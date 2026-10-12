using System.Text;
using Jellyfin.Plugin.WatchGuard.Standalone;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Xunit;

namespace WatchGuard.Tests;
public sealed class StandaloneTests
{
    [Theory]
    [InlineData("/web/index.html", "GET", 200, "text/html", true)]
    [InlineData("/web/", "GET", 200, "text/html; charset=utf-8", true)]
    [InlineData("/api/example", "GET", 200, "text/html", false)]
    [InlineData("/web/index.html", "GET", 500, "text/html", false)]
    [InlineData("/web/index.html", "POST", 200, "text/html", false)]
    [InlineData("/web/index.html", "GET", 200, "application/json", false)]
    public async Task OnlySuccessfulWebGetHtmlIsModified(string path,string method,int status,string contentType,bool injected)
    {
        var context=new DefaultHttpContext(); context.Request.Path=path;context.Request.Method=method;
        await using var output=new MemoryStream();context.Response.Body=output;
        await StandaloneStartupFilter.Rewrite(context,async()=>{
            context.Response.StatusCode=status;context.Response.ContentType=contentType;
            var bytes=Encoding.UTF8.GetBytes("<html><head></head><body>Native</body></html>");
            context.Response.ContentLength=bytes.Length;await context.Response.Body.WriteAsync(bytes);
        },"",()=>true);
        var body=Encoding.UTF8.GetString(output.ToArray());
        Assert.Equal(injected,body.Contains("watchguard-standalone-loader",StringComparison.Ordinal));
        Assert.Equal(status,context.Response.StatusCode);
        Assert.Equal(output.Length,context.Response.ContentLength);
    }
    [Fact]
    public async Task PrefixDuplicateCacheAndHeadContracts()
    {
        var context=new DefaultHttpContext();context.Request.Path="/jellyfin/web/index.html";context.Request.Method="GET";
        context.Request.Headers.AcceptEncoding="gzip";context.Request.Headers.IfNoneMatch="old";
        await using var output=new MemoryStream();context.Response.Body=output;
        await StandaloneStartupFilter.Rewrite(context,async()=>{
            Assert.False(context.Request.Headers.ContainsKey("Accept-Encoding"));Assert.False(context.Request.Headers.ContainsKey("If-None-Match"));
            context.Response.ContentType="text/html";context.Response.Headers.ETag="old";
            await context.Response.Body.WriteAsync(Encoding.UTF8.GetBytes("<head></head>"));
        },"/jellyfin",()=>true);
        Assert.Contains("/jellyfin/WatchGuard/Standalone/bootstrap.js",Encoding.UTF8.GetString(output.ToArray()), StringComparison.Ordinal);
        Assert.Equal("gzip",context.Request.Headers.AcceptEncoding.ToString());Assert.False(context.Response.Headers.ContainsKey("ETag"));
        Assert.Equal("no-store",context.Response.Headers.CacheControl.ToString());
        output.SetLength(0);
        await StandaloneStartupFilter.Rewrite(context,()=>context.Response.WriteAsync("<head><script id=\"watchguard-standalone-loader\"></script></head>"),"/jellyfin",()=>true);
        Assert.Equal(1,Encoding.UTF8.GetString(output.ToArray()).Split("watchguard-standalone-loader").Length-1);
        output.SetLength(0);context.Request.Method="HEAD";
        await StandaloneStartupFilter.Rewrite(context,()=>{context.Response.ContentLength=999;return Task.CompletedTask;},"/jellyfin",()=>true);
        Assert.Equal(0,output.Length);Assert.Null(context.Response.ContentLength);
    }
    [Fact]
    public async Task ConflictAndFailuresDoNotInjectOrLeaveReplacedBody()
    {
        var context=new DefaultHttpContext();context.Request.Path="/web/index.html";context.Request.Method="GET";
        await using var output=new MemoryStream();context.Response.Body=output;
        await StandaloneStartupFilter.Rewrite(context,()=>context.Response.WriteAsync("original"),"",()=>false);
        Assert.Equal("original",Encoding.UTF8.GetString(output.ToArray()));
        await Assert.ThrowsAsync<IOException>(()=>StandaloneStartupFilter.Rewrite(context,()=>throw new IOException(),"",()=>true));
        Assert.Same(output,context.Response.Body);
    }
    [Theory]
    [InlineData(1048576, false)]
    [InlineData(1048577, true)]
    [InlineData(4194304, true)]
    public async Task OversizedDocumentsPassThroughWithoutTruncation(int size, bool unchanged)
    {
        var context = new DefaultHttpContext(); context.Request.Path = "/web/"; context.Request.Method = "GET";
        await using var output = new MemoryStream(); context.Response.Body = output;
        var input = Encoding.UTF8.GetBytes("<head></head>" + new string('x', size - 13));
        await StandaloneStartupFilter.Rewrite(context, async () => {
            context.Response.ContentType = "text/html"; context.Response.ContentLength = input.Length;
            context.Response.Headers.ETag = "original";
            // Cross the bound incrementally, then exercise another write after bypass.
            for (var offset = 0; offset < input.Length; offset += 8192)
                await context.Response.Body.WriteAsync(input.AsMemory(offset, Math.Min(8192, input.Length-offset)));
        }, "", () => true);
        if (unchanged) { Assert.Equal(input, output.ToArray()); Assert.Equal("original", context.Response.Headers.ETag); }
        else Assert.Contains("watchguard-standalone-loader", Encoding.UTF8.GetString(output.ToArray()), StringComparison.Ordinal);
    }
    [Theory]
    [InlineData("flush")]
    [InlineData("start")]
    [InlineData("304")]
    [InlineData("encoded")]
    [InlineData("charset")]
    [InlineData("invalid-utf8")]
    public async Task UnsafeResponsesRemainUntouched(string kind)
    {
        var context = new DefaultHttpContext(); context.Request.Path = "/web/"; context.Request.Method = "GET";
        await using var output = new MemoryStream(); context.Response.Body = output;
        var input = kind == "invalid-utf8" ? new byte[] { 255, 254 } : Encoding.UTF8.GetBytes("<head></head>");
        await StandaloneStartupFilter.Rewrite(context, async () => {
            context.Response.ContentType = kind == "charset" ? "text/html; charset=iso-8859-1" : "text/html";
            if (kind == "304") context.Response.StatusCode = 304;
            if (kind == "encoded") context.Response.Headers.ContentEncoding = "gzip";
            if (kind == "start") await context.Response.StartAsync();
            await context.Response.Body.WriteAsync(input);
            if (kind == "flush") await context.Response.Body.FlushAsync();
        }, "", () => true);
        Assert.Equal(input, output.ToArray()); Assert.Same(output, context.Response.Body);
    }

