const DEFAULT_API_PATH = "/api/v1/product/stock/sku/list";
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 100;
const CAPTURE_KEY = "__TK_SAAS_TIKTOK_INVENTORY_CAPTURES__";

function asInteger(value, { field, fallback = null } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`TikTok inventory field ${field || "value"} must be a non-negative integer; received ${value}.`);
  }
  return parsed;
}

function asText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function sourceEndpoint(value) {
  const endpoint = new URL(value);
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString();
}

export function parseTikTokInventoryResponse(response) {
  if (!response || typeof response !== "object") throw new Error("TikTok inventory request returned no response metadata.");
  const contentType = asText(response.contentType).toLowerCase();
  const text = asText(response.text);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`TikTok inventory request failed with HTTP ${response.status}.`);
  }
  if (!contentType.includes("json") && /^\s*</.test(text)) {
    throw new Error("TikTok inventory session is not authenticated; the endpoint returned HTML.");
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("TikTok inventory endpoint did not return valid JSON; the browser session may have expired.");
  }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.skus)) {
    throw new Error("TikTok inventory endpoint response is missing $.skus.");
  }
  return payload;
}

export function normalizeTikTokInventoryRecord(raw, { endpoint, capturedAt }) {
  const skuId = asText(raw?.sku_id);
  if (!skuId) throw new Error("TikTok inventory row is missing sku_id.");
  const totalStock = asInteger(raw?.warehouse_total_quantity, { field: "warehouse_total_quantity" });
  const availableStock = asInteger(raw?.open_quantity, { field: "open_quantity" });
  if (availableStock > totalStock) {
    throw new Error(`TikTok inventory row ${skuId} has open_quantity greater than warehouse_total_quantity.`);
  }
  const sellerSku = asText(raw?.seller_sku) || null;
  const warehouseStockList = Array.isArray(raw?.warehouse_stock_list)
    ? raw.warehouse_stock_list.map((warehouse) => ({
        warehouseId: asText(warehouse?.warehouse_id) || null,
        warehouseName: asText(warehouse?.warehouse_name) || null,
        inShopStock: asInteger(warehouse?.in_shop_stock, { field: "warehouse_stock_list.in_shop_stock", fallback: 0 }),
        totalQuantity: asInteger(warehouse?.total_quantity, { field: "warehouse_stock_list.total_quantity", fallback: 0 }),
        stockEditProhibited: Boolean(warehouse?.is_stock_edit_prohibited),
        stockSaleType: asInteger(warehouse?.stock_sale_type, { field: "warehouse_stock_list.stock_sale_type", fallback: 0 }),
      }))
    : [];
  const cleanEndpoint = sourceEndpoint(endpoint);
  const sourceText = [
    `TikTok session API ${cleanEndpoint}`,
    `SKU ID ${skuId}`,
    sellerSku ? `seller SKU ${sellerSku}` : "seller SKU empty",
    `total ${totalStock}`,
    `available ${availableStock}`,
    `locked ${totalStock - availableStock}`,
  ].join(" | ");

  return {
    id: skuId,
    skuId,
    sellerSku,
    productId: asText(raw?.product_id) || null,
    productTitle: asText(raw?.product_title) || null,
    variation: asText(raw?.sku_name ?? raw?.variation_name ?? raw?.sku_desc) || null,
    totalStock,
    availableStock,
    platformAvailableStock: availableStock,
    lockedStock: totalStock - availableStock,
    sales30d: asText(raw?.sku_sales) || null,
    forecast30d: asText(raw?.sku_forecast_sales) || null,
    recommendedRestock30d: asText(raw?.sku_replenishment_quantity) || null,
    supplyDays: asText(raw?.sku_stock_days_left) || null,
    campaignStock: asInteger(raw?.campaign_quantity, { field: "campaign_quantity", fallback: 0 }),
    creatorStock: asInteger(raw?.creator_quantity, { field: "creator_quantity", fallback: 0 }),
    withholdingStock: asInteger(raw?.withholding_quantity, { field: "withholding_quantity", fallback: 0 }),
    stockModelType: asInteger(raw?.stock_model_type, { field: "stock_model_type", fallback: 0 }),
    skuComboType: asInteger(raw?.sku_combo_type, { field: "sku_combo_type", fallback: 0 }),
    warehouseStockList,
    evidence: [{ sourceText, sourceUrl: cleanEndpoint, capturedAt }],
  };
}

