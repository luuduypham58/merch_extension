# AUDIT v0.9.4

## Reproduced failure
ChatGPT returned prose saying the image tool treated a brand-new Merch generation request as an edit requiring an existing image target.

## Root causes fixed
1. The v0.9.3 routing-failure regex did not match the exact “treated ... as an edit requiring an existing image target” wording, so immediate recovery was skipped.
2. Legacy pending-job reference fields could survive an upgrade/retry path even though current jobs intentionally pass an empty reference.
3. The composer was not explicitly scrubbed for stale file/preview state before a text-only artwork send.
4. The artwork brief contained the ambiguous phrase “uploaded artwork itself”.

## v0.9.4 safeguards
- All fresh Merch jobs force referenceDataUrl/referenceName empty.
- Old referenceAlreadySent/recoveryMode state is cleared before send.
- Composer file inputs and attachment remove controls are cleared before the prompt is filled.
- The exact image-edit routing refusal is recognized and retried in a brand-new ChatGPT tab after ~2 seconds.
- Main and retry prompts carry a TEXT_TO_IMAGE_ONLY marker and use unambiguous output wording.
