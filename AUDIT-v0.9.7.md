# Merch Flow v0.9.7 audit

## Issue reproduced from screenshot

v0.9.6 could open/focus the ChatGPT composer but then report `Menu ChatGPT không có mục Create image`. The selector only searched semantic menu/button roles, while the current ChatGPT menu can render the **Create image / Visualize anything** row through different non-semantic wrappers.

## Fix

1. Search semantic menu items, Radix collection rows, tabindex rows, buttons, and image-labelled test IDs.
2. Fall back to visible text-node discovery for `Create image` / `Visualize anything`, then climb to the nearest clickable row.
3. Add a bounded `div/span` fallback for current menu markup.
4. Use pointer + mouse events instead of relying only on `element.click()`.
5. Retry opening the `+` popover up to three times and include visible menu text in any final diagnostic.
6. Continue to abort before prompt submission if image mode cannot be confirmed.
