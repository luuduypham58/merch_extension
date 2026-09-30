# Merch Flow v0.9.18 — Empty Create-image route handshake

## Production evidence

The live v0.9.17 job reached Create image but route repair increased from 2 to 5 and then failed at 6. Storage showed a second conversation path, `/c/6a89193e-326c-83ec-a1ae-72225380a64c`, that did not exist before the job and appeared while Create image was being activated.

The background guard treated every pre-Send `/c/...` as stale, including this newly allocated empty conversation, so it repeatedly destroyed the valid Create image state.

## Fix

- Arm a short route-transition window only after a stable empty New chat is proven.
- Accept an unknown conversation path as the one candidate route; never accept a path already in the stale deny-list.
- Before Send, reload job state, wait for the candidate to settle, and require zero conversation messages.
- Keep the final Send arm and post-storage freshness assertion.

## Verification

- JavaScript syntax checks pass.
- Tests cover deny-list precedence, candidate-route ownership, stability dwell and the zero-message requirement.
