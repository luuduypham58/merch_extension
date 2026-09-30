# AUDIT v0.9.2 CLEAN — remove image-mode metadata

## Trigger

A live artwork job showed that the extra line `MERCH_FLOW_IMAGE_MODE: TEXT_TO_IMAGE_NEW` could make routing less reliable rather than more reliable. It is application metadata, not part of the creative brief, and the image system does not need it.

## Changes

1. Removed `MERCH_FLOW_IMAGE_MODE: TEXT_TO_IMAGE_NEW` from `buildArtworkPrompt()`.
2. Removed the same marker from `buildArtworkRetryPrompt()`.
3. Retry strips that legacy marker from a stale `sourcePrompt` before embedding the old brief in a fresh retry session.
4. Prompt opening is reduced to the Job ID plus a direct instruction to create one brand-new artwork from scratch.
5. Fresh-session isolation remains unchanged: unique session nonce, no reference attachment, and the old managed ChatGPT tab is closed.
6. Listing remains hard-blocked until a real artwork image is captured for the exact current job/session.

## Expected behavior

The extension still provides all creative constraints, but no longer tries to tell ChatGPT which internal image mode to use. Each artwork attempt starts in a clean session and asks directly for one new generated artwork. If ChatGPT returns a missing-image/image-edit style error, the existing fast fallback opens another clean session and retries the complete brief without the legacy marker.
