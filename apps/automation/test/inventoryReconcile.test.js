import assert from "node:assert/strict";
import test from "node:test";
import { reconcileInventorySnapshots } from "../src/inventory/reconcile.js";

function snapshot(definitionId, records) {
  return {
    runId: `${definitionId}-run`,
    definitionId,
    extraction: { records },
  };
}

test("inventory reconciliation preserves unmapped SKUs and calculates evidence-backed restock suggestions", () => {
  const result = reconcileInventorySnapshots({
    hcrdSnapshot: snapshot("hcrd.inventory.sync", [
      { sellerSku: "H-1", availableStock: 5, evidence: [{ sourceText: "H-1 5" }] },
      { sellerSku: "H-NO-MAP", availableStock: 2, evidence: [{ sourceText: "H-NO-MAP 2" }] },
    ]),
    tiktokSnapshot: snapshot("tiktok.inventory.sync", [
      { skuId: "T-1", availableStock: 3, evidence: [{ sourceText: "T-1 3" }] },
      { sellerSku: "T-NO-MAP", platformAvailableStock: 1, evidence: [{ sourceText: "T-NO-MAP 1" }] },
    ]),
    inTransitSnapshot: snapshot("hcrd.inventory.sync_in_transit", [
      { sellerSku: "H-1", remainingQuantity: 2, evidence: [{ sourceText: "H-1 transit 2" }] },
    ]),
    mapping: { "H-1": "T-1" },
    safetyStock: { "T-1": 10 },
  });
  const mapped = result.records.find(({ status }) => status === "mapped");
  assert.equal(mapped.discrepancy, 2);
  assert.equal(mapped.restockSuggestion, 3);
  assert.equal(result.summary.unmappedHcrdCount, 1);
  assert.equal(result.summary.unmappedTikTokCount, 1);
  assert.equal(result.summary.recordsValid, true);
});

test("inventory reconciliation sums the same HCRD seller SKU across warehouse rows", () => {
  const result = reconcileInventorySnapshots({
    hcrdSnapshot: snapshot("hcrd.inventory.sync", [
      { id: "WH-A:H-1", sellerSku: "H-1", availableStock: 5, evidence: [{ sourceText: "WH-A H-1 5" }] },
      { id: "WH-B:H-1", sellerSku: "H-1", availableStock: 7, evidence: [{ sourceText: "WH-B H-1 7" }] },
    ]),
    tiktokSnapshot: snapshot("tiktok.inventory.sync", [
      { skuId: "T-1", availableStock: 10, evidence: [{ sourceText: "T-1 10" }] },
    ]),
    mapping: { "H-1": "T-1" },
    safetyStock: {},
  });
  const mapped = result.records.find(({ status }) => status === "mapped");
  assert.equal(mapped.hcrdAvailable, 12);
  assert.equal(mapped.discrepancy, 2);
});
