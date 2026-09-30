# Audit v0.8.2 — Regenerate Fresh-Chat Fix

## Root cause

v0.8.1 still mixed fresh-generation language with edit-like context: `previous artwork`, `rejected artwork`, `reference image`, `image target`, and `same conversation`. That could cause the image tool to classify regeneration as an edit and refuse when no usable target image was available.

## Fix

- Regenerate now navigates the managed ChatGPT tab to a blank conversation.
- The same `MERCH_FLOW_JOB_ID` is preserved in extension storage.
- Regeneration sends **no image attachment** (`referenceDataUrl` and `referenceName` are empty).
- Regeneration prompt omits all reference/edit/old-image language and strips reference wording from the saved style DNA.
- Revision metadata is persisted into `lastSentChatJob` so artwork capture and listing follow-up remain bound to the current revision.
- Listing is still blocked until a real new image is captured.
- Artwork retry copy is classifier-neutral and asks only for one new image from the text brief.

## Intended flow

Reject → blank ChatGPT conversation → same Job ID + text-only brief → new image → capture → listing JSON.
