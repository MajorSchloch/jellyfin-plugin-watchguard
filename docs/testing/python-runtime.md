# Qualification Python selection

Qualification run [42463127571](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42463127571), attempt 2, stopped before the package build. Attempt 1 reached the final evidence-verification job, where the same Python setup failed. The hosted Ubuntu 24.04 image did not contain Python 3.12.0. `actions/setup-python` attempted the 3.12.0 archive and received HTTP 504 on all three download attempts.

The exact image was `20261101.360.1`. Its [official inventory](https://github.com/actions/runner-images/blob/ubuntu24/20261101.360/images/ubuntu/Ubuntu2404-Readme.md) lists system Python 3.12.3 and cached Python 3.12.16. These are different installations. Qualification selects the cached interpreter.

The authoritative patch is in [`.python-version`](../../.python-version). Release jobs, the browser benchmark and automatic fast checks use that file with `check-latest: false`. The suite wrapper validates the observed version against the file, keeps the exact `python` field in each report, and starts child scenarios with `sys.executable`.

The automatic PR check runs on Ubuntu 24.04. It verifies the cache entry and its reported version before `setup-python`, then verifies the selected executable afterward. The retained `WatchGuard-python-selection` artifact records both observations and the runner image. This check catches a missing or inconsistent cached interpreter without a Python download. The shared workflow setup still retains the action’s normal fallback if a release runner lacks the pin; the PR preflight makes that drift visible before merge.

Qualification jobs, required scenarios, artifact verification, approval and publication permissions are unchanged. The plugin stays at v0.7.17. Historical qualification reports keep their original Python version.

## Hosted validation

[PR check 42466555302](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42466555302) passed on hosted Ubuntu 24.04, image `20261101.360.1`, at commit `cb897999f1d2ef049fc6fe0858a1e21e7fa8bf9f`.

The preflight found Python 3.12.16 before setup. The postflight resolved the same executable: `/opt/hostedtoolcache/Python/3.12.16/x64/bin/python3.12`. The action log reports successful CPython 3.12.16 setup without any Python download step. Both observations are retained in the [hosted selection record](../evidence/python-runtime/hosted-selection.json).

All 124 Python, 376 .NET, 306 JavaScript and eight catalog tests passed. Package construction, packaged ES2019 browser assets and qualification-policy validation passed. New tests reject missing/inconsistent cache entries, wrong interpreter selection and unsupported patches. They also verify exact suite report values and child executable reuse.

The hosted PR ZIP is byte-identical to the successful [current-master build 42463127640](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42463127640), commit `7aebc07c6e1ead05708d4334e02fa04c07ef667b`.

- ZIP SHA-256: `9b53815b0e7bcbcf99feaa694f36a310235408e5ff27730801f77b695f2e5266`.
- DLL SHA-256: `75d0dddc6f9ffcd5dd8a8edd1e35ec14c8335f145f8a6617f96d5524e7523be1`.

[Validation record and artifact IDs](../evidence/python-runtime/validation.json).

This is hosted interpreter/build validation, not a new native compatibility qualification. The full matrix and browser benchmark were not dispatched. After merge, the existing unpublished-candidate workflow must produce a complete qualified record before publication approval. Future hosted image changes can remove an exact cached patch; the preflight makes that condition explicit and the shared pin must then be reviewed.
