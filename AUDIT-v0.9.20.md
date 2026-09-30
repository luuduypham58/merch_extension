# Merch Flow v0.9.20 — Verified Create-image composer claim

## Live evidence

- A manually duplicated clean root lost the Create image chip.
- Clicking the exact current `div.__menu-item` row on that duplicate produced a stable root composer
  with the Create image pill and zero messages.
- Plain `TEXT_TO_IMAGE_ONLY` fallback was sent successfully but ChatGPT refused it as a mistaken
  image-edit route, so a real active Create image composer is preferred.
- An unknown `/c/...` candidate later proved to contain two messages from an earlier Merch attempt;
  URL novelty alone is therefore insufficient.

## Hardening

- Background probes root ChatGPT tabs and claims only a verified clean, active Create image composer.
- Claiming binds the exact job ID, session nonce and tab ID before `runChatJob` can execute.
- Freshness checks ignore the non-editable tool pill but still require no editable draft.
- Non-empty candidate conversations are promoted immediately into the stale deny-list.
