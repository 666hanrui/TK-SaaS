import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { JobRecordSchema, SchemaVersion } from "../protocol/schemas.js";

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

export class FileJobStore {
  constructor({ directory }) {
    this.directory = path.resolve(directory);
  }

  file(runId) {
    return path.join(this.directory, `${runId}.json`);
  }

  lock(runId) {
    return path.join(this.directory, `${runId}.lock`);
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async enqueue(task, at = new Date().toISOString()) {
    await this.initialize();
    const record = JobRecordSchema.parse({
      schemaVersion: SchemaVersion,
      task,
      queueStatus: "queued",
      createdAt: at,
      updatedAt: at,
    });
    const file = this.file(task.runId);
    let handle;
    try {
      handle = await open(file, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
      return { enqueued: true, record };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      return { enqueued: false, record: await this.get(task.runId) };
    } finally {
      await handle?.close();
    }
  }

  async get(runId) {
    await this.initialize();
    const record = await readJson(this.file(runId));
    return record ? JobRecordSchema.parse(record) : null;
  }

  async list({ limit = 100 } = {}) {
    await this.initialize();
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).sort();
    const records = [];
    for (const name of names.slice(-limit)) {
      const record = await readJson(path.join(this.directory, name));
      if (record) records.push(JobRecordSchema.parse(record));
    }
    return records;
  }

  async acquireFileLock(runId) {
    const lock = this.lock(runId);
    let handle;
    try {
      handle = await open(lock, "wx", 0o600);
      return async () => {
        await handle.close().catch(() => {});
        await rm(lock, { force: true });
      };
    } catch (error) {
      if (error.code === "EEXIST") return null;
      throw error;
    }
  }

  async claimNext({ workerId, leaseMs = 5 * 60_000, now = new Date() }) {
    const candidates = await this.list({ limit: 1_000 });
    for (const candidate of candidates) {
      const expired =
        candidate.queueStatus === "claimed" &&
        candidate.leaseExpiresAt &&
        new Date(candidate.leaseExpiresAt).getTime() <= now.getTime();
      if (candidate.queueStatus !== "queued" && !expired) continue;

      const release = await this.acquireFileLock(candidate.task.runId);
      if (!release) continue;
      try {
        const current = await this.get(candidate.task.runId);
        if (!current) continue;
        const currentExpired =
          current.queueStatus === "claimed" &&
          current.leaseExpiresAt &&
          new Date(current.leaseExpiresAt).getTime() <= now.getTime();
        if (current.queueStatus !== "queued" && !currentExpired) continue;

        const next = JobRecordSchema.parse({
          ...current,
          queueStatus: "claimed",
          claimedBy: workerId,
          leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
          updatedAt: now.toISOString(),
        });
        await writeJsonAtomic(this.file(current.task.runId), next);
        return next;
      } finally {
        await release();
      }
    }
    return null;
  }

  async complete(runId, result, at = new Date().toISOString()) {
    const release = await this.acquireFileLock(runId);
    if (!release) throw new Error(`Cannot complete job ${runId}; it is locked by another worker.`);
    try {
      const current = await this.get(runId);
      if (!current) throw new Error(`Job ${runId} was not found.`);
      const next = JobRecordSchema.parse({
        ...current,
        queueStatus: "completed",
        leaseExpiresAt: undefined,
        updatedAt: at,
        result,
      });
      await writeJsonAtomic(this.file(runId), next);
      return next;
    } finally {
      await release();
    }
  }
}
