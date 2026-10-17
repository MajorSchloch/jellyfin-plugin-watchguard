"""Disposable Jellyfin-native reverse-proxy policy regression.

This is NOT a WatchGuard approval test. It verifies Jellyfin's own remote
client classification and EnableRemoteAccess authorization against the
exact pinned Jellyfin server, using a synthetic TEST-NET IP and a generated
non-admin account. No production network, account or media is touched.
"""
import json
import secrets
import urllib.error
import urllib.request

REMOTE_TEST_IP = "198.51.100.77"  # RFC 5737 TEST-NET-2, never a real client


def _get(caddy, route, token=None):
    headers = {}
    if token:
        headers["Authorization"] = 'MediaBrowser Client="ProxyFixture", Device="Disposable", DeviceId="proxy-boundary", Version="1", Token="' + token + '"'
    request = urllib.request.Request(caddy.base + route, headers=headers)
    try:
        with urllib.request.urlopen(request, context=caddy.ssl, timeout=20) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read()
    return status, json.loads(body) if status == 200 else None


def _public_contains(caddy, user_id):
    status, body = _get(caddy, "/Users/Public")
    assert status == 200 and isinstance(body, list), ("Native public-user API", status)
    return any(user.get("Id") == user_id for user in body)


def _set_forwarded_test_ip(docker, jellyfin, root, caddy):
    path = root / "Caddyfile"
    original = path.read_text()
    anchor = "reverse_proxy " + jellyfin + ":8096"
    assert original.count(anchor) == 1, "Disposable Caddy forwarding anchor must be unique"
    # The fixture proxy, not the caller, supplies an unambiguous synthetic
    # public client IP. This must never be used for a real proxy configuration.
    replacement = anchor + " {\n  header_up X-Forwarded-For " + REMOTE_TEST_IP + "\n }"
    path.write_text(original.replace(anchor, replacement))
    docker("exec", caddy.name, "caddy", "reload", "--config", "/etc/caddy/Caddyfile")
    return original


def begin(docker, jellyfin, root, caddy, native):
    """Observe missing native trust before the enclosing fixture enables it."""
    assert not native("/System/Configuration/network").get("KnownProxies"), "Must begin with no native trusted proxy"
    username = "ProxyRemoteRestrictedFixture"
    password = secrets.token_hex(20)
    user = native("/Users/New", "POST", {"Name": username, "Password": password})
    user_id = user["Id"]
    signed = native("/Users/AuthenticateByName", "POST", {"Username": username, "Pw": password}, device="proxy-remote")
    token = signed["AccessToken"]
    policy = dict(user["Policy"], EnableRemoteAccess=False, IsHidden=False, IsDisabled=False)
    native("/Users/" + user_id + "/Policy", "POST", policy, expected=204)
    assert native("/Users/" + user_id)["Policy"]["EnableRemoteAccess"] is False

    original = _set_forwarded_test_ip(docker, jellyfin, root, caddy)
    visible = _public_contains(caddy, user_id)
    status, _ = _get(caddy, "/Users/Me", token)
    assert visible and status == 200, (
        "Untrusted forwarded remote address must not activate native remote policy; "
        "check fixture's local Docker network classification", visible, status
    )
    return {
        "id": user_id,
        "token": token,
        "original": original,
        "withoutKnownProxies": {
            "nativePublicAccountVisible": visible,
            "nativeRestrictedSessionHttp": status,
            "forwardedClientTreatedAsRemote": False
        }
    }


def finish(docker, jellyfin, root, caddy, native, state):
    """After the native KnownProxies change/restart, ensure local-only is denied."""
    try:
        proxies = native("/System/Configuration/network").get("KnownProxies")
        assert proxies, "Native trusted proxy must be configured before the trusted observation"
        visible = _public_contains(caddy, state["id"])
        status, _ = _get(caddy, "/Users/Me", state["token"])
        assert not visible, "Jellyfin did not filter a native local-only account for the forwarded remote client"
        assert status in (401, 403), ("Jellyfin did not deny native remote access", status)

        # The direct host connection is NOT the trusted Caddy container. Its
        # spoofed forwarding header must not acquire Caddy's trust privileges.
        direct = native("/Users/Public", auth=None, headers={
            "X-Forwarded-For": REMOTE_TEST_IP,
            "X-Forwarded-Host": "forged.invalid",
            "X-Forwarded-Proto": "https"
        })
        assert any(user.get("Id") == state["id"] for user in direct), (
            "Untrusted direct X-Forwarded-For unexpectedly changed native client classification"
        )
        return {
            "withoutKnownProxies": state["withoutKnownProxies"],
            "withKnownProxies": {
                "nativePublicAccountVisible": visible,
                "nativeRestrictedSessionHttp": status,
                "forwardedClientTreatedAsRemote": True
            },
            "directUntrustedForwardedHeadersIgnored": True,
            "syntheticRemoteIpCategory": "RFC5737-TEST-NET-2",
            "nativePolicyChecked": "EnableRemoteAccess=false",
            "approvalProtocolNotUsedForTheseRequests": True
        }
    finally:
        (root / "Caddyfile").write_text(state["original"])
        docker("exec", caddy.name, "caddy", "reload", "--config", "/etc/caddy/Caddyfile")
