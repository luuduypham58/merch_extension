# Merch Flow v0.9.24 — Amazon Angular checkbox control

## Live evidence

The current Select Products table exposed enabled native checkbox inputs, but
`HTMLInputElement.click()` left Standard t-shirt unchecked. Setting the native `checked` property
and dispatching bubbling, composed `input` and `change` events changed the value to true and the
Angular UI retained it after a delay.

## Fix

- Keep click and label activation as the first paths.
- If Amazon cancels both, set native checked state and emit the framework form events.
- Verify the live checkbox state after the events; product selection still fails closed if Amazon
  does not retain the requested state.
