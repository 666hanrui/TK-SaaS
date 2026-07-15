import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskSpec } from "../src/protocol/builders.js";
import { RecordSnapshotStore } from "../src/records/snapshotStore.js";

function verifiedReadSummary() {
  const task = buildTaskSpec({
    definitionId: "hcrd.inventory.sync",
    sourceTaskId: "record-store-test",
    entityId: "hcrd-snapshot-1",
    runId: "record-store-run-1",
    mode: "shadow",
    target: {
      url: "https://hcrd.example.test/inventory",
      origin: "https://hcrd.example.test",
      accountId: "hcrd-account",
      profileId: "hcrd-account",
    },
    input: { accountId: "hcrd-account", warehouse: "WH-A", owner: "store", snapshotWindow: "first-page" },
  });
  return {
    task: { ...task, status: "succeeded" },
    result: {
      records: [{ id: "SKU-1", availableStock: 12, evidence: [{ sourceText: "SKU-1: 12" }] }],
      summary: { recordsValid: true, capturedCount: 1 },
    },
    verification: { ok: true, checks: [{ id: "records_valid", ok: true }] },
  };
}

test("verified R1 source snapshots are immutable, local, and retrievable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tk-saas-records-"));
  try {
    const snapshots = new RecordSnapshotStore({ directory });
    const summary = verifiedReadSummary();
    const first = await snapshots.store(summary, "2026-07-10T06:00:00.000Z");
    assert.equal(first.stored, true);
    assert.equal(first.snapshot.definitionId, "hcrd.inventory.sync");
    assert.equal(first.snapshot.extraction.records[0].id, "SKU-1");

    const duplicate = await snapshots.store(summary, "2026-07-10T07:00:00.000Z");
    assert.equal(duplicate.duplicate, true);
    assert.equal((await snapshots.list()).length, 1);
    assert.equal((await snapshots.get("record-store-run-1")).entityId, "hcrd-snapshot-1");

    const skipped = await snapshots.store({ task: { ...summary.task, riskLevel: "R3_SENSITIVE_WRITE" } });
    assert.equal(skipped.stored, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