function pageSignature(rows) {
  if (!rows.length) return "empty";
  return `${rows.length}:${asText(rows[0]?.sku_id)}:${asText(rows.at(-1)?.sku_id)}`;
}

function installInventoryCapture({ key, apiPath }) {
  const matches = (value) => {
    try {
      return new URL(String(value), location.href).pathname === apiPath;
    } catch {
      return false;
    }
  };
  const captures = [];
  Object.defineProperty(globalThis, key, { configurable: true, value: captures });
  const push = (capture) => captures.push({ capturedAt: new Date().toISOString(), ...capture });

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = async function tkSaasInventoryFetch(input, init) {
      const response = await originalFetch.apply(this, arguments);
      const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      if (matches(url)) {
        const clone = response.clone();
        void clone.text().then((text) => push({
          transport: "fetch",
          url: clone.url || new URL(String(url), location.href).toString(),
          status: clone.status,
          contentType: clone.headers.get("content-type") || "",
          requestBody: typeof init?.body === "string" ? init.body : null,
          text,
        })).catch(() => {});
      }
      return response;
    };
  }

  const xhrPrototype = globalThis.XMLHttpRequest?.prototype;
  if (xhrPrototype) {
    const originalOpen = xhrPrototype.open;
    const originalSend = xhrPrototype.send;
    xhrPrototype.open = function tkSaasInventoryOpen(method, url) {
      this.__tkSaasInventoryRequest = { method: String(method || "GET"), url: new URL(String(url), location.href).toString() };
      return originalOpen.apply(this, arguments);
    };
    xhrPrototype.send = function tkSaasInventorySend(body) {
      const request = this.__tkSaasInventoryRequest;
      if (request && matches(request.url)) {
        this.addEventListener("load", () => push({
          transport: "xhr",
          url: this.responseURL || request.url,
          status: this.status,
          contentType: this.getResponseHeader("content-type") || "",
          requestBody: typeof body === "string" ? body : null,
          text: typeof this.responseText === "string" ? this.responseText : "",
        }), { once: true });
      }
      return originalSend.apply(this, arguments);
    };
  }
}

async function readCapturedResponses(page) {
  return page.evaluate(({ key }) => Array.isArray(globalThis[key]) ? globalThis[key] : [], { key: CAPTURE_KEY });
}

async function waitForUniqueCapture(page, { cursor, seenSignatures, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  let nextCursor = cursor;
  let lastError;
  while (Date.now() < deadline) {
    const captures = await readCapturedResponses(page);
    while (nextCursor < captures.length) {
      const response = captures[nextCursor];
      nextCursor += 1;
      try {
        const payload = parseTikTokInventoryResponse(response);
        const signature = pageSignature(payload.skus);
        if (seenSignatures.has(signature)) continue;
        seenSignatures.add(signature);
        return { response, payload, cursor: nextCursor };
      } catch (error) {
        lastError = error;
      }
    }
    await page.waitForTimeout(250);
  }
  const detail = lastError instanceof Error ? ` Last response error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for a new TikTok inventory API page.${detail}`);
}

async function clickInventoryPage(page, pageNumber) {
  const clicked = await page.evaluate(({ requestedPage }) => {
    const items = [...document.querySelectorAll(".core-pagination li")];
    const item = items.find((element) => String(element.textContent || "").trim() === String(requestedPage));
    if (!item) return false;
    item.click();
    return true;
  }, { requestedPage: pageNumber });
  if (!clicked) throw new Error(`TikTok inventory pagination control for page ${pageNumber} was not found.`);
}

