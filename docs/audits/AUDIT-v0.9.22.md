# Merch Flow v0.9.22 — Bounded listing recovery

## Live evidence

The listing request was sent after successful artwork capture, but ChatGPT produced only the
truncated text `{"merch_flow":_` and stopped. The previous implementation never retried unless the
user manually forced Resume, leaving AUTO in `capturing-listing` indefinitely.

## Fix

- Invalid or missing listing responses are retried automatically after the existing cooldown.
- Retry state is persisted in `lastSentChatJob` and capped at two retries.
- Exhaustion writes a concrete error and changes AUTO to `failed`, while preserving the captured
  and normalized artwork for manual recovery.
- An existing image candidate suppresses the unrelated artwork-retry exhaustion path.
