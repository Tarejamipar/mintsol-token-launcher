export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
export const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestsByIp = new Map();

export function getImageSignatureError(image, imageType) {
  const bytes = Buffer.isBuffer(image) ? image : Buffer.from(image || []);
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp = bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const isGif = bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6));
  const matches = (imageType === "image/png" && isPng)
    || (imageType === "image/jpeg" && isJpeg)
    || (imageType === "image/webp" && isWebp)
    || (imageType === "image/gif" && isGif);
  return matches ? null : "The file contents do not match the selected image type.";
}

export function decodeImageBase64(base64, imageType) {
  if (typeof base64 !== "string" || !base64.length || base64.length > MAX_BASE64_CHARS) {
    return { error: "Image must be larger than 0 bytes and no more than 2 MB.", status: 413 };
  }
  if (base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    return { error: "The image upload data is invalid.", status: 400 };
  }
  const imageBuffer = Buffer.from(base64, "base64");
  if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) {
    return { error: "Image must be larger than 0 bytes and no more than 2 MB.", status: 413 };
  }
  if (imageBuffer.toString("base64") !== base64) {
    return { error: "The image upload data is invalid.", status: 400 };
  }
  const signatureError = getImageSignatureError(imageBuffer, imageType);
  if (signatureError) return { error: signatureError, status: 400 };
  return { imageBuffer };
}

export function checkUploadRateLimit(ip, now = Date.now()) {
  const key = String(ip || "unknown").slice(0, 128);
  const entry = requestsByIp.get(key);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS || now < entry.windowStart) {
    requestsByIp.set(key, { windowStart: now, count: 1 });
    if (requestsByIp.size > 5000) {
      for (const [storedIp, stored] of requestsByIp) {
        if (now - stored.windowStart >= RATE_LIMIT_WINDOW_MS || now < stored.windowStart) requestsByIp.delete(storedIp);
      }
    }
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count };
}

// Best-effort per-instance protection only. Pair with Vercel Firewall or a shared
// rate limiter for enforceable limits across serverless instances.

const SHARED_LIMIT_SCRIPT = `local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}`;

// Returns null when shared limiting is not configured. When configured, errors
// are surfaced so callers can fail closed rather than silently bypassing it.
export async function checkSharedUploadRateLimit(ip, options = {}) {
  const url = options.url ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = options.token ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url && !token) return null;
  if (!url || !token) throw new Error("Shared rate-limit configuration is incomplete.");

  const keyIp = String(ip || "unknown").slice(0, 128);
  const key = `mintsol:upload-rate:${Buffer.from(keyIp).toString("base64url")}`;
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url.replace(/\/$/, ""), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", SHARED_LIMIT_SCRIPT, "1", key, String(RATE_LIMIT_WINDOW_MS)])
  });
  if (!response.ok) throw new Error(`Shared rate-limit service returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload?.error || !Array.isArray(payload?.result) || payload.result.length < 2) {
    throw new Error("Shared rate-limit service returned an invalid response.");
  }
  const count = Number(payload.result[0]);
  const ttlMs = Number(payload.result[1]);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isFinite(ttlMs)) {
    throw new Error("Shared rate-limit service returned invalid counters.");
  }
  if (count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) };
  }
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - count };
}
