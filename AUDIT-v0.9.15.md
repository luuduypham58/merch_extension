# Merch Flow v0.9.15 — Stale conversation hard block

## Root cause

v0.9.14 only observed `tabs.onUpdated` and temporarily allowed any `/c/...` route after the fresh Send gate was armed. ChatGPT can restore conversations through the History API, and an old route could therefore be missed or admitted during that short window.

## Fix

- Snapshot all existing ChatGPT `/c/...` paths before each fresh job.
- Reject a known stale path even while Send is armed.
- Observe both committed navigation and History API navigation with `webNavigation`.
- Close the previous managed ChatGPT tab before loading the new blank tab.
- Re-check the empty non-conversation page after the asynchronous storage arm completes, immediately before Send.

## Verification

- JavaScript syntax checks pass.
- The full Node test suite covers the stale-path deny list, SPA listener, close-before-load ordering, and post-arm freshness assertion.
