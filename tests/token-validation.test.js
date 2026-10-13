import test from "node:test";
import assert from "node:assert/strict";
import { isValidUrl, shortKey, validateTokenForm } from "../src/token-validation.js";

test("shortKey leaves short values unchanged", () => {
  assert.equal(shortKey("abc123"), "abc123");
});

test("shortKey shortens long wallet addresses", () => {
  assert.equal(shortKey("123456789ABCDEFG"), "12345…DEFG");
});

test("shortKey handles empty values", () => {
  assert.equal(shortKey(""), "");
  assert.equal(shortKey(null), "");
});

test("isValidUrl accepts HTTP, HTTPS, and IPFS URLs", () => {
  assert.equal(isValidUrl("https://example.com/token.json"), true);
  assert.equal(isValidUrl("http://example.com/token.json"), true);
  assert.equal(isValidUrl("ipfs://bafybeigdyr/token.json"), true);
});

test("isValidUrl rejects malformed and unsupported protocols", () => {
  assert.equal(isValidUrl("not a url"), false);
  assert.equal(isValidUrl("javascript:alert(1)"), false);
  assert.equal(isValidUrl("file:///etc/passwd"), false);
});

test("validateTokenForm accepts a valid token configuration", () => {
  assert.equal(validateTokenForm({
    name: "Nova Protocol",
    symbol: "NOVA",
    supply: "1000000",
    decimals: "9",
    uri: "https://example.com/token.json"
  }), true);
});

test("validateTokenForm rejects blank or overlong names", () => {
  const base = { name: "Nova", symbol: "NOVA", supply: "100", decimals: "9", uri: "https://example.com/token.json" };
  assert.equal(validateTokenForm({ ...base, name: " " }), false);
  assert.equal(validateTokenForm({ ...base, name: "N".repeat(33) }), false);
});

test("validateTokenForm rejects invalid symbols", () => {
  const base = { name: "Nova", symbol: "NOVA", supply: "100", decimals: "9", uri: "https://example.com/token.json" };
  for (const symbol of ["", "TOO-LONG-SYMBOL", "BAD SYMBOL", "NOVA!"]) {
    assert.equal(validateTokenForm({ ...base, symbol }), false, symbol);
  }
});

test("validateTokenForm requires a positive safe integer supply", () => {
  const base = { name: "Nova", symbol: "NOVA", supply: "100", decimals: "9", uri: "https://example.com/token.json" };
  for (const supply of ["0", "-1", "1.5", "9007199254740992", ""]) {
    assert.equal(validateTokenForm({ ...base, supply }), false, supply);
  }
});

test("validateTokenForm limits decimals to integers from 0 through 9", () => {
  const base = { name: "Nova", symbol: "NOVA", supply: "100", decimals: "9", uri: "https://example.com/token.json" };
  for (const decimals of ["-1", "10", "1.5", "abc"]) {
    assert.equal(validateTokenForm({ ...base, decimals }), false, decimals);
  }
  assert.equal(validateTokenForm({ ...base, decimals: "0" }), true);
});

test("validateTokenForm rejects invalid metadata URIs", () => {
  const base = { name: "Nova", symbol: "NOVA", supply: "100", decimals: "9", uri: "https://example.com/token.json" };
  assert.equal(validateTokenForm({ ...base, uri: "javascript:alert(1)" }), false);
  assert.equal(validateTokenForm({ ...base, uri: "invalid" }), false);
});
