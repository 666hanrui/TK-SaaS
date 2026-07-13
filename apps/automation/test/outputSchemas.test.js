import test from "node:test";
import assert from "node:assert/strict";
import { stagehandOutputSchemas } from "../src/adapters/stagehand/outputSchemas.js";

const summary = {
  recordsValid: true,
  visibleCount: 1,
  capturedCount: 1,
  warnings: [],
};

test("inventory schema requires typed SKU stock fields", () => {
  const valid = stagehandOutputSchemas.inventory_list.parse({
    records: [
      {
        id: "1732365465645322771",
        skuId: "1732365465645322771",
        totalStock: 31,
        availableStock: 31,
        lockedStock: 0,
        stockAlert: null,
        autoRestock: null,
        forecast30d: null,
        evidence: [{ sourceText: "SKU ID: 1732365465645322771 | Default | 31 | 31 | 0" }],
      },
    ],
    summary,
  });

  assert.equal(valid.records[0].availableStock, 31);
  assert.equal(valid.records[0].stockAlert, null);

  assert.throws(
    () =>
      stagehandOutputSchemas.inventory_list.parse({
        records: [
          {
            id: "1732365465645322771",
            evidence: [{ sourceText: "SKU ID: 1732365465645322771 | Default | 31 | 31 | 0" }],
          },
        ],
        summary,
      }),
    /skuId|totalStock|availableStock|lockedStock/,
  );
});

test("HCRD inventory schema requires seller SKU, warehouse, and typed stock fields", () => {
  const valid = stagehandOutputSchemas.hcrd_inventory_list.parse({
    records: [
      {
        id: "SELLER-SKU-1",
        sellerSku: "SELLER-SKU-1",
        warehouse: "US Warehouse",
        owner: null,
        totalStock: 12,
        availableStock: 10,
        lockedStock: 2,
        evidence: [{ sourceText: "US Warehouse | SELLER-SKU-1 | 12 | 10 | 2" }],
      },
    ],
    summary,
  });

  assert.equal(valid.records[0].sellerSku, "SELLER-SKU-1");
  assert.throws(
    () =>
      stagehandOutputSchemas.hcrd_inventory_list.parse({
        records: [
          {
            id: "SELLER-SKU-1",
            evidence: [{ sourceText: "SELLER-SKU-1 | 12 | 10 | 2" }],
          },
        ],
        summary,
      }),
    /sellerSku|warehouse|totalStock|availableStock|lockedStock/,
  );
});
