# Merch Flow v0.9.9 — Safety hardening

## Fixed from v0.9.8 audit

- P0: Amazon upload is fail-closed. `uploaded: true` is returned only after positive artwork verification. Unverified transfers stay pending and cannot advance listing/product automation.
- P0: listing parser rejects the exact angle-bracket placeholders emitted by `buildListingPrompt()`.
- P1: completion requires the 10-product selection checkpoint; a filled 5/5 listing alone cannot clear `pendingUpload`.
- P1: Create image discovery is scoped to open menu/popover UI and activation requires a visible image-mode chip.
- P1: listing import is bound to the current artwork Job ID; no cross-job global listing fallback. New standalone manual uploads receive a fresh Job ID.
- P2: out-of-message artwork fallback requires generated-image confidence signals and sorts by confidence/score before DOM recency.
- P2: large vault exports are split into bounded ZIP parts to reduce side-panel memory spikes.
- P3: deleting a single saved design now asks for confirmation.

## Safety principle

The extension now prefers a visible retry/wait state over claiming success from ambiguous UI state.
