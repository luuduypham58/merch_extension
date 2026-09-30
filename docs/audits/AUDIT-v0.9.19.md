# Merch Flow v0.9.19 — Create image restore-loop escape

## Live root cause

On the real ChatGPT profile, clicking **Create image** on a clean root composer repeatedly restored
`/c/6a89193e-326c-83ec-a1ae-72225380a64c`. The restored page contained one unrelated personal
user message, so the existing stale-route guard correctly blocked Send but retried the same menu
interaction until the repair limit was exhausted.

## Fix

- A known stale `/c/...` reached during the short Create-image transition sets
  `createImageModeBypass` before navigating back to the canonical root.
- On the next clean root load, the content script skips the menu interaction and uses the existing
  guarded `TEXT_TO_IMAGE_ONLY` fallback.
- The fallback still requires the exact job/tab/session, no attachment, a normal composer, zero
  conversation messages, and the final pre-Send fresh-page assertions.

## Verification

- `npm.cmd test`
- Live CDP verification on the dedicated Chrome profile at `[::1]:9222`.
