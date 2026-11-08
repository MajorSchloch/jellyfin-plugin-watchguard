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

## Hosted results

[Hosted probe 42468380825](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42468380825), attempt 1, passed at commit `8827ee2454fc5d0a4402b643d4b00a9743676bf6`. The runner used Ubuntu 24.04 image `20261101.360.1`. The [automatic PR check](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42468382550) also passed.

The probe verified release `437486887`, ZIP asset `720298473` and checksum asset `720298556`. The real API transfers took 0.435 seconds and 0.384 seconds. Complete retrieval and validation took 1.910 seconds. These timings exclude a real public-route timeout because the two HTTP 504 failures were injected.

- Previous-stable v0.7.16 ZIP SHA-256: `e473f1bbef8604e9ee8c2e48db40b9d8a183175e6a07b45a4c4976878f8091d2`.
- Previous-stable DLL SHA-256: `155df955cf36014e84f80fa6d3a9a6cb13f7f6420539c04a11b96e1159c8d766`.
- Unchanged v0.7.17 ZIP SHA-256: `9b53815b0e7bcbcf99feaa694f36a310235408e5ff27730801f77b695f2e5266`.
- Unchanged candidate DLL SHA-256: `75d0dddc6f9ffcd5dd8a8edd1e35ec14c8335f145f8a6617f96d5524e7523be1`.

The hosted candidate ZIP is byte-identical to the retained master package from run `42463127640`. All 134 Python, 376 .NET, 306 JavaScript and eight catalog tests passed. Deterministic packaging, packaged ES2019 parsing, release-note validation, qualification-policy validation and published installation-metadata checks passed.

[Hosted transfer record](../evidence/previous-stable-download/hosted-probe.json) · [Validation and artifact IDs](../evidence/previous-stable-download/validation.json)

No plugin version, runtime code, catalog entry, release asset, qualification job or approval permission changes in this patch. No native matrix was rerun for this CI-only change. After merge, the existing qualification workflow remains responsible for the unpublished v0.7.17 candidate.
