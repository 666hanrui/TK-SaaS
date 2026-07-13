import test from "node:test";
import assert from "node:assert/strict";
import { StagehandAutomationDriver } from "../src/adapters/stagehand/stagehandDriver.js";

test("list extraction explicitly defines a verified empty-state result", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 } },
    schemaRegistry: { order_list: { schema: "order-list" } },
  });
  let call;
  driver.stagehand = {
    async extract(instruction, schema, options) {
      call = { instruction, schema, options };
      return {
        records: [],
        summary: { recordsValid: true, capturedCount: 0, warnings: ["No matching rows are visible."] },
      };
    },
  };

  const result = await driver.runRead({
    definition: {
      id: "tiktok.orders.sync",
      outputSchemaKey: "order_list",
      extractInstruction: "Extract visible orders.",
    },
  });

  assert.deepEqual(result.records, []);
  assert.match(call.instruction, /must always contain both "records" and "summary"/);
  assert.match(call.instruction, /visibly has no matching rows/);
  assert.match(call.instruction, /still loading/);
  assert.equal(call.schema.schema, "order-list");
  assert.equal(call.options.timeout, 90_000);
});

test("detail extraction still requires the requested schema without list-only fields", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 } },
    schemaRegistry: { order_detail: { schema: "order-detail" } },
  });
  let instruction;
  driver.stagehand = {
    async extract(value) {
      instruction = value;
      return { id: "order-1" };
    },
  };

  await driver.runRead({
    definition: {
      id: "tiktok.orders.read_detail",
      outputSchemaKey: "order_detail",
      extractInstruction: "Extract the order detail.",
    },
  });

  assert.match(instruction, /Never omit required fields/);
  assert.doesNotMatch(instruction, /must always contain both "records" and "summary"/);
});
