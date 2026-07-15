import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import Busboy from "busboy";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

function isLoopbackHost(host) {
  return ["127.0.0.1", "::1", "localhost"].includes(String(host).toLowerCase());
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function authenticated(request, token) {
  return request.headers.authorization === `Bearer ${token}`;
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

function normalizeBaseUrl(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("AUTOMATION_IMAGE_INGRESS_MODEL_READ_BASE_URL must use http or https.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function artifactPaths(directory, id, extension = "bin") {
  const root = path.resolve(directory);
  return {
    image: path.join(root, `${id}.${extension}`),
    metadata: path.join(root, `${id}.json`),
  };
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, file);
}

function parseMultipartImage(request, { fieldName, maxBytes }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let fileSeen = false;
    let mimeType;
    let chunks = [];
    let bytes = 0;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const fail = (error) => {
      chunks = [];
      finish(reject, error instanceof Error ? error : new Error(String(error)));
    };

    let busboy;
    try {
      busboy = Busboy({
        headers: request.headers,
        limits: { files: 1, fields: 4, fileSize: maxBytes },
      });
    } catch {
      fail(new Error("Expected a multipart/form-data image upload."));
      return;
    }

    busboy.on("file", (field, stream, info) => {
      if (fileSeen || field !== fieldName) {
        stream.resume();
        fail(`Expected exactly one image in multipart field ${fieldName}.`);
        return;
      }
      fileSeen = true;
      mimeType = String(info.mimeType || "").toLowerCase();
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        stream.resume();
        fail("Only image/jpeg, image/png, and image/webp uploads are accepted.");
        return;
      }
      stream.on("data", (chunk) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > maxBytes) {
          fail(`Image exceeds the ${maxBytes}-byte limit.`);
          return;
        }
        chunks.push(chunk);
      });
      stream.on("limit", () => fail(`Image exceeds the ${maxBytes}-byte limit.`));
      stream.on("error", fail);
    });
    busboy.on("filesLimit", () => fail("Only one image upload is accepted."));
    busboy.on("error", fail);
    busboy.on("finish", () => {
      if (settled) return;
      if (!fileSeen || bytes === 0) {
        fail("A non-empty image upload is required.");
        return;
      }
      finish(resolve, { mimeType, buffer: Buffer.concat(chunks) });
    });
    request.on("error", fail);
    request.pipe(busboy);
  });
}

async function removeImage(directory, metadata) {
  const paths = artifactPaths(directory, metadata.id, metadata.extension);
  await Promise.all([rm(paths.image, { force: true }), rm(paths.metadata, { force: true })]);
}

export async function purgeExpiredImages({ directory, now = new Date() }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadataFiles = (await readdir(directory)).filter((name) => name.endsWith(".json"));
  let removed = 0;
  for (const name of metadataFiles) {
    const metadata = await readJson(path.join(directory, name)).catch(() => null);
    if (!metadata?.id || !metadata?.expiresAt || new Date(metadata.expiresAt).getTime() > now.getTime()) continue;
    await removeImage(directory, metadata);
    removed += 1;
  }
  return removed;
}

export function createImageIngressServer({ config, now = () => new Date() }) {
  const ingress = config.imageIngress;
  if (!isLoopbackHost(ingress.host)) {
    throw new Error("Image ingress must bind to a loopback host; use an FRP STCP visitor for worker access.");
  }
  if (!ingress.uploadToken || ingress.uploadToken.length < 24) {
    throw new Error("AUTOMATION_IMAGE_INGRESS_UPLOAD_TOKEN must be a random token of at least 24 characters.");
  }
  if (!Number.isInteger(ingress.ttlMs) || ingress.ttlMs < 30_000) {
    throw new Error("AUTOMATION_IMAGE_INGRESS_TTL_SECONDS must be at least 30 seconds.");
  }
  if (!Number.isInteger(ingress.maxBytes) || ingress.maxBytes < 1 || ingress.maxBytes > 20 * 1024 * 1024) {
    throw new Error("AUTOMATION_IMAGE_INGRESS_MAX_BYTES must be between 1 and 20971520.");
  }
  const modelReadBaseUrl = normalizeBaseUrl(ingress.modelReadBaseUrl);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || ingress.host}`);
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, {
          ok: true,
          host: ingress.host,
          port: ingress.port,
          ttlMs: ingress.ttlMs,
          maxBytes: ingress.maxBytes,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/images") {
        if (!authenticated(request, ingress.uploadToken)) {
          sendJson(response, 401, { ok: false, message: "Unauthorized" });
          return;
        }
        await purgeExpiredImages({ directory: ingress.dataDirectory, now: now() });
        const declaredLength = Number(request.headers["content-length"] || 0);
        if (Number.isFinite(declaredLength) && declaredLength > ingress.maxBytes + 256 * 1024) {
          sendJson(response, 413, { ok: false, message: "Request exceeds the upload limit" });
          return;
        }
        const upload = await parseMultipartImage(request, {
          fieldName: ingress.fieldName,
          maxBytes: ingress.maxBytes,
        });
        const id = randomUUID();
        const extension = extensionForMimeType(upload.mimeType);
        const paths = artifactPaths(ingress.dataDirectory, id, extension);
        const expiresAt = new Date(now().getTime() + ingress.ttlMs).toISOString();
        await mkdir(ingress.dataDirectory, { recursive: true, mode: 0o700 });
        await writeAtomic(paths.image, upload.buffer);
        await writeAtomic(
          paths.metadata,
          `${JSON.stringify({ id, extension, mimeType: upload.mimeType, bytes: upload.buffer.length, expiresAt })}\n`,
        );
        sendJson(response, 201, { ok: true, url: `${modelReadBaseUrl}/${id}`, expiresAt });
        return;
      }

      const imageMatch = url.pathname.match(/^\/v1\/images\/([0-9a-f-]{36})$/i);
      if (request.method === "GET" && imageMatch) {
        const id = imageMatch[1];
        if (!ID_PATTERN.test(id)) {
          sendJson(response, 404, { ok: false, message: "Image not found" });
          return;
        }
        const metadata = await readJson(artifactPaths(ingress.dataDirectory, id).metadata);
        if (!metadata) {
          sendJson(response, 404, { ok: false, message: "Image not found" });
          return;
        }
        if (new Date(metadata.expiresAt).getTime() <= now().getTime()) {
          await removeImage(ingress.dataDirectory, metadata);
          sendJson(response, 410, { ok: false, message: "Image expired" });
          return;
        }
        const image = await readFile(artifactPaths(ingress.dataDirectory, id, metadata.extension).image).catch(() => null);
        if (!image) {
          sendJson(response, 404, { ok: false, message: "Image not found" });
          return;
        }
        response.writeHead(200, {
          "Content-Type": metadata.mimeType,
          "Content-Length": image.length,
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        });
        response.end(image);
        return;
      }

      sendJson(response, 404, { ok: false, message: "Not found" });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });

  return server;
}
