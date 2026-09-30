# Audit v0.9.34 — Runtime hardening

## Fixed

- Product selection contract is consistently manual after verified artwork + listing 5/5.
- Dormant Select Products automation and checkbox mutation code removed.
- ChatGPT ownership no longer falls back to tab title or arbitrary query tagging.
- Batch recovery reopens a canonical clean session when the owned tab is gone or failed.
- Extension updates reload only managed flow tabs.
- Amazon runtime registrations are removed when their tab closes.
- Vault image payloads moved from chrome.storage.local to IndexedDB with legacy migration.
- ChatGPT observers and polling arm only for a verified owned job.
- Unused activeTab permission removed.
- Historical audit files moved out of the repository root.

## Validation

- v0.9.34 syntax checks pass.
- Updated local snapshot test suite: 121/121 PASS.
- Registration ownership was tightened after audit to remove the last title heuristic.
