# MintSol — Solana Token Launcher

MintSol is a Vite + React interface for creating a classic SPL token and its Metaplex Token Metadata account in one wallet-approved transaction.

**Default network: Solana Devnet.** This is a starter application, not an audited smart-contract product. Test thoroughly before any mainnet use.

## Features

- Connects to a compatible browser wallet such as Phantom.
- Creates a classic SPL Token mint.
- Creates the connected wallet's associated token account and mints the initial supply.
- Uploads a selected token image and metadata JSON to Pinata/IPFS through a server-side Vercel function.\n- Creates a Metaplex Token Metadata account with the token name, symbol, and public metadata URI in the same wallet-approved Solana transaction.
- Adds a configurable **0.02 SOL platform fee** transfer to the same transaction.
- Shows the mint address and Solana Explorer links after confirmation.
- Includes a GitHub Actions production-build check.

The app does not custody wallet keys. The wallet signs the transaction locally.

Automated unit tests cover token form validation, accepted metadata URI protocols, and wallet-address display formatting. These tests do not replace an end-to-end wallet or on-chain test.

## Requirements

- Node.js 20 or newer and npm.
- A compatible Solana browser wallet.
- Devnet SOL for testing, obtained from a trusted Solana Devnet faucet.
- A public Solana address to receive the platform fee.
- A public Solana address to receive the platform fee.

## Run locally

1. Clone the repository and enter its directory.
2. Install the exact locked dependency versions by running **npm ci**.
3. Copy .env.example to .env.
   - Windows PowerShell: **Copy-Item .env.example .env**
   - macOS/Linux: **cp .env.example .env**
4. Edit .env and set VITE_PLATFORM_FEE_WALLET to the public address that should receive the 0.02 SOL fee. Do not put private keys or seed phrases in this file.
5. Keep VITE_SOLANA_CLUSTER=devnet while testing.
6. Keep `VITE_SOLANA_CLUSTER=devnet`. The upload endpoint is a Vercel serverless function, so plain `npm run dev` does not serve it. For local end-to-end testing, use the Vercel CLI (`vercel dev`) with the server-side `PINATA_JWT` available in your local environment; otherwise test on your deployed Vercel app.

Run automated unit tests with **npm test**. Build and preview the production bundle with **npm run build** and **npm run preview**.

## Token image and on-chain metadata

A PNG, JPEG, WebP, or GIF image up to 2 MB is required for the metadata publishing flow. The Vercel server-side endpoint uploads the image and a metadata JSON document to Pinata/IPFS, then returns public URLs. The client adds a Metaplex Token Metadata instruction containing the token name, symbol, and metadata URI to the same wallet-approved transaction that creates the classic SPL token.

Compatible wallets and explorers can use this on-chain metadata to resolve the token name, symbol, and image. Display is not guaranteed to be immediate: wallet and explorer indexing/caching varies, and some services only show assets after their own indexing.

### Required Vercel configuration

- Set `PINATA_JWT` under Vercel Project → Settings → Environment Variables. It must be a server-only variable and must never use the `VITE_` prefix.
- The upload endpoint allows the production origin `https://mintsol-token-launcher.vercel.app` by default. If your deployment uses a different domain, set `APP_ORIGIN` to that exact origin in Vercel.
- Redeploy after adding or changing environment variables.
- The public upload endpoint checks the request origin, accepted image types, and a 2 MB file limit. Add Vercel-side rate limiting/abuse protection before promoting this endpoint for high-volume public use.

The Pinata JWT is never sent to the browser. Uploaded IPFS files may remain pinned even if the user rejects the wallet transaction or the Solana transaction fails.

## Transaction behavior

The transaction includes:

1. Transfer of 0.02 SOL to VITE_PLATFORM_FEE_WALLET.
2. Creation and initialization of the mint account.
3. Creation of the associated token account.
4. Minting of the initial supply to the connected wallet.
5. Create a Metaplex metadata account pointing to the public IPFS metadata JSON.

These instructions are submitted together. If any instruction fails, Solana transaction atomicity means the instructions do not partially commit, although transaction fees may still be charged. The payer also needs SOL for account rent and network fees. The exact cost varies.

The app uses the connected wallet as mint authority and metadata update authority. The mint authority is **not revoked** by this starter app; therefore, the authority can mint more tokens later. Do not imply a fixed maximum supply unless you add a reviewed authority-revocation workflow.

## Configuration

| Variable | Purpose |
| --- | --- |
| VITE_PLATFORM_FEE_WALLET | Public Solana address receiving the 0.02 SOL fee. Required for token creation. |
| VITE_SOLANA_CLUSTER | Devnet by default; set to mainnet-beta only when deliberately preparing for mainnet. |\n| PINATA_JWT | Server-only Pinata credential used by `/api/upload`. Never prefix it with `VITE_` or commit its value. |\n| APP_ORIGIN | Optional exact app origin allowed to call `/api/upload`; defaults to the production Vercel URL. |

Vite environment variables are embedded in the public client bundle. Only use public configuration values here. Never add a private key, seed phrase, or secret API key.

## Mainnet checklist

- Test complete creation on Devnet first.
- Inspect every wallet instruction and confirm the fee recipient address.
- Review the source code and dependency versions; run a security/dependency audit.
- Confirm metadata JSON and image URLs are durable and accessible.
- Understand rent, network fees, token decimals, mint authority, and metadata update authority.
- Use an RPC provider suitable for your traffic and operational requirements.
- Do not promise the app is audited or production-ready without an independent review.

## Troubleshooting

- **Wallet not found:** Install or enable a compatible Solana browser wallet and reload the page.
- **Insufficient funds:** Request Devnet SOL when on Devnet, or fund the wallet with enough SOL for fee, rent, and transaction fees on Mainnet.
- **Fee wallet setup required:** Set a valid public address in .env, then restart Vite.
- **Token name, symbol, or image is missing in a wallet/explorer:** Confirm the Metaplex metadata account exists and its URI opens publicly. Wallet/explorer indexing and caching may delay display.
- **Transaction fails:** Check the selected cluster, wallet network, balance, and transaction error details.

## License

MIT. See LICENSE.