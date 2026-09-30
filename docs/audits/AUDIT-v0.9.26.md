# Merch Flow v0.9.26 — Native-first product selection

## Live evidence

Amazon's Angular checkbox `.click()` path did not change state and spent roughly 15 seconds in its
synchronous handler. The 45-second safety watchdog therefore recovered after only three products.
The native checked setter plus bubbling/composed `input` and `change` retained state immediately.

## Fix

- Native property/events are now the primary path for native checkbox inputs.
- Live state is checked before any fallback.
- `.click()` and label activation remain bounded fallbacks for other Amazon UI variants.
