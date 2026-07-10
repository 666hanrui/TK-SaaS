import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  InlineDataImageResolver,
  StaticDirectoryImageResolver,
  createImageResolver,
} from "../src/adapters/stagehand/imageResolver.js";

test("inline image resolver returns a model-compatible data URL", async () => {
  const resolver = new InlineDataImageResolver();
  const url = await resolver.publish({ buffer: Buffer.from("image"), mimeType: "image/png" });
  assert.equal(url, "data:image/png;base64,aW1hZ2U=");
});

test("static image resolver publishes a deterministic file name and public URL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tk-saas-images-"));
  const resolver = new StaticDirectoryImageResolver({
    directory,
    publicBaseUrl: "http://images.example.test/automation",
  });
  const url = await resolver.publish({ buffer: Buffer.from("image"), mimeType: "image/png", filenameHint: "order 1" });
  assert.match(url, /^http:\/\/images\.example\.test\/automation\/order-1-[a-f0-9]{16}\.png$/);
  const filename = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
  assert.equal((await readFile(path.join(directory, filename), "utf8")), "image");
});

test("remote image transport blocks vision only when no mapped publish directory is configured", async () => {
  const resolver = createImageResolver({
    imageTransport: "remote_url",
    imagePublishDirectory: "",
    imagePublicBaseUrl: "http://images.test",
  });
  await assert.rejects(() => resolver.publish({ buffer: Buffer.from("image") }), /AUTOMATION_IMAGE_PUBLISH_DIR/);
});
