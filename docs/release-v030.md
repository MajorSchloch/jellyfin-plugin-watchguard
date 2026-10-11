WatchGuard v0.3.0 targets Jellyfin Server/Web 12.2 and .NET 10.

- Add/remove personal membership in supported native movie/series context menus.
- Compact filter icon/count; existing checkbox/history behavior retained.
- My list and individual-user views request only the selected user's activity; All users retains bounded aggregation.
- Native Jellyfin catalog packaging and manual-to-catalog migration instructions.

JavaScript Injector 4.0.0.0 **jf12** must be installed separately with response-time middleware enabled. Verify one authenticated `watchguard-v1` registration and reload all clients. No library-card hover button or server-side activity cache is added.

Membership schema, Favorites, native playback and fresh deletion checks are unchanged. Warnings remain advisory and Web-only; native clients, direct APIs and filesystem deletion bypass them. Keep v0.2.4 for rollback. See the repository's deployment, native-actions, performance and migration documentation before upgrading.
