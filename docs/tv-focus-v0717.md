# TV focus polish — v0.7.17 preparation

Published v0.7.16 shows two presentation differences in real Chromium 79 and current Chromium. Native Favorites grows to 1.3 times its resting text size on focus, before or after activation. Selected but unfocused text stays at its resting size. Watchlists retains the text highlight but does not grow. The Series viewing heading has visible straight focus edges, but its rounded panel clips the corners into disconnected lines.

The patch follows the native TV focus scale through a scoped rule. It keeps Watchlists outside Jellyfin’s indexed tab controller; adopting its `emby-tab-button` class would also change which elements that controller manages. The transform does not change layout dimensions. No navigation handlers change.

The detail heading shares its panel’s radius and uses an inset shadow instead of an outline. Chromium 79 renders its curved corners continuously, without depending on `:focus-visible`. Modern pointer-focus suppression remains supported. The rule applies to the focused heading, not `:focus-within`, so focus on an inner control removes the heading indicator.

Validation evidence and physical-TV procedure follow below. The existing qualification policy applies to the exact master package after merge.
