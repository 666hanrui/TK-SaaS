import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../protocol/builders.js";

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export class FileIdempotencyLedger {
  constructor({ directory }) {
    this.directory = path.resolve(directory);
  }

  fileForKey(key) {
    return path.join(this.directory, `${sha256(key)}.json`);
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async get(key) {
    await this.initialize();
    return readJson(this.fileForKey(key));
  }

  async claim({ key, runId, definitionId, entityId, at = new Date().toISOString() }) {
    await this.initialize();
    const file = this.fileForKey(key);
    let handle;

    try {
      handle = await open(file, "wx", 0o600);
      const record = {
        key,
        runId,
        definitionId,
        entityId,
        state: "claimed",
        claimedAt: at,
        updatedAt: at,
      };
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
      return { claimed: true, record };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return { claimed: false, record: await readJson(file) };
    } finally {
      await handle?.close();
    }
  }

  async update(key, patch) {
    await this.initialize();
    const file = this.fileForKey(key);
    const current = await readJson(file);
    if (!current) throw new Error(`Idempotency key is not claimed: ${key}`);

    const next = {
      ...current,
      ...patch,
      key,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };
    await writeJsonAtomic(file, next);
    return next;
  }

  async commit(key, receipt) {
    return this.update(key, {
      state: "committed",
      committedAt: new Date().toISOString(),
      receipt,
    });
  }

  async markAmbiguous(key, receipt, reason) {
    return this.update(key, {
      state: "ambiguous_reconcile",
      ambiguousAt: new Date().toISOString(),
      receipt,
      reason,
    });
  }

  async markFailed(key, reason) {
    return this.update(key, {
      state: "failed",
      failedAt: new Date().toISOString(),
      reason,
    });
  }
}
