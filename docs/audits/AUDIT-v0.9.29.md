# Merch Flow v0.9.29 — ChatGPT artwork capture audit

## Root cause

- The failed ChatGPT turn contained no generated image, but the content script accepted a 592 × 592 UI `canvas` as artwork.
- That false artifact unlocked listing generation and allowed the flow to advance toward Amazon.
- ChatGPT's exact image-routing refusal was not fully covered, so recovery behavior was inconsistent.

## Fixes

- Artwork discovery now scans only real `img` elements; every `HTMLCanvasElement` is rejected by scoring, fallback confidence, and capture storage.
- Legacy `sourceUrl: "canvas"` artifacts and same-job derived listing/processed/upload records are purged on startup.
- Listing capture and follow-up require a usable non-canvas artwork bound to the current Job ID/session/revision.
- English and Vietnamese source-image/edit-routing refusals trigger a fresh retry.
- A routing retry bypasses the explicit Create image chip and uses a verified clean normal composer with `TEXT_TO_IMAGE_ONLY` and no attachment.
- Retry remains bounded at three attempts. Exhaustion sets AUTO to `failed` at artwork and cannot proceed to listing or Amazon.

## Verification

- Static/runtime suite: `npm.cmd test`.
- Live CDP profile: extension ID `pdnancbmddcajicipfhnmbbpdpenaemk`, port `9222`.
- Invalid job `0d695a33-79c8-40d7-ad74-b2966c91948d` was cleaned: canvas artwork, fabricated listing, processed/final artwork, and upload state were removed.
- Live retry 3 used `createImageModeBypass: true`, `INPUT_ASSETS: NONE`, and no attachment. ChatGPT returned an external image-generation failure, so the extension stopped at artwork without generating listing or opening Amazon.
