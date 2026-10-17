using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.WatchGuard;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;
using Moq;
using Jellyfin.Plugin.WatchGuard.ServerEnforcement;
using Xunit;

public sealed class BoundaryTests : IDisposable
{
    public sealed class MovieFixture : Movie { public bool Permitted = true; public override bool CanDelete(User user) => Permitted; }
    public sealed class EpisodeFixture : Episode { public override bool CanDelete(User user) => true; }
    private readonly string directory = Path.Combine(Path.GetTempPath(), "approval-unit-" + Guid.NewGuid());
    private readonly User user = new("fixture", "test", "test") { Id = Guid.NewGuid() };
    private readonly MovieFixture movie = new() { Id = Guid.NewGuid(), Path = "/fixture/movie.mp4", DateCreated = DateTime.UtcNow };
    private readonly Mock<ILibraryManager> library = new();
    private readonly Mock<IUserManager> users = new();
    private readonly Mock<IAuthorizationContext> auth = new();
    private readonly Mock<IUserDataManager> data = new();
    private readonly ApprovalStore approvals = new(new Clock());
    private readonly WorkAdmission work = new(new Clock());
    private readonly Identity identity;
    private readonly Evaluator evaluator;
    private readonly WatchlistStore watchlists;
    public BoundaryTests()
    {
        user.SetPermission(PermissionKind.IsAdministrator, true);
        users.Setup(u => u.GetUserById(user.Id)).Returns(user); users.Setup(u => u.GetUsers()).Returns([user]);
        auth.Setup(a => a.GetAuthorizationInfo(It.IsAny<HttpRequest>())).ReturnsAsync(new AuthorizationInfo { IsAuthenticated = true, User = user, Token = "token" });
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, user)).Returns(movie);
        library.Setup(l => l.GetItemIdsWithAlternateVersions(It.IsAny<IReadOnlyList<Guid>>())).Returns(new HashSet<Guid>());
        data.Setup(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), user)).Returns((IReadOnlyList<BaseItem> items, User _) => items.ToDictionary(i => i.Id, _ => new UserItemData { Key = "fixture" }));
        data.Setup(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), user)).Returns(new Dictionary<Guid, VersionResumeData>());
        var sessions = new Mock<ISessionManager>(); sessions.Setup(s => s.Sessions).Returns(Array.Empty<SessionInfo>());
        watchlists = new(directory); identity = new(auth.Object, users.Object, approvals);
        evaluator = new(library.Object, new InterestService(watchlists, library.Object, users.Object, data.Object, sessions.Object), approvals, NullLogger<Evaluator>.Instance);
    }
    private DefaultHttpContext Context()
    {
        var http = new DefaultHttpContext(); http.Request.Scheme = "https"; http.Request.Host = new("fixture.invalid");
        http.Request.Headers.Authorization = "MediaBrowser Token=\"token\""; return http;
    }
    private Owner Owner => new(user.Id, approvals.SessionDigest("token"));
    private Operation Operation => Operation.Create("DeleteItem", [movie.Id]);
    private string Approved()
    {
        watchlists.Set(user.Id, movie.Id, true);
        var state = evaluator.Read(Operation, user, default);
        var t = approvals.Create(Owner, Operation, state.Fingerprint, state.Resources);
        approvals.Transition(t.Id, Owner, Operation, state.Fingerprint, ApprovalState.Presented);
        approvals.Transition(t.Id, Owner, Operation, state.Fingerprint, ApprovalState.Approved);
        return t.Id;
    }
    private async Task<(int Calls, IActionResult? Result)> Invoke(string? id, bool nativeFailure = false, bool cancelled = false, bool enabled = true)
    {
        var http = Context(); if (id is not null) http.Request.Headers[Guard.ApprovalHeader] = id;
        if (cancelled) http.RequestAborted = new CancellationToken(true);
        var context = new ActionContext(http, new RouteData(), new ActionDescriptor());
        var executing = new ActionExecutingContext(context, [], new Dictionary<string, object?> { ["itemId"] = movie.Id }, new object());
        var calls = 0;
        var guard = new Guard(identity, evaluator, approvals, work, new Attachment { Supported = true, EnabledAtStartup = enabled }, NullLogger<Guard>.Instance);
        await guard.OnActionExecutionAsync(executing, () =>
        {
            calls++; if (nativeFailure) throw new InvalidOperationException("native");
            return Task.FromResult(new ActionExecutedContext(context, [], new object()) { Result = new NoContentResult() });
        });
        return (calls, executing.Result);
    }
    [Theory]
    [InlineData("Origin", "https://other.invalid")]
    [InlineData("Origin", "null")]
    [InlineData("Sec-Fetch-Site", "same-site")]
    [InlineData("Sec-Fetch-Site", "cross-site")]
    [InlineData("Authorization", "")]
    [InlineData("Authorization", "MediaBrowser Token=\"wrong\"")]
    public async Task CsrfAndCredentialBoundary(string header, string value)
    {
        var context = Context(); context.Request.Headers[header] = value;
        Assert.Equal("ApprovalInvalid", (await Assert.ThrowsAsync<GuardFailure>(() => identity.Read(context))).Code);
    }
    [Fact] public async Task SameOriginAndNonBrowserBearerAreAcceptedButQueryTokensAreNot()
    {
        var context = Context(); Assert.Equal(user.Id, (await identity.Read(context, true)).User.Id);
        context.Request.Headers.Origin = "https://fixture.invalid"; context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        await identity.Read(context, true);
        context.Request.QueryString = new("?api_key=token"); await Assert.ThrowsAsync<GuardFailure>(() => identity.Read(context));
    }
    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task DisabledAndApiKeyCannotApprove(bool disabled, bool key)
    {
        user.SetPermission(PermissionKind.IsDisabled, disabled);
        auth.Setup(a => a.GetAuthorizationInfo(It.IsAny<HttpRequest>())).ReturnsAsync(new AuthorizationInfo { IsAuthenticated = true, User = user, Token = "token", IsApiKey = key });
        Assert.Equal("NativePermissionDenied", (await Assert.ThrowsAsync<GuardFailure>(() => identity.Read(Context(), true))).Code);
    }
    [Fact] public async Task ApprovalCallsNativeOnceAndReplayNeverDoes()
    {
        var id = Approved(); Assert.Equal(1, (await Invoke(id)).Calls); Assert.Equal(0, (await Invoke(id)).Calls);
    }
    [Fact] public async Task NativeFailureConsumesWithoutRetryOrReplacementResult()
    {
        var id = Approved(); await Assert.ThrowsAsync<InvalidOperationException>(() => Invoke(id, nativeFailure: true));
        Assert.Equal(0, (await Invoke(id)).Calls);
    }
    [Fact] public async Task CancellationAndFailedLookupAndRevokedPermissionNeverContinue()
    {
        var id = Approved(); Assert.Equal(0, (await Invoke(id, cancelled: true)).Calls);
        movie.Permitted = false; Assert.Equal(0, (await Invoke(id)).Calls);
        movie.Permitted = true;
        id = Approved(); data.Setup(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), user)).Throws<InvalidDataException>();
        Assert.Equal(0, (await Invoke(id)).Calls);
    }
    [Fact] public async Task ReplacementMetadataAndNewVersionAndMissingItemInvalidate()
    {
        var id = Approved(); movie.DateModified = DateTime.UtcNow; Assert.Equal(0, (await Invoke(id)).Calls);
        id = Approved(); movie.Path = "/fixture/replacement.mp4"; Assert.Equal(0, (await Invoke(id)).Calls);
        id = Approved(); library.Setup(l => l.GetItemById<BaseItem>(movie.Id, user)).Returns((BaseItem?)null); Assert.Equal(0, (await Invoke(id)).Calls);
    }
    [Fact] public async Task AlternateVersionChangesInvalidateAndReserveVersionInventory()
    {
        var id = Approved(); var alternate = new MovieFixture { Id = Guid.NewGuid(), Path = "/fixture/alternate.mp4" };
        library.Setup(l => l.GetItemIdsWithAlternateVersions(It.IsAny<IReadOnlyList<Guid>>())).Returns(new HashSet<Guid> { movie.Id });
        library.Setup(l => l.GetLocalAlternateVersionIds(movie)).Returns([alternate.Id]);
        library.Setup(l => l.GetLinkedAlternateVersions(movie)).Returns(Array.Empty<Video>());
        library.Setup(l => l.GetItemById<BaseItem>(alternate.Id, user)).Returns(alternate);
        Assert.Equal(0, (await Invoke(id)).Calls);
        Assert.Contains(alternate.Id, evaluator.Read(Operation, user, default).Resources);
    }
    [Fact] public async Task RemovingInterestNeverMakesAStaleHeaderBypassValidation()
    {
        var id = Approved(); watchlists.Set(user.Id, movie.Id, false); Assert.Equal(0, (await Invoke(id)).Calls);
        Assert.Equal(1, (await Invoke(null)).Calls); // Fresh clear request without any approval follows native behavior.
    }
    [Fact] public void ParentSeriesChangesChangeFingerprint()
    {
        var a = new Series { Id = Guid.NewGuid() }; var b = new Series { Id = Guid.NewGuid() };
        var episode = new EpisodeFixture { Id = Guid.NewGuid(), SeriesId = a.Id };
        library.Setup(l => l.GetItemById<BaseItem>(episode.Id, user)).Returns(episode);
        library.Setup(l => l.GetItemById<BaseItem>(a.Id, user)).Returns(a); library.Setup(l => l.GetItemById<BaseItem>(b.Id, user)).Returns(b);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns(Array.Empty<BaseItem>());
        var op = Operation.Create("DeleteItem", [episode.Id]); var first = evaluator.Read(op, user, default);
        episode.SeriesId = b.Id; Assert.NotEqual(first.Fingerprint, evaluator.Read(op, user, default).Fingerprint);
    }
    [Fact] public async Task PrepareIsNonAuthorizingAndBoundToFreshNativePermission()
    {
        watchlists.Set(user.Id, movie.Id, true);
        using var services = new ServiceCollection().AddSingleton(new Attachment { Supported = true, EnabledAtStartup = true })
            .AddSingleton(identity).AddSingleton(evaluator).AddSingleton(approvals).AddSingleton(work).BuildServiceProvider();
        var controller = new WebProtocol(services, auth.Object, users.Object) { ControllerContext = new ControllerContext { HttpContext = Context() } };
        var result = Assert.IsType<OkObjectResult>(await controller.Prepare(new("DeleteItem", [movie.Id])));
        var json = JsonSerializer.SerializeToElement(result.Value);
        var id = json.GetProperty("ChallengeId").GetString()!;
        var ticket = approvals.Read(id, Owner);
        Assert.Equal(ApprovalState.Created, ticket.State);
        Assert.Throws<GuardFailure>(() => approvals.Consume(id, Owner, Operation, ticket.Fingerprint));
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
        movie.Permitted = false;
        Assert.Equal(403, Assert.IsType<ObjectResult>(await controller.Prepare(new("DeleteItem", [movie.Id]))).StatusCode);
    }
    [Fact] public async Task PrepareDoesNotGrantOrdinaryUserOrApiKeyOverrides()
    {
        using var services = new ServiceCollection().AddSingleton(new Attachment { Supported = true, EnabledAtStartup = true }).AddSingleton(identity).BuildServiceProvider();
        var controller = new WebProtocol(services, auth.Object, users.Object) { ControllerContext = new ControllerContext { HttpContext = Context() } };
        user.SetPermission(PermissionKind.IsAdministrator, false);
        Assert.Equal(403, Assert.IsType<ObjectResult>(await controller.Prepare(new("DeleteItem", [movie.Id]))).StatusCode);
        auth.Setup(a => a.GetAuthorizationInfo(It.IsAny<HttpRequest>())).ReturnsAsync(new AuthorizationInfo { IsAuthenticated = true, IsApiKey = true, User = user, Token = "token" });
        Assert.Equal(403, Assert.IsType<ObjectResult>(await controller.Prepare(new("DeleteItem", [movie.Id]))).StatusCode);
    }
    [Theory]
    [InlineData(false, false, "Unhealthy")]
    [InlineData(true, false, "Unhealthy")]
    [InlineData(true, true, "Enabled")]
    public async Task CapabilitiesReportActualServerAttachment(bool registered, bool supported, string expected)
    {
        var collection = new ServiceCollection().AddSingleton(approvals).AddSingleton(identity);
        if (registered) collection.AddSingleton(new Attachment { Supported = supported, EnabledAtStartup = true });
        using var services = collection.BuildServiceProvider();
        var controller = new WebProtocol(services, auth.Object, users.Object) { ControllerContext = new ControllerContext { HttpContext = Context() } };
        var result = Assert.IsType<OkObjectResult>(await controller.Capabilities());
        Assert.Equal(expected, JsonSerializer.SerializeToElement(result.Value).GetProperty("State").GetString());
        Assert.Equal("no-store", controller.Response.Headers.CacheControl);
    }
    [Fact] public async Task DisabledFilterDoesNoAuthenticationOrProtectionWork()
    {
        watchlists.Set(user.Id, movie.Id, true);
        auth.Invocations.Clear(); library.Invocations.Clear(); data.Invocations.Clear();
        Assert.Equal(1, (await Invoke(null, enabled: false)).Calls);
        Assert.Empty(auth.Invocations); Assert.Empty(library.Invocations); Assert.Empty(data.Invocations);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Invoke(null, nativeFailure: true, enabled: false));
    }
    [Fact] public void OldConfigurationDefaultsOffAndExplicitTrueRoundTrips()
    {
        var serializer = new System.Xml.Serialization.XmlSerializer(typeof(Configuration));
        var old = (Configuration)serializer.Deserialize(new StringReader("<Configuration><ProtectCaughtUpSeries>false</ProtectCaughtUpSeries></Configuration>"))!;
        Assert.False(old.EnableServerEnforcement); Assert.False(old.ProtectCaughtUpSeries);
        old.EnableServerEnforcement = true;
        var output = new StringWriter(); serializer.Serialize(output, old);
        var restored = (Configuration)serializer.Deserialize(new StringReader(output.ToString()))!;
        Assert.True(restored.EnableServerEnforcement); Assert.False(restored.ProtectCaughtUpSeries);
        Assert.False(new Attachment { Supported = true }.Active);
        Assert.True(new Attachment { Supported = true, EnabledAtStartup = true }.Active);
    }
    [Fact] public async Task CapabilityOriginMismatchIsUnhealthyAndCannotDowngrade()
    {
        using var services = new ServiceCollection().AddSingleton(approvals).AddSingleton(identity)
            .AddSingleton(new Attachment { Supported = true, EnabledAtStartup = true }).BuildServiceProvider();
        var context = Context(); context.Request.Headers.Origin = "https://proxy.invalid";
        var controller = new WebProtocol(services, auth.Object, users.Object) { ControllerContext = new ControllerContext { HttpContext = context } };
        var result = Assert.IsType<OkObjectResult>(await controller.Capabilities());
        var json = JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal("Unhealthy", json.GetProperty("State").GetString());
        Assert.True(json.GetProperty("Expected").GetBoolean());
    }
    [Fact] public async Task CapabilityRejectsUnsupportedCredentialTransportAsUnhealthy()
    {
        using var services = new ServiceCollection().AddSingleton(approvals).AddSingleton(identity)
            .AddSingleton(new Attachment { Supported = true, EnabledAtStartup = true }).BuildServiceProvider();
        var context = Context(); context.Request.Headers.Authorization = "";
        var controller = new WebProtocol(services, auth.Object, users.Object) { ControllerContext = new ControllerContext { HttpContext = context } };
        var result = Assert.IsType<OkObjectResult>(await controller.Capabilities());
        var json = JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal("Unhealthy", json.GetProperty("State").GetString());
        Assert.True(json.GetProperty("Expected").GetBoolean());
        Assert.StartsWith("Unavailable;", json.GetProperty("AuthorizationState").GetString(), StringComparison.Ordinal);
    }
    [Theory]
    [InlineData("same-origin", true)]
    [InlineData("cross-site", false)]
    [InlineData("same-site", false)]
    [InlineData("none", false)]
    [InlineData(null, false)]
    public async Task HttpsProxyReadinessUsesPostBoundaryWithoutEvaluatingMedia(string? site, bool expected)
    {
        using var services = new ServiceCollection().AddSingleton(identity)
            .AddSingleton(new Attachment { Supported = true, EnabledAtStartup = true }).BuildServiceProvider();
        var context = Context(); context.Request.Method = "POST"; context.Request.Scheme = "http";
        context.Request.Headers.Origin = "https://fixture.invalid";
        if (site is not null) context.Request.Headers["Sec-Fetch-Site"] = site;
        var controller = new WebProtocol(services, auth.Object, users.Object) { ControllerContext = new() { HttpContext = context } };
        var response = Assert.IsAssignableFrom<ObjectResult>(await controller.Readiness());
        Assert.Equal(expected ? 200 : 403, response.StatusCode);
        Assert.Equal(expected, JsonSerializer.SerializeToElement(response.Value).GetProperty("ApprovalRequestsReady").GetBoolean());
        Assert.Equal("no-store", context.Response.Headers.CacheControl.ToString());
        library.VerifyNoOtherCalls(); data.VerifyNoOtherCalls();
    }
    [Fact] public async Task ProxyEvidenceDoesNotAuthenticateCookieOrQueryCredentials()
    {
        var context = Context(); context.Request.Scheme = "http";
        context.Request.Headers.Origin = "https://fixture.invalid"; context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        context.Request.Headers.Authorization = ""; context.Request.Headers.Cookie = "token=token";
        await Assert.ThrowsAsync<GuardFailure>(() => identity.Read(context, true));
        context.Request.Headers.Authorization = "MediaBrowser Token=\"token\"";
        context.Request.QueryString = new("?api_key=token");
        await Assert.ThrowsAsync<GuardFailure>(() => identity.Read(context, true));
    }
    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task ReadinessDoesNotClaimBrowserOrInactiveGuardFromAuthenticationAlone(bool active, bool origin)
    {
        using var services = new ServiceCollection().AddSingleton(identity)
            .AddSingleton(new Attachment { Supported = true, EnabledAtStartup = active }).BuildServiceProvider();
        var context = Context();
        if (origin) context.Request.Headers.Origin = "https://fixture.invalid";
        var controller = new WebProtocol(services, auth.Object, users.Object) { ControllerContext = new() { HttpContext = context } };
        var response = Assert.IsType<OkObjectResult>(await controller.Readiness());
        var json = JsonSerializer.SerializeToElement(response.Value);
        Assert.False(json.GetProperty("ApprovalRequestsReady").GetBoolean());
        Assert.Equal(active, json.GetProperty("GuardActive").GetBoolean());
        library.VerifyNoOtherCalls(); data.VerifyNoOtherCalls();
    }
    public void Dispose() { work.Dispose(); if (Directory.Exists(directory)) Directory.Delete(directory, true); }
}
