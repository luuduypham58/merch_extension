# AUDIT v0.9.0 CLEAN

## Root causes found

1. v0.8.3 claimed fresh-chat regeneration but the installed logic could still reuse/navigate the currently managed ChatGPT tab while global state was already pending.
2. Old unpacked extension versions can coexist under different Chrome extension IDs. Multiple enabled 0.8.x copies can inject separate content scripts into the same ChatGPT page and independently send stale prompts/listing requests.
3. Listing parsing ran before a hard proof that a real image had been captured.
4. Text-only artwork failures were retried inside the same conversation, preserving the bad tool classification state.
5. Reference wording could be emitted even when no reference image was attached.

## v0.9.0 fixes

- Fresh artwork attempts use a new ChatGPT tab created first as about:blank, then get a unique session nonce and navigate to a clean ChatGPT root.
- Artwork-attempt prompt contains no regenerate/revision/rejected/previous/reference/edit/image-target wording.
- New session nonce isolates capture/listing state to the exact ChatGPT session.
- No listing may be captured or requested until a real artwork image is captured after the current artwork prompt.
- Text-only failure triggers another clean session instead of a same-conversation retry.
- Known managed ChatGPT tabs are reloaded on extension update to clear stale injected scripts.
- Manifest now contains a stable key so future v0.9+ unpacked builds use a stable extension ID.
- Reference rules appear only when an actual reference image is attached.
- HỦY AUTO remains available and late callbacks remain tombstoned.

## Test result

52/52 tests PASS; all JS syntax checks PASS.

## One-time clean install requirement

Because older unpacked builds were created without the stable key, Chrome may have installed each folder as a separate extension. Chrome extensions cannot disable sibling extensions. Before loading v0.9.0 CLEAN, disable/remove every older Merch Flow copy in chrome://extensions. Keep only Merch Flow v0.9.0 CLEAN enabled.
