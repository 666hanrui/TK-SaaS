import test from "node:test";
import assert from "node:assert/strict";
import { StagehandAutomationDriver } from "../src/adapters/stagehand/stagehandDriver.js";

test("HCRD navigation tolerates a DOM-content timeout only after the target origin is loaded", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 } },
  });
  let waited = 0;
  driver.page = {
    async goto(_url, options) {
      assert.deepEqual(options, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
      throw new Error("page.goto: Timeout 30000ms exceeded");
    },
    url() {
      return "http://124.156.202.7:8888/wms-main/inventory/inventory/listForClient.htm";
    },
    async waitForTimeout(milliseconds) {
      waited += milliseconds;
    },
  };

  await driver.navigate({
    task: {
      target: {
        origin: "http://124.156.202.7:8888",
        url: "http://124.156.202.7:8888/wms-main/inventory/inventory/listForClient.htm",
      },
    },
    definition: { outputSchemaKey: "hcrd_inventory_list" },
  });

  assert.equal(waited, 1_000);
});

test("evidence capture preserves direct string extraction on non-HCRD pages", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 } },
  });
  driver.page = {
    async screenshot() {},
    url() {
      return "https://seller.us.tiktokshopglobalselling.com/product/stock";
    },
    async title() {
      return "TikTok Shop Seller Center";
    },
    async evaluate() {
      return { url: "https://seller.us.tiktokshopglobalselling.com/product/stock", title: "Inventory", headings: [], buttons: [] };
    },
  };
  driver.stagehand = {
    async extract() {
      return "direct page text";
    },
  };
  const written = [];
  await driver.captureEvidence({
    definition: { outputSchemaKey: "order_list" },
    artifactStore: {
      async prepareFile() {
        return "/tmp/evidence.png";
      },
      async writeJson(path, value) {
        written.push({ path, value });
      },
    },
    phase: "before-observe",
  });

  assert.equal(written[0].value.accessibilityText, "direct page text");
});

test("inventory observation uses deterministic page checks without full-page action enumeration", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 } },
  });
  let observeCalled = false;
  driver.stagehand = {
    async extract() {
      return { pageText: "管理库存 Estrella Hair" };
    },
    async observe() {
      observeCalled = true;
      return [];
    },
  };
  driver.page = {
    async evaluate() {
      return { url: "https://seller.us.tiktokshopglobalselling.com/product/stock", title: "Inventory", headings: [], buttons: [] };
    },
    url() {
      return "https://seller.us.tiktokshopglobalselling.com/product/stock?shop_region=US";
    },
    locator(selector) {
      assert.equal(selector, "body");
      return {
        async innerText() {
          return "管理库存 Estrella Hair";
        },
      };
    },
  };

  const observation = await driver.observe({
    task: { target: { origin: "https://seller.us.tiktokshopglobalselling.com" } },
    definition: { outputSchemaKey: "inventory_list", allowedMethods: ["click", "fill", "extract"] },
  });

  assert.equal(observeCalled, false);
  assert.equal(observation.authenticated, true);
  assert.equal(observation.challengeDetected, false);
  assert.deepEqual(observation.candidates, []);
});

test("list extraction explicitly defines a verified empty-state result", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 }, tiktokInventory: { sessionApi: false } },
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
    config: { llm: { timeoutMs: 90_000 }, tiktokInventory: { sessionApi: false } },
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
  const artifacts = [];
  driver.stagehand = {
    async extract(instruction, _schema, options) {
      const batchIndex = calls.length;
      const count = 5;
      const records = Array.from({ length: count }, (_, offset) => {
        const id = String(1_732_000_000_000_000_000n + BigInt(batchIndex * 5 + offset));
        return {
          id,
          skuId: id,
          totalStock: 10,
          availableStock: 9,
          lockedStock: 1,
          stockAlert: null,
          evidence: [{ sourceText: `SKU ID: ${id}`, sourceSelector: "invented", capturedAt: "2024-01-01T00:00:00Z" }],
        };
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
    artifactStore: {
      async writeJson(path, value) {
        artifacts.push({ path, value });
      },
    },
  });

  assert.equal(calls.length, 5);
  assert.match(calls[0].instruction, /rows 1-5 of 25/);
  assert.match(calls[4].instruction, /rows 21-25 of 25/);
  assert.match(calls[0].instruction, /exactly one concise evidence item/);
  assert.equal(calls[0].options.selector, '[data-tk-saas-extraction-scope="inventory_list"]');
  assert.equal(calls[0].options.ignoreSelectors, undefined);
  assert.equal(result.records.length, 25);
  assert.equal(Object.hasOwn(result.records[0], "stockAlert"), false);
  assert.deepEqual(result.records[0].evidence, [{ sourceText: `SKU ID: ${result.records[0].id}` }]);
  assert.deepEqual(result.summary, {
    recordsValid: true,
    visibleCount: 25,
    capturedCount: 25,
    warnings: [],
  });
  assert.equal(pageEvaluations.filter((value) => value?.startIndex !== undefined).length, 5);
  assert.equal(artifacts.length, 5);
  assert.equal(artifacts[0].path, "extraction/inventory-rows-1-5.json");
  assert.equal(artifacts[4].path, "extraction/inventory-rows-21-25.json");
  assert.deepEqual(pageEvaluations.at(-1), [
    "data-tk-saas-extraction-scope",
    "data-tk-saas-extraction-row",
  ]);
});

