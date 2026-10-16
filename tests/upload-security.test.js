import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BASE64_CHARS, MAX_IMAGE_BYTES, checkUploadRateLimit, decodeImageBase64, getImageSignatureError } from "../api/upload-security.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test("decodes a valid PNG whose signature matches the declared type", () => {
  const result = decodeImageBase64(png.toString("base64"), "image/png");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.imageBuffer, png);
});

test("rejects mismatched image signatures", () => {
  const result = decodeImageBase64(Buffer.from("not an image").toString("base64"), "image/png");
  assert.equal(result.status, 400);
  assert.match(result.error, /do not match/);
  assert.match(getImageSignatureError(Buffer.from("not an image"), "image/jpeg"), /do not match/);
});

test("rejects oversized Base64 before decoding", () => {
  const result = decodeImageBase64("A".repeat(MAX_BASE64_CHARS + 4), "image/png");
  assert.equal(result.status, 413);
});

test("enforces the decoded 2 MiB limit", () => {
  const result = decodeImageBase64(Buffer.alloc(MAX_IMAGE_BYTES + 1).toString("base64"), "image/png");
  assert.equal(result.status, 413);
});

test("rejects malformed and non-canonical Base64", () => {
  for (const value of ["%%%", "a", "AAAA====", "AB=="]) {
    const result = decodeImageBase64(value, "image/png");
    assert.ok(result.error, value);
  }
});

test("recognizes supported JPEG, WebP, and GIF signatures", () => {
  const samples = [
    ["image/jpeg", [0xff, 0xd8, 0xff, 0x00]],
    ["image/webp", [...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]],
    ["image/gif", [...Buffer.from("GIF89a"), 0]]
  ];
  for (const [type, bytes] of samples) assert.equal(getImageSignatureError(Buffer.from(bytes), type), null);
  assert.ok(getImageSignatureError(png, "image/jpeg"));
});

test("limits an IP to ten upload attempts per 15-minute window", () => {
  const ip = "test-ip-rate-limit";
  const start = 1_800_000_000_000;
  for (let i = 0; i < 10; i++) assert.equal(checkUploadRateLimit(ip, start + i).allowed, true);
  const blocked = checkUploadRateLimit(ip, start + 11);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.equal(checkUploadRateLimit(ip, start + 15 * 60 * 1000 + 1).allowed, true);
});
