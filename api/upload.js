const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const PRODUCTION_ORIGIN = "https://mintsol-token-launcher.vercel.app";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Method not allowed." });
  }

  const origin = req.headers.origin;
  const allowedOrigin = process.env.APP_ORIGIN || PRODUCTION_ORIGIN;
  if (origin && origin !== allowedOrigin) {
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
    const file = new Blob([imageBuffer], { type: imageType });
    const form = new FormData();
    form.append("file", file, safeFilename(image.filename, extension));
    form.append("pinataMetadata", JSON.stringify({ name: `MintSol-${symbol}-image` }));
    form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    const imageResponse = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}` },
      body: form
    });
    const imageResult = await imageResponse.json().catch(() => ({}));
    if (!imageResponse.ok || !imageResult.IpfsHash) {
      console.error("Pinata image upload failed:", imageResponse.status, imageResult.error || imageResult.message || "Unknown error");
      return send(res, 502, { error: "Pinata could not upload the image. Check the server-side Pinata key and permissions." });
    }

    const imageUri = `https://gateway.pinata.cloud/ipfs/${imageResult.IpfsHash}`;
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

    const metadataResponse = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        pinataMetadata: { name: `MintSol-${symbol}-metadata` },
        pinataOptions: { cidVersion: 1 },
        pinataContent: metadata
      })
    });
    const metadataResult = await metadataResponse.json().catch(() => ({}));
    if (!metadataResponse.ok || !metadataResult.IpfsHash) {
      console.error("Pinata metadata upload failed:", metadataResponse.status, metadataResult.error || metadataResult.message || "Unknown error");
      return send(res, 502, { error: "The image was uploaded, but Pinata could not publish token metadata JSON. Retry the upload." });
    }

    const metadataUri = `https://gateway.pinata.cloud/ipfs/${metadataResult.IpfsHash}`;
    return send(res, 200, { imageUri, metadataUri });
  } catch (error) {
    console.error("MintSol upload endpoint failed:", error?.message || "Unknown error");
    return send(res, 500, { error: "The upload failed unexpectedly. Please try again." });
  }
}
