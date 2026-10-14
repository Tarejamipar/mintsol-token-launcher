import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight, Check, CheckCircle2, ChevronDown, Coins, Copy, ExternalLink,
  FileImage, Fingerprint, Info, LoaderCircle, LockKeyhole, Rocket, ShieldCheck,
  Sparkles, Wallet, Zap
} from "lucide-react";
import {
  clusterApiUrl, Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, MINT_SIZE, TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction, createInitializeMintInstruction,
  createMintToInstruction, getAssociatedTokenAddressSync
} from "@solana/spl-token";
import { shortKey, validateTokenForm } from "./token-validation.js";

const FEE_SOL = 0.02;
const FEE_LAMPORTS = Math.round(FEE_SOL * LAMPORTS_PER_SOL);
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const DEFAULT_CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER === "mainnet-beta" ? "mainnet-beta" : "devnet";

function FieldLabel({ children, hint }) {
  return <div className="mb-2 flex items-center justify-between gap-2"><label className="text-sm font-semibold text-slate-200">{children}</label>{hint && <span className="text-xs text-slate-500">{hint}</span>}</div>;
}

function App() {
  const [cluster, setCluster] = useState(DEFAULT_CLUSTER);
  const [wallet, setWallet] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [mintAddress, setMintAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [copied, setCopied] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [form, setForm] = useState({ name: "", symbol: "", supply: "1000000", decimals: "9", uri: "" });

  useEffect(() => {
    const provider = window.solana;
    if (!provider?.on) return undefined;

    const handleAccountChanged = (publicKey) => {
      const nextWallet = publicKey ? new PublicKey(publicKey.toString()).toBase58() : "";
      if (nextWallet !== wallet) {
        setWallet(nextWallet);
        setError("Your wallet account changed. Review the connected account before continuing.");
      }
    };
    const handleDisconnect = () => {
      setWallet("");
      setError("Your wallet disconnected. Reconnect it before creating a token.");
    };

    provider.on("accountChanged", handleAccountChanged);
    provider.on("disconnect", handleDisconnect);
    return () => {
      provider.removeListener?.("accountChanged", handleAccountChanged);
      provider.removeListener?.("disconnect", handleDisconnect);
    };
  }, [wallet]);

  const connection = useMemo(() => new Connection(clusterApiUrl(cluster), "confirmed"), [cluster]);
  const feeWallet = import.meta.env.VITE_PLATFORM_FEE_WALLET || "";
  const feeWalletValid = useMemo(() => {
    try { return Boolean(feeWallet) && new PublicKey(feeWallet).toBase58() === feeWallet; }
    catch { return false; }
  }, [feeWallet]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value, ...(["name", "symbol"].includes(key) ? { uri: "" } : {}) }));
  const decimals = Number(form.decimals);
  const supply = Number(form.supply);
  const validSupply = Number.isSafeInteger(supply) && supply > 0;
  const validDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 9;
  const validForm = validateTokenForm({ ...form, uri: form.uri || "https://pending.invalid/metadata.json" });
  const canCreate = Boolean(wallet) && feeWalletValid && validForm && !busy;

  async function connectWallet() {
    setError("");
    setWalletBusy(true);
    try {
      const provider = window.solana;
      if (!provider?.connect) throw new Error("No Solana wallet found. Install Phantom or another compatible browser wallet, then reload this page.");
      const response = await provider.connect();
      const publicKey = response?.publicKey || provider.publicKey;
      if (!publicKey) throw new Error("The wallet did not return a public key.");
      setWallet(new PublicKey(publicKey.toString()).toBase58());
    } catch (err) {
      setError(err?.message || "Wallet connection was cancelled.");
    } finally { setWalletBusy(false); }
  }

  async function disconnectWallet() {
    try { await window.solana?.disconnect?.(); } catch { /* Wallet may already be disconnected. */ }
    setWallet("");
  }

  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
    } catch { setError("Clipboard access was blocked. Select and copy the address manually."); }
  }

  async function createToken(event) {
    event.preventDefault();
    setError("");
    setMintAddress("");
    setSignature("");
    if (!wallet) return setError("Connect your wallet first.");
    if (!feeWalletValid) return setError("Configure VITE_PLATFORM_FEE_WALLET with a valid public Solana address before creating a token.");
    if (!validateTokenForm({ ...form, uri: form.uri || "https://pending.invalid/metadata.json" })) return setError("Enter a valid token name, symbol, supply, and decimals.");

    const provider = window.solana;
    if (!provider?.publicKey || new PublicKey(provider.publicKey.toString()).toBase58() !== wallet) {
      return setError("Your wallet connection changed. Reconnect it and try again.");
    }

    setBusy(true);
    setStage("");
    try {
      setStage("Preparing token transaction");
      const owner = new PublicKey(wallet);
      const feeRecipient = new PublicKey(feeWallet);
      const tokenSupply = BigInt(form.supply) * (10n ** BigInt(decimals));
      if (tokenSupply > 18446744073709551615n) throw new Error("Supply multiplied by decimals exceeds the SPL Token uint64 limit.");

      const mint = Keypair.generate();
      const associatedToken = getAssociatedTokenAddressSync(mint.publicKey, owner);
      const rentLamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
      const transaction = new Transaction();

      // All requested instructions are submitted atomically in one transaction.
      transaction.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: feeRecipient, lamports: FEE_LAMPORTS }));
      transaction.add(SystemProgram.createAccount({
        fromPubkey: owner, newAccountPubkey: mint.publicKey, space: MINT_SIZE,
        lamports: rentLamports, programId: TOKEN_PROGRAM_ID
      }));
      transaction.add(createInitializeMintInstruction(mint.publicKey, decimals, owner, owner, TOKEN_PROGRAM_ID));
      transaction.add(createAssociatedTokenAccountInstruction(owner, associatedToken, owner, mint.publicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
      transaction.add(createMintToInstruction(mint.publicKey, associatedToken, tokenSupply, owner, [], TOKEN_PROGRAM_ID));

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      transaction.feePayer = owner;
      transaction.recentBlockhash = blockhash;
      transaction.partialSign(mint);

      if (!provider.publicKey || new PublicKey(provider.publicKey.toString()).toBase58() !== wallet) {
        throw new Error("The connected wallet changed before signing. Please reconnect and try again.");
      }
      setStage("Waiting for wallet approval");
      const signed = await provider.signTransaction(transaction);
      if (!provider.publicKey || new PublicKey(provider.publicKey.toString()).toBase58() !== wallet) {
        throw new Error("The connected wallet changed during signing. The transaction was not sent.");
      }
      setStage("Sending transaction");
      const txSignature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
      setStage("Confirming on Solana");
      const confirmation = await connection.confirmTransaction({ signature: txSignature, blockhash, lastValidBlockHeight }, "confirmed");
      if (confirmation.value.err) throw new Error("The transaction was confirmed as failed. Check the transaction details in Solana Explorer.");
      setMintAddress(mint.publicKey.toBase58());
      setSignature(txSignature);
      setStage("Token created successfully");
    } catch (err) {
      setError(err?.message || "Token creation failed. No success was reported.");
      setStage("");
    } finally { setBusy(false); }
  }

  const explorerCluster = cluster === "mainnet-beta" ? "" : "?cluster=devnet";
  const explorerBase = "https://explorer.solana.com";
  const resetForm = () => { setMintAddress(""); setSignature(""); setError(""); setStage(""); };

  return <div className="relative min-h-screen overflow-hidden">
    <div className="mesh pointer-events-none absolute inset-x-0 top-0 h-[560px]" />
    <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
      <a href="#" className="flex items-center gap-3 text-white">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-300/20 bg-violet-400/10 text-violet-200"><Sparkles size={21} /></span>
        <span><span className="block text-base font-extrabold tracking-tight">MintSol</span><span className="block text-[10px] font-semibold uppercase tracking-[.22em] text-slate-500">Solana launch studio</span></span>
      </a>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[.03] px-2 py-2 text-[10px] text-slate-400 sm:gap-2 sm:px-3 sm:text-xs">
          <span className={"h-1.5 w-1.5 rounded-full " + (cluster === "devnet" ? "bg-amber-300" : "bg-emerald-300")} />
          <select aria-label="Solana cluster" disabled={busy} className="max-w-[74px] bg-transparent text-slate-200 outline-none disabled:opacity-60 sm:max-w-none" value={cluster} onChange={(e) => { setCluster(e.target.value); resetForm(); }}>
            <option value="devnet">Devnet</option><option value="mainnet-beta">Mainnet</option>
          </select>
        </label>
        {wallet ? <button onClick={disconnectWallet} disabled={busy} className="flex items-center gap-2 disabled:opacity-60 rounded-xl border border-white/10 bg-white/[.05] px-3 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10"><span className="h-2 w-2 rounded-full bg-emerald-400" />{shortKey(wallet)} <ChevronDown size={13} /></button>
          : <button onClick={connectWallet} disabled={walletBusy} className="primary-btn flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs">{walletBusy ? <LoaderCircle className="animate-spin" size={15} /> : <Wallet size={15} />} Connect wallet</button>}
      </div>
    </header>

    <main className="relative z-10 mx-auto max-w-7xl px-5 pb-16 pt-8 sm:px-8 sm:pt-14">
      <div className="mx-auto mb-10 max-w-3xl text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/[.07] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-violet-200"><span className="pulse-glow h-1.5 w-1.5 rounded-full bg-violet-300" /> SPL token studio</div>
        <h1 className="text-4xl font-extrabold leading-[1.08] tracking-[-.05em] text-white sm:text-6xl">Launch your token.<br /><span className="bg-gradient-to-r from-violet-300 via-fuchsia-200 to-indigo-300 bg-clip-text text-transparent">Make it yours.</span></h1>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">Create a classic SPL token without needing a metadata URI. Token artwork is preview-only; wallets and explorers may not display its name, symbol, or image.</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500"><span className="flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-300" /> Non-custodial</span><span className="flex items-center gap-1.5"><Zap size={14} className="text-amber-300" /> Single transaction</span><span className="flex items-center gap-1.5"><Fingerprint size={14} className="text-violet-300" /> Metadata optional</span></div>
      </div>

      {cluster === "mainnet-beta" && <div className="mx-auto mb-5 max-w-5xl rounded-xl border border-amber-300/20 bg-amber-300/[.06] p-3 text-sm text-amber-100"><Info size={16} className="mr-2 inline" />Mainnet is selected. Real SOL fees and rent will be charged. Test on Devnet first.</div>}

      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[1.35fr_.75fr]">
        <section className="panel rounded-2xl p-5 sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-lg font-bold text-white"><Coins size={19} className="text-violet-300" /> Token configuration</div><p className="mt-1 text-xs text-slate-500">Define the identity and initial supply of your token.</p></div><span className="rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Step 01 / 02</span></div>
          <form onSubmit={createToken} className="space-y-5">
            <div><FieldLabel hint="Up to 32 characters">Token name</FieldLabel><input className="field" maxLength={32} placeholder="e.g. Nova Protocol" value={form.name} onChange={(e) => update("name", e.target.value)} required /></div>
            <div className="grid gap-4 sm:grid-cols-2"><div><FieldLabel hint="1–10 letters/numbers">Ticker symbol</FieldLabel><input className="field uppercase" maxLength={10} placeholder="NOVA" value={form.symbol} onChange={(e) => update("symbol", e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} required /></div><div><FieldLabel>Decimals</FieldLabel><select className="field" value={form.decimals} onChange={(e) => update("decimals", e.target.value)}>{[9,8,6,4,2,0].map((n) => <option key={n} value={n}>{n} decimals</option>)}</select></div></div>
            <div><FieldLabel hint="Whole tokens, before decimals">Initial supply</FieldLabel><div className="relative"><input className="field pr-20" type="number" min="1" step="1" placeholder="1000000" value={form.supply} onChange={(e) => update("supply", e.target.value)} required /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">{form.symbol || "TOKEN"}</span></div><p className="mt-2 text-[11px] text-slate-500">You will receive the entire initial supply in your connected wallet.</p></div>
            <div>
              <FieldLabel hint="PNG, JPG, WebP or GIF · max 2 MB">Token image</FieldLabel>
              <label className="flex cursor-pointer items-center gap-4 rounded-xl border border-dashed border-violet-300/30 bg-white/[.02] p-4 hover:bg-white/[.04]">
                {imagePreview ? <img src={imagePreview} alt="Token image preview" className="h-20 w-20 rounded-xl border border-white/10 object-cover" /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[.03] text-violet-200"><FileImage size={26} /></span>}
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-slate-100">{imageFile ? imageFile.name : "Choose token image (optional)"}</span><span className="mt-1 block text-xs leading-5 text-slate-500">Select an image for an on-page preview. It is not uploaded or attached to the on-chain token.</span><span className="mt-2 inline-flex rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-violet-200">Browse image</span></span>
                <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(e) => {
                  const file = e.target.files?.[0];
                  setError("");
                  setForm((current) => ({ ...current, uri: "" }));
                  if (!file) return;
                  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
                    setImageFile(null); setImagePreview(""); setError("Choose a PNG, JPEG, WebP, or GIF image."); e.target.value = ""; return;
                  }
                  if (file.size > 2 * 1024 * 1024) {
                    setImageFile(null); setImagePreview(""); setError("Image must be 2 MB or smaller."); e.target.value = ""; return;
                  }
                  setImageFile(file);
                  const reader = new FileReader();
                  reader.onload = () => setImagePreview(String(reader.result || ""));
                  reader.onerror = () => { setImageFile(null); setImagePreview(""); setError("Could not preview this image. Try another file."); };
                  reader.readAsDataURL(file);
                }} />
              </label>
              <p className="mt-2 text-[11px] leading-5 text-amber-200">Image-only mode: no metadata URI is required. The selected image stays in your browser and is not published. Wallets and token explorers may not show a token name, symbol, or image without on-chain metadata and a public metadata URI.</p>
            </div>
            {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-400/[.07] p-3 text-sm leading-5 text-rose-200"><Info size={16} className="mr-2 inline" />{error}</div>}
            {stage && <div aria-live="polite" className="rounded-xl border border-violet-300/20 bg-violet-300/[.06] p-3 text-sm text-violet-100">{busy && <LoaderCircle size={15} className="mr-2 inline animate-spin" />}{!busy && <CheckCircle2 size={15} className="mr-2 inline" />}{stage}</div>}
            <button className="primary-btn flex w-full items-center justify-center gap-2 rounded-xl px-5 py-4 text-sm" type="submit" disabled={!canCreate}>{busy ? <LoaderCircle size={17} className="animate-spin" /> : <Rocket size={17} />}{busy ? "Creating token…" : "Create token"}{!busy && <ArrowUpRight size={16} />}</button>
            {!wallet && <p className="text-center text-xs text-slate-500">Connect a Solana wallet to enable token creation.</p>}
            {wallet && !feeWalletValid && <p className="text-center text-xs text-amber-200">Admin setup required: configure the platform fee wallet.</p>}
          </form>
        </section>

        <aside className="space-y-5">
          <section className="panel overflow-hidden rounded-2xl">
            <div className="border-b border-white/[.07] p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-bold text-white">Launch summary</h2><Sparkles size={16} className="text-violet-300" /></div><p className="mt-1 text-xs text-slate-500">Review the transaction before signing.</p></div>
            <div className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-4"><span className="text-xs text-slate-400">Network</span><span className="rounded-md border border-white/10 bg-white/[.04] px-2 py-1 text-[11px] font-semibold text-slate-200">{cluster === "devnet" ? "Solana Devnet" : "Solana Mainnet"}</span></div>
              <div className="flex items-center justify-between gap-4"><span className="text-xs text-slate-400">Token</span><span className="max-w-[58%] truncate text-right text-xs font-semibold text-slate-200">{form.name || "Your token name"}</span></div>
              <div className="flex items-center justify-between gap-4"><span className="text-xs text-slate-400">Symbol</span><span className="text-xs font-bold text-violet-200">{form.symbol || "—"}</span></div>
              <div className="flex items-center justify-between gap-4"><span className="text-xs text-slate-400">Initial supply</span><span className="mono text-xs text-slate-200">{validSupply ? supply.toLocaleString("en-US") : "—"}</span></div>
              <div className="my-1 border-t border-dashed border-white/10" />
              <div className="flex items-center justify-between gap-4"><span className="text-xs text-slate-400">Platform fee</span><span className="mono text-xs font-bold text-slate-100">0.02 SOL</span></div>
              <div className="flex items-center justify-between gap-4"><span className="text-xs text-slate-400">Network + rent</span><span className="text-xs text-slate-300">Additional</span></div>
              <div className="rounded-xl border border-violet-300/15 bg-violet-300/[.05] p-3 text-xs leading-5 text-slate-400"><Info size={14} className="mr-1.5 inline text-violet-300" />Your wallet shows the transaction for approval. Review all instructions before signing.</div>
            </div>
          </section>
          <section className="panel rounded-2xl p-5">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck size={17} className="text-emerald-300" /> What happens on-chain?</div>
            <ol className="space-y-4">
              {[["01","Create mint account","A new SPL token mint is created."],["02","Mint initial supply","Tokens are sent to your associated account."],["03","No metadata upload","The image is only a local preview; token metadata is not created."],["04","Pay platform fee","0.02 SOL is sent to the configured fee wallet."]].map(([n,title,desc]) => <li key={n} className="flex gap-3"><span className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-[10px] text-violet-200">{n}</span><div><p className="text-xs font-semibold text-slate-200">{title}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{desc}</p></div></li>)}
            </ol>
          </section>
        </aside>
      </div>

      {mintAddress && <div className="mx-auto mt-6 max-w-5xl rounded-2xl border border-emerald-300/20 bg-emerald-300/[.06] p-5 sm:p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-300" size={22} /><div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-white">Your token is live on {cluster === "devnet" ? "Devnet" : "Mainnet"}!</h2><p className="mt-1 text-sm text-slate-400">The transaction was confirmed. Save your mint address for future use.</p>
        <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Mint address</p><div className="flex items-center gap-2"><code className="mono min-w-0 flex-1 break-all text-xs text-emerald-100">{mintAddress}</code><button aria-label="Copy mint address" onClick={() => copyText(mintAddress, "mint")} className="rounded-lg border border-white/10 p-2 text-slate-300 hover:bg-white/10">{copied === "mint" ? <Check size={15} /> : <Copy size={15} />}</button></div></div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs"><a target="_blank" rel="noreferrer" href={explorerBase + "/address/" + mintAddress + explorerCluster} className="inline-flex items-center gap-1.5">View mint <ExternalLink size={12} /></a>{signature && <a target="_blank" rel="noreferrer" href={explorerBase + "/tx/" + signature + explorerCluster} className="inline-flex items-center gap-1.5">View transaction <ExternalLink size={12} /></a>}</div>
      </div></div></div>}

      <footer className="mx-auto mt-12 flex max-w-5xl flex-col items-center justify-between gap-3 border-t border-white/[.07] pt-6 text-[11px] text-slate-600 sm:flex-row">
        <div className="flex items-center gap-2"><Sparkles size={14} className="text-violet-300" /> MintSol <span>·</span> Built for Solana</div>
        <div className="flex items-center gap-4"><a href="https://solana.com/docs" target="_blank" rel="noreferrer">Solana docs</a><a href="https://developers.metaplex.com/token-metadata" target="_blank" rel="noreferrer">Metaplex docs</a><span className="flex items-center gap-1"><LockKeyhole size={11} /> Non-custodial</span></div>
      </footer>
    </main>
  </div>;
}
export default App;