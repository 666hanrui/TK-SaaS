import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildTaskSpec } from "../src/protocol/builders.js";
import { FileJobStore } from "../src/queue/fileJobStore.js";

function task(runId) {
  return buildTaskSpec({
    definitionId: "tiktok.reviews.sync",
    sourceTaskId: "queue-test",
    entityId: "snapshot-1",
    runId,
    target: {
      url: "http://127.0.0.1:5173/",
      origin: "http://127.0.0.1:5173",
      accountId: "account-a",
      shopId: "shop-a",
      profileId: "shop-a",
    },
    input: { shopId: "shop-a", since: "2026-07-10", ratingFilter: "all", replyFilter: "all" },
    requestedAt: "2026-07-10T06:00:00.000Z",
  });
}

test("file job store queues, leases, expires, and completes jobs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tk-saas-jobs-"));
  const store = new FileJobStore({ directory });
  const firstTask = task("job-1");
  assert.equal((await store.enqueue(firstTask)).enqueued, true);
  assert.equal((await store.enqueue(firstTask)).enqueued, false);

  const now = new Date("2026-07-10T06:00:00.000Z");
  const claimed = await store.claimNext({ workerId: "worker-a", leaseMs: 1_000, now });
  assert.equal(claimed.task.runId, "job-1");
  assert.equal(claimed.queueStatus, "claimed");
  assert.equal(await store.claimNext({ workerId: "worker-b", now }), null);

  const reclaimed = await store.claimNext({ workerId: "worker-b", now: new Date("2026-07-10T06:00:02.000Z") });
  assert.equal(reclaimed.claimedBy, "worker-b");
  const completed = await store.complete("job-1", { status: "shadow_completed" }, "2026-07-10T06:00:03.000Z");
  assert.equal(completed.queueStatus, "completed");
  assert.equal(completed.result.status, "shadow_completed");
});
