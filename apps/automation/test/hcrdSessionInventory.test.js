import test from "node:test";
import assert from "node:assert/strict";
import {
  compareHcrdVisualAudit,
  parseHcrdInventoryResponse,
  readHcrdInventoryViaSession,
} from "../src/inventory/hcrdSessionInventory.js";

function rawRow(index, overrides = {}) {
  return {
    id: index,
    sku: `XCGLM-GLM${String(index).padStart(3, "0")}`,
    customerCode: "XCGLM",
    qty: index === 5 ? 4 : 16,
    availableQty: index === 5 ? 4 : 16,
    frozenQty: 0,
    checkFrozenQty: 0,
    defectiveQty: 0,
    onShelfQty: index === 5 ? 4 : 16,
    onloadQty: 0,
    soldQty: 0,
    transferQty: 0,
    lackQty: 0,
    maxInventoryAge: 10,
    warehouseCode: "HCNY",
    warehouseId: 1,
    warehouseName: "惠程纽约仓",
    productCname: index === 5 ? "44-ST-N-D" : "44-ST-N-E",
    ...overrides,
  };
}

test("HCRD session inventory paginates the authenticated JSON API and preserves typed source fields", async () => {
  const rows = [rawRow(5), rawRow(6), rawRow(7)];
  const requests = [];
  const page = {
    async evaluate(_callback, argument) {
      requests.push(argument.requestBody);
      const pageRows = argument.requestBody.page === 1 ? rows.slice(0, 2) : rows.slice(2);
      return {
        status: 200,
        url: argument.url,
        redirected: false,
        contentType: "application/json;charset=UTF-8",
        text: JSON.stringify({ page: argument.requestBody.page, total: 3, totalPage: 2, rows: pageRows }),
      };
    },
  };

  const result = await readHcrdInventoryViaSession({
    page,
    endpoint: "http://124.156.202.7:8888/wms-main/inventory/inventory/listForClientAction.json",
    pageSize: 2,
    warehouse: "HCNY",
    now: () => new Date("2026-07-13T03:00:00.000Z"),
  });

  assert.deepEqual(requests, [{ page: 1, rows: 2 }, { page: 2, rows: 2 }]);
  assert.equal(result.records.length, 3);
  assert.equal(result.records[0].sellerSku, "XCGLM-GLM005");
  assert.equal(result.records[0].totalStock, 4);
  assert.equal(result.records[0].availableStock, 4);
  assert.equal(result.records[0].warehouse, "惠程纽约仓");
  assert.equal(result.records[0].owner, "XCGLM");
  assert.match(result.records[0].evidence[0].sourceText, /session API.*XCGLM-GLM005.*total 4.*available 4/);
  assert.deepEqual(result.summary, {
    recordsValid: true,
    visibleCount: 3,
    capturedCount: 3,
    sourceTotalCount: 3,
    sourceCapturedCount: 3,
    pageSize: 2,
    pagesCaptured: 2,
    source: "hcrd_session_api",
    warnings: [],
  });
});

test("HCRD session inventory rejects a redirected HTML login response", () => {
  assert.throws(
    () => parseHcrdInventoryResponse({ status: 200, contentType: "text/html", text: "<html>登录</html>" }),
    /not authenticated/,
  );
});

test("HCRD session inventory captures the reported 303-row baseline in two 200-row requests", async () => {
  const rows = Array.from({ length: 303 }, (_, index) => rawRow(index + 1));
  const page = {
    async evaluate(_callback, argument) {
      const start = (argument.requestBody.page - 1) * argument.requestBody.rows;
      const pageRows = rows.slice(start, start + argument.requestBody.rows);
      return {
        status: 200,
        url: argument.url,
        redirected: false,
        contentType: "application/json",
        text: JSON.stringify({
          page: argument.requestBody.page,
          total: rows.length,
          totalPage: 2,
          rows: pageRows,
        }),
      };
    },
  };
  const result = await readHcrdInventoryViaSession({
    page,
    endpoint: "http://124.156.202.7:8888/wms-main/inventory/inventory/listForClientAction.json",
    pageSize: 200,
    warehouse: "HCNY",
  });
  assert.equal(result.records.length, 303);
  assert.equal(result.summary.sourceTotalCount, 303);
  assert.equal(result.summary.pagesCaptured, 2);
  assert.equal(result.summary.recordsValid, true);
});

test("HCRD session inventory follows total=303 when the server ignores rows=200 and returns 10 per page", async () => {
  const rows = Array.from({ length: 303 }, (_, index) => rawRow(index + 1));
  const requests = [];
  const page = {
    async evaluate(_callback, argument) {
      requests.push(argument.requestBody);
      const start = (argument.requestBody.page - 1) * 10;
      const pageRows = rows.slice(start, start + 10);
      return {
        status: 200,
        url: argument.url,
        redirected: false,
        contentType: "application/json",
        text: JSON.stringify({
          page: argument.requestBody.page,
          total: rows.length,
          totalPage: 31,
          rows: pageRows,
        }),
      };
    },
  };
  const result = await readHcrdInventoryViaSession({
    page,
    endpoint: "http://124.156.202.7:8888/wms-main/inventory/inventory/listForClientAction.json",
    pageSize: 200,
    warehouse: "HCNY",
  });
  assert.equal(requests.length, 31);
  assert.deepEqual(requests.at(-1), { page: 31, rows: 200 });
  assert.equal(result.records.length, 303);
  assert.equal(result.summary.sourceCapturedCount, 303);
  assert.equal(result.summary.pagesCaptured, 31);
  assert.equal(result.summary.recordsValid, true);
});

test("HCRD multimodal audit requires visible API values to agree", () => {
  const records = [
    {
      sellerSku: "XCGLM-GLM005",
      totalStock: 4,
      availableStock: 4,
      maxInventoryAge: 33,
    },
  ];
  assert.equal(
    compareHcrdVisualAudit(records, {
      pageKind: "inventory_list",
      rows: [{ sellerSku: "XCGLM-GLM005", maxInventoryAge: 33, usableStock: 4, sellableStock: 4 }],
      warnings: [],
    }).ok,
    true,
  );
  assert.equal(
    compareHcrdVisualAudit(records, {
      pageKind: "inventory_list",
      rows: [{ sellerSku: "XCGLM-GLM005", maxInventoryAge: 33, usableStock: 4, sellableStock: 3 }],
      warnings: [],
    }).ok,
    false,
  );
});
