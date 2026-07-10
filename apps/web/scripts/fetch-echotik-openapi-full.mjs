#!/usr/bin/env node

import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT_DIR = path.resolve(import.meta.dirname, "../../..");
const WEB_DIR = path.resolve(import.meta.dirname, "..");
const ENV_PATH = path.join(WEB_DIR, ".env");
const DEFAULT_EXISTING_PATH = path.join(WEB_DIR, "output/creator-backups/latest.json");
const API_BASE = "https://open.echotik.live/api/v3/echotik";
const DEFAULT_KEYWORDS = [
  "drawstring ponytail",
  "half wig",
  "wig",
  "crochet hair",
  "braids",
  "black girl",
];

class ApiStopError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ApiStopError";
    this.details = details;
  }
}

const state = {
  startedAt: new Date().toISOString(),
  endedAt: null,
  calls: 0,
  successes: 0,
  failures: 0,
  stopReason: null,
  discoveredMaxPageSize: null,
  discoveredMaxDetailBatchSize: null,
  files: {},
  endpointStats: {},
  errors: [],
};

function parseArgs(argv) {
  const args = {
    existingPath: DEFAULT_EXISTING_PATH,
    outputDir: "",
    includeAllList: true,
    keywords: DEFAULT_KEYWORDS,
    region: "US",
    minFollowers: 1000,
    salesFlag: 1,
    pageSizes: [10],
    detailBatchSizes: [100, 50, 20, 10, 5, 1],
    delayMs: 250,
    maxPagesPerQuery: 0,
    maxVideoCreators: 0,
    maxVideoPages: 0,
    videoPageSize: 0,
    listPageSize: 0,
    detailBatchSize: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key.startsWith("--")) continue;

    if (key === "--no-include-all-list") {
      args.includeAllList = false;
      continue;
    }

    if (next == null || next.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }

    i += 1;
    if (key === "--existing-path") args.existingPath = path.resolve(ROOT_DIR, next);
    else if (key === "--output-dir") args.outputDir = path.resolve(ROOT_DIR, next);
    else if (key === "--keywords") args.keywords = next.split(",").map((item) => item.trim()).filter(Boolean);
    else if (key === "--region") args.region = next;
    else if (key === "--min-followers") args.minFollowers = Number(next);
    else if (key === "--sales-flag") args.salesFlag = Number(next);
    else if (key === "--page-sizes") args.pageSizes = parseNumberList(next);
    else if (key === "--detail-batch-sizes") args.detailBatchSizes = parseNumberList(next);
    else if (key === "--delay-ms") args.delayMs = Number(next);
    else if (key === "--max-pages-per-query") args.maxPagesPerQuery = Number(next);
    else if (key === "--max-video-creators") args.maxVideoCreators = Number(next);
    else if (key === "--max-video-pages") args.maxVideoPages = Number(next);
    else if (key === "--video-page-size") args.videoPageSize = Number(next);
    else if (key === "--list-page-size") args.listPageSize = Number(next);
    else if (key === "--detail-batch-size") args.detailBatchSize = Number(next);
    else throw new Error(`Unknown option ${key}`);
  }

  return args;
}

function parseNumberList(value) {
  return value
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0);
}

