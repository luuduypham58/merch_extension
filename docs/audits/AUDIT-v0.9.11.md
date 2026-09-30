# Audit v0.9.11 — AUTO New Chat Routing

## Fixed P0 routing behavior

AUTO must never reuse a visible conversation merely because it is in a newly created browser tab. ChatGPT may restore a previous `/c/<id>` route during app startup. v0.9.11 therefore requires both a managed fresh session and an empty conversation before sending the first prompt.

### Guarantees

- `MERCH_FLOW_START_FRESH_CHAT_V1` marks the pending job with `freshConversationRequired: true`.
- Before composer use, the content script detects old `/c/...` routes, existing user/assistant messages, and specialized Deep Research composer state.
- It clicks the visible New chat control and waits up to 20 seconds for a root, zero-message composer.
- If that proof is unavailable, prompt sending is blocked.
- A second guard runs immediately before `sendMarkedPrompt()` to close SPA race conditions.
- AUTO and fresh retries therefore cannot intentionally post the Merch brief into an existing personal conversation.
