# v0.7.4 preparation

Unpublished candidate incorporating the startup handoff and mobile drawer fix. Publication copy lives separately in `docs/releases/v0.7.4.md`. The public catalog remains unchanged at published v0.7.3.

The [drawer and consolidated qualification follow-up](docs/drawer-qualification-v074.md), based on master `0d07009`, passed [run 40081087661](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40081087661) on runtime commit `ef982ccfb2211ebcca597edd094fa3756660bf2f` with `publish=false`, `proxy_matrix=true`. All eleven integration suites passed on both Jellyfin Server/Web **12.2.0 and 12.3.0**, and the final evidence gate verified one identical package across all 22 reports. Publication was skipped. Subsequent commits contain documentation/evidence only.

Current ZIP SHA-256: `6d1a6ac52b3dbc2c8e677ca2c52f9a9140c40166b2a95787923eed3c68b035a1`.
Current DLL SHA-256: `3cca83c537f0962f7e7444a5a53a359c903deaf7637dfdd4b513f82d25761374`.

The earlier [startup qualification](docs/startup-validation-v074.md) on `1a3bc8b2f706d745b38084fcf2c126defe307c11` and ZIP `47c93012c620bc2a85fe75992e26e0614a733218c5bdfc2edf9d7429b716feab` is preserved as historical evidence for the pre-drawer candidate. It is not the current package.

The [capability-based compatibility proposal](docs/compatibility-capabilities.md) is documentation only. Exact-version gating and deletion protection are unchanged. No merge, publication or deployment was performed.
