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
    const sku = firstText(record, ["sellerSku", "skuId", "platformSkuId", "sku", "SKU", "skuCode", "productSku"]);
    if (!sku) continue;
    const available =
      kind === "tiktok"
        ? firstNumber(record, ["platformAvailableStock", "availableStock", "available", "stock"])
        : firstNumber(record, ["availableStock", "available", "totalStock", "stock"]);
    const inTransit = firstNumber(record, ["remainingQuantity", "inTransit", "inTransitQuantity"]);
    const existing = index.get(sku);
    if (kind === "hcrd" && existing) {
      const combinedAvailable = existing.available === null || available === null ? null : existing.available + available;
      const combinedInTransit = (existing.inTransit ?? 0) + (inTransit ?? 0);
      index.set(sku, {
        sku,
        available: combinedAvailable,
        inTransit: combinedInTransit,
        record: {
          ...existing.record,
          id: `aggregated:${sku}`,
          sellerSku: sku,
          availableStock: combinedAvailable,
          evidence: [...(existing.record.evidence || []), ...(record.evidence || [])],
          sourceRows: [...(existing.record.sourceRows || [existing.record.id]), record.id],
        },
      });
    } else {
      index.set(sku, { sku, available, inTransit, record });
    }
  }
  return index;
}

function normalizeMapping(mapping) {
  const rawEntries = Array.isArray(mapping)
    ? mapping
    : Array.isArray(mapping?.entries)
      ? mapping.entries
      : Object.entries(mapping || {}).map(([hcrdSku, tiktokSku]) => ({ type: "direct", hcrdSku, tiktokSku }));
  const normalized = [];
  const mappedHcrdSkus = new Set();
  const mappedTikTokSkus = new Set();

  for (const rawEntry of rawEntries) {
    const entry = Array.isArray(rawEntry)
      ? { type: "direct", hcrdSku: rawEntry[0], tiktokSku: rawEntry[1] }
      : rawEntry;
    const type = entry?.type ?? entry?.mappingType ?? "direct";
    const tiktokSku = entry?.tiktokSku ?? entry?.targetSku;
    if (!tiktokSku) throw new Error("Every SKU mapping requires tiktokSku/targetSku.");
    if (mappedTikTokSkus.has(String(tiktokSku))) throw new Error(`Duplicate TikTok SKU mapping: ${tiktokSku}`);

    let components;
    if (type === "direct") {
      const hcrdSku = entry?.hcrdSku ?? entry?.sourceSku;
      if (!hcrdSku) throw new Error("Every direct SKU mapping requires hcrdSku/sourceSku.");
      components = [{ hcrdSku: String(hcrdSku), quantity: 1 }];
    } else if (type === "bundle") {
      if (!Array.isArray(entry?.components) || entry.components.length === 0) {
        throw new Error(`Bundle mapping ${tiktokSku} requires at least one HCRD component.`);
      }
      components = entry.components.map((component) => {
        const hcrdSku = component?.hcrdSku ?? component?.sourceSku;
        const quantity = asNumber(component?.quantity ?? component?.requiredQuantity ?? 1);
        if (!hcrdSku || quantity === null || quantity <= 0 || !Number.isInteger(quantity)) {
          throw new Error(`Invalid bundle component for TikTok SKU ${tiktokSku}.`);
        }
        return { hcrdSku: String(hcrdSku), quantity };
      });
      if (new Set(components.map(({ hcrdSku }) => hcrdSku)).size !== components.length) {
        throw new Error(`Bundle mapping ${tiktokSku} contains a duplicate HCRD component.`);
      }
    } else {
      throw new Error(`Unsupported SKU mapping type: ${type}`);
    }

    for (const { hcrdSku } of components) {
      if (mappedHcrdSkus.has(hcrdSku)) throw new Error(`Duplicate HCRD SKU mapping: ${hcrdSku}`);
      mappedHcrdSkus.add(hcrdSku);
    }
    mappedTikTokSkus.add(String(tiktokSku));
    normalized.push({
      type,
      tiktokSku: String(tiktokSku),
      components,
      evidence: entry?.evidence ?? [],
    });
  }
  if (normalized.length === 0) throw new Error("At least one approved SKU mapping is required for inventory reconciliation.");
  return {
    version: typeof mapping?.version === "string" && mapping.version.trim() ? mapping.version.trim() : "legacy-unversioned",
    status: typeof mapping?.status === "string" && mapping.status.trim() ? mapping.status.trim() : "unspecified",
    entries: normalized,
    mappedHcrdSkus,
    mappedTikTokSkus,
  };
}