    [Fact]
    public async Task NativeSendFileUsesBoundedCaptureAndRestoresFeature()
    {
        var file = Path.GetTempFileName();
        try {
            await File.WriteAllTextAsync(file, "<head></head>");
            var context = new DefaultHttpContext(); context.Request.Path = "/web/"; context.Request.Method = "GET";
            await using var output = new MemoryStream(); context.Response.Body = output;
            var original = context.Features.Get<IHttpResponseBodyFeature>();
            await StandaloneStartupFilter.Rewrite(context, async () => {
                context.Response.ContentType = "text/html";
                await context.Response.SendFileAsync(file, 0, null);
            }, "", () => true);
            Assert.Contains("watchguard-standalone-loader", Encoding.UTF8.GetString(output.ToArray()), StringComparison.Ordinal);
            Assert.Same(original, context.Features.Get<IHttpResponseBodyFeature>());
        } finally { File.Delete(file); }
    }
    private sealed class StartedResponse : HttpResponseFeature { public override bool HasStarted => true; }
    [Theory]
    [InlineData("/web/")]
    [InlineData("/WatchGuard/Standalone/script.js")]
    public async Task AlreadyStartedResponsesAreNotRewritten(string path)
    {
        var context = new DefaultHttpContext(); context.Features.Set<IHttpResponseFeature>(new StartedResponse());
        context.Request.Method = "GET"; context.Request.Path = path; context.Request.Headers.AcceptEncoding = "gzip";
        await using var output = new MemoryStream(); context.Response.Body = output;
        await StandaloneStartupFilter.Rewrite(context, async () => {
            Assert.Equal("gzip", context.Request.Headers.AcceptEncoding);
            await context.Response.Body.WriteAsync(Encoding.UTF8.GetBytes("<head></head>"));
        }, "", () => true);
        Assert.Equal("<head></head>", Encoding.UTF8.GetString(output.ToArray()));
        Assert.False(context.Response.Headers.ContainsKey("Cache-Control"));
    }

    public sealed class ThrowingInjector { public static ThrowingInjector Instance => throw new InvalidOperationException(); public object Configuration => new EmptyConfig(); }
    public sealed class EmptyInjector { public static EmptyInjector Instance => new(); public object Configuration => new EmptyConfig(); }
    public sealed class EmptyConfig { public object[] PluginJavaScripts => []; }
    public sealed class ConflictInjector { public static ConflictInjector Instance => new(); public object Configuration => new ConflictConfig(); }
    public sealed class ConflictConfig { public object[] PluginJavaScripts => [new Entry("unrelated"), new Entry("watchguard-v1")]; }
    public sealed record Entry(string Id);
    [Fact]
    public void CoexistenceIsReadOnlyAndFailsClosedForUnknownContracts()
    {
        var absent = StandaloneMode.InspectInjector(null);
        Assert.False(absent.Discovered);
        var unknown = StandaloneMode.InspectInjector(typeof(string));
        Assert.True(unknown.Discovered); Assert.False(unknown.InterfaceCompatible);
        Assert.False(StandaloneMode.InspectInjector(typeof(ThrowingInjector)).InterfaceCompatible);
        var empty = StandaloneMode.InspectInjector(typeof(EmptyInjector));
        Assert.True(empty.InterfaceCompatible); Assert.False(empty.WatchGuardRegistration);
        var conflict = StandaloneMode.InspectInjector(typeof(ConflictInjector));
        Assert.True(conflict.InterfaceCompatible); Assert.True(conflict.WatchGuardRegistration);
        Assert.Equal(2, new ConflictConfig().PluginJavaScripts.Length);
    }
    [Fact]
    public void NormalAssemblyContainsLoaderAndNoRegistrationService()
    {
        var assembly = typeof(StandaloneMode).Assembly;
        Assert.Contains("Jellyfin.Plugin.WatchGuard.Standalone.bootstrap.js", assembly.GetManifestResourceNames());
        Assert.Null(assembly.GetType("Jellyfin.Plugin.WatchGuard.InjectorRegistration"));
        Assert.True(new StandaloneMode().CanLoad());
    }

}


