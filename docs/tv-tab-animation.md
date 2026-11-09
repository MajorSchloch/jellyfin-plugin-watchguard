# TV tab focus animation

The physical LG check on webOS 6.5.3-47 found the correct focused size in v0.7.17, but no zoom animation.

Actual Chromium 79.0.3945.0, with pinned Jellyfin Server/Web 12.4.0 through the `/jellyfin` proxy fixture, reproduced this difference:

| Computed resting transition | Favorites | Watchlists before | Watchlists after |
| --- | --- | --- | --- |
| Property | `all` | `color` | `color, transform` |
| Duration | `0.2s` | `0.15s` | `0.15s, 0.2s` |
| Easing | `ease` | `ease` | `ease, ease` |

The TV-only resting rule now includes `transform .2s ease`. It applies during both focus and blur. The existing color transition and 1.3× focused transform remain intact. The existing reduced-motion rule disables both transitions.

The browser check arms a focus or blur listener before each remote-arrow key. It records the computed transform on successive animation frames. It requires an intermediate scale in each direction, then checks the final transform and text dimensions. A transition placed only on `:focus` fails the blur check. The unmodified v0.7.17 package failed the new check because Watchlists had no transform transition and no intermediate scales.

These samples came from the candidate in actual Chromium 79. Times are milliseconds after the corresponding focus or blur event:

| Tab and event | Intermediate sample | Final scale |
| --- | --- | --- |
| Favorites focus, Right arrow | 1.02124× at 42.615ms | 1.3× |
| Favorites blur, Left arrow | 1.27876× at 23.680ms | 1× |
| Watchlists focus, Right arrow | 1.02124× at 26.710ms | 1.3× |
| Watchlists blur, Left arrow | 1.27876× at 25.860ms | 1× |

Reduced-motion emulation produced no intermediate Watchlists scales in either direction. Final sizes remained 1.3× and 1×. Desktop and mobile retained `color 0.15s ease`, with no transform transition. Existing checks passed for selected/focused states, stable neighboring tabs, rounded series-detail rings, and inner-control focus. Their computed focus styles also match the stored [v0.7.17 Chromium 79 evidence](evidence/tv-focus-v0717/candidate-79/focus.json).

## Reproduction

Build the package with `python3 scripts/build-release.py`. Start the disposable fixture with:

```sh
python3 tests/docker-smoke.py --serve --base-path /jellyfin --proxy
```

Use the fixture path printed after `READY fixture=`:

```sh
WATCHGUARD_CHROMIUM79=/path/to/verified/Chromium79 node tests/focus-browser.cjs /path/to/fixture.json artifacts/tv-tab-animation/candidate-79
node tests/focus-browser.cjs /path/to/fixture.json artifacts/tv-tab-animation/candidate-current
```

Each output directory contains `focus.json`, per-frame scale samples, computed transitions, text-size measurements, and screenshots. Fixture credentials stay outside these reports.

Candidate ZIP SHA-256: `3f50005f7f3e9d975a7d1b04d59f5fd89f25eac3bf34abe746e76bc78690e576`.

Deployed DLL SHA-256: `028e258ef3f4963200f4d586a494da81d67f0c2a501d0e47d2c6cda403f0f607`.

Current Chromium 141.0.7390.37 also passed all three layouts and both animation directions. The forced-colors detail ring retained 3,375 visible focus-edge pixels and connected corners.

The 307 JavaScript checks and packaged ES2019 checks passed. These checks use real browser engines on macOS with synthetic media. This change has not been tested on the physical LG TV.
