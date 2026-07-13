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
  assert.equal(call.options.selector, "main");
});

test("inventory extraction processes the dedicated stock table in bounded SKU batches", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 } },
    schemaRegistry: { inventory_list: { schema: "inventory-list" } },
  });
  const pageEvaluations = [];
  driver.page = {
    async evaluate(_callback, argument) {
      pageEvaluations.push(argument);
      if (Array.isArray(argument)) return undefined;
      if (Object.hasOwn(argument, "startIndex")) return argument.endIndex - argument.startIndex;
      return { prepared: true, rowCount: 25, textLength: 7_500 };
    },
  };
  const calls = [];
  driver.stagehand = {
    async extract(instruction, _schema, options) {
      const batchIndex = calls.length;
      const count = 5;
      const records = Array.from({ length: count }, (_, offset) => {
        const id = String(1_732_000_000_000_000_000n + BigInt(batchIndex * 5 + offset));
        return { id, skuId: id, evidence: [{ sourceText: `SKU ID: ${id}` }] };
      });
      calls.push({ instruction, options });
      return { records, summary: { recordsValid: true, capturedCount: records.length, warnings: [] } };
    },
  };

  const result = await driver.runRead({
    definition: {
      id: "tiktok.inventory.sync",
      outputSchemaKey: "inventory_list",
      extractInstruction: "Extract visible inventory.",
    },
  });

  assert.equal(calls.length, 5);
  assert.match(calls[0].instruction, /rows 1-5 of 25/);
  assert.match(calls[4].instruction, /rows 21-25 of 25/);
  assert.match(calls[0].instruction, /exactly one concise evidence item/);
  assert.equal(calls[0].options.selector, '[data-tk-saas-extraction-scope="inventory_list"]');
  assert.equal(calls[0].options.ignoreSelectors, undefined);
  assert.equal(result.records.length, 25);
  assert.deepEqual(result.summary, {
    recordsValid: true,
    visibleCount: 25,
    capturedCount: 25,
    warnings: [],
  });
  assert.equal(pageEvaluations.filter((value) => value?.startIndex !== undefined).length, 5);
  assert.deepEqual(pageEvaluations.at(-1), [
    "data-tk-saas-extraction-scope",
    "data-tk-saas-extraction-row",
  ]);
});

test("inventory extraction refuses to use a non-stock page or an unbounded fallback", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 } },
    schemaRegistry: { inventory_list: { schema: "inventory-list" } },
  });
  driver.page = {
    async evaluate() {
      return { prepared: false, reason: "unexpected_inventory_path", pathname: "/product/manage" };
    },
  };
  driver.stagehand = {
    async extract() {
      assert.fail("extract must not receive an unbounded inventory page");
    },
  };

  await assert.rejects(
    driver.runRead({
      definition: {
        id: "tiktok.inventory.sync",
        outputSchemaKey: "inventory_list",
        extractInstruction: "Extract visible inventory.",
      },
      observation: { candidates: [] },
    }),
    /unexpected_inventory_path/,
  );
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
