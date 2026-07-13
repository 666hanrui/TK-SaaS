import test from "node:test";
import assert from "node:assert/strict";
import {
  compareTikTokVisualAudit,
  normalizeTikTokInventoryRecord,
  readTikTokInventoryViaSession,
} from "../src/inventory/tiktokSessionInventory.js";

function rawSku(index) {
  const skuId = String(1_732_000_000_000_000_000n + BigInt(index));
  return {
    sku_id: skuId,
    product_id: String(1_731_000_000_000_000_000n + BigInt(index)),
    product_title: `Product ${index}`,
    seller_sku: index % 2 ? `SELLER-${index}` : "",
    warehouse_total_quantity: 31,
    open_quantity: 29,
    campaign_quantity: 1,
    creator_quantity: 1,
    withholding_quantity: 0,
    sku_sales: "14",
    sku_forecast_sales: "29",
    sku_replenishment_quantity: "0",
    sku_stock_days_left: ">60",
    stock_model_type: 0,
    sku_combo_type: 0,
    warehouse_stock_list: [{
      warehouse_id: "7623832149289043729",
      warehouse_name: "惠程纽约仓",
      in_shop_stock: 29,
      total_quantity: 31,
      is_stock_edit_prohibited: false,
      stock_sale_type: 1,
    }],
  };
}

function fakeResponse(pageNumber, rows, total) {
  return {
    status: 200,
    url: "https://seller.us.tiktokshopglobalselling.com/api/v1/product/stock/sku/list",
    contentType: "application/json",
    text: JSON.stringify({ skus: rows, total_sku_count: total }),
    requestBody: JSON.stringify({ page_no: pageNumber, page_size: 50 }),
  };
}

function fakePage(allRows) {
  const captures = [];
  const emit = (pageNumber) => {
    const start = (pageNumber - 1) * 50;
    captures.push(fakeResponse(pageNumber, allRows.slice(start, start + 50), allRows.length));
  };
  return {
    async addInitScript(_script, argument) {
      assert.deepEqual(argument, {
        key: "__TK_SAAS_TIKTOK_INVENTORY_CAPTURES__",
        apiPath: "/api/v1/product/stock/sku/list",
      });
    },
    async reload(options) {
      assert.deepEqual(options, { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
      emit(1);
    },
    async evaluate(_callback, argument) {
      if (argument.key) return captures;
      emit(argument.requestedPage);
      return true;
    },
    async waitForTimeout() {},
  };
}

test("TikTok session inventory captures the current 346-SKU baseline across seven visible API pages", async () => {
  const rows = Array.from({ length: 346 }, (_, index) => rawSku(index + 1));
  const artifacts = [];
  const result = await readTikTokInventoryViaSession({
    page: fakePage(rows),
    artifactStore: {
      async writeJson(file, value) {
        artifacts.push({ file, value });
      },
    },
    now: () => new Date("2026-07-13T00:00:00.000Z"),
  });

  assert.equal(result.records.length, 346);
  assert.equal(result.summary.recordsValid, true);
  assert.equal(result.summary.sourceTotalCount, 346);
  assert.equal(result.summary.pagesCaptured, 7);
  assert.equal(result.summary.source, "tiktok_session_api");
  assert.equal(artifacts.length, 7);
  assert.equal(artifacts.at(-1).value.receivedRows, 46);
  assert.equal(result.records[0].sellerSku, "SELLER-1");
  assert.equal(result.records[1].sellerSku, null);
  assert.equal(result.records[0].totalStock, 31);
  assert.equal(result.records[0].availableStock, 29);
  assert.equal(result.records[0].lockedStock, 2);
  assert.equal(result.records[0].warehouseStockList[0].warehouseName, "惠程纽约仓");
});

test("TikTok inventory normalization preserves empty seller SKU without losing SKU identity", () => {
  const record = normalizeTikTokInventoryRecord(rawSku(2), {
    endpoint: "https://seller.us.tiktokshopglobalselling.com/api/v1/product/stock/sku/list",
    capturedAt: "2026-07-13T00:00:00.000Z",
  });
  assert.equal(record.sellerSku, null);
  assert.equal(record.skuId, rawSku(2).sku_id);
  assert.match(record.evidence[0].sourceText, /seller SKU empty/);
});

test("TikTok multimodal audit requires total, available, and locked values to match", () => {
  const record = normalizeTikTokInventoryRecord(rawSku(1), {
    endpoint: "https://seller.us.tiktokshopglobalselling.com/api/v1/product/stock/sku/list",
    capturedAt: "2026-07-13T00:00:00.000Z",
  });
  const matching = {
    pageKind: "inventory_list",
    rows: [{ skuId: record.skuId, totalStock: 31, availableStock: 29, lockedStock: 2 }],
    warnings: [],
  };
  assert.equal(compareTikTokVisualAudit([record], matching).ok, true);
  assert.equal(compareTikTokVisualAudit([record], {
    ...matching,
    rows: [{ ...matching.rows[0], availableStock: 28 }],
  }).ok, false);
});