export async function readTikTokInventoryViaSession({
  page,
  apiPath = DEFAULT_API_PATH,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES,
  artifactStore,
  timeoutMs = 30_000,
  now = () => new Date(),
}) {
  if (!page?.addInitScript || !page?.reload || !page?.evaluate || !page?.waitForTimeout) {
    throw new Error("TikTok session inventory requires a Stagehand browser page.");
  }
  const size = asInteger(pageSize, { field: "pageSize" });
  const limit = asInteger(maxPages, { field: "maxPages" });
  if (size < 1 || size > 200) throw new Error("TikTok inventory pageSize must be between 1 and 200.");
  if (limit < 1 || limit > 1_000) throw new Error("TikTok inventory maxPages must be between 1 and 1000.");

  const capturedAt = now().toISOString();
  const rawRows = [];
  const seenSignatures = new Set();
  let sourceTotalCount = null;
  let endpoint = null;
  let pageNumber = 1;
  let paginationComplete = false;
  let captureCursor = 0;

  await page.addInitScript(installInventoryCapture, { key: CAPTURE_KEY, apiPath });
  await page.reload({ waitUntil: "domcontentloaded", timeoutMs: 30_000 }).catch((error) => {
    if (!/timeout/i.test(error instanceof Error ? error.message : String(error))) throw error;
  });

  while (pageNumber <= limit) {
    if (pageNumber > 1) await clickInventoryPage(page, pageNumber);
    const captured = await waitForUniqueCapture(page, {
      cursor: captureCursor,
      seenSignatures,
      timeoutMs,
    });
    captureCursor = captured.cursor;
    const { response, payload } = captured;
    const rows = payload.skus;
    const total = asInteger(payload.total_sku_count, { field: "total_sku_count", fallback: null });
    if (total !== null) sourceTotalCount = total;
    endpoint = sourceEndpoint(response.url);
    rawRows.push(...rows);

    await artifactStore?.writeJson(`extraction/tiktok-api-page-${pageNumber}.json`, {
      endpoint: sourceEndpoint(response.url),
      page: pageNumber,
      requestBody: response.requestBody,
      receivedRows: rows.length,
      reportedTotal: total,
    }).catch(() => {});

    const reachedTotal = sourceTotalCount !== null && rawRows.length >= sourceTotalCount;
    const shortPageWithoutTotal = sourceTotalCount === null && rows.length < size;
    if (reachedTotal || rows.length === 0 || shortPageWithoutTotal) {
      paginationComplete = true;
      break;
    }
    pageNumber += 1;
  }

  if (!paginationComplete) {
    const expected = sourceTotalCount === null ? "an unknown total" : sourceTotalCount;
    throw new Error(`TikTok inventory exceeded maxPages=${limit}; captured ${rawRows.length} of ${expected}.`);
  }
  const records = rawRows.map((row) => normalizeTikTokInventoryRecord(row, { endpoint, capturedAt }));
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new Error(`TikTok inventory returned duplicate SKU ID ${record.id}.`);
    ids.add(record.id);
  }
  const warnings = [];
  if (sourceTotalCount === null) warnings.push("TikTok response did not report total_sku_count; completeness was inferred from pagination.");
  if (sourceTotalCount !== null && records.length !== sourceTotalCount) {
    warnings.push(`TikTok reported ${sourceTotalCount} SKUs but ${records.length} were captured.`);
  }

  return {
    records,
    summary: {
      recordsValid: records.length > 0 && (sourceTotalCount === null || records.length === sourceTotalCount),
      visibleCount: records.length,
      capturedCount: records.length,
      sourceTotalCount: sourceTotalCount ?? records.length,
      sourceCapturedCount: records.length,
      pageSize: size,
      pagesCaptured: seenSignatures.size,
      source: "tiktok_session_api",
      warnings,
    },
  };
}

export function compareTikTokVisualAudit(records, audit) {
  const bySku = new Map(records.map((record) => [record.skuId, record]));
  const checks = (audit?.rows || []).map((visible) => {
    const skuId = asText(visible?.skuId);
    const record = bySku.get(skuId);
    return {
      skuId,
      foundInApi: Boolean(record),
      totalMatches: Boolean(record) && Number(visible?.totalStock) === record.totalStock,
      availableMatches: Boolean(record) && Number(visible?.availableStock) === record.availableStock,
      lockedMatches: Boolean(record) && Number(visible?.lockedStock) === record.lockedStock,
    };
  });
  const matched = checks.filter((check) => check.foundInApi);
  return {
    pageKind: audit?.pageKind || "unknown",
    modelRows: audit?.rows || [],
    checks,
    ok:
      audit?.pageKind === "inventory_list"
      && matched.length > 0
      && matched.every((check) => check.totalMatches && check.availableMatches && check.lockedMatches),
    warnings: audit?.warnings || [],
  };
}
