# Merch Flow v0.9.27 — Live Amazon draft reconciliation

## Live evidence

Extension storage retained `artworkVerified: true` across an audit reload, but the actual Amazon
draft had returned to `Drag and drop artwork here`. The old resume path filled listing/products
without retransferring the PNG, so Publish remained disabled. Separately, Amazon required
`Save publish settings` after product selection before it could enable Publish.

## Fix

- Resume now compares persisted verification with live uploader state for up to five seconds.
- A blank/rejected uploader resets only the current upload checkpoints and retransfers the same
  finalized PNG; listing/artwork source data remain intact.
- After all data is ready, the extension saves publish settings and waits for an enabled review
  control. It still never clicks Publish.
