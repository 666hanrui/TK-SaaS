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
        evidence: [{ sourceText: "SKU ID: 1732365465645322771 | Default | 31 | 31 | 0" }],
      },
    ],
    summary,
  });

  assert.equal(valid.records[0].availableStock, 31);

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
