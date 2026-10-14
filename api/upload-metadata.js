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
    const requestUrl = new URL(req.url || "/api/upload-metadata", "https://" + (req.headers.host || "localhost"));
    const name = requestUrl.searchParams.get("name") || "";
    const symbol = requestUrl.searchParams.get("symbol") || "";
    const imageType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();

    if (!name.trim() || name.trim().length > 32) {
      return send(res, 400, { error: "Enter a token name of 1–32 characters." });
    }
    if (!/^[A-Za-z0-9]{1,10}$/.test(symbol.trim())) {
      return send(res, 400, { error: "Enter a symbol containing 1–10 letters or numbers." });
    }
    if (!ALLOWED_TYPES.has(imageType)) {
      return send(res, 400, { error: "Choose a PNG, JPEG, WebP, or GIF image." });
    }

    let image;
    if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
      image = Buffer.from(req.body);
    } else {
      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of req) {
        const part = Buffer.from(chunk);
        totalBytes += part.length;
        if (totalBytes > MAX_IMAGE_BYTES) {
          return send(res, 413, { error: "Image must be 2 MB or smaller." });
        }
        chunks.push(part);
      }
      image = Buffer.concat(chunks);
    }
    if (!image.length || image.length > MAX_IMAGE_BYTES) {
      return send(res, 413, { error: "Image must be 2 MB or smaller." });
    }

    // Check the file signature as well as the supplied MIME type.
    const isPng = image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
    const isWebp = image.length >= 12 && image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
    const isGif = image.length >= 6 && ["GIF87a", "GIF89a"].includes(image.toString("ascii", 0, 6));
    const signatureMatches = (imageType === "image/png" && isPng)
      || (imageType === "image/jpeg" && isJpeg)
      || (imageType === "image/webp" && isWebp)
      || (imageType === "image/gif" && isGif);
    if (!signatureMatches) {
      return send(res, 400, { error: "The file contents do not match the selected image type." });
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
      description: name.trim() + " token created with MintSol.",
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
