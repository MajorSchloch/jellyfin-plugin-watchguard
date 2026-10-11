# WatchGuard v0.3.0 — native actions

Target: Jellyfin Server/Web 12.2, .NET 10. No Web source edits, frontend framework, global network interception, native module replacement or React-tree changes.

## Source-verified menu integration

The pinned [itemContextMenu](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/itemContextMenu.js) obtains commands asynchronously and delegates to [actionSheet](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/actionSheet/actionSheet.ts). Native collection/playlist commands have stable IDs `addtocollection` and `addtoplaylist`; translated labels are not used as selectors. [dialogHelper](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/dialogHelper/dialogHelper.js) dispatches a non-bubbling `open` event after attaching the completed sheet. A capture listener observes it without replacing any native function.

The sheet does **not** expose its target item ID and there is no supported plugin command-registration API. WatchGuard records only a source-verified initiating event: a detail More click, a legacy card More click, or a right-click on a card with item/type/server attributes. On the next matching sheet, it requires a collection/playlist anchor, matching account/API/server, unchanged route and connected source. It verifies the item through native `getItem` and supports only movies/series. Episode/season menus are intentionally excluded; their existing detail bookmark still targets the parent series.

One owned native-style button is inserted beside collection/playlist actions. A disabled loading label precedes the authenticated user's membership lookup. Only Add or Remove is then enabled. Clicking the owned button stops only that click from reaching the native sheet's command dispatcher, so Jellyfin never executes a fabricated command. The API mutation must succeed before state changes. A failure leaves a disabled, explicit retry message; reopen the menu to retry. The sheet remains open after success and its label updates. Close it using native outside-click/back behavior; Escape from the added control did not close the sheet in the tested desktop fixture. WatchGuard does not patch native keyboard handling to hide this limitation.

The integration is deliberately conservative: ambiguous overlapping menu triggers disable this optional menu extension until navigation; unknown/programmatic/long-press triggers and missing DOM anchors receive no injected action. A late lookup cannot populate a closed sheet or another account's menu. The existing detail bookmark is the fallback. This is a version-specific DOM integration, not a public Jellyfin contract. Revalidate after upgrades/themes. Both supported application shells share the detail template and native action sheet at this revision.

## Shared personal state

Detail and context actions use one identity-bound membership helper. Concurrent reads coalesce through the authenticated own-list endpoint; opening a menu/detail requests fresh membership. Successful writes invalidate the snapshot and refresh current detail controls. Failed writes never change state. API instance/user/token changes invalidate old work. There are no per-library-card reads, username identifiers, Favorites writes, playback writes or changes to the JSON store. The helper is never used for protection or automatic activity decisions.

## Poster hover decision

No new library poster hover control is installed in v0.3.0. The pinned [card builder](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/cardbuilder/cardBuilder.js) constructs/replaces complete card markup and native overlay controls. Modern card surfaces are not uniformly governed by that lifecycle. There is no reliable public per-card mount/unmount extension shared by both shells. Guaranteeing a keyboard/touch-accessible injected control across replacement and virtualization would require broader observation, polling or additional adapters. The native-menu action and existing detail bookmark are the safer alternatives. The Watchlists page retains its own removal button; no claim is made that native library cards now have bookmark-plus/blue/minus hover states.

## Filters and scoped loading

The existing checkbox disclosure now uses native `filter_list` and a selected-status count in the same toolbar row. Accessible label/title include the count. Enter/Space, Tab, checkbox labels, touch-sized rows, Escape and outside-pointer handling remain. Defaults, OR/same-user semantics, URL history/reload, reset, sorting and responsive grid are unchanged.

User changes now fetch the appropriate backend scope; status/sort changes remain local. This intentionally supersedes v0.2.4's all-users snapshot for every administrator view. See [performance and API details](performance-v030.md). Regular users always use own routes even with forged owner parameters. No additional permanent toolbar row is added.

## Validation

The unit/browser suites cover scoped requests, asynchronous membership reads, account invalidation, native movie/series detail actions, library right-click actions, keyboard activation, Add/Remove consistency, single commands on reopen and failed mutation feedback. Original checkbox/history, progressive loading, privacy and all deletion regressions remain. Native permission checks, `Protection/{id}`, the deletion adapter and its generic cancellation-error limitation are unchanged.

Evidence and release totals are recorded in [deployment.md](deployment.md#automated-results). [Native menu screenshot](screenshots/v0.3.0/native-menu.png), [desktop filters](screenshots/v0.3.0/status-filters-desktop.png) and [narrow filters](screenshots/v0.3.0/status-filters-narrow.png). Other browsers, TV layouts, custom themes, programmatic menus and native clients remain outside the tested extension surface.
