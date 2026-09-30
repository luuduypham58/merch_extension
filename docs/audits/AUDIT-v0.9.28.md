# Audit v0.9.28

## Result

- AUTO no longer waits forever on Amazon product/color selection.
- Artwork still requires a stable Amazon acceptance signal before the listing step.
- PNG normalization remains 4500 × 5400 RGBA PNG.
- Listing automation stops after all five fields are populated and leaves product/color selection to the seller.
- Publish is never clicked by the extension.

## Loop protection

- Amazon content scripts register a per-tab runtime identity.
- When an active job is opened by a new extension runtime, the tab is reloaded once to clear stale content-script worlds.
- Listing/form readiness has a two-minute timeout; stale jobs become `failed`/`needs-attention` with a concrete message.
- Existing product-selection helpers remain available for later work but are not invoked by the current AUTO path.

## Verification

- `npm.cmd test` — 108/108 passing.
- Live CDP profile updated to v0.9.28.
- The previously expired AUTO job was stopped and its stored artwork/listing were preserved.
