# Required release qualification

Generated from `scripts/qualification-policy.json`. Run `python3 scripts/qualification_policy.py --write-doc` after a policy change.

One candidate ZIP is built and deterministically rebuilt. Every required job tests those exact bytes. Published assets and historical evidence are unchanged.

| Host | Level | Shard | Required suites |
|---|---|---|---|
| 12.4 | full | activity-native | activity-index |
| 12.4 | full | activity-browser | activity-browser |
| 12.4 | full | navigation | basepath-navigation |
| 12.4 | full | browser | basepath |
| 12.4 | full | enforcement | server-enforcement |
| 12.4 | full | platforms | server-enforcement-basepath, server-enforcement-linuxserver |
| 12.4 | full | upgrade | upgrade |
| 12.4 | full | browser79 | browser79 |
| 12.3 | core | browser | basepath |
| 12.3 | core | enforcement | server-enforcement |
| 12.3 | core | upgrade | upgrade |

11 integration jobs; 12 blocking host/suite reports. Current Chromium is Playwright 1.56.1; Chromium 79 uses an actual pinned executable, not user-agent emulation.

## Scenarios

| Suite | Required scenarios |
|---|---|
| activity-index | activity-current-query-contracts |
| activity-browser | activity-native-browser-polling |
| basepath | basepath-full-browser |
| basepath-navigation | basepath-native-catalog → basepath-startup-drawer-navigation |
| server-enforcement | enforcement-official-proxies |
| server-enforcement-basepath | enforcement-basepath |
| server-enforcement-linuxserver | enforcement-linuxserver |
| upgrade | previous-stable-upgrade-caddy |
| browser79 | chromium79-native |

## Retired mandatory coverage

- Jellyfin 12.2 native qualification (minimum ABI stays 12.2)
- Published Injector v0.3.0/v0.3.1 and Injector migration/rollback ladders
- v0.4.x/v0.5.x preference rollback and catalog upgrade ladders
- v0.4.5/v0.4.7 discovery and verification performance comparisons
- v0.5.2/v0.6.0 activity performance comparisons
- Repeated large-library verification benchmark (backend policy/security tests retained)

These fixtures remain available for explicit investigations. Their old evidence is historical, not current qualification. Data-format migrations and backend security assertions remain intact.

The minimum package ABI remains 12.2.0.0. This is a loading/dependency floor, not a claim of full native testing on that host. Prior 12.2 qualification remains historical. No runtime compatibility policy changes in this tooling PR.
