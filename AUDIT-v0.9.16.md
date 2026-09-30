# Merch Flow v0.9.16 — Failed-job fresh recovery

## Production evidence

CDP inspection of the dedicated Chrome profile showed a failed pending job with `freshRouteRepairCount: 6`, an empty stale-route list, and a valid clean root ChatGPT tab. The Resume flow was reusing that tab and stale job state instead of asking the background manager for a new session.

## Fix

- Failed jobs now restart through `MERCH_FLOW_START_FRESH_CHAT_V1` even when the old managed tab still exists.
- Recovery resets route counters, Send arming and stale-route state.
- The background launches and repairs to canonical `https://chatgpt.com/` without custom query parameters.
- Every pre-Send conversation route is learned into the job deny-list before repair.

## Verification

- Chrome 151 CDP is reachable at `http://[::1]:9222`.
- The real ChatGPT root stayed empty and stable during repeated observation.
- A cancelled synthetic job was forced onto the exact stale production route `/c/6a880926-c17c-83ec-a5f7-fdf265d39908`; the service worker learned the route, incremented repair count once, and returned the tab to canonical root without sending a message.
- Test storage was restored and the temporary tab was closed after verification.
- JavaScript syntax and the full Node test suite pass.
