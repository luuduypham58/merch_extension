# Merch Flow v0.8.3 — Cancel / Stuck AUTO hardening

- Added a visible **Hủy AUTO** control whenever an AUTO job is active.
- Cancel is a real flow reset, not only a UI state change.
- Background stores a `flowCancel` tombstone so late ChatGPT/Amazon callbacks from the cancelled job are ignored.
- ChatGPT capture, artwork retry, listing follow-up and Amazon listing watcher now respect cancellation.
- Pending chat/upload/transient artwork/listing state is cleared on cancel.
- AUTO UI flags no-progress runs older than 7 minutes as likely stuck and changes the cancel label to `Hủy AUTO · đang kẹt`.
- New AUTO/regenerate clears the previous cancellation tombstone.
- No browser/tab reload is required after cancelling.
