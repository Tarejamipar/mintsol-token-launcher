import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/upload.js";

const ORIGIN = "https://mintsol-token-launcher.vercel.app";
const PNG_BASE64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64");
let requestCounter = 0;

function makeResponse() {
  const headers = {};
  return {
    statusCode: 200,
    body: "",
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; },
    json() { return JSON.parse(this.body); },
    headers
  };
}

function makeRequest(overrides = {}) {
  requestCounter += 1;
  return {
    method: "POST",
    headers: {
      origin: ORIGIN,
      host: "mintsol-token-launcher.vercel.app",
      "x-real-ip": `upload-handler-test-${requestCounter}`
    },
    body: {
      name: "Test Token",
      symbol: "TST",
      image: { filename: "test.png", contentType: "image/png", base64: PNG_BASE64 }
    },
    ...overrides
  };
}

function withEnv(name, value, callback) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
}

test("upload endpoint rejects non-POST requests without contacting Pinata", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch should not be called"); };
  try {
    const res = makeResponse();
    await handler(makeRequest({ method: "GET" }), res);
    assert.equal(res.statusCode, 405);
    assert.match(res.json().error, /Method not allowed/);
    assert.equal(res.headers.allow, "POST");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("upload endpoint rejects untrusted origins", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch should not be called"); };
  try {
    await withEnv("PINATA_JWT", "test-jwt", async () => {
      const res = makeResponse();
      await handler(makeRequest({ headers: { origin: "https://attacker.example", host: "mintsol-token-launcher.vercel.app", "x-real-ip": `bad-origin-${++requestCounter}` } }), res);
      assert.equal(res.statusCode, 403);
      assert.match(res.json().error, /Origin not allowed/);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("upload endpoint returns a configuration error when PINATA_JWT is missing", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch should not be called"); };
  try {
    await withEnv("PINATA_JWT", undefined, async () => {
      const res = makeResponse();
      await handler(makeRequest(), res);
      assert.equal(res.statusCode, 503);
      assert.match(res.json().error, /PINATA_JWT/);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("upload endpoint validates token fields before uploading", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch should not be called"); };
  try {
    await withEnv("PINATA_JWT", "test-jwt", async () => {
      const res = makeResponse();
      await handler(makeRequest({ body: { name: "Test Token", symbol: "BAD-SYMBOL", image: { filename: "test.png", contentType: "image/png", base64: PNG_BASE64 } } }), res);
      assert.equal(res.statusCode, 400);
      assert.match(res.json().error, /Token symbol/);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("upload endpoint uploads the image and generated metadata, returning both public URIs", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.error;
  const calls = [];
  console.error = () => {};
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const cid = calls.length === 1 ? "bafy-image-test" : "bafy-metadata-test";
    return new Response(JSON.stringify({ data: { cid } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    await withEnv("PINATA_JWT", "test-jwt", async () => {
      const res = makeResponse();
      await handler(makeRequest(), res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json(), {
        imageUri: "https://gateway.pinata.cloud/ipfs/bafy-image-test",
        metadataUri: "https://gateway.pinata.cloud/ipfs/bafy-metadata-test"
      });
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, "https://uploads.pinata.cloud/v3/files");
      assert.equal(calls[0].options.headers.Authorization, "Bearer test-jwt");
      assert.equal(calls[1].options.headers.Authorization, "Bearer test-jwt");
      assert.equal(res.headers["cache-control"], "no-store");
    });
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousLog;
  }
});

test("upload endpoint maps Pinata authorization failures to a safe client error", async () => {
  const previousFetch = globalThis.fetch;
  const previousLog = console.error;
  console.error = () => {};
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "unauthorized secret detail" }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });

  try {
    await withEnv("PINATA_JWT", "test-jwt", async () => {
      const res = makeResponse();
      await handler(makeRequest(), res);
      assert.equal(res.statusCode, 502);
      assert.match(res.json().error, /HTTP 401/);
      assert.doesNotMatch(res.body, /unauthorized secret detail|test-jwt/);
    });
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousLog;
  }
});
