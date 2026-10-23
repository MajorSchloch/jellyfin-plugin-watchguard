# Watchlists startup qualification — v0.7.4

Based on published v0.7.3 / master `0663d4b`. Qualification results will be added after the final runtime is tested.

The published v0.7.3 package (SHA-256 `8082c08a96e4aee46fea8dc22fbde84bdd0c107cb5cc410dd49efaedbc0da20e`) exposed native Home in all 24 initial-render cases: legacy and modern Web, 1280px and 390px, direct entry, reload and cache-disabled hard reload, with either bootstrap or authenticated runtime delayed by 2.2 seconds. The observer is installed with Playwright `addInitScript`, before any entry-document code. It samples visible native Home headings with hit testing on every animation frame, rather than inferring exposure from hidden DOM or final settlement.

The server injects a static anonymous-safe handoff before deferred scripts run. It only starts on `#/home?watchguard=watchlists` (with optional filters), contains no account data and makes no requests. It never changes native nodes, history or authentication. Native DOM/view readiness triggers the existing serialized authenticated loader; its one-second compatibility fallback remains. The runtime mounts navigation immediately instead of waiting for its 500ms maintenance interval. Watchlists owns loading after that handoff.

Temporary UI releases after mounting, navigation away, authentication/script failure or a 20-second deadline. Native Home remains available after failure; reload retries startup. The loading panel also offers a Home link. The server does not relax or rewrite CSP: a policy forbidding inline scripts can block the early handoff, and a policy forbidding blob scripts still blocks the authenticated runtime. A blocked early handoff cannot hide native Web. External Web deployments that bypass the plugin's entry-document middleware do not receive this handoff.

The public catalog, ABI, dependencies, activity query semantics, preference formats and authorization/deletion behavior remain unchanged. Historical qualification is preserved in [v0.7.3 compatibility](compatibility-v073.md) and [v0.7.2 navigation](navigation-validation-v072.md).
