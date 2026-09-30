# Merch Flow v0.9.6 audit

## Routing fix

The previous build relied on prompt text alone to request text-to-image generation. That can still be routed by ChatGPT as an image-edit request. v0.9.6 now explicitly selects the ChatGPT **Create image** tool before any Merch artwork prompt is sent.

## Fail-closed rules

1. Clear any stale file/image from the active composer.
2. Find the composer `+` / Add files and more control.
3. Open its menu and select **Create image** (English and Vietnamese labels supported).
4. Reacquire the live composer because ChatGPT may replace the editor node.
5. If Create image cannot be activated, stop the job instead of sending a prompt in ambiguous mode.
6. Apply the same path to fresh retries and regeneration.

Listing remains gated on capture of a real image for the current Job ID/session.
