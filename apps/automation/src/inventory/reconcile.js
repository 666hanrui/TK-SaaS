function asNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstText(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function firstNumber(record, keys) {
  for (const key of keys) {
    const number = asNumber(record?.[key]);
    if (number !== null) return number;
  }
  return null;
}

function recordsFrom(snapshot) {
  const records = snapshot?.extraction?.records;
  if (!Array.isArray(records)) throw new Error(`Snapshot ${snapshot?.runId || "unknown"} has no extracted record list.`);
  return records;
}

function inventoryIndex(snapshot, kind) {
  const index = new Map();
  for (const record of recordsFrom(snapshot)) {
    const sku = firstText(record, ["sellerSku", "sku", "SKU", "skuCode", "productSku"]);
    if (!sku) continue;
    const available =
      kind === "tiktok"
        ? firstNumber(record, ["platformAvailableStock", "availableStock", "available", "stock"])
        : firstNumber(record, ["availableStock", "available", "totalStock", "stock"]);
    const inTransit = firstNumber(record, ["remainingQuantity", "inTransit", "inTransitQuantity"]);
    index.set(sku, { sku, available, inTransit, record });
  }
  return index;
}

function normalizeMapping(mapping) {
  const entries = Array.isArray(mapping)
    ? mapping.map((row) => [row.hcrdSku ?? row.sourceSku, row.tiktokSku ?? row.targetSku])
    : Object.entries(mapping || {});
  const normalized = new Map();
  for (const [hcrdSku, tiktokSku] of entries) {
    if (!hcrdSku || !tiktokSku) throw new Error("Every SKU mapping requires hcrdSku/sourceSku and tiktokSku/targetSku.");
    if (normalized.has(String(hcrdSku))) throw new Error(`Duplicate HCRD SKU mapping: ${hcrdSku}`);
    normalized.set(String(hcrdSku), String(tiktokSku));
  }
  if (normalized.size === 0) throw new Error("At least one approved SKU mapping is required for inventory reconciliation.");
  return normalized;
}

function normalizeSafetyStock(safetyStock) {
  const entries = Array.isArray(safetyStock)
    ? safetyStock.map((row) => [row.sellerSku ?? row.sku, row.safetyStock])
    : Object.entries(safetyStock || {});
  return new Map(
    entries.map(([sku, stock]) => {
      const value = asNumber(stock);
      if (!sku || value === null || value < 0) throw new Error(`Invalid safety stock for SKU ${sku || "[missing]"}.`);
      return [String(sku), value];
    }),
  );
}

function assertDefinition(snapshot, expected) {
  if (snapshot?.definitionId !== expected) {
    throw new Error(`Expected ${expected} source snapshot, received ${snapshot?.definitionId || "[missing]"}.`);
  }
}

export function reconcileInventorySnapshots({ hcrdSnapshot, tiktokSnapshot, inTransitSnapshot, mapping, safetyStock }) {
  assertDefinition(hcrdSnapshot, "hcrd.inventory.sync");
  assertDefinition(tiktokSnapshot, "tiktok.inventory.sync");
  if (inTransitSnapshot) assertDefinition(inTransitSnapshot, "hcrd.inventory.sync_in_transit");

  const hcrdBySku = inventoryIndex(hcrdSnapshot, "hcrd");
  const tiktokBySku = inventoryIndex(tiktokSnapshot, "tiktok");
  const transitBySku = inTransitSnapshot ? inventoryIndex(inTransitSnapshot, "hcrd") : new Map();
  const skuMapping = normalizeMapping(mapping);
  const safetyBySku = normalizeSafetyStock(safetyStock);
  const rows = [];
  const mappedTikTokSkus = new Set();

  for (const [hcrdSku, tiktokSku] of skuMapping.entries()) {
    mappedTikTokSkus.add(tiktokSku);
    const hcrd = hcrdBySku.get(hcrdSku);
    const tiktok = tiktokBySku.get(tiktokSku);
    const transit = transitBySku.get(hcrdSku) ?? transitBySku.get(tiktokSku);
    const safety = safetyBySku.get(tiktokSku) ?? safetyBySku.get(hcrdSku) ?? 0;
    const hcrdAvailable = hcrd?.available ?? null;
    const tiktokAvailable = tiktok?.available ?? null;
    const inTransit = transit?.inTransit ?? transit?.available ?? 0;
    rows.push({
      id: `mapped:${hcrdSku}:${tiktokSku}`,
      status: !hcrd ? "missing_hcrd" : !tiktok ? "missing_tiktok" : "mapped",
      hcrdSku,
      tiktokSku,
      hcrdAvailable,
      tiktokAvailable,
      inTransit,
      safetyStock: safety,
      discrepancy: hcrdAvailable !== null && tiktokAvailable !== null ? hcrdAvailable - tiktokAvailable : null,
      restockSuggestion: hcrdAvailable === null ? null : Math.max(0, safety - hcrdAvailable - inTransit),
      evidence: [hcrd?.record?.evidence, tiktok?.record?.evidence, transit?.record?.evidence].filter(Boolean),
    });
  }

  for (const hcrdSku of hcrdBySku.keys()) {
    if (skuMapping.has(hcrdSku)) continue;
    rows.push({ id: `unmapped_hcrd:${hcrdSku}`, status: "unmapped_hcrd", hcrdSku, tiktokSku: null, evidence: [hcrdBySku.get(hcrdSku).record.evidence] });
  }
  for (const tiktokSku of tiktokBySku.keys()) {
    if (mappedTikTokSkus.has(tiktokSku)) continue;
    rows.push({ id: `unmapped_tiktok:${tiktokSku}`, status: "unmapped_tiktok", hcrdSku: null, tiktokSku, evidence: [tiktokBySku.get(tiktokSku).record.evidence] });
  }

  const counts = Object.groupBy(rows, ({ status }) => status);
  return {
    records: rows,
    summary: {
      recordsValid: true,
      capturedCount: rows.length,
      mappedCount: counts.mapped?.length ?? 0,
      missingHcrdCount: counts.missing_hcrd?.length ?? 0,
      missingTikTokCount: counts.missing_tiktok?.length ?? 0,
      unmappedHcrdCount: counts.unmapped_hcrd?.length ?? 0,
      unmappedTikTokCount: counts.unmapped_tiktok?.length ?? 0,
      restockSuggestedCount: rows.filter(({ restockSuggestion }) => Number(restockSuggestion) > 0).length,
      warnings: rows
        .filter(({ status }) => status !== "mapped")
        .map(({ id, status }) => `${id}: ${status}`),
    },
  };
}
