import { ALLOWED_TYPES, checkSharedUploadRateLimit, checkUploadRateLimit, decodeImageBase64 } from "./upload-security.js";

const PRODUCTION_ORIGIN = "https://mintsol-token-launcher.vercel.app";
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

function send(res, status, body, headers = {}) {
  res.status(status);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(JSON.stringify(body));
}

function safeFilename(value, extension) {
  const base = String(value || "token-image").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48) || "token-image";
  return `${base}.${extension}`;
}

function extensionForType(type) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" })[type];
}

function clientIp(req) {
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) return realIp.trim();
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return "unknown";
}

function pinataFailureMessage(status, stage) {
  if (status === 401) return "Pinata rejected the server key (HTTP 401). Replace PINATA_JWT in Vercel with a valid Pinata JWT.";
  if (status === 403) return "Pinata denied this upload (HTTP 403). Check that the key has permission to upload public files.";
  if (status === 413) return "Pinata rejected the file as too large. Choose an image under 2 MB.";
  if (status === 429) return "Pinata rate limit reached. Wait a minute and retry.";
  if (status >= 500) return "Pinata is temporarily unavailable. Please retry in a moment.";
  return `Pinata rejected the ${stage} upload (HTTP ${status}). Check the Pinata key permissions and retry.`;
}

async function uploadPublicFile(jwt, file, filename, contentType) {
  const form = new FormData();
  form.append("network", "public");
  form.append("name", filename);
  form.append("file", new Blob([file], { type: contentType }), filename);

  const response = await fetch(PINATA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}` },
    body: form
  });
  const result = await response.json().catch(() => ({}));
  const cid = result?.data?.cid;
  if (!response.ok || typeof cid !== "string" || !cid) {
    const detail = result?.error || result?.message || result?.data?.message || "No CID returned";
    console.error("Pinata v3 upload failed:", { status: response.status, detail });
    const error = new Error(pinataFailureMessage(response.status, "file"));
    error.status = response.status;
    throw error;
  }
  return cid;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed." }, { Allow: "POST" });
  }

  const origin = req.headers.origin;
  const configuredOrigins = (process.env.APP_ORIGIN || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigins = new Set([
    PRODUCTION_ORIGIN,
    ...configuredOrigins,
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_BRANCH_URL ? [`https://${process.env.VERCEL_BRANCH_URL}`] : [])
  ]);
  let sameRequestHost = false;
  if (origin && req.headers.host) {
    try {
      const parsedOrigin = new URL(origin);
      sameRequestHost = ["https:", "http:"].includes(parsedOrigin.protocol)
        && parsedOrigin.host.toLowerCase() === String(req.headers.host).toLowerCase();
    } catch {
      sameRequestHost = false;
    }
  }
  if (!origin || (!allowedOrigins.has(origin) && !sameRequestHost)) {
    return send(res, 403, { error: "Origin not allowed." });
  }

  let limit;
  try {
    const sharedLimit = await checkSharedUploadRateLimit(clientIp(req));
    limit = sharedLimit ?? checkUploadRateLimit(clientIp(req));
  } catch (error) {
    console.error("Shared upload rate limiter unavailable:", error?.message || "Unknown error");
    return send(res, 503, { error: "Upload protection is temporarily unavailable. Please retry shortly." });
  }
  if (!limit.allowed) {
    return send(res, 429, { error: "Upload rate limit reached. Wait 15 minutes before trying again." }, {
      "Retry-After": String(limit.retryAfterSeconds),
      "X-RateLimit-Limit": "10",
      "X-RateLimit-Remaining": "0"
    });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return send(res, 503, { error: "Server upload is not configured. Set PINATA_JWT in Vercel Environment Variables." });

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const image = body.image && typeof body.image === "object" ? body.image : {};
    const imageType = typeof image.contentType === "string" ? image.contentType.toLowerCase() : "";
    const base64 = typeof image.base64 === "string" ? image.base64 : "";

    if (!name || new TextEncoder().encode(name).length > 32) {
      return send(res, 400, { error: "Token name is required and must be 32 UTF-8 bytes or fewer." });
    }
    if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) {
      return send(res, 400, { error: "Token symbol must contain 1–10 letters or numbers." });
    }
    if (!ALLOWED_TYPES.has(imageType)) {
      return send(res, 400, { error: "Choose a PNG, JPEG, WebP, or GIF image." });
    }

    // Reject oversized encoded payloads before allocating/decoding the image buffer.
    const decoded = decodeImageBase64(base64, imageType);
    if (decoded.error) return send(res, decoded.status, { error: decoded.error });
    const imageBuffer = decoded.imageBuffer;

    let imageCid;
    try {
      imageCid = await uploadPublicFile(jwt, imageBuffer, safeFilename(image.filename, extensionForType(imageType)), imageType);
    } catch (error) {
      return send(res, 502, { error: error?.message || "Pinata could not upload the image. Check the server-side key and permissions." });
    }

    const imageUri = `https://gateway.pinata.cloud/ipfs/${imageCid}`;
    const metadata = {
      name, symbol: symbol.toUpperCase(),
      description: `${name} token created with MintSol.`,
      image: imageUri, attributes: [],
      properties: { files: [{ uri: imageUri, type: imageType }], category: "image" }
    };

    let metadataCid;
    try {
      metadataCid = await uploadPublicFile(
        jwt, Buffer.from(JSON.stringify(metadata), "utf8"),
        safeFilename(`MintSol-${symbol}-metadata`, "json"), "application/json"
      );
    } catch (error) {
      console.error("Pinata metadata upload failed:", error?.message || "Unknown error");
      return send(res, 502, { error: error?.message || "The image uploaded, but Pinata could not upload public token metadata JSON. Retry." });
    }

    return send(res, 200, {
      imageUri,
      metadataUri: `https://gateway.pinata.cloud/ipfs/${metadataCid}`
    }, { "X-RateLimit-Limit": "10", "X-RateLimit-Remaining": String(limit.remaining) });
  } catch (error) {
    console.error("MintSol upload endpoint failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "The upload failed unexpectedly. Please try again." });
  }
}
