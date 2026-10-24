# v0.7.5 preparation

Unpublished mobile drawer and unified qualification patch, based on master `fe24bc1`. The v0.7.4 release was published during development; its package and catalog entry remain unchanged. Publication copy is `docs/releases/v0.7.5.md`.

[Full qualification](docs/drawer-qualification-v075.md) passed in [run 40083551172](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40083551172) on runtime commit `289af755cd0b7af42636333a5f95871488e724c5`, with `publish=false`, `proxy_matrix=true`. All eleven integration suites passed on both Jellyfin Server/Web **12.2.0 and 12.3.0**; the final gate verified the same package and DLL across all 22 reports. Publication was skipped. Subsequent commits contain documentation/evidence only.

ZIP SHA-256: `03ac773e2b82fec870f4bd0a7200cd128e0bc2360bf3492461a2662490813dbc`.
DLL SHA-256: `a9b22eef117d6c590773df35262861b34c03703dfa474767e163729deeff6bd8`.

The first successful run before the version change is retained as [pre-version evidence](docs/evidence/drawer-v075/pre-version/qualification.json); it does not qualify the final v0.7.5 artifact. Historical startup qualification and published v0.7.4 ZIP `47c93012c620bc2a85fe75992e26e0614a733218c5bdfc2edf9d7429b716feab` remain unchanged.

The [capability-based compatibility proposal](docs/compatibility-capabilities.md) changes no runtime policy. No PR merge, publication or deployment was performed.
