import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createImageIngressServer } from "../src/image-ingress/server.js";

async function start(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("private image ingress authenticates uploads, returns model-local URLs, and expires images", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tk-saas-image-ingress-"));
  let current = new Date("2026-07-10T06:00:00.000Z");
  const server = createImageIngressServer({
    config: {
      imageIngress: {
        host: "127.0.0.1",
        port: 8090,
        dataDirectory: directory,
        uploadToken: "a-test-token-that-is-long-enough",
        fieldName: "file",
        ttlMs: 30_000,
        maxBytes: 1_024,
        modelReadBaseUrl: "http://127.0.0.1:8090/v1/images",
      },
    },
    now: () => current,
  });
  try {
    const base = await start(server);
    const denied = await fetch(`${base}/v1/images`, { method: "POST" });
    assert.equal(denied.status, 401);

    const form = new FormData();
    const source = Buffer.from([137, 80, 78, 71]);
    form.set("file", new Blob([source], { type: "image/png" }), "safe-test.png");
    const upload = await fetch(`${base}/v1/images`, {
      method: "POST",
      headers: { Authorization: "Bearer a-test-token-that-is-long-enough" },
      body: form,
    });
    assert.equal(upload.status, 201);
    const payload = await upload.json();
    assert.match(payload.url, /^http:\/\/127\.0\.0\.1:8090\/v1\/images\//);

    const modelPath = new URL(payload.url).pathname;
    const read = await fetch(`${base}${modelPath}`);
    assert.equal(read.status, 200);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), source);

    current = new Date("2026-07-10T06:00:31.000Z");
    const expired = await fetch(`${base}${modelPath}`);
    assert.equal(expired.status, 410);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
