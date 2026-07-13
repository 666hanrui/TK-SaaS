const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_PAGES = 100;

function asInteger(value, { field, fallback = null } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`HCRD inventory field ${field || "value"} must be a non-negative integer; received ${value}.`);
  }
  return parsed;
}

function asText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function rowsFromPayload(payload) {
  const candidates = [
    payload?.rows,
    payload?.data?.rows,
    payload?.data?.list,
    payload?.data,
    payload?.list,
    payload?.result?.rows,
    payload?.result?.list,
    payload?.result,
  ];
  return candidates.find(Array.isArray) || [];
}

function numberFromPayload(payload, keys) {
  for (const path of keys) {
    let value = payload;
    for (const segment of path) value = value?.[segment];
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function pageSignature(rows) {
  if (!rows.length) return "empty";
  const identity = (row) => `${asText(row?.id)}:${asText(row?.warehouseCode)}:${asText(row?.sku)}`;
  return `${rows.length}:${identity(rows[0])}:${identity(rows.at(-1))}`;
}

export function parseHcrdInventoryResponse(response) {
  if (!response || typeof response !== "object") throw new Error("HCRD inventory request returned no response metadata.");
  const contentType = asText(response.contentType).toLowerCase();
  const text = asText(response.text);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HCRD inventory request failed with HTTP ${response.status}.`);
  }
  if (!contentType.includes("json") && /^\s*</.test(text)) {
    throw new Error("HCRD inventory session is not authenticated; the endpoint returned an HTML login page.");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("HCRD inventory endpoint did not return valid JSON; the browser session may have expired.");
  }
  if (!payload || typeof payload !== "object") throw new Error("HCRD inventory endpoint returned an invalid JSON envelope.");
  return payload;
}

export function normalizeHcrdInventoryRecord(raw, { endpoint, capturedAt }) {
  const sellerSku = asText(raw?.sku);
  const warehouseCode = asText(raw?.warehouseCode);
  const warehouseName = asText(raw?.warehouseName);
  if (!sellerSku) throw new Error("HCRD inventory row is missing sku.");
  if (!warehouseCode && !warehouseName) throw new Error(`HCRD inventory row ${sellerSku} is missing warehouse identity.`);

  const totalStock = asInteger(raw?.qty, { field: "qty" });
  const availableStock = asInteger(raw?.availableQty, { field: "availableQty" });
  const frozenStock = asInteger(raw?.frozenQty, { field: "frozenQty", fallback: 0 });
  const inspectionFrozenStock = asInteger(raw?.checkFrozenQty, { field: "checkFrozenQty", fallback: 0 });
  const warehouse = warehouseName || warehouseCode;
  const sourceText = [
    `HCRD session API ${endpoint}`,
    `SKU ${sellerSku}`,
    `warehouse ${warehouseCode || warehouseName}`,
    `total ${totalStock}`,
    `available ${availableStock}`,
    `frozen ${frozenStock}`,
    `inspectionFrozen ${inspectionFrozenStock}`,
  ].join(" | ");

  return {
    id: `${warehouseCode || warehouseName}:${sellerSku}`,
    sellerSku,
    warehouse,
    warehouseCode: warehouseCode || null,
    warehouseId: firstDefined(raw?.warehouseId, null),
    owner: asText(raw?.customerCode) || null,
    customerId: firstDefined(raw?.customerId, null),
    inventoryRecordId: firstDefined(raw?.id, null),
    barcode: asText(raw?.barcode) || null,
    productId: firstDefined(raw?.productId, null),
    productCname: asText(raw?.productCname) || null,
    productEname: asText(raw?.productEname) || null,
    fieldTitles: Array.isArray(raw?.fieldTitles) ? raw.fieldTitles : [],
    totalStock,
    availableStock,
    lockedStock: frozenStock + inspectionFrozenStock,
    frozenStock,
    inspectionFrozenStock,
    defectiveStock: asInteger(raw?.defectiveQty, { field: "defectiveQty", fallback: 0 }),
    onShelfStock: asInteger(raw?.onShelfQty, { field: "onShelfQty", fallback: 0 }),
    inTransitStock: asInteger(raw?.onloadQty, { field: "onloadQty", fallback: 0 }),
    soldStock: asInteger(raw?.soldQty, { field: "soldQty", fallback: 0 }),
    transferStock: asInteger(raw?.transferQty, { field: "transferQty", fallback: 0 }),
    shortageStock: asInteger(raw?.lackQty, { field: "lackQty", fallback: 0 }),
    maxInventoryAge: asInteger(raw?.maxInventoryAge, { field: "maxInventoryAge", fallback: 0 }),
    earliestOnShelfTime: asText(raw?.earliestOnShelfTime) || null,
    evidence: [{ sourceText, sourceUrl: endpoint, capturedAt }],
  };
}

export async function requestHcrdInventoryPage(page, { endpoint, pageNumber, pageSize }) {
  if (!page?.evaluate) throw new Error("HCRD session inventory requires a browser page.");
  return page.evaluate(
    async ({ url, requestBody }) => {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include",
        redirect: "follow",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/json;charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: JSON.stringify(requestBody),
      });
      return {
        status: response.status,
        url: response.url,
        redirected: response.redirected,
        contentType: response.headers.get("content-type") || "",
        text: await response.text(),
      };
    },
    {
      url: endpoint,
      requestBody: { page: pageNumber, rows: pageSize },
    },
  );
}

export async function readHcrdInventoryViaSession({
  page,
  endpoint,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  warehouse,
  artifactStore,
  now = () => new Date(),
}) {
  const size = asInteger(pageSize, { field: "pageSize" });
  const limit = asInteger(maxPages, { field: "maxPages" });
  if (size < 1 || size > 2_000) throw new Error("HCRD inventory pageSize must be between 1 and 2000.");
  if (limit < 1 || limit > 1_000) throw new Error("HCRD inventory maxPages must be between 1 and 1000.");

  const capturedAt = now().toISOString();
  const rawRows = [];
  const seenPageSignatures = new Set();
  let sourceTotalCount = null;
  let reportedTotalPages = null;
  let pageNumber = 1;
  let paginationComplete = false;

  while (pageNumber <= limit) {
    const response = await requestHcrdInventoryPage(page, { endpoint, pageNumber, pageSize: size });
    const payload = parseHcrdInventoryResponse(response);
    const rows = rowsFromPayload(payload);
    const reportedTotal = numberFromPayload(payload, [["total"], ["data", "total"], ["result", "total"], ["count"]]);
    const totalPages = numberFromPayload(payload, [["totalPage"], ["data", "totalPage"], ["result", "totalPage"]]);
    if (reportedTotal !== null) sourceTotalCount = reportedTotal;
    if (totalPages !== null) reportedTotalPages = totalPages;

    const signature = pageSignature(rows);
    if (seenPageSignatures.has(signature) && rows.length > 0) {
      throw new Error(`HCRD inventory pagination repeated page data at page ${pageNumber}.`);
    }
    seenPageSignatures.add(signature);
    rawRows.push(...rows);

    await artifactStore?.writeJson(`extraction/hcrd-api-page-${pageNumber}.json`, {
      endpoint,
      page: pageNumber,
      requestedRows: size,
      receivedRows: rows.length,
      reportedTotal,
      reportedTotalPages: totalPages,
    }).catch(() => {});

    const reachedTotal = sourceTotalCount !== null && rawRows.length >= sourceTotalCount;
    const reachedReportedLastPage =
      sourceTotalCount === null && reportedTotalPages !== null && pageNumber >= reportedTotalPages;
    const shortPageWithoutTotals =
      sourceTotalCount === null && reportedTotalPages === null && rows.length < size;
    if (reachedTotal || reachedReportedLastPage || rows.length === 0 || shortPageWithoutTotals) {
      paginationComplete = true;
      break;
    }
    pageNumber += 1;
  }

  if (!paginationComplete) {
    const expected = sourceTotalCount === null ? "an unknown total" : sourceTotalCount;
    throw new Error(`HCRD inventory exceeded maxPages=${limit}; captured ${rawRows.length} of ${expected}.`);
  }

  const normalized = rawRows.map((row) => normalizeHcrdInventoryRecord(row, { endpoint, capturedAt }));
  const ids = new Set();
  for (const record of normalized) {
    if (ids.has(record.id)) throw new Error(`HCRD inventory returned duplicate warehouse/SKU row ${record.id}.`);
    ids.add(record.id);
  }

  const warehouseFilter = asText(warehouse).toLowerCase();
  const filterEnabled = warehouseFilter && !["*", "all", "全部"].includes(warehouseFilter);
  const records = filterEnabled
    ? normalized.filter((record) =>
        [record.warehouse, record.warehouseCode].filter(Boolean).some((value) => asText(value).toLowerCase() === warehouseFilter),
      )
    : normalized;
  const warnings = [];
  if (sourceTotalCount === null) warnings.push("HCRD response did not report total; completeness was inferred from pagination.");
  if (sourceTotalCount !== null && rawRows.length !== sourceTotalCount) {
    warnings.push(`HCRD reported ${sourceTotalCount} rows but ${rawRows.length} rows were captured.`);
  }
  if (filterEnabled && records.length === 0) warnings.push(`No HCRD records matched warehouse filter ${warehouse}.`);

  return {
    records,
    summary: {
      recordsValid:
        records.length > 0 &&
        (sourceTotalCount === null || rawRows.length === sourceTotalCount) &&
        (!filterEnabled || records.length > 0),
      visibleCount: records.length,
      capturedCount: records.length,
      sourceTotalCount: sourceTotalCount ?? rawRows.length,
      sourceCapturedCount: rawRows.length,
      pageSize: size,
      pagesCaptured: seenPageSignatures.size,
      source: "hcrd_session_api",
      warnings,
    },
  };
}

export function compareHcrdVisualAudit(records, audit) {
  const bySku = new Map(records.map((record) => [record.sellerSku, record]));
  const checks = [];
  for (const visible of audit?.rows || []) {
    const record = bySku.get(asText(visible?.sellerSku));
    checks.push({
      sellerSku: asText(visible?.sellerSku),
      foundInApi: Boolean(record),
      inventoryAgeMatches: Boolean(record) && Number(visible?.maxInventoryAge) === record.maxInventoryAge,
      usableMatches: Boolean(record) && Number(visible?.usableStock) === record.totalStock,
      sellableMatches: Boolean(record) && Number(visible?.sellableStock) === record.availableStock,
    });
  }
  const matched = checks.filter((check) => check.foundInApi);
  return {
    pageKind: audit?.pageKind || "unknown",
    modelRows: audit?.rows || [],
    checks,
    ok:
      audit?.pageKind === "inventory_list" &&
      matched.length > 0 &&
      matched.every((check) => check.inventoryAgeMatches && check.usableMatches && check.sellableMatches),
    warnings: audit?.warnings || [],
  };
}
