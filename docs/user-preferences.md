> **v0.5.1 candidate:** [Saved Recently added sorting](saved-sort-v051.md) adds a backward-compatible preference sidecar. The historical v0.3.1 persistence description below applies to legacy sorts; current public v0.5.0 still cannot save added. The candidate keeps the same routes, owner/status rules and URL precedence.

# Personal Watchlists preferences — v0.3.1

Open the existing filter popover and choose **Save view as defaults** to save the current owner scope, enabled statuses and sort. Ordinary filter changes remain URL navigation and do not write defaults. This avoids unexpected preference changes from shared links/history and adds no permanent toolbar row.

**Reset to Defaults** removes the authenticated user's saved preferences and navigates to My list, Watchlisted + Watching + Currently Playing, title sort. Unlike the old status-only reset, it resets the complete view. If saving/resetting fails, the page shows an error; it does not report successful persistence. No browser local storage or second writable representation exists.

## Precedence and lifecycle

Each explicit `owner`, `interest`, or `sort` URL parameter overrides that saved field independently. Missing parameters use saved values; absent preferences use built-in defaults. `interest=none` explicitly selects zero statuses. Back/forward and reload retain this precedence. A bare Watchlists link opens saved defaults. Preferences load once per page lifetime before scoped discovery; explicit memberships still precede automatic activity. Save/reset use a separate request; ordinary status/sort changes never repeat discovery.

Account identity/token and page lifetime guard asynchronous responses. Logout/navigation abort the owned page; a late response cannot populate another account's page. Regular users always query their own activity regardless of URL or a formerly administrative saved scope.

## API and storage

All routes require native enabled-user authentication; API keys and unauthenticated callers cannot own preferences. Responses are non-cacheable.

- `GET /WatchGuard/Preferences`: effective own defaults.
- `PUT /WatchGuard/Preferences`: validate/replace own defaults, return effective values.
- `DELETE /WatchGuard/Preferences`: remove own override, return built-in defaults.

Example payload/response:

```json
{"Owner":"mine","Statuses":["watchlisted","watching","playing"],"Sort":"title"}
```

Owner accepts `mine`, `all` or a Jellyfin user GUID. Only administrators may save cross-user scopes. An enabled individual owner is checked natively; removed/disabled owners fall back to `mine`. Revoked administrator status also falls back to `mine` on read. A fallback does not silently rewrite stored preferences. Cross-user item visibility continues to be enforced by the existing scoped activity/membership services. Unsupported status/sort/owner formats and duplicate statuses return 400; forbidden cross-user writes return 403. An empty status array is valid.

`BasePlugin.DataFolderPath/preferences.json` stores schema 1 with `Version` and `Entries`, each entry containing `UserId` and `Preferences`. Only IDs are persisted, never usernames. A singleton lock serializes read-modify-write; same-directory temporary files are flushed then atomically replaced. Reads always inspect the authoritative file. Corrupt/unknown-schema/duplicate documents return 503 and remain untouched, including on reset. Back up the original, stop Jellyfin, repair/restore a known-good copy, then retry; do not silently replace it with an empty file.

`watchlists.json` remains schema 1 and byte-independent. Back up both JSON files with plugin XML. v0.3.0 ignores the preference file and uses URL/built-in behavior; rollback requires no conversion and later reinstall retains saved preferences. Removed users' orphan entries are inert and never returned to other accounts.