function bundleStock(components, hcrdBySku, transitBySku) {
  const rows = components.map(({ hcrdSku, quantity }) => {
    const hcrd = hcrdBySku.get(hcrdSku);
    const transit = transitBySku.get(hcrdSku);
    const available = hcrd?.available ?? null;
    const inTransit = transit?.inTransit ?? transit?.available ?? 0;
    return {
      hcrdSku,
      requiredQuantity: quantity,
      available,
      inTransit,
      currentCapacity: available === null ? null : Math.floor(available / quantity),
      projectedCapacity: available === null ? null : Math.floor((available + inTransit) / quantity),
      evidence: [hcrd?.record?.evidence, transit?.record?.evidence].filter(Boolean),
    };
  });
  const complete = rows.every(({ currentCapacity }) => currentCapacity !== null);
  const currentCapacity = complete ? Math.min(...rows.map(({ currentCapacity: value }) => value)) : null;
  const projectedCapacity = complete ? Math.min(...rows.map(({ projectedCapacity: value }) => value)) : null;
  return {
    rows,
    currentCapacity,
    inTransitCapacity: complete ? Math.max(0, projectedCapacity - currentCapacity) : 0,
  };
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

  for (const mappingEntry of skuMapping.entries) {
    const { type, tiktokSku, components } = mappingEntry;
    const tiktok = tiktokBySku.get(tiktokSku);
    const hcrdSku = type === "direct" ? components[0].hcrdSku : null;
    const safety = safetyBySku.get(tiktokSku) ?? (hcrdSku ? safetyBySku.get(hcrdSku) : undefined) ?? 0;
    const stock = bundleStock(components, hcrdBySku, transitBySku);
    const hcrdAvailable = stock.currentCapacity;
    const tiktokAvailable = tiktok?.available ?? null;
    const inTransit = stock.inTransitCapacity;
    const missingHcrd = stock.rows.some(({ available }) => available === null);
    rows.push({
      id: `mapped:${components.map(({ hcrdSku: sku }) => sku).join("+")}:${tiktokSku}`,
      status: missingHcrd ? "missing_hcrd" : !tiktok ? "missing_tiktok" : "mapped",
      mappingType: type,
      hcrdSku,
      tiktokSku,
      components: stock.rows,
      hcrdAvailable,
      tiktokAvailable,
      inTransit,
      safetyStock: safety,
      discrepancy: hcrdAvailable !== null && tiktokAvailable !== null ? hcrdAvailable - tiktokAvailable : null,
      restockSuggestion: hcrdAvailable === null ? null : Math.max(0, safety - hcrdAvailable - inTransit),
      evidence: [mappingEntry.evidence, ...stock.rows.map(({ evidence }) => evidence), tiktok?.record?.evidence].filter(Boolean),
    });
  }

  for (const hcrdSku of hcrdBySku.keys()) {
    if (skuMapping.mappedHcrdSkus.has(hcrdSku)) continue;
    rows.push({ id: `unmapped_hcrd:${hcrdSku}`, status: "unmapped_hcrd", hcrdSku, tiktokSku: null, evidence: [hcrdBySku.get(hcrdSku).record.evidence] });
  }
  for (const tiktokSku of tiktokBySku.keys()) {
    if (skuMapping.mappedTikTokSkus.has(tiktokSku)) continue;
    rows.push({ id: `unmapped_tiktok:${tiktokSku}`, status: "unmapped_tiktok", hcrdSku: null, tiktokSku, evidence: [tiktokBySku.get(tiktokSku).record.evidence] });
  }

  const counts = Object.groupBy(rows, ({ status }) => status);
  return {
    records: rows,
    summary: {
      recordsValid: true,
      skuMappingVersion: skuMapping.version,
      skuMappingStatus: skuMapping.status,
      capturedCount: rows.length,
      mappedCount: counts.mapped?.length ?? 0,
      mappedHcrdSkuCount: skuMapping.mappedHcrdSkus.size,
      mappedTikTokSkuCount: skuMapping.mappedTikTokSkus.size,
      directMappedCount: rows.filter(({ status, mappingType }) => status === "mapped" && mappingType === "direct").length,
      bundleMappedCount: rows.filter(({ status, mappingType }) => status === "mapped" && mappingType === "bundle").length,
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
