# MintSol Security Hardening v1.0.1

## Upload endpoint safeguards

- `/api/upload` accepts POST requests only, checks the browser origin, validates token fields, and checks the declared MIME type against the image file signature.
- Encoded image payloads are size-checked before Base64 decoding; decoded images are limited to 2 MiB.
- A best-effort in-memory limit allows 10 upload requests per IP per 15-minute window per serverless instance. This is not a global distributed limit: configure Vercel Firewall/rate limiting or a shared rate-limit service before high-volume public use.
- The old `/api/upload-metadata` route was removed after confirming the app calls only `/api/upload`.
- Pinata credentials remain server-only in `PINATA_JWT`; never expose them through `VITE_*` variables or commit secrets.
- The upload endpoint can pin files before a wallet transaction is approved. A wallet rejection can therefore leave an uploaded image/metadata pair on IPFS.

## Verification

Run:

```sh
npm ci
npm test
npm run build
```

Keep `VITE_SOLANA_CLUSTER=devnet` during testing. This hardening change does not alter token instructions, token authorities, or the configured Solana cluster.
