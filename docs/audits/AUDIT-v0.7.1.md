# Audit v0.7.1 — Duplicate ChatGPT tabs

## Root cause

- v0.7.0 primarily reused a stored tab ID. A stale/missing ID could create another ChatGPT tab even when a Merch Flow conversation already existed.
- Popup and batch each had separate `chrome.tabs.create()` paths, so near-simultaneous requests could race.
- `runtime.onStartup` auto-started the next pending batch job, which could open ChatGPT simply after reopening Chrome.

## Fix

- Centralized ChatGPT open/reuse in background `ensureManagedChatTab()`.
- Serialized all open requests with `managedChatOpenChain`.
- Recover managed tabs from stored IDs, exact `merch_flow_job`, known conversation path, or Merch Flow conversation titles.
- ChatGPT content script registers a tagged/known Merch Flow tab back to background.
- Browser startup pauses a running batch instead of opening ChatGPT.
- Popup no longer directly creates ChatGPT tabs.

## Expected

- Open Amazon Merch: 0 new ChatGPT tabs.
- Reopen Chrome with unfinished batch: 0 new ChatGPT tabs; batch is paused.
- Click Create/AUTO/Resume: at most 1 managed ChatGPT tab.
- Artwork retry and listing follow-up stay in the same conversation/tab.
