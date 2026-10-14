# MintSol — Solana Token Launcher

MintSol is a Vite + React interface for creating a classic SPL token and its Metaplex Token Metadata account in one wallet-approved transaction.

**Default network: Solana Devnet.** This is a starter application, not an audited smart-contract product. Test thoroughly before any mainnet use.

## Features

- Connects to a compatible browser wallet such as Phantom.
- Creates a classic SPL Token mint.
- Creates the connected wallet's associated token account and mints the initial supply.
- Allows token creation without a metadata URI or metadata upload. An optional selected image is only a local preview and is not published or attached to the token.
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
6. Keep `VITE_SOLANA_CLUSTER=devnet`, open the local Vite URL, connect your test wallet, and create a test token.

Run automated unit tests with **npm test**. Build and preview the production bundle with **npm run build** and **npm run preview**.

## Image-only mode and metadata limitations

A user may optionally select a PNG, JPEG, WebP, or GIF image up to 2 MB. The browser displays it as a local preview only. MintSol does not upload the image, create a metadata JSON file, or require a metadata URI in this mode.

**Important:** A classic SPL token mint does not itself store a display name, symbol, or image. Without a Metaplex metadata account and a publicly accessible metadata URI, wallets and token explorers may show only the mint address or incomplete token details; the chosen local image will not appear to other users. To publish artwork and improve wallet/explorer display, add a metadata-hosting workflow in a future version.

## Transaction behavior

The transaction includes:

1. Transfer of 0.02 SOL to VITE_PLATFORM_FEE_WALLET.
2. Creation and initialization of the mint account.
3. Creation of the associated token account.
4. Minting of the initial supply to the connected wallet.
5. No metadata account is created in image-only mode.

These instructions are submitted together. If any instruction fails, Solana transaction atomicity means the instructions do not partially commit, although transaction fees may still be charged. The payer also needs SOL for account rent and network fees. The exact cost varies.

The app uses the connected wallet as mint authority and metadata update authority. The mint authority is **not revoked** by this starter app; therefore, the authority can mint more tokens later. Do not imply a fixed maximum supply unless you add a reviewed authority-revocation workflow.

## Configuration

| Variable | Purpose |
| --- | --- |
| VITE_PLATFORM_FEE_WALLET | Public Solana address receiving the 0.02 SOL fee. Required for token creation. |
| VITE_SOLANA_CLUSTER | Devnet by default; set to mainnet-beta only when deliberately preparing for mainnet. |

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
- **Token name, symbol, or image is missing in a wallet/explorer:** This mode does not create metadata. Add a metadata account and public metadata URI if you need those display fields.
- **Transaction fails:** Check the selected cluster, wallet network, balance, and transaction error details.

## License

MIT. See LICENSE.