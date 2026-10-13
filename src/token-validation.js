export function shortKey(value) {
  if (!value) return "";
  const text = String(value);
  return text.length > 12 ? text.slice(0, 5) + "…" + text.slice(-5) : text;
}

export function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:", "ipfs:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function validateTokenForm(form) {
  const name = form.name.trim();
  const symbol = form.symbol.trim();
  const uri = form.uri.trim();
  const decimals = Number(form.decimals);
  const supplyText = String(form.supply).trim();
  const supply = Number(supplyText);
  const validSupply = /^\d+$/.test(supplyText) && Number.isSafeInteger(supply) && supply > 0;
  return name.length > 0
    && new TextEncoder().encode(name).length <= 32
    && /^[A-Za-z0-9]{1,10}$/.test(symbol)
    && validSupply
    && Number.isInteger(decimals)
    && decimals >= 0
    && decimals <= 9
    && new TextEncoder().encode(uri).length <= 200
    && isValidUrl(uri);
}
