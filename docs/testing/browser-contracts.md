# Browser test contracts

`server-enforcement-browser.cjs` and `server-enforcement-old-tab.cjs` test ApiClient interception, confirmation and protocol behavior. They do not require the native More button. `browser-poc.cjs` retains real native detail/context-menu/multi-select deletion coverage; it must pass independently.

`browser-readiness.cjs` requires login to finish routing to Home, then checks authenticated user, server and origin before navigating. Detail setup resolves the requested item through the current ApiClient and confirms the route still addresses that item before invoking deletion. A script-installed marker alone is insufficient.

No helper clicks hidden controls or retries a deletion. Failure must stop the scenario; an unexpected Home route is not repaired by automatically repeating the destructive action. Cancel, Escape, close, approval counts, file survival and native record survival assertions remain in their existing suites.

Failure readiness snapshots deliberately omit tokens, credentials, complete page text and approval identifiers. Bounded console/error/request chronology and sanitized action/screenshot traces are captured on failure. Network payloads, DOM snapshots and action parameters are deliberately omitted from uploaded traces; raw traces are removed from a temporary directory. Screenshots contain only generated fixture users/media.
