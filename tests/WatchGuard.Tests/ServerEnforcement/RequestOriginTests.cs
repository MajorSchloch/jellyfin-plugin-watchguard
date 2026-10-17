using Jellyfin.Plugin.WatchGuard.ServerEnforcement;
using Microsoft.AspNetCore.Http;
using Xunit;

public class RequestOriginTests
{
    [Theory]
    [InlineData("http", "fixture.test", "http://fixture.test", null, "SameOrigin")]
    [InlineData("https", "fixture.test", "https://fixture.test", "same-origin", "SameOrigin")]
    [InlineData("http", "fixture.test", "https://fixture.test", "same-origin", "HttpsProxySameOrigin")]
    [InlineData("http", "fixture.test:8443", "https://fixture.test:8443", "same-origin", "HttpsProxySameOrigin")]
    [InlineData("http", "fixture.test", "https://fixture.test", null, "OriginSchemeMismatch")]
    [InlineData("http", "fixture.test", "https://fixture.test", "none", "OriginSchemeMismatch")]
    [InlineData("https", "fixture.test", "http://fixture.test", "same-origin", "OriginSchemeMismatch")]
    [InlineData("http", "fixture.test", "https://fixture.test", "same-site", "FetchMetadataRejected")]
    [InlineData("http", "fixture.test", "https://fixture.test", "cross-site", "FetchMetadataRejected")]
    [InlineData("http", "fixture.test", "https://evil.test", "same-origin", "OriginHostMismatch")]
    [InlineData("http", "evil.test", "https://fixture.test", "same-origin", "OriginHostMismatch")]
    [InlineData("http", "fixture.test:8096", "https://fixture.test", "same-origin", "OriginHostMismatch")]
    [InlineData("http", "fixture.test", "null", "same-origin", "OriginMalformed")]
    [InlineData("http", "fixture.test", "https://name@fixture.test", "same-origin", "OriginMalformed")]
    [InlineData("http", "fixture.test", "https://fixture.test/path", "same-origin", "OriginMalformed")]
    [InlineData("http", "fixture.test", "https://fixture.test?x=y", "same-origin", "OriginMalformed")]
    [InlineData("http", "fixture.test", "https://fixture.test#x", "same-origin", "OriginMalformed")]
    [InlineData("http", "fixture.test", null, null, "NoOriginObserved")]
    [InlineData("http", "fixture.test", null, "cross-site", "FetchMetadataRejected")]
    public void ExactBrowserBoundary(string scheme, string host, string? origin, string? site, string expected)
    {
        var context = new DefaultHttpContext(); var request = context.Request;
        request.Scheme = scheme; request.Host = new(host); request.PathBase = "/jellyfin";
        if (origin is not null) request.Headers.Origin = origin;
        if (site is not null) request.Headers["Sec-Fetch-Site"] = site;
        Assert.Equal(expected, RequestOrigin.Evaluate(request));
        request.Headers["X-Forwarded-Host"] = "evil.test";
        request.Headers["X-Forwarded-Proto"] = "https";
        Assert.Equal(expected, RequestOrigin.Evaluate(request));
    }
    [Fact] public void DuplicateHeadersAreRejected()
    {
        var request = new DefaultHttpContext().Request;
        request.Scheme = "http"; request.Host = new("fixture.test");
        request.Headers.Origin = new Microsoft.Extensions.Primitives.StringValues(["https://fixture.test", "https://fixture.test"]);
        Assert.Equal("OriginMalformed", RequestOrigin.Evaluate(request));
        request.Headers.Origin = "https://fixture.test";
        request.Headers["Sec-Fetch-Site"] = new Microsoft.Extensions.Primitives.StringValues(["same-origin", "same-origin"]);
        Assert.Equal("FetchMetadataRejected", RequestOrigin.Evaluate(request));
    }
}
