# Qualification Python selection

Qualification run [42463127571](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42463127571), attempt 2, stopped before the package build. Attempt 1 reached the final evidence-verification job, where the same Python setup failed. The hosted Ubuntu 24.04 image did not contain Python 3.12.0. `actions/setup-python` attempted the 3.12.0 archive and received HTTP 504 on all three download attempts.

The exact image was `20261101.360.1`. Its [official inventory](https://github.com/actions/runner-images/blob/ubuntu24/20261101.360/images/ubuntu/Ubuntu2404-Readme.md) lists system Python 3.12.3 and cached Python 3.12.16. These are different installations. Qualification selects the cached interpreter.

The authoritative patch is in [`.python-version`](../../.python-version). Release jobs, the browser benchmark and automatic fast checks use that file with `check-latest: false`. The suite wrapper validates the observed version against the file, keeps the exact `python` field in each report, and starts child scenarios with `sys.executable`.

The automatic PR check runs on Ubuntu 24.04. It verifies the cache entry and its reported version before `setup-python`, then verifies the selected executable afterward. The retained `WatchGuard-python-selection` artifact records both observations and the runner image. This check catches a missing or inconsistent cached interpreter without a Python download. The shared workflow setup still retains the action’s normal fallback if a release runner lacks the pin; the PR preflight makes that drift visible before merge.

Qualification jobs, required scenarios, artifact verification, approval and publication permissions are unchanged. The plugin stays at v0.7.17. Historical qualification reports keep their original Python version.

Hosted validation and package comparison are recorded below after the PR check completes.
