# Merch Flow v0.9.10 audit note

## Screenshot regression fixed

The v0.9.9 hardening could stall at `Create image` when the current ChatGPT UI did not expose a persistent selected-mode chip. v0.9.10 keeps the strict positive-check path, but adds a narrowly-scoped fallback that does **not** claim image mode is active.

Fallback is allowed only when all are true:

- the tab is registered as the exact managed job/session;
- the prompt explicitly contains `TASK_CLASS: TEXT_TO_IMAGE`, `INPUT_ASSETS: NONE`, and `TEXT_TO_IMAGE_ONLY`;
- there is no reference asset and no composer attachment;
- the composer is not Deep Research / detailed-report mode.

The resume path also no longer chooses an arbitrary active ChatGPT tab for a live job. If the managed tab is missing, it reopens a fresh job-owned session.
