using System.Text;
using System.Text.Encodings.Web;
using MediaBrowser.Common.Net;
using MediaBrowser.Controller.Configuration;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;

namespace Jellyfin.Plugin.WatchGuard.Standalone;

// Standalone entry-document loader. No Injector middleware source is incorporated.
public sealed class StandaloneStartupFilter(StandaloneMode mode, IServerConfigurationManager configuration) : IStartupFilter
{
    // Static code only: no route, user data or credentials are interpolated into script.
    // Existing CSP remains authoritative (including policies that forbid inline scripts).
    private static readonly string Startup = ReadStartup();
    private static string ReadStartup()
    {
        using var stream = typeof(StandaloneStartupFilter).Assembly.GetManifestResourceStream("Jellyfin.Plugin.WatchGuard.Standalone.startup.js")!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
    {
        mode.MiddlewareRegistered = true;
        var prefix = configuration.GetNetworkConfiguration().BaseUrl.TrimEnd('/');
        app.Use((context, following) => Rewrite(context, following, prefix, mode.CanLoad));
        next(app);
    };

    public static async Task Rewrite(HttpContext context, Func<Task> next, string prefix, Func<bool> canLoad)
    {
        var path = context.Request.Path.Value;
        if (!context.Response.HasStarted && path?.StartsWith(prefix + "/WatchGuard/Standalone/", StringComparison.OrdinalIgnoreCase) == true)
        {
            context.Response.Headers.CacheControl = "no-store, private";
            context.Response.Headers.Vary = "Authorization";
            context.Response.Headers.XContentTypeOptions = "nosniff";
        }
        if ((path != prefix + "/web/" && path != prefix + "/web/index.html") ||
            (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method)) || context.Response.HasStarted || !canLoad())
        { await next(); return; }

        var names = new[] { "Accept-Encoding", "If-None-Match", "If-Modified-Since", "Range", "If-Range" };
        var saved = names.ToDictionary(n => n, n => context.Request.Headers[n]);
        foreach (var name in names) context.Request.Headers.Remove(name);
        var original = context.Response.Body;
        await using var buffer = new EntryDocumentBuffer(original);
        var priorFeature = context.Features.Get<IHttpResponseBodyFeature>()!;
        var feature = new EntryDocumentBodyFeature(buffer, priorFeature);
        context.Features.Set<IHttpResponseBodyFeature>(feature);
        try
        {
            await next();
            context.Features.Set(priorFeature);
            var response = context.Response;
            if (buffer.Passthrough) return;
            if (response.StatusCode == 200 && !response.HasStarted &&
                Microsoft.Net.Http.Headers.MediaTypeHeaderValue.TryParse(response.ContentType, out var mediaType) &&
                mediaType.MediaType.Equals("text/html", StringComparison.OrdinalIgnoreCase) &&
                (!mediaType.Charset.HasValue || mediaType.Charset.Equals("utf-8", StringComparison.OrdinalIgnoreCase)) &&
                !response.Headers.ContainsKey("Content-Encoding"))
            {
                if (HttpMethods.IsHead(context.Request.Method))
                {
                    NoCache(response); response.ContentLength = null; return;
                }
                if (buffer.Length <= EntryDocumentBuffer.Limit)
                {
                    var html = new UTF8Encoding(false, true).GetString(buffer.Captured);
                    var end = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                    if (end >= 0 && !html.Contains("id=\"watchguard-standalone-loader\"", StringComparison.Ordinal))
                    {
                        var tag = "<script id=\"watchguard-startup-handoff\">" + Startup + "</script><script id=\"watchguard-standalone-loader\" defer src=\"" +
                            HtmlEncoder.Default.Encode(prefix + "/WatchGuard/Standalone/bootstrap.js") + "\"></script>";
                        var bytes = Encoding.UTF8.GetBytes(html.Insert(end, tag));
                        NoCache(response); response.ContentLength = bytes.Length;
                        await original.WriteAsync(bytes, context.RequestAborted); return;
                    }
                }
            }
            await original.WriteAsync(buffer.Captured, context.RequestAborted);
        }
        catch (DecoderFallbackException)
        {
            // Invalid UTF-8: preserve the original response and do not load WatchGuard.
            context.Features.Set(priorFeature); await original.WriteAsync(buffer.Captured, context.RequestAborted);
        }
        finally
        {
            feature.Dispose();
            context.Features.Set(priorFeature);
            foreach (var (name, value) in saved) { if (value.Count == 0) context.Request.Headers.Remove(name); else context.Request.Headers[name] = value; }
        }
    }
    private static void NoCache(HttpResponse response)
    {
        response.Headers.CacheControl = "no-store";
        foreach (var header in new[] { "ETag", "Last-Modified", "Accept-Ranges", "Content-Range" }) response.Headers.Remove(header);
    }
}
