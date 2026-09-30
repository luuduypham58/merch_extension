# Merch Flow v0.9.23 — Fallback artwork provenance repair

## Live evidence

The generated image was captured correctly, but a later fallback scan rewrote its candidate with
`artworkMessageIndex: -1`. Listing capture intentionally rejects artwork without an assistant
message boundary, so even a complete five-field JSON response could not be accepted.

## Fix

- Fallback visuals are mapped back to the canonical assistant message that contains them.
- A matching already-stored candidate with legacy index `-1` is repaired in place; image bytes and
  storage key are preserved.
- Listing parsing continues only after the repaired non-negative message index, preserving exact
  job, session, artwork key, revision, and conversation provenance.
