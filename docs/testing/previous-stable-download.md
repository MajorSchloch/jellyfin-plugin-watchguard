# Previous-stable download fallback

Qualification [42467247813](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42467247813), attempt 1, stopped before the integration matrix. The public v0.7.16 ZIP URL returned HTTP 504 on all six attempts. These responses establish a transport failure, not a package mismatch.

Only `scripts/previous_stable.py` uses the new fallback. It selects the previous stable version from the catalog and resolves both assets from one public release. It checks the release tag, published state, asset names, uploaded state, IDs and repository URLs before downloads.

Each asset gets one public-URL attempt. A transient HTTP/transport failure permits up to three anonymous API attempts, with two- and four-second backoffs. The API request uses `Accept: application/octet-stream`. It does not use `gh` for bytes, an authorization header, cookies or user curl configuration. Release metadata inspection retains the existing read-only GitHub API client.

One 120-second deadline covers both assets and both routes. Connection time is at most 10 seconds; each transfer/process is at most 30 seconds. The fallback uses the existing transient-status policy, including 404, 408, 429 and selected 5xx responses. Authentication/authorization denials fail immediately. Exhaustion stops qualification.

Both routes use the existing size, SHA-256 digest, ZIP content, checksum-sidecar and catalog installation-metadata checks. Content or identity mismatch does not trigger another download. A failed retrieval cannot leave a success identity record from a previous invocation. The publisher and catalog generator keep their existing anonymous public-download checks, without this fallback.

## Read-only hosted probe

Dispatch **Build and test WatchGuard** on the PR branch with `previous_stable_probe=true`. This runs the normal fast checks, then the optional download probe. It cannot publish.

The probe injects one public HTTP 504 per asset. It then uses the real anonymous API route for both assets. It retains the release ID, asset IDs, hashes, timings, runner image and source commit in `WatchGuard-previous-stable-download-probe`. The injected failures are test control, not observations of GitHub availability. The API bytes and release/package/catalog validation are real.

The local HTTP regressions cover 504 fallback, API retry success, failure of both routes, permanent denial, mismatched ZIP/checksum bytes, release/asset identity conflicts, sidecar/catalog mismatch and deadline exhaustion. They also verify that other consumers retain the original public downloader.

Hosted results and candidate package comparison will be recorded after the branch check completes. No plugin version, runtime code, catalog entry, release asset, qualification job or approval permission changes in this patch.