test("inventory extraction splits only a malformed batch and preserves exact row coverage", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 }, tiktokInventory: { sessionApi: false } },
    schemaRegistry: { inventory_list: { schema: "inventory-list" } },
  });
  driver.page = {
    async evaluate(_callback, argument) {
      if (Array.isArray(argument)) return undefined;
      if (Object.hasOwn(argument, "startIndex")) return argument.endIndex - argument.startIndex;
      return { prepared: true, rowCount: 5, textLength: 1_500 };
    },
  };
  const instructions = [];
  driver.stagehand = {
    async extract(instruction) {
      instructions.push(instruction);
      if (/rows 1-5 of 5/.test(instruction)) throw new SyntaxError("malformed JSON");
      const match = instruction.match(/rows (\d+)-(\d+) of 5/);
      const start = Number(match[1]);
      const end = Number(match[2]);
      const records = Array.from({ length: end - start + 1 }, (_, offset) => {
        const id = String(1_732_000_000_000_000_000n + BigInt(start + offset));
        return { id, skuId: id, totalStock: 5, availableStock: 5, lockedStock: 0, evidence: [{ sourceText: `SKU ID: ${id}` }] };
      });
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

  assert.equal(instructions.length, 3);
  assert.match(instructions[1], /rows 1-2 of 5/);
  assert.match(instructions[2], /rows 3-5 of 5/);
  assert.equal(result.records.length, 5);
  assert.equal(result.summary.recordsValid, true);
});

test("inventory extraction refuses to use a non-stock page or an unbounded fallback", async () => {
  const driver = new StagehandAutomationDriver({
    config: { llm: { timeoutMs: 90_000 }, tiktokInventory: { sessionApi: false } },
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

test("HCRD inventory uses the session API result and requires a matching multimodal sample", async () => {
  const endpointCalls = [];
  const driver = new StagehandAutomationDriver({
    config: {
      llm: { timeoutMs: 90_000 },
      platformBaseUrls: { hcrd: "http://124.156.202.7:8888/wms-main" },
      hcrdInventory: {
        baseUrl: "http://124.156.202.7:8888/wms-main",
        path: "/inventory/inventory/listForClientAction.json",
        pageSize: 200,
        maxPages: 100,
        visualAudit: true,
      },
    },
    async hcrdInventoryReader(options) {
      endpointCalls.push(options.endpoint);
      return {
        records: [{
          id: "HCNY:XCGLM-GLM005",
          sellerSku: "XCGLM-GLM005",
          warehouse: "惠程纽约仓",
          owner: "XCGLM",
          totalStock: 4,
          availableStock: 4,
          lockedStock: 0,
          maxInventoryAge: 33,
          evidence: [{ sourceText: "HCRD API XCGLM-GLM005 4 4 0" }],
        }],
        summary: { recordsValid: true, capturedCount: 1, warnings: [] },
      };
    },
    async hcrdVisionAuditor() {
      return {
        pageKind: "inventory_list",
        rows: [{ sellerSku: "XCGLM-GLM005", maxInventoryAge: 33, usableStock: 4, sellableStock: 4 }],
        warnings: [],
      };
    },
  });
  driver.page = {};

  const result = await driver.runRead({
    task: {
      target: {
        origin: "http://124.156.202.7:8888",
        url: "http://124.156.202.7:8888/wms-main/inventory/inventory/listForClient.htm",
      },
      input: { warehouse: "HCNY" },
    },
    definition: {
      id: "hcrd.inventory.sync",
      outputSchemaKey: "hcrd_inventory_list",
      extractInstruction: "Read HCRD inventory.",
    },
  });

  assert.deepEqual(endpointCalls, ["http://124.156.202.7:8888/wms-main/inventory/inventory/listForClientAction.json"]);
  assert.equal(result.records.length, 1);
  assert.equal(result.visualAudit.ok, true);
  assert.equal(result.summary.recordsValid, true);
});

test("TikTok inventory uses complete session API data and requires a matching multimodal sample", async () => {
  const calls = [];
  const driver = new StagehandAutomationDriver({
    config: {
      llm: { timeoutMs: 90_000 },
      tiktokInventory: {
        apiPath: "/api/v1/product/stock/sku/list",
        pageSize: 50,
        maxPages: 100,
        sessionApi: true,
        visualAudit: true,
      },
    },
    async tiktokInventoryReader(options) {
      calls.push(options);
      return {
        records: [{
          id: "1732365465645322771",
          skuId: "1732365465645322771",
          sellerSku: null,
          productTitle: "Limited Free Bonus",
          totalStock: 31,
          availableStock: 31,
          platformAvailableStock: 31,
          lockedStock: 0,
          evidence: [{ sourceText: "TikTok API SKU 1732365465645322771 total 31 available 31 locked 0" }],
        }],
        summary: { recordsValid: true, capturedCount: 1, warnings: [], sourceTotalCount: 1 },
      };
    },
    async tiktokVisionAuditor() {
      return {
        pageKind: "inventory_list",
        rows: [{ skuId: "1732365465645322771", totalStock: 31, availableStock: 31, lockedStock: 0 }],
        warnings: [],
      };
    },
  });
  driver.page = {};
  const artifacts = [];

  const result = await driver.runRead({
    task: {
      target: {
        origin: "https://seller.us.tiktokshopglobalselling.com",
        url: "https://seller.us.tiktokshopglobalselling.com/product/stock?shop_region=US",
      },
      input: {},
    },
    definition: {
      id: "tiktok.inventory.sync",
      outputSchemaKey: "inventory_list",
      extractInstruction: "Read TikTok inventory.",
    },
    artifactStore: {
      async writeJson(file, value) {
        artifacts.push({ file, value });
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiPath, "/api/v1/product/stock/sku/list");
  assert.equal(result.records.length, 1);
  assert.equal(result.visualAudit.ok, true);
  assert.equal(result.summary.recordsValid, true);
  assert.equal(artifacts[0].file, "extraction/tiktok-visual-audit.json");
});
