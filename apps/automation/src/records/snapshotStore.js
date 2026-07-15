import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../artifacts/artifactStore.js";
import { SchemaVersion } from "../protocol/schemas.js";

function validSegment(value, label) {
  if (!/^[a-zA-Z0-9._-]+$/.test(String(value))) throw new Error(`Invalid ${label}.`);
  return String(value);
}

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
  await open(temporary, "wx", 0o600).then(async (handle) => {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    } finally {
      await handle.close();
    }
  });
  await rename(temporary, file);
}

export class RecordSnapshotStore {
  constructor({ directory }) {
    this.directory = path.resolve(directory);
  }

  file(definitionId, runId) {
    return path.join(this.directory, validSegment(definitionId, "definition id"), `${validSegment(runId, "run id")}.json`);
  }

  async store(runSummary, capturedAt = new Date().toISOString()) {
    const task = runSummary?.task;
    if (task?.riskLevel !== "R1_READ" || task.status !== "succeeded") {
      return { stored: false, reason: "Only verified R1 read results are recorded." };
    }
    const file = this.file(task.definitionId, task.runId);
    const existing = await readJson(file);
    if (existing) return { stored: false, duplicate: true, snapshot: existing };

    const snapshot = redactSecrets({
      schemaVersion: SchemaVersion,
      kind: "verified_source_snapshot",
      runId: task.runId,
      definitionId: task.definitionId,
      module: task.definitionId.split(".")[1] || "unknown",
      entityId: task.entityId,
      capturedAt,
      source: {
        target: task.target,
        input: task.input,
        requestedAt: task.requestedAt,
      },
      extraction: runSummary.result ?? null,
      verification: runSummary.verification ?? null,
      artifactRunId: task.runId,
    });
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeJsonAtomic(file, snapshot);
    return { stored: true, snapshot };
  }

  async storeInternal({ definitionId, runId, entityId, source = {}, input = {}, result, verification }, capturedAt = new Date().toISOString()) {
    const file = this.file(definitionId, runId);
    const existing = await readJson(file);
    if (existing) return { stored: false, duplicate: true, snapshot: existing };
    const snapshot = redactSecrets({
      schemaVersion: SchemaVersion,
      kind: "verified_internal_snapshot",
      runId,
      definitionId,
      module: definitionId.split(".")[1] || "internal",
      entityId,
      capturedAt,
      source,
      input,
      extraction: result ?? null,
      verification: verification ?? null,
      artifactRunId: null,
    });
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeJsonAtomic(file, snapshot);
    return { stored: true, snapshot };
  }

  async list({ definitionId, limit = 100 } = {}) {
    const directories = definitionId
      ? [validSegment(definitionId, "definition id")]
      : await readdir(this.directory).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
    const snapshots = [];
    for (const name of directories) {
      const directory = path.join(this.directory, name);
      const names = await readdir(directory).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
      for (const fileName of names.filter((item) => item.endsWith(".json"))) {
        const snapshot = await readJson(path.join(directory, fileName));
        if (snapshot) snapshots.push(snapshot);
      }
    }
    return snapshots
      .sort((left, right) => String(right.capturedAt).localeCompare(String(left.capturedAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
  }

  async get(runId) {
    const safeRunId = validSegment(runId, "run id");
    const definitions = await readdir(this.directory).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));
    for (const definitionId of definitions) {
      const snapshot = await readJson(path.join(this.directory, definitionId, `${safeRunId}.json`));
      if (snapshot) return snapshot;
    }
    return null;
  }
}
