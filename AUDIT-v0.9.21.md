# Merch Flow v0.9.21 — Current ChatGPT image-turn capture

## Live evidence

The real generated turn used `section[data-turn="assistant"]` without a nested
`data-message-author-role="assistant"`. It contained a signed ChatGPT estuary image URL and the
visible 400 × 480 image frame, but the image element was still `complete=false`,
`naturalWidth=0`, and inside a temporary opacity-zero wrapper. The old capture path therefore
reported no artwork even though the response exposed “Like this image” actions.

## Fix

- Canonical message enumeration supports old author-role nodes and current `section[data-turn]`
  nodes without returning duplicate user turns.
- Artwork/listing/retry code reads the role through one `messageRole` helper.
- Signed generated-image URLs can be fetched before the browser image element finishes decoding;
  the existing job/session/candidate provenance checks remain in force.
