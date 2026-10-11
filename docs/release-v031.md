# WatchGuard v0.3.1

Adds native dashboard settings and administrator integration diagnostics, plus server-side personal Watchlists defaults. Explicit URL filters take precedence; Save view as defaults and Reset to Defaults are in the existing filter popover.

Preserves watchlist schema 1, native activity/playback behavior, context actions, fresh deletion protection, plugin GUID and watchguard-v1. JavaScript Injector 4.0.0.0 jf12 remains a separate required dependency for Web integration. Backend APIs work without it.

Restart after catalog installation and fully reload Web clients. Settings saves do not require a restart; diagnostic script changes require a client reload. Back up both watchlists.json and preferences.json with plugin XML. Rollback to v0.3.0 preserves data; the older release ignores personal defaults. See docs/settings.md, docs/user-preferences.md and docs/deployment.md.
