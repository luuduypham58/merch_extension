# Merch Flow v0.9.14 — Background route ownership

The v0.9.13 in-page recovery could still lose a race to ChatGPT session restoration. v0.9.14 adds a service-worker route guard for the exact managed tab.

- Before Send is armed, any `/c/...` navigation on the pending job tab is treated as stale restoration.
- The background restores a root URL containing the same Job ID and session nonce.
- The content script arms the route only after the final empty-chat check, immediately before Send.
- After Send is armed, the new `/c/...` route created by the real prompt is allowed.
- Repeated restoration is capped and fails closed.
