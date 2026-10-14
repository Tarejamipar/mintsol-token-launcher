const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use POST to upload token artwork." });
  }

  const jwt = process.env.PINATA_JWT;
  if (!jwt) {
    return send(res, 503, {
      error: "Image hosting is not configured yet. The site administrator must add PINATA_JWT in Vercel project environment variables."
    });
  }

  try {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_IMAGE_BYTES * 1.5) {
        return send(res, 413, { error: "Image is too large. Choose an image under 2 MB." });
      }
    }

    const body = JSON.parse(raw || "{}");
    const { name, symbol, description = "", imageBase64, imageType } = body;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 32) {
      return send(res, 400, { error: "Enter a token name of 1–32 characters." });
    }
    if (typeof symbol !== "string" || !/^[A-Za-z0-9]{1,10}$/.test(symbol.trim())) {
      return send(res, 400, { error: "Enter a symbol containing 1–10 letters or numbers." });
    }
    if (typeof description !== "string" || description.length > 500) {
      return send(res, 400, { error: "Description must be 500 characters or fewer." });
    }
    if (!ALLOWED_TYPES.has(imageType) || typeof imageBase64 !== "string") {
      return send(res, 400, { error: "Choose a PNG, JPEG, WebP, or GIF image." });
    }

    const encoded = imageBase64.replace(/^data:[^,]+,/, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      return send(res, 400, { error: "The image data is invalid. Please select the image again." });
    }
    const image = Buffer.from(encoded, "base64");
    if (!image.length || image.length > MAX_IMAGE_BYTES) {
      return send(res, 413, { error: "Image must be smaller than 2 MB." });
    }

    const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" })[imageType];
    const file = new Blob([image], { type: imageType });
    const upload = new FormData();
    upload.append("file", file, "token-image." + extension);
    upload.append("pinataMetadata", JSON.stringify({ name: name.trim() + " token image" }));
    const imageResponse = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: "Bearer " + jwt },
      body: upload
    });
    const imageResult = await imageResponse.json().catch(() => ({}));
    if (!imageResponse.ok || !imageResult.IpfsHash) {
      console.error("Pinata image upload failed:", imageResponse.status);
      return send(res, 502, { error: "Image hosting failed. Check the Pinata configuration and try again." });
    }

    const imageUri = "https://gateway.pinata.cloud/ipfs/" + imageResult.IpfsHash;
    const metadata = {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      description: description.trim() || (name.trim() + " token created with MintSol."),
      image: imageUri,
      properties: { files: [{ uri: imageUri, type: imageType }], category: "image" }
    };
    const metadataResponse = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
      method: "POST",
      headers: { Authorization: "Bearer " + jwt, "Content-Type": "application/json" },
      body: JSON.stringify({
        pinataMetadata: { name: name.trim() + " token metadata" },
        pinataContent: metadata
      })
    });
    const metadataResult = await metadataResponse.json().catch(() => ({}));
    if (!metadataResponse.ok || !metadataResult.IpfsHash) {
      console.error("Pinata metadata upload failed:", metadataResponse.status);
      return send(res, 502, { error: "The image was uploaded, but metadata hosting failed. Try uploading again." });
    }

    return send(res, 200, {
      imageUri,
      metadataUri: "https://gateway.pinata.cloud/ipfs/" + metadataResult.IpfsHash
    });
  } catch (error) {
    console.error("Metadata upload request failed:", error?.message || "unknown error");
    return send(res, 400, { error: "Could not process this image. Please select a valid image and try again." });
  }
}
