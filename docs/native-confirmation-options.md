# Native confirmation options — Jellyfin Web 12.2

Reviewed for WatchGuard v0.4.2. **Retain the native confirmation, the WatchGuard confirmation and Jellyfin's generic cancellation error.** No supported, maintainable extension point was found in the pinned implementation for consolidating these flows.

## Verified execution order

Source pin: Jellyfin Web `61b1f890365ad15138e943e694af723c1d47df2a`. The local `deleteHelper.js` was compared byte-for-byte with the upstream pinned raw source on 2026-10-14.

1. [`deleteHelper.deleteItem`](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/scripts/deleteHelper.js) builds confirmation content through its private `getDeletionConfirmContent`. It obtains the server's ApiClient and calls the imported native confirm function.
2. Native confirmation resolves before `apiClient.deleteItem(item.Id)` is called. WatchGuard's existing instance adapter checks fresh protection here, before invoking the captured native deletion method.
3. The helper attaches a rejection handler to the API promise. It displays the translated `ErrorDeletingItem` alert for **every rejection**, then rethrows the original error. There is no AbortError/cancellation exception or plugin callback.
4. On successful deletion the helper may navigate to a parent/home page. Returning fabricated success would incorrectly activate this behavior without deleting media.

The imported [`confirm`](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/confirm/confirm.ts) accepts title/text/button labels, constructs Cancel/OK choices, waits for the router, and resolves only for OK. These options belong to its bundled callers; they are not a public plugin registration interface. No hook lets an injected script extend the private content builder, defer native confirmation for interest lookup, or replace that caller's error policy.

[`multiSelect`](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/multiSelect/multiSelect.js) has a separate bulk path: native confirmation, a map of `apiClient.deleteItem` calls, then `Promise.all` with a generic error handler. Modifying only deleteHelper would not cover bulk deletion.

## Options considered

| Approach | Decision |
| --- | --- |
| Public callback to enrich native confirmation or identify cancellation | No such contract found in these pinned paths. An upstream extension would be the preferred future solution. |
| Import/replace bundled confirm or deleteHelper internals | Reject: private Web modules, no supported runtime registration, version/build sensitivity and incomplete bulk coverage. |
| Edit native confirmation DOM / capture all Delete clicks | Reject: asynchronous interest checks, multiple layouts/entry points, lifecycle and permission-order risks. It cannot reliably identify every native operation. |
| Return successful API result on WatchGuard Cancel | Reject: fake deletion success causes native navigation/refresh and breaks the API contract. |
| Suppress generic alerts or globally patch fetch/XHR | Reject: affects unrelated errors/requests and falls outside the narrow adapter. |
| Keep the already validated ApiClient instance adapter and its own accessible dialog | Adopt for v0.4.2; no new interception layer. |

The adapter itself is a version-specific Web integration, not a supported server deletion hook. Native clients, direct API calls, other ApiClient instances, deletion before installation, later method replacement, cleanup plugins and filesystem removal remain outside its coverage. The existing fresh-check/confirmation race is not an atomic server transaction.

## Result

No native Web source, private module, global network API or native error handler is modified. Cancel/Escape/close still reject with AbortError and send zero DELETEs. Jellyfin's generic error remains visible. Delete Anyway calls the original deletion method exactly once; native permission failures continue to surface unchanged. Bulk prompts remain serialized and per item; cancellation does not undo already deleted items or automatically cancel other queued operations.

Revisit consolidation only if Jellyfin adds a documented pre-delete confirmation provider and cancellation contract covering both single and bulk paths. Serving a plugin dashboard page or Web asset alone does not provide such a hook.
