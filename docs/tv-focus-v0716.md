# TV focus correction — v0.7.16 preparation

Published v0.7.15 reproduces both reported focus defects in actual Chromium 79. Native TV tabs highlight text; Watchlists instead shows a border and grey text. The detail summary has a computed outward outline, but its clipped panel renders no focus pixels. Current Chromium renders that detail outline inward through `:focus-visible`.

The patch adds native text focus only to TV top tabs. Other navigation surfaces retain their existing visible outlines. The detail summary uses an inward `:focus` outline in both engines. No event handlers, layout geometry, routing, authorization or stored data change.

The browser regression uses actual arrows in TV layout and Tab in desktop/mobile layouts. It records screenshots, checks rendered focus pixels, opens the disclosure with Enter, closes it with Escape and verifies focus restoration. It also verifies navigation onward. Full current qualification remains required after merge. Physical LG validation remains separate.

Validation evidence will be recorded after final candidate checks.
