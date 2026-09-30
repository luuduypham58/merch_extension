# Merch Flow v0.9.25 — Stable Amazon acceptance gate

## Live evidence

One Amazon attempt briefly produced UI changes that satisfied the old preview fingerprint check,
then displayed `Please upload a valid PNG` and left Publish disabled. A subsequent instrumented
retry proved the exact File received by Amazon had valid PNG signature/tail, 4,360,398 bytes, and
the asset PUT plus preview GET requests returned HTTP 200.

## Fix

- Preview/file-name acceptance must remain positive for 1.8 seconds with no upload error.
- Amazon's current “Please upload a valid PNG” message is an explicit negative signal.
- Final success additionally requires an enabled Publish/Review control.
- A 45-second busy watchdog recovers a lost Select Products callback instead of leaving AUTO in
  `selecting-products` indefinitely.
