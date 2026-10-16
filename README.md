# MintSol — Solana Token Launcher

MintSol is a Vite + React interface for creating a classic SPL token and its Metaplex Token Metadata account in one wallet-approved transaction.

**Default network: Solana Devnet.** This is a starter application, not an audited smart-contract product. Test thoroughly before any mainnet use.

## Features

- Connects to a compatible browser wallet such as Phantom.
- Creates a classic SPL Token mint.
- Creates the connected wallet's associated token account and mints the initial supply.
- Uploads a selected token image and metadata JSON to Pinata/IPFS through a server-side Vercel function.
- Creates a Metaplex Token Metadata account with the token name, symbol, and public metadata URI in the same wallet-approved Solana transaction.
- Adds a configurable **0.02 SOL platform fee** transfer to the same transaction.
- Shows the mint address and Solana Explorer links after confirmation.
- Includes GitHub Actions checks.

The app does not custody wallet keys. The wallet signs the transaction locally.

## Requirements

- Node.js 20 or newer and npm.
- A compatible Solana browser wallet.
- Devnet SOL for testing, obtained from a trusted Solana Devnet faucet.
- A public Solana address to receive the platform fee.

## Run locally

1. Clone the repository and enter its directory.
2. Install the locked dependency versions with `npm ci`.
3. Copy `.env.example` to `.env`.
   - Windows PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
4. Set `VITE_PLATFORM_FEE_WALLET` to the public address that should receive the 0.02 SOL fee. Do not put private keys or seed phrases in this file.
5. Keep `VITE_SOLANA_CLUSTER=devnet` while testing.
6. The upload endpoint is a Vercel serverless function, so plain `npm run dev` does not serve it. For local end-to-end testing, use `vercel dev` with the server-side `PINATA_JWT` available in your local environment, or test on your deployed Vercel app.

Run tests with `npm test`; build with `npm run build`; preview the production bundle with `npm run preview`.

## Token image and on-chain metadata

PNG, JPEG, WebP, or GIF images up to 2 MiB are accepted. The server-side endpoint uploads the image and metadata JSON to Pinata/IPFS and returns public URLs. Compatible wallets and explorers may resolve the token name, symbol, and image from the on-chain metadata, but indexing and caching delays vary.

### Required Vercel configuration

- Set `PINATA_JWT` under Vercel Project → Settings → Environment Variables. It must be server-only and must never use the `VITE_` prefix.
- The upload endpoint allows `https://mintsol-token-launcher.vercel.app` by default. Set `APP_ORIGIN` to your exact production origin if it differs.
- Redeploy after adding or changing environment variables.
- The endpoint checks request origin, validates image MIME types against file signatures, and limits decoded images to 2 MiB.
- The rate limit is best-effort and in-memory: 10 requests per IP per 15-minute window per serverless instance. It is not a global distributed limit. Configure Vercel Firewall/rate limiting or a shared rate-limit service before high-volume public use.

The Pinata JWT is never sent to the browser. Uploaded IPFS files may remain pinned if the user rejects the wallet transaction or the Solana transaction fails.

## Transaction behavior

The transaction transfers the 0.02 SOL platform fee, creates and initializes the mint, creates the associated token account, mints the initial supply, and creates the Metaplex metadata account. Review the transaction code and current authority behavior before relying on a fixed-supply claim or using Mainnet. All instructions are submitted together; if one fails, state changes do not partially commit, though network fees may still be charged. Rent and network fees are additional to the platform fee.

## Configuration

| Variable | Purpose |
| --- | --- |
| `VITE_PLATFORM_FEE_WALLET` | Public Solana address receiving the 0.02 SOL fee. |
| `VITE_SOLANA_CLUSTER` | Devnet by default. Keep on Devnet while testing. |
| `PINATA_JWT` | Server-only Pinata credential used by `/api/upload`. Never prefix it with `VITE_` or commit it. |
| `APP_ORIGIN` | Optional exact origin allowed to call `/api/upload`; defaults to the production Vercel URL. |

Vite environment variables are embedded in the public client bundle. Never add a private key, seed phrase, or secret API key to client-side variables.

## Mainnet checklist

- Complete the entire creation flow on Devnet first.
- Inspect every wallet instruction and verify the fee recipient address.
- Verify the mint and freeze authority state of a test token and clearly document the behavior.
- Review source code and dependency versions; run tests and a security/dependency audit.
- Confirm metadata JSON and image URLs are public and durable.
- Understand rent, network fees, decimals, mint authority, and metadata update authority.
- Use an RPC provider suitable for expected traffic.
- Do not claim the app is audited or production-ready without an independent review.

## Troubleshooting

- **Wallet not found:** Install or enable a compatible Solana browser wallet and reload.
- **Insufficient funds:** Request Devnet SOL on Devnet; on Mainnet, budget for the platform fee, rent, and transaction fees.
- **Fee wallet setup required:** Set a valid public address in `.env` and restart Vite.
- **Image upload fails:** Verify the server-side `PINATA_JWT` Vercel environment variable and redeploy. Never paste the JWT into chat or commit it.
- **Metadata missing in wallet/explorer:** Confirm the metadata account exists and its URI is publicly accessible. Indexing and caching can delay display.
- **Transaction fails:** Check cluster selection, wallet network, balance, and the transaction error.

## Security hardening notes

- `/api/upload` accepts POST requests only and validates the request origin and uploaded image signature.
- Encoded image data is size-checked before Base64 decoding; decoded images are limited to 2 MiB.
- The best-effort in-memory limit allows 10 upload requests per IP per 15-minute window per serverless instance; it is not global.
- The legacy `/api/upload-metadata` route was removed after checking that the app uses `/api/upload` only.
- Keep Pinata credentials server-side. Uploaded IPFS files can remain pinned even when a wallet transaction is rejected.

Run verification with:

```sh
npm ci
npm test
npm run build
```

## License

MIT. See LICENSE.
