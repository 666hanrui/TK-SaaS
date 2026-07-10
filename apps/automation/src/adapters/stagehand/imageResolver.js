import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function ensurePublicUrl(baseUrl, filename) {
  const base = String(baseUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("A public image base URL is required for remote_url image transport.");
  return `${base}/${encodeURIComponent(filename)}`;
}

function getNestedValue(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), object);
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export class InlineDataImageResolver {
  async publish({ buffer, mimeType = "image/jpeg" }) {
    return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
  }
}

export class UnavailableImageResolver {
  constructor(message) {
    this.message = message;
  }

  async publish() {
    throw new Error(this.message);
  }
}

export class StaticDirectoryImageResolver {
  constructor({ directory, publicBaseUrl }) {
    this.directory = path.resolve(directory);
    this.publicBaseUrl = publicBaseUrl;
  }

  async publish({ buffer, mimeType = "image/jpeg", filenameHint = "screenshot" }) {
    const content = Buffer.from(buffer);
    const extension = extensionForMimeType(mimeType);
    const digest = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const safeHint = String(filenameHint).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48);
    const filename = `${safeHint || "screenshot"}-${digest}.${extension}`;
    const target = path.join(this.directory, filename);
    const temporary = `${target}.${process.pid}.tmp`;

    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, target);
    return ensurePublicUrl(this.publicBaseUrl, filename);
  }
}

export class HttpUploadImageResolver {
  constructor({ uploadUrl, fieldName = "file", responsePath = "url", bearerToken = "" }) {
    this.uploadUrl = uploadUrl;
    this.fieldName = fieldName;
    this.responsePath = responsePath;
    this.bearerToken = bearerToken;
  }

  async publish({ buffer, mimeType = "image/jpeg", filenameHint = "screenshot" }) {
    if (!this.uploadUrl) throw new Error("Image upload URL is required for http_upload image transport.");
    const form = new FormData();
    form.set(
      this.fieldName,
      new Blob([Buffer.from(buffer)], { type: mimeType }),
      `${String(filenameHint).replace(/[^a-zA-Z0-9._-]+/g, "-") || "screenshot"}.${extensionForMimeType(mimeType)}`,
    );
    const response = await fetch(this.uploadUrl, {
      method: "POST",
      headers: this.bearerToken ? { Authorization: `Bearer ${this.bearerToken}` } : undefined,
      body: form,
    });
    if (!response.ok) throw new Error(`Image upload failed with HTTP ${response.status}`);
    const payload = await response.json();
    const imageUrl = getNestedValue(payload, this.responsePath);
    if (typeof imageUrl !== "string" || !/^https?:\/\//.test(imageUrl)) {
      throw new Error(`Image upload response did not contain a public URL at ${this.responsePath}`);
    }
    return imageUrl;
  }
}

export function createImageResolver(config) {
  if (config.imageTransport === "inline_data_url") return new InlineDataImageResolver();
  if (config.imageTransport === "remote_url") {
    if (!config.imagePublishDirectory) {
      return new UnavailableImageResolver(
        "Visual model calls require AUTOMATION_IMAGE_PUBLISH_DIR mapped to the configured public image host.",
      );
    }
    return new StaticDirectoryImageResolver({
      directory: config.imagePublishDirectory,
      publicBaseUrl: config.imagePublicBaseUrl,
    });
  }
  if (config.imageTransport === "http_upload") {
    return new HttpUploadImageResolver({
      uploadUrl: config.imageUploadUrl,
      fieldName: config.imageUploadField,
      responsePath: config.imageUploadResponsePath,
      bearerToken: config.imageUploadBearerToken,
    });
  }
  throw new Error(`Unsupported LOCAL_LLM_IMAGE_TRANSPORT: ${config.imageTransport}`);
}
