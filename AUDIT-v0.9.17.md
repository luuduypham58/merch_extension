# Merch Flow v0.9.17 — Live AUTO stall fix

## Production evidence

CDP inspection showed the job failed after roughly four minutes with six stale-route repairs. The managed tab ended on the old conversation with an unsent Merch prompt draft. A real New chat activation immediately moved the same tab to canonical root and remained stable.

The current ChatGPT DOM also showed:

- Create image menu row: `div.__menu-item` without menu roles or `data-state`.
- Active Create image mode: a non-editable `[data-inline-selection-pill]` inside `#prompt-textarea`.

## Fix

- Use native element activation for New chat and composer controls.
- Match the current Create image menu row while excluding sidebar history.
- Replace only editable composer text after the active tool pill.
- Verify the pill survives prompt insertion.
- Bound menu retries to a shorter fail/fallback window.

## Verification

- JavaScript syntax checks pass.
- Full Node suite covers version sync, current menu markup, native activation and pill preservation.
