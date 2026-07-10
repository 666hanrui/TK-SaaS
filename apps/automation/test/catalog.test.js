import assert from "node:assert/strict";
import test from "node:test";
import {
  automationTaskCatalog,
  currentTaskBindings,
  getAutomationDefinition,
  resolveCurrentTaskDefinition,
} from "../src/catalog/taskCatalog.js";

test("automation catalog has unique definitions and covers current mock task categories", () => {
  const ids = automationTaskCatalog.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(automationTaskCatalog.some(({ id }) => id === "tiktok.orders.sync"));
  assert.ok(automationTaskCatalog.some(({ id }) => id === "echotik.creators.search"));
  assert.ok(automationTaskCatalog.some(({ id }) => id === "tiktok.messages.sync"));

  for (const [taskKey, binding] of Object.entries(currentTaskBindings)) {
    for (const [operation, definitionId] of Object.entries(binding)) {
      assert.ok(getAutomationDefinition(definitionId), `${taskKey}.${operation} should resolve`);
    }
  }
});

test("current task binding resolves run and send workflows", () => {
  const pickupRisk = { module: "orders", category: "pickup_risk" };
  assert.equal(resolveCurrentTaskDefinition(pickupRisk, "run").id, "tiktok.orders.audit_fulfillment");
  assert.equal(resolveCurrentTaskDefinition(pickupRisk, "send").id, "tiktok.orders.send_customer_message");
  assert.equal(resolveCurrentTaskDefinition({ module: "orders", category: "unknown" }), undefined);
});
