# Audit v0.8.1 — Regenerate Safety Fix

## Root cause

1. The revision prompt said to use the reference image already present. That phrasing could turn a fresh regeneration into an image-edit dependency; when the target image was not available to the image tool, ChatGPT correctly asked for another upload instead of generating.
2. AUTO capture and Regenerate could overlap. Because the job_id stays the same, a capture started from the previous send could race with the new revision and make downstream listing logic believe an artwork existed.

## Fix

- Regeneration now explicitly requests a fresh text-to-image artwork and never requires the rejected artwork as an edit target.
- Reference art is optional grammar context only; regeneration continues from the text brief when it is unavailable.
- Artwork capture validates the exact `sentAt` + `regenerationRevision` snapshot before storing anything.
- Listing follow-up requires a captured image belonging to the same send/revision and positioned after the revision prompt boundary.

## Expected behavior

Reject → Regenerate → exactly one new image → capture new image → request listing for that image.

If image generation returns text/refusal instead, the extension retries image generation and does **not** request a listing.
