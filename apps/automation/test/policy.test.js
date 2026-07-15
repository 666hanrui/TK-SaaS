import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskSpec } from "../src/protocol/builders.js";
import { evaluatePolicy } from "../src/policy/engine.js";

const timestamp = "2026-07-10T06:00:00.000Z";

function browserTarget(url = "http://127.0.0.1:5173/") {
  return {
    url,
    origin: new URL(url).origin,
    accountId: "account-a",
    shopId: "shop-a",
    profileId: "tiktok-shop-a",
  };
}

test("rehearsal allows local read but only observes local writes", () => {
  const readTask = buildTaskSpec({
    definitionId: "tiktok.reviews.sync",
    sourceTaskId: "review-sync",
    entityId: "snapshot-1",
    target: browserTarget(),
    input: { shopId: "shop-a", since: "2026-07-10", ratingFilter: "all", replyFilter: "all" },
    requestedAt: timestamp,
  });
  const readDecision = evaluatePolicy(readTask, { now: timestamp });
  assert.equal(readDecision.decision, "allow");
  assert.equal(readDecision.allowExecute, true);

  const writeTask = buildTaskSpec({
    definitionId: "tiktok.reviews.send_reply",
    sourceTaskId: "review-reply",
    entityId: "review-1",
    target: browserTarget(),
    input: { shopId: "shop-a", reviewId: "review-1", approvedReply: "We can help.", replyHash: "hash" },
    requestedAt: timestamp,
  });
  const writeDecision = evaluatePolicy(writeTask, { now: timestamp });
  assert.equal(writeDecision.decision, "observe_only");
  assert.equal(writeDecision.allowExecute, false);
});

test("external origins require allowlisting and shadow mode does not execute writes", () => {
  const task = buildTaskSpec({
    definitionId: "tiktok.reviews.send_reply",
    sourceTaskId: "review-reply",
    entityId: "review-1",
    target: browserTarget("https://seller.example.test/reviews"),
    mode: "shadow",
    input: { shopId: "shop-a", reviewId: "review-1", approvedReply: "We can help.", replyHash: "hash" },
    requestedAt: timestamp,
  });
  const decision = evaluatePolicy(task, {
    now: timestamp,
    allowedOrigins: ["https://seller.example.test"],
    externalReadEnabled: true,
    externalWriteEnabled: true,
  });
  assert.equal(decision.decision, "observe_only");
  assert.equal(decision.allowObserve, true);
  assert.equal(decision.allowExecute, false);

  const blocked = evaluatePolicy(task, { now: timestamp, externalReadEnabled: true });
  assert.equal(blocked.decision, "block");
});

test("sensitive writes need both global enablement and a matching unexpired grant", () => {
  const task = buildTaskSpec({
    definitionId: "tiktok.inventory.submit_update",
    sourceTaskId: "adjustment-1",
    entityId: "SKU-1",
    target: browserTarget("https://seller.example.test/inventory"),
    mode: "live",
    input: {
      shopId: "shop-a",
      sellerSku: "SKU-1",
      expectedCurrentStock: 12,
      targetStock: 8,
      adjustmentId: "adjustment-1",
      approvalRef: "grant-1",
    },
    approvalGrant: {
      grantId: "grant-1",
      definitionId: "tiktok.inventory.submit_update",
      entityId: "SKU-1",
      expiresAt: "2026-07-10T07:00:00.000Z",
    },
    requestedAt: timestamp,
  });
  const disabled = evaluatePolicy(task, {
    now: timestamp,
    allowedOrigins: ["https://seller.example.test"],
    externalReadEnabled: true,
    externalWriteEnabled: true,
  });
  assert.equal(disabled.decision, "needs_approval");

  const allowed = evaluatePolicy(task, {
    now: timestamp,
    allowedOrigins: ["https://seller.example.test"],
    externalReadEnabled: true,
    externalWriteEnabled: true,
    highRiskAutomationEnabled: true,
  });
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.allowExecute, true);
});
