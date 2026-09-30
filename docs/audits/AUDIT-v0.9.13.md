# Merch Flow v0.9.13 — Late old-chat restore recovery

## Production failure fixed

ChatGPT could briefly expose an empty root composer and then restore an older `/c/...` conversation while Merch Flow was selecting Create image. The previous final guard correctly blocked Send, but left the job waiting for a manual retry.

v0.9.13 now:

- requires the empty New chat state to remain stable before continuing;
- checks route and message state again after the prompt and Send button are ready;
- clears the unsent Merch draft if a late restore occurs;
- reopens New chat, reselects Create image, and retries automatically with a strict limit;
- reloads a job-owned root URL if the New chat control does not take effect.

## Adjacent regression fixed

Vault normalization preserves listing provenance/binding metadata, and a user-selected saved artwork/listing pair remains uploadable.
