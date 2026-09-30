# Merch Flow v0.9.12 — Binding & Verification Hardening

Implemented remaining audit findings:

- Resume requires `expectedJobId` and exact artwork/session binding.
- Listing capture/import requires the assistant listing to occur after the current artwork message and match storage key, revision and session nonce.
- ChatGPT-origin listings cannot be silently relabeled when artwork changes; manual user-entered listings remain intentionally re-bindable.
- Amazon verification snapshots are scoped to artwork/upload evidence roots, never all page images.
- Safe text-to-image fallback rejects active Search, Study, Deep Research, Agent and Shopping Research contexts.
- ZIP export chunk defaults reduced to 3 designs / 24 MB estimated image data and base64 is decoded in 1 MB chunks.