async function readEnv() {
  const env = { ...process.env };
  let content = "";
  try {
    content = await readFile(ENV_PATH, "utf8");
  } catch {
    return env;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex < 0) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function makeAuthHeader(env) {
  const username = env.VITE_ECHOTIK_USERNAME || env.ECHOTIK_USERNAME;
  const password = env.VITE_ECHOTIK_PASSWORD || env.ECHOTIK_PASSWORD;
  if (!username || !password) {
    throw new Error(`EchoTik Open API credentials missing in ${ENV_PATH}`);
  }
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function delay(ms) {
  if (!ms) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getByPath(obj, paths) {
  for (const itemPath of paths) {
    const value = itemPath.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function extractList(payload) {
  const list = getByPath(payload, [
    "data.list",
    "data.influencers",
    "data.records",
    "data.items",
    "data.data",
    "list",
    "influencers",
    "records",
    "items",
  ]);
  if (Array.isArray(list)) return list;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function extractTotal(payload) {
  const total = getByPath(payload, [
    "data.total",
    "data.total_count",
    "data.totalCount",
    "data.count",
    "total",
    "total_count",
    "totalCount",
    "count",
  ]);
  const numeric = Number(total);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractCreatorId(item) {
  const id = getByPath(item, [
    "user_id",
    "userId",
    "influencer_id",
    "influencerId",
    "author_id",
    "authorId",
    "id",
  ]);
  if (id == null) return "";
  return String(id);
}

function extractExistingRawId(creator) {
  const rawId = creator.rawId || creator.userId || creator.user_id || creator.influencer_id;
  if (rawId) return String(rawId);
  const id = String(creator.id || "");
  return id.startsWith("echotik-") ? id.slice("echotik-".length) : "";
}

function extractExistingCreators(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.creators)) return payload.creators;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  throw new Error("Existing creator file does not contain an array or a creators[] field");
}

async function callOpenApi(endpoint, params, authHeader, rawLogPath) {
  const url = new URL(`${API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  state.calls += 1;
  state.endpointStats[endpoint] ||= { calls: 0, successes: 0, failures: 0 };
  state.endpointStats[endpoint].calls += 1;

  const startedAt = new Date().toISOString();
  let status = 0;
  let bodyText = "";
  let payload = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    status = response.status;
    bodyText = await response.text();
    try {
      payload = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      payload = { rawText: bodyText };
    }

    await appendFile(
      rawLogPath,
      `${JSON.stringify({
        ts: startedAt,
        endpoint,
        params,
        status,
        payload,
      })}\n`,
    );

    const apiCode = payload?.code;
    const isApiSuccess = apiCode === undefined || apiCode === 0 || apiCode === "0";
    if (!response.ok || !isApiSuccess) {
      state.failures += 1;
      state.endpointStats[endpoint].failures += 1;
      throw new ApiStopError(buildApiErrorMessage(endpoint, status, payload), {
        endpoint,
        params,
        status,
        payload,
        isQuota: isQuotaLike(status, payload),
      });
    }

    state.successes += 1;
    state.endpointStats[endpoint].successes += 1;
    return payload;
  } catch (error) {
    if (error instanceof ApiStopError) throw error;
    state.failures += 1;
    state.endpointStats[endpoint].failures += 1;
    const wrapped = new ApiStopError(`${endpoint} request failed: ${error.message}`, {
      endpoint,
      params,
      status,
      payload,
      isQuota: false,
    });
    state.errors.push(summarizeError(wrapped));
    throw wrapped;
  }
}

function buildApiErrorMessage(endpoint, status, payload) {
  const message =
    payload?.msg ||
    payload?.message ||
    payload?.error ||
    payload?.data?.message ||
    payload?.rawText ||
    "unknown API error";
  return `${endpoint} HTTP ${status}: ${message}`;
}

function isQuotaLike(status, payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  return (
    status === 402 ||
    status === 403 ||
    status === 429 ||
    /quota|credit|limit|exceed|usage|次数|额度|不足|频率|过多|上限/.test(text)
  );
}

function summarizeError(error) {
  return {
    message: error.message,
    endpoint: error.details?.endpoint,
    params: error.details?.params,
    status: error.details?.status,
    isQuota: Boolean(error.details?.isQuota),
  };
}

async function probePageSize(authHeader, args, files) {
  if (args.listPageSize > 0) return args.listPageSize;

  for (const pageSize of args.pageSizes) {
    try {
      const payload = await callOpenApi(
        "/influencer/list",
        {
          region: args.region,
          page_num: 1,
          page_size: pageSize,
          sales_flag: args.salesFlag,
          min_total_followers_cnt: args.minFollowers,
        },
        authHeader,
        files.probeRaw,
      );
      const list = extractList(payload);
      await appendFile(
        files.progress,
        `${new Date().toISOString()} page_size_probe ok size=${pageSize} rows=${list.length}\n`,
      );
      return pageSize;
    } catch (error) {
      state.errors.push(summarizeError(error));
      await appendFile(
        files.progress,
        `${new Date().toISOString()} page_size_probe fail size=${pageSize} ${error.message}\n`,
      );
      if (error.details?.isQuota) throw error;
    }
  }

  throw new Error(`No usable page_size found from ${args.pageSizes.join(",")}`);
}

async function probeDetailBatchSize(authHeader, args, files, existingRawIds) {
  if (args.detailBatchSize > 0) return args.detailBatchSize;
  const ids = existingRawIds.filter(Boolean);
  if (!ids.length) return 1;

  for (const batchSize of args.detailBatchSizes) {
    const chunk = ids.slice(0, batchSize);
    try {
      const payload = await callOpenApi(
        "/influencer/detail",
        { user_ids: chunk.join(",") },
        authHeader,
        files.probeRaw,
      );
      const list = extractList(payload);
      const rows = list.length || (payload?.data ? 1 : 0);
      await appendFile(
        files.progress,
        `${new Date().toISOString()} detail_batch_probe ok size=${batchSize} rows=${rows}\n`,
      );
      return batchSize;
    } catch (error) {
      state.errors.push(summarizeError(error));
      await appendFile(
        files.progress,
        `${new Date().toISOString()} detail_batch_probe fail size=${batchSize} ${error.message}\n`,
      );
      if (error.details?.isQuota) throw error;
    }
  }

  throw new Error(`No usable detail batch size found from ${args.detailBatchSizes.join(",")}`);
}

async function fetchListQueries(authHeader, args, files, pageSize, resultStore) {
  const queries = [];
  if (args.includeAllList) queries.push({ label: "all", keyword: "" });
  for (const keyword of args.keywords) queries.push({ label: keyword, keyword });

  for (const query of queries) {
    let pageNum = 1;
    let total = null;
    while (true) {
      if (args.maxPagesPerQuery > 0 && pageNum > args.maxPagesPerQuery) break;
      const params = {
        region: args.region,
        page_num: pageNum,
        page_size: pageSize,
        sales_flag: args.salesFlag,
        min_total_followers_cnt: args.minFollowers,
        keyword: query.keyword,
      };
      let payload;
      try {
        payload = await callOpenApi("/influencer/list", params, authHeader, files.listRaw);
      } catch (error) {
        state.errors.push(summarizeError(error));
        throw error;
      }

      const list = extractList(payload);
      total = extractTotal(payload) ?? total;
      for (const item of list) {
        const id = extractCreatorId(item);
        if (id) {
          const current = resultStore.listItemsById.get(id) || {};
          resultStore.listItemsById.set(id, {
            ...current,
            ...item,
            __queryLabels: Array.from(new Set([...(current.__queryLabels || []), query.label])),
          });
        }
      }

      await appendFile(
        files.progress,
        `${new Date().toISOString()} list query="${query.label}" page=${pageNum} rows=${list.length} unique=${resultStore.listItemsById.size} total=${total ?? ""}\n`,
      );

      if (!list.length) break;
      if (total != null && pageNum * pageSize >= total) break;
      pageNum += 1;
      await delay(args.delayMs);
    }
  }
}

async function fetchDetails(authHeader, files, rawIds, batchSize, delayMs, resultStore) {
  const ids = Array.from(new Set(rawIds.filter(Boolean)));
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize);
    let payload;
    try {
      payload = await callOpenApi(
        "/influencer/detail",
        { user_ids: chunk.join(",") },
        authHeader,
        files.detailRaw,
      );
    } catch (error) {
      state.errors.push(summarizeError(error));
      throw error;
    }

    const list = extractList(payload);
    if (list.length) {
      for (const item of list) {
        const id = extractCreatorId(item);
        if (id) resultStore.detailItemsById.set(id, item);
      }
    } else if (payload?.data && typeof payload.data === "object") {
      const id = extractCreatorId(payload.data);
      if (id) resultStore.detailItemsById.set(id, payload.data);
    }

    await appendFile(
      files.progress,
      `${new Date().toISOString()} detail batch=${Math.floor(i / batchSize) + 1}/${Math.ceil(ids.length / batchSize)} ids=${chunk.length} unique=${resultStore.detailItemsById.size}\n`,
    );
    await delay(delayMs);
  }
}

async function fetchVideos(authHeader, args, files, rawIds, pageSize, resultStore) {
  const ids = Array.from(new Set(rawIds.filter(Boolean)));
  const limitedIds = args.maxVideoCreators > 0 ? ids.slice(0, args.maxVideoCreators) : ids;
  const videoPageSize = args.videoPageSize > 0 ? args.videoPageSize : pageSize;

  for (let index = 0; index < limitedIds.length; index += 1) {
    const userId = limitedIds[index];
    let pageNum = 1;
    let total = null;
    while (true) {
      if (args.maxVideoPages > 0 && pageNum > args.maxVideoPages) break;
      const params = {
        user_id: userId,
        page_num: pageNum,
        page_size: videoPageSize,
      };
      let payload;
      try {
        payload = await callOpenApi("/influencer/video/list", params, authHeader, files.videoRaw);
      } catch (error) {
        state.errors.push(summarizeError(error));
        throw error;
      }

      const list = extractList(payload);
      total = extractTotal(payload) ?? total;
      const current = resultStore.videoItemsById.get(userId) || [];
      current.push(...list);
      resultStore.videoItemsById.set(userId, current);

      await appendFile(
        files.progress,
        `${new Date().toISOString()} video user=${index + 1}/${limitedIds.length} id=${userId} page=${pageNum} rows=${list.length} total=${total ?? ""}\n`,
      );

      if (!list.length) break;
      if (total != null && pageNum * videoPageSize >= total) break;
      pageNum += 1;
      await delay(args.delayMs);
    }
    await delay(args.delayMs);
  }
}

function collectKeys(value, prefix, keySet) {
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) collectKeys(item, prefix, keySet);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    keySet.add(nextPrefix);
    collectKeys(child, nextPrefix, keySet);
  }
}

function buildFieldInventory(resultStore) {
  const listKeys = new Set();
  const detailKeys = new Set();
  const videoKeys = new Set();

  for (const item of resultStore.listItemsById.values()) collectKeys(item, "", listKeys);
  for (const item of resultStore.detailItemsById.values()) collectKeys(item, "", detailKeys);
  for (const items of resultStore.videoItemsById.values()) collectKeys(items, "", videoKeys);

  return {
    list: Array.from(listKeys).sort(),
    detail: Array.from(detailKeys).sort(),
    video: Array.from(videoKeys).sort(),
  };
}

function mergeRecords(existingCreators, resultStore) {
  const mergedById = new Map();

  for (const creator of existingCreators) {
    const rawId = extractExistingRawId(creator);
    mergedById.set(rawId || creator.id, {
      existingCreator: creator,
      openapiList: rawId ? resultStore.listItemsById.get(rawId) || null : null,
      openapiDetail: rawId ? resultStore.detailItemsById.get(rawId) || null : null,
      openapiVideos: rawId ? resultStore.videoItemsById.get(rawId) || [] : [],
    });
  }

  for (const [id, item] of resultStore.listItemsById.entries()) {
    if (!mergedById.has(id)) {
      mergedById.set(id, {
        existingCreator: null,
        openapiList: item,
        openapiDetail: resultStore.detailItemsById.get(id) || null,
        openapiVideos: resultStore.videoItemsById.get(id) || [],
      });
    }
  }

  for (const [id, item] of resultStore.detailItemsById.entries()) {
    if (!mergedById.has(id)) {
      mergedById.set(id, {
        existingCreator: null,
        openapiList: resultStore.listItemsById.get(id) || null,
        openapiDetail: item,
        openapiVideos: resultStore.videoItemsById.get(id) || [],
      });
    }
  }

  return Array.from(mergedById.entries()).map(([id, record]) => ({ rawId: id, ...record }));
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir =
    args.outputDir || path.join(WEB_DIR, "output/echotik-api-runs", timestamp);
  await mkdir(outputDir, { recursive: true });

  const files = {
    outputDir,
    existingSnapshot: path.join(outputDir, "existing-creators-snapshot.json"),
    existingCreatorsOnly: path.join(outputDir, "existing-creators-only.json"),
    probeRaw: path.join(outputDir, "openapi-probe-raw.jsonl"),
    listRaw: path.join(outputDir, "openapi-list-raw.jsonl"),
    detailRaw: path.join(outputDir, "openapi-detail-raw.jsonl"),
    videoRaw: path.join(outputDir, "openapi-video-raw.jsonl"),
    progress: path.join(outputDir, "progress.log"),
    merged: path.join(outputDir, "merged-creators.json"),
    fieldInventory: path.join(outputDir, "field-inventory.json"),
    reportJson: path.join(outputDir, "run-report.json"),
    reportMd: path.join(outputDir, "run-report.md"),
  };
  state.files = files;

  const env = await readEnv();
  const authHeader = makeAuthHeader(env);

  await copyFile(args.existingPath, files.existingSnapshot);
  const existingPayload = JSON.parse(await readFile(args.existingPath, "utf8"));
  const existingCreators = extractExistingCreators(existingPayload);
  await writeJson(files.existingCreatorsOnly, existingCreators);
  const existingRawIds = existingCreators.map(extractExistingRawId).filter(Boolean);

  await appendFile(
    files.progress,
    `${new Date().toISOString()} copied existing creators=${existingCreators.length} rawIds=${existingRawIds.length}\n`,
  );

  const resultStore = {
    listItemsById: new Map(),
    detailItemsById: new Map(),
    videoItemsById: new Map(),
  };

  try {
    const pageSize = await probePageSize(authHeader, args, files);
    state.discoveredMaxPageSize = pageSize;
    const detailBatchSize = await probeDetailBatchSize(authHeader, args, files, existingRawIds);
    state.discoveredMaxDetailBatchSize = detailBatchSize;

    await fetchDetails(authHeader, files, existingRawIds, detailBatchSize, args.delayMs, resultStore);
    await fetchListQueries(authHeader, args, files, pageSize, resultStore);

    const idsForVideos = Array.from(
      new Set([
        ...existingRawIds,
        ...Array.from(resultStore.listItemsById.keys()),
        ...Array.from(resultStore.detailItemsById.keys()),
      ]),
    );
    await fetchVideos(authHeader, args, files, idsForVideos, pageSize, resultStore);

    state.stopReason = "completed_all_available_requests_without_quota_error";
  } catch (error) {
    state.errors.push(summarizeError(error));
    state.stopReason = error.details?.isQuota
      ? `quota_or_rate_limit: ${error.message}`
      : `stopped_on_error: ${error.message}`;
  } finally {
    state.endedAt = new Date().toISOString();
    const merged = mergeRecords(existingCreators, resultStore);
    const fieldInventory = buildFieldInventory(resultStore);

    await writeJson(files.merged, merged);
    await writeJson(files.fieldInventory, fieldInventory);

    const report = {
      ...state,
      args: {
        ...args,
        outputDir,
        credentialsLoaded: true,
      },
      counts: {
        existingCreators: existingCreators.length,
        existingPayloadCount: existingPayload?.count ?? null,
        existingRawIds: existingRawIds.length,
        uniqueListCreators: resultStore.listItemsById.size,
        uniqueDetailCreators: resultStore.detailItemsById.size,
        creatorsWithVideos: resultStore.videoItemsById.size,
        totalVideos: Array.from(resultStore.videoItemsById.values()).reduce(
          (sum, items) => sum + items.length,
          0,
        ),
        mergedRecords: merged.length,
      },
      fieldCounts: {
        list: fieldInventory.list.length,
        detail: fieldInventory.detail.length,
        video: fieldInventory.video.length,
      },
    };

    await writeJson(files.reportJson, report);
    await writeFile(files.reportMd, buildMarkdownReport(report));
    console.log(JSON.stringify(report, null, 2));

    if (state.stopReason?.startsWith("stopped_on_error")) {
      process.exitCode = 1;
    }
  }
}

function buildMarkdownReport(report) {
  return `# EchoTik Open API Full Fetch Report

- Started: ${report.startedAt}
- Ended: ${report.endedAt}
- Stop reason: ${report.stopReason}
- API calls: ${report.calls} (${report.successes} success, ${report.failures} failed)
- Max list page size used: ${report.discoveredMaxPageSize ?? "n/a"}
- Max detail batch size used: ${report.discoveredMaxDetailBatchSize ?? "n/a"}

## Counts

- Existing creators snapshot: ${report.counts.existingCreators}
- Existing creator raw IDs: ${report.counts.existingRawIds}
- Unique list creators: ${report.counts.uniqueListCreators}
- Unique detail creators: ${report.counts.uniqueDetailCreators}
- Creators with videos: ${report.counts.creatorsWithVideos}
- Total videos fetched: ${report.counts.totalVideos}
- Merged records: ${report.counts.mergedRecords}

## Field Inventory

- List fields: ${report.fieldCounts.list}
- Detail fields: ${report.fieldCounts.detail}
- Video fields: ${report.fieldCounts.video}

## Files

- Existing snapshot: ${report.files.existingSnapshot}
- Existing creators only: ${report.files.existingCreatorsOnly}
- Probe raw: ${report.files.probeRaw}
- List raw: ${report.files.listRaw}
- Detail raw: ${report.files.detailRaw}
- Video raw: ${report.files.videoRaw}
- Merged records: ${report.files.merged}
- Field inventory: ${report.files.fieldInventory}
- JSON report: ${report.files.reportJson}
- Progress log: ${report.files.progress}

## Endpoint Stats

\`\`\`json
${JSON.stringify(report.endpointStats, null, 2)}
\`\`\`

## Errors

\`\`\`json
${JSON.stringify(report.errors.slice(-20), null, 2)}
\`\`\`
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
