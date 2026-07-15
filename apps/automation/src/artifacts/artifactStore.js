import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { RunEventSchema, SchemaVersion } from "../protocol/schemas.js";

const SECRET_KEY = /(password|secret|token|cookie|authorization|api[_-]?key|connecturl|storageState)/i;

export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SECRET_KEY.test(key) ? "[REDACTED]" : redactSecrets(child),
    ]),
  );
}

async function writeAtomic(file, value, options = {}) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value, options);
  await rename(temporary, file);
}

async function listFiles(directory, prefix = "") {
  const names = await readdir(directory);
  const files = [];
  for (const name of names) {
    const relative = path.join(prefix, name);
    const absolute = path.join(directory, name);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      files.push(...(await listFiles(absolute, relative)));
    } else {
      files.push(relative);
    }
  }
  return files;
}

async function checksum(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export class ArtifactStore {
  constructor({ rootDirectory, runId }) {
    this.rootDirectory = path.resolve(rootDirectory);
    this.runId = runId;
    this.runDirectory = path.join(this.rootDirectory, runId);
    this.eventsFile = path.join(this.runDirectory, "events.jsonl");
    this.sequence = 0;
  }

  async initialize() {
    await mkdir(this.runDirectory, { recursive: true, mode: 0o700 });
  }

  resolve(relativePath) {
    const absolute = path.resolve(this.runDirectory, relativePath);
    if (!absolute.startsWith(`${this.runDirectory}${path.sep}`)) {
      throw new Error(`Artifact path escapes the run directory: ${relativePath}`);
    }
    return absolute;
  }

  async appendEvent({ type, status, payload = {}, at = new Date().toISOString() }) {
    await this.initialize();
    const event = RunEventSchema.parse({
      schemaVersion: SchemaVersion,
      runId: this.runId,
      sequence: this.sequence,
      type,
      status,
      at,
      payload: redactSecrets(payload),
    });
    this.sequence += 1;
    await appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    return event;
  }

  async writeJson(relativePath, value) {
    await this.initialize();
    const file = this.resolve(relativePath);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeAtomic(file, `${JSON.stringify(redactSecrets(value), null, 2)}\n`, { mode: 0o600 });
    return file;
  }

  async prepareFile(relativePath) {
    await this.initialize();
    const file = this.resolve(relativePath);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    return file;
  }

  async finalize(summary) {
    await this.initialize();
    await this.writeJson("summary.json", summary);
    const artifactFiles = (await listFiles(this.runDirectory)).filter(
      (relative) => relative !== "manifest.json",
    );
    const files = [];
    for (const relative of artifactFiles.sort()) {
      const absolute = path.join(this.runDirectory, relative);
      const info = await stat(absolute);
      files.push({ path: relative, bytes: info.size, sha256: await checksum(absolute) });
    }

    const manifest = {
      schemaVersion: SchemaVersion,
      runId: this.runId,
      finalizedAt: new Date().toISOString(),
      files,
    };
    await this.writeJson("manifest.json", manifest);
    return manifest;
  }
}
