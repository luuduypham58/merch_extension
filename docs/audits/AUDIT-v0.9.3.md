# AUDIT v0.9.3

## Bugs fixed

1. **Amazon content script version drift**
   - `manifest.json` was v0.9.2 while `merch-content.js` still used `SCRIPT_VERSION = "0.8.3"`.
   - On an already-open Merch tab, reinjection could be skipped because the page believed the same old script version was already loaded.
   - Fixed by aligning ChatGPT + Merch content scripts and package/manifest to v0.9.3.

2. **Select Products could retry forever**
   - Disabled Select Products buttons were treated as clickable.
   - Selection count used all marketplace leaf checkboxes instead of only the target `.com` column.
   - Save action could be temporarily disabled after React state updates; old logic could fall back to the close button and lose selections.
   - Old logic retried indefinitely on failure.
   - Fixed with enabled-control checks, per-product verification after rerender, `.com`-only count, explicit wait for Save/Apply/Done, one save retry, and a 3-failure circuit breaker.
   - A manual retry resets the failure counter.

3. **Extension updates did not refresh Amazon tabs**
   - Update handler reloaded known ChatGPT tabs only.
   - Fixed to reload open `merch.amazon.com` tabs too, reducing stale content-script state after an extension update.

4. **Reference-image UI was misleading**
   - v0.9.2 intentionally did not attach stored reference images to artwork-generation jobs to avoid accidental image-edit routing.
   - The picker still looked like an active style-reference input.
   - v0.9.3 labels it explicitly as local-only. Only written Winner Style DNA affects generation.

## Verification

- `npm run check`: pass
- `node --test tests/*.test.js`: 59/59 pass
