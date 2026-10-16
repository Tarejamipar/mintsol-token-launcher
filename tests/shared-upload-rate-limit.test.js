import test from "node:test";
import assert from "node:assert/strict";
import { checkSharedUploadRateLimit } from "../api/upload-security.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

test("shared limiter allows requests under the limit and reports remaining quota", async () => {
  let request;
  const result = await checkSharedUploadRateLimit("192.0.2.1", {
    url: "https://redis.example/",
    token: "test-token",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ result: [3, 60000] });
    }
  });
  assert.deepEqual(result, { allowed: true, remaining: 7 });
  assert.equal(request.url, "https://redis.example");
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  const command = JSON.parse(request.options.body);
  assert.equal(command[0], "EVAL");
  assert.equal(command[2], "1");
  assert.match(command[3], /^mintsol:upload-rate:/);
});

test("shared limiter blocks requests above ten and provides a retry delay", async () => {
  const result = await checkSharedUploadRateLimit("192.0.2.2", {
    url: "https://redis.example",
    token: "test-token",
    fetchImpl: async () => response({ result: [11, 30000] })
  });
  assert.deepEqual(result, { allowed: false, remaining: 0, retryAfterSeconds: 30 });
});

test("shared limiter is disabled when neither credential is configured", async () => {
  const result = await checkSharedUploadRateLimit("192.0.2.3", {
    url: "",
    token: "",
    fetchImpl: async () => { throw new Error("must not call fetch"); }
  });
  assert.equal(result, null);
});

test("shared limiter rejects incomplete configuration", async () => {
  await assert.rejects(
    checkSharedUploadRateLimit("192.0.2.4", {
      url: "https://redis.example",
      token: "",
      fetchImpl: async () => { throw new Error("must not call fetch"); }
    }),
    /configuration is incomplete/
  );
});

test("shared limiter fails closed on provider errors or malformed responses", async () => {
  await assert.rejects(
    checkSharedUploadRateLimit("192.0.2.5", {
      url: "https://redis.example",
      token: "test-token",
      fetchImpl: async () => response({}, 503)
    }),
    /HTTP 503/
  );
  await assert.rejects(
    checkSharedUploadRateLimit("192.0.2.6", {
      url: "https://redis.example",
      token: "test-token",
      fetchImpl: async () => response({ result: "unexpected" })
    }),
    /invalid response/
  );
});
