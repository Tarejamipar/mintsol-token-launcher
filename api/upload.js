const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PRODUCTION_ORIGIN = "https://mintsol-token-launcher.vercel.app";
const PINATA_UPLOAD_URL = "https://uploads.pinata.cloud/v3/files";

function send(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function safeFilename(value, extension) {
  const base = String(value || "token-image").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 48) || "token-image";
  return `${base}.${extension}`;
}

function extensionForType(type) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" })[type];
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
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const origin = req.headers.origin;
  // Allow explicit exact origins, and the exact host serving this same-origin
  // API request (covers Vercel aliases/custom domains without wildcard CORS).
  const configuredOrigins = (process.env.APP_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigins = new Set([
    PRODUCTION_ORIGIN,
    ...configuredOrigins,
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_BRANCH_URL ? [`https://${process.env.VERCEL_BRANCH_URL}`] : [])
  ]);
  let sameRequestHost = false;
  if (origin && req.headers.host) {
    try {
      sameRequestHost = new URL(origin).host.toLowerCase() === String(req.headers.host).toLowerCase();
    } catch {
      sameRequestHost = false;
    }
  }
  if (!origin || (!allowedOrigins.has(origin) && !sameRequestHost)) {
    return send(res, 403, { error: "Origin not allowed." });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) return send(res, 500, { error: "Server upload is not configured. Set PINATA_JWT in Vercel Environment Variables." });

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
    const image = body.image && typeof body.image === "object" ? body.image : {};
    const imageType = typeof image.contentType === "string" ? image.contentType : "";
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
    if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      return send(res, 400, { error: "The image upload data is invalid." });
    }

    const imageBuffer = Buffer.from(base64, "base64");
    if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_BYTES) {
      return send(res, 413, { error: "Image must be larger than 0 bytes and no more than 2 MB." });
    }

    const extension = extensionForType(imageType);
    let imageCid;
    try {
      imageCid = await uploadPublicFile(jwt, imageBuffer, safeFilename(image.filename, extension), imageType);
    } catch (error) {
      return send(res, 502, { error: error?.message || "Pinata could not upload the image. Check the server-side key and permissions." });
    }

    const imageUri = `https://gateway.pinata.cloud/ipfs/${imageCid}`;
    const metadata = {
      name,
      symbol,
      description: `${name} token created with MintSol.`,
      image: imageUri,
      attributes: [],
      properties: {
        files: [{ uri: imageUri, type: imageType }],
        category: "image"
      }
    };

    let metadataCid;
    try {
      const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf8");
      metadataCid = await uploadPublicFile(
        jwt,
        metadataBytes,
        safeFilename(`MintSol-${symbol}-metadata`, "json"),
        "application/json"
      );
    } catch (error) {
      console.error("Pinata metadata upload failed:", error?.message || "Unknown error");
      return send(res, 502, { error: error?.message || "The image uploaded, but Pinata could not upload public token metadata JSON. Retry." });
    }

    const metadataUri = `https://gateway.pinata.cloud/ipfs/${metadataCid}`;
    return send(res, 200, { imageUri, metadataUri });
  } catch (error) {
    console.error("MintSol upload endpoint failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "The upload failed unexpectedly. Please try again." });
  }
}
