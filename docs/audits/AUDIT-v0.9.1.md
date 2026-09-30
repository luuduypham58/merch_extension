# AUDIT v0.9.1 CLEAN — Text-to-image routing hardening

## Failure reproduced from the current flow

The artwork request can be answered with text instead of an image when ChatGPT/image generation classifies the request as an image-edit task and cannot find a usable source image. In v0.9.0 the automatic retry opened a fresh conversation but replayed the same source prompt unchanged, so the same routing failure could repeat.

## Root causes fixed

1. **Saved winner reference leaked into artwork jobs.** Manual/AUTO/batch jobs could carry `referenceDataUrl`, which caused the extension to attach an image before the prompt. That is useful for edit workflows, but risky for a brand-new Merch design because it supplies an image target to the conversation.
2. **Not every first artwork attempt used the strict fresh-session manager.** Regeneration/retry did, but the normal manual/AUTO path and batch path still used the managed-tab reuse path.
3. **Recovery builder existed but was not used.** `Core.buildArtworkRetryPrompt()` was defined, but `maybeRequestArtworkRetry()` opened a clean chat and sent `sourcePrompt` unchanged.
4. **Recovery prompt assumed the old brief existed in the new chat.** A clean retry cannot say “use the brief already supplied in this conversation” unless it embeds that brief.
5. **Known image-edit/missing-image failures waited on the generic retry delay.** This made an obvious routing failure unnecessarily slow.

## v0.9.1 changes

- Every manual, AUTO and batch artwork job starts with `MERCH_FLOW_START_FRESH_CHAT_V1` and a unique session nonce.
- Every artwork prompt includes `MERCH_FLOW_IMAGE_MODE: TEXT_TO_IMAGE_NEW` plus a clear brand-new text-to-image instruction.
- Stored style-reference images remain saved in the profile UI, but generation jobs force `referenceDataUrl: ""` and `referenceName: ""`.
- Batch prompt generation ignores reference attachments and emits no `REFERENCE RULE` block.
- Text-only retries now call `Core.buildArtworkRetryPrompt(jobId, retryNumber, sourcePrompt)`.
- The recovery prompt embeds the entire original written brief, so a genuinely fresh chat has everything required.
- Common “upload/attach/provide image”, “missing image target/source”, and image-edit routing responses trigger the fresh recovery path after ~4 seconds instead of waiting for the generic artwork timeout.
- Listing remains hard-blocked until a real image is captured for the exact current job/session.

## UX behavior after the fix

Normal use remains one click. The user can still save a winner image in the profile as a visual/style note, but AUTO does not attach it to image generation. Style guidance comes from the saved Winner Style DNA text. If ChatGPT still returns a routing error instead of artwork, the extension opens a clean text-to-image session itself and retries with the full original brief.

## Verification

- JavaScript syntax checks: PASS
- Automated test suite: **56/56 PASS**
- Manual prompt inspection confirms the first lines are:
  - `MERCH_FLOW_JOB_ID: ...`
  - `MERCH_FLOW_IMAGE_MODE: TEXT_TO_IMAGE_NEW`
  - brand-new image / written-brief-only generation instruction
- Manual and batch code paths both use the fresh-chat manager.
- All active artwork job constructors force empty reference attachment fields.
