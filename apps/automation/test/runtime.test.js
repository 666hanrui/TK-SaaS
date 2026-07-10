import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ArtifactStore } from "../src/artifacts/artifactStore.js";
import { buildTaskSpec } from "../src/protocol/builders.js";
import { FileIdempotencyLedger } from "../src/runtime/idempotencyLedger.js";
import { runAutomationTask } from "../src/runtime/runner.js";
import { ProfileLeaseManager } from "../src/session/profileManager.js";

const fixedNow = () => new Date("2026-07-10T06:00:00.000Z");

function createReadDriver() {
  return {
    async acquireSession() {},
    async navigate() {},
    async observe() {
      return { authenticated: true, challengeDetected: false, pageFingerprint: "page-a" };
    },
    async runRead() {
      return { records: [{ id: "review-1", evidence: [{ sourceText: "1 star" }] }], summary: { recordsValid: true, capturedCount: 1, warnings: [] } };
    },
    async verify() {
      return { ok: true, checks: [{ id: "records", ok: true, message: "ok" }] };
    },
    async close() {},
  };
}

function createWriteDriver({ verificationOk = true } = {}) {
  let executed = 0;
  return {
    get executed() {
      return executed;
    },
    async acquireSession() {},
    async navigate() {},
    async observe() {
      return {
        authenticated: true,
        challengeDetected: false,
        pageFingerprint: "page-a",
        candidates: [
          { description: "Send reply", method: "click", selector: "button.send", arguments: [], pageFingerprint: "page-a" },
        ],
      };
    },
    async proposeWrite({ observation }) {
      return { candidate: observation.candidates[0], payload: { approvedReply: "We can help." } };
    },
    async execute({ task }) {
      executed += 1;
      return {
        schemaVersion: "1.0",
        runId: task.runId,
        definitionId: task.definitionId,
        idempotencyKey: task.idempotencyKey,
        attempted: true,
        success: true,
        ambiguous: false,
        message: "sent",
        executedAt: fixedNow().toISOString(),
      };
    },
    async verify() {
      return { ok: verificationOk, checks: [{ id: "postcondition", ok: verificationOk, message: "checked" }] };
    },
    async close() {},
  };
}

async function runtimeDependencies() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-saas-automation-"));
  return {
    root,
    ledger: new FileIdempotencyLedger({ directory: path.join(root, "ledger") }),
    profileManager: new ProfileLeaseManager({ rootDirectory: path.join(root, "profiles") }),
    artifactStore: (runId) => new ArtifactStore({ rootDirectory: path.join(root, "artifacts"), runId }),
  };
}

function localTarget() {
  return {
    url: "http://127.0.0.1:5173/",
    origin: "http://127.0.0.1:5173",
    accountId: "account-a",
    shopId: "shop-a",
    profileId: "shop-a",
  };
}

test("read task is idempotent and commits only after verification", async () => {
  const dependencies = await runtimeDependencies();
  const task = buildTaskSpec({
    definitionId: "tiktok.reviews.sync",
    sourceTaskId: "task-review-sync",
    entityId: "snapshot-1",
    target: localTarget(),
    input: { shopId: "shop-a", since: "2026-07-10", ratingFilter: "all", replyFilter: "all" },
    requestedAt: fixedNow().toISOString(),
  });
  const first = await runAutomationTask({
    task,
    driver: createReadDriver(),
    policyContext: {},
    ledger: dependencies.ledger,
    profileManager: dependencies.profileManager,
    artifactStore: dependencies.artifactStore(task.runId),
    now: fixedNow,
  });
  assert.equal(first.task.status, "succeeded");

  const secondTask = { ...task, runId: "second-run" };
  const second = await runAutomationTask({
    task: secondTask,
    driver: createReadDriver(),
    policyContext: {},
    ledger: dependencies.ledger,
    profileManager: dependencies.profileManager,
    artifactStore: dependencies.artifactStore(secondTask.runId),
    now: fixedNow,
  });
  assert.equal(second.task.status, "blocked");
  assert.equal(second.duplicate.state, "committed");
});

test("rehearsal proposes a write but never executes it", async () => {
  const dependencies = await runtimeDependencies();
  const task = buildTaskSpec({
    definitionId: "tiktok.reviews.send_reply",
    sourceTaskId: "task-review-send",
    entityId: "review-1",
    target: localTarget(),
    input: { shopId: "shop-a", reviewId: "review-1", approvedReply: "We can help.", replyHash: "hash" },
    requestedAt: fixedNow().toISOString(),
  });
  const driver = createWriteDriver();
  const result = await runAutomationTask({
    task,
    driver,
    policyContext: {},
    ledger: dependencies.ledger,
    profileManager: dependencies.profileManager,
    artifactStore: dependencies.artifactStore(task.runId),
    now: fixedNow,
  });
  assert.equal(result.task.status, "shadow_completed");
  assert.equal(driver.executed, 0);
});

test("a postcondition failure after a real write becomes ambiguous reconciliation", async () => {
  const dependencies = await runtimeDependencies();
  const target = {
    ...localTarget(),
    url: "https://seller.example.test/reviews",
    origin: "https://seller.example.test",
  };
  const task = buildTaskSpec({
    definitionId: "tiktok.reviews.send_reply",
    sourceTaskId: "task-review-send-live",
    entityId: "review-1",
    target,
    mode: "live",
    input: { shopId: "shop-a", reviewId: "review-1", approvedReply: "We can help.", replyHash: "hash" },
    approvalGrant: {
      grantId: "grant-1",
      definitionId: "tiktok.reviews.send_reply",
      entityId: "review-1",
      expiresAt: "2026-07-10T07:00:00.000Z",
    },
    requestedAt: fixedNow().toISOString(),
  });
  const driver = createWriteDriver({ verificationOk: false });
  const result = await runAutomationTask({
    task,
    driver,
    policyContext: {
      allowedOrigins: [target.origin],
      externalReadEnabled: true,
      externalWriteEnabled: true,
    },
    ledger: dependencies.ledger,
    profileManager: dependencies.profileManager,
    artifactStore: dependencies.artifactStore(task.runId),
    now: fixedNow,
  });
  assert.equal(driver.executed, 1);
  assert.equal(result.task.status, "ambiguous_reconcile");
  assert.equal((await dependencies.ledger.get(task.idempotencyKey)).state, "ambiguous_reconcile");
});
