# Browser test contracts

`server-enforcement-browser.cjs` and `server-enforcement-old-tab.cjs` test ApiClient interception, confirmation and protocol behavior. They do not require the native More button. `browser-poc.cjs` retains real native detail/context-menu/multi-select deletion coverage; it must pass independently.

`browser-readiness.cjs` requires login to finish routing to Home, then checks authenticated user, server and origin before navigating. Detail setup resolves the requested item through the current ApiClient and confirms the route still addresses that item before invoking deletion. A script-installed marker alone is insufficient.

No helper clicks hidden controls or retries a deletion. Failure must stop the scenario; an unexpected Home route is not repaired by automatically repeating the destructive action. Cancel, Escape, close, approval counts, file survival and native record survival assertions remain in their existing suites.

Failure readiness snapshots deliberately omit tokens, credentials, complete page text and approval identifiers. Bounded console/error/request chronology and sanitized action/screenshot traces are captured on failure. Network payloads, DOM snapshots and action parameters are deliberately omitted from uploaded traces; raw traces are removed from a temporary directory. Screenshots contain only generated fixture users/media.

Native detail DELETE completion has two boundaries: the HTTP result and the subsequent native parent navigation. The test records native `viewshow` events and awaits the expected parent after an approved detail deletion before setting up another scenario. Context-menu and bulk operations do not inherit this detail-only redirect requirement. Layout preference changes use an explicit bootstrap reload, not an error-triggered reload.

A real sanitized failure ZIP was successfully opened and rendered in the pinned Playwright trace viewer using headless Chromium. Its actions and screenshots remain usable; network payloads and DOM snapshots are intentionally unavailable.

Standalone bootstrap, settings and WebSocket helpers use the same sanitized capture. Existing retries for a specifically observed pre-login `ERR_NETWORK_CHANGED` are bounded (at most two setup retries per page), preserve a distinct initial-failure trace/screenshot/attempt record, and never extend to approvals or DELETE. A passing setup retry remains visible in artifacts.

Successful readiness timings are emitted as `browser-timing-*.json`. Native/login contracts include Home and authenticated identity readiness; CSP bootstrap timings measure the expected installed/blocked transition specifically. Each browser process has a 600-second outer watchdog for otherwise unbounded evaluation promises; existing individual assertions/timeouts are unchanged. A watchdog failure stops the suite, captures server evidence and does not retry mutation.

Settings mutations await the matching native configuration POST and Save re-enablement (which follows asynchronous status rendering). A refresh awaits its own final script-availability response before inspecting status; an old success line is not completion evidence for a new request. No save, approval or deletion is retried.
