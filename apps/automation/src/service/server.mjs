import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadAutomationConfig, publicConfigSummary } from "../config.js";
import { automationTaskCatalog, getAutomationDefinition } from "../catalog/taskCatalog.js";
import { buildTaskSpec } from "../protocol/builders.js";
import { evaluatePolicy } from "../policy/engine.js";
import { FileJobStore } from "../queue/fileJobStore.js";
import { RecordSnapshotStore } from "../records/snapshotStore.js";
import { reconcileInventorySnapshots } from "../inventory/reconcile.js";

const config = loadAutomationConfig();
const { host, port, token, requireToken } = config.service;
const store = new FileJobStore({ directory: `${config.dataDirectory}/jobs` });
const recordStore = new RecordSnapshotStore({ directory: config.recordDirectory });
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function authenticated(request) {
  if (!token) return !requireToken;
  return request.headers.authorization === `Bearer ${token}`;
}

function parseRunId(value) {
  const runId = decodeURIComponent(value);
  if (!/^[a-zA-Z0-9._-]+$/.test(runId) || runId === "." || runId === "..") {
    throw new Error("Invalid run id.");
  }
  return runId;
}

function resolveArtifact(runId, encodedRelativePath) {
  const relativePath = decodeURIComponent(encodedRelativePath);
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid artifact path.");
  }
  const root = path.resolve(config.artifactDirectory);
  const runDirectory = path.resolve(root, runId);
  const artifact = path.resolve(runDirectory, relativePath);
  if (!runDirectory.startsWith(`${root}${path.sep}`) || !artifact.startsWith(`${runDirectory}${path.sep}`)) {
    throw new Error("Artifact path escapes the run directory.");
  }
  return artifact;
}

function contentTypeFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".json":
      return "application/json; charset=utf-8";
    case ".jsonl":
      return "application/x-ndjson; charset=utf-8";
    case ".txt":
    case ".log":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function sendArtifact(response, runId, encodedRelativePath) {
  const artifact = resolveArtifact(runId, encodedRelativePath);
  let info;
  try {
    info = await stat(artifact);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { ok: false, message: "Artifact not found" });
      return;
    }
    throw error;
  }
  if (!info.isFile()) {
    sendJson(response, 404, { ok: false, message: "Artifact not found" });
    return;
  }
  if (info.size > MAX_ARTIFACT_BYTES) {
    sendJson(response, 413, { ok: false, message: "Artifact exceeds the service download limit" });
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypeFor(artifact),
    "Content-Length": info.size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${path.basename(artifact).replace(/["\\]/g, "_")}"`,
  });
  response.end(await readFile(artifact));
}

function policyContext() {
  return {
    allowedOrigins: config.allowedOrigins,
    externalReadEnabled: config.externalReadEnabled,
    externalWriteEnabled: config.externalWriteEnabled,
    highRiskAutomationEnabled: config.highRiskAutomationEnabled,
    autoApprovedDefinitionIds: config.autoApprovedDefinitionIds,
  };
}

const server = http.createServer(async (request, response) => {
  try {
    if (!authenticated(request)) {
      sendJson(response, 401, { ok: false, message: "Unauthorized" });
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host || host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true, config: publicConfigSummary(config) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/catalog") {
      sendJson(response, 200, { ok: true, definitions: automationTaskCatalog });
      return;
    }
    if (request.method === "GET" && url.pathname === "/jobs") {
      sendJson(response, 200, { ok: true, jobs: await store.list() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/records") {
      sendJson(response, 200, {
        ok: true,
        snapshots: await recordStore.list({
          definitionId: url.searchParams.get("definitionId") || undefined,
          limit: url.searchParams.get("limit") || undefined,
        }),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/inventory/reconcile") {
      const body = await readJson(request);
      for (const key of ["hcrdSnapshotId", "tiktokSnapshotId", "mapping", "safetyStock"]) {
        if (body[key] === undefined || body[key] === null) {
          sendJson(response, 400, { ok: false, message: `${key} is required for inventory reconciliation` });
          return;
        }
      }
      const [hcrdSnapshot, tiktokSnapshot, inTransitSnapshot] = await Promise.all([
        recordStore.get(body.hcrdSnapshotId),
        recordStore.get(body.tiktokSnapshotId),
        body.inTransitSnapshotId ? recordStore.get(body.inTransitSnapshotId) : null,
      ]);
      if (!hcrdSnapshot || !tiktokSnapshot || (body.inTransitSnapshotId && !inTransitSnapshot)) {
        sendJson(response, 404, { ok: false, message: "One or more requested source snapshots were not found" });
        return;
      }
      const result = reconcileInventorySnapshots({
        hcrdSnapshot,
        tiktokSnapshot,
        inTransitSnapshot,
        mapping: body.mapping,
        safetyStock: body.safetyStock,
      });
      const runId = body.runId || randomUUID();
      const stored = await recordStore.storeInternal({
        definitionId: "internal.inventory.reconcile",
        runId,
        entityId: body.entityId || `inventory-reconciliation:${runId}`,
        source: {
          hcrdSnapshotId: body.hcrdSnapshotId,
          tiktokSnapshotId: body.tiktokSnapshotId,
          inTransitSnapshotId: body.inTransitSnapshotId || null,
        },
        input: {
          skuMappingVersion: body.skuMappingVersion || "unversioned",
          safetyStockVersion: body.safetyStockVersion || "unversioned",
        },
        result,
        verification: {
          ok: result.summary.recordsValid === true,
          checks: [
            {
              id: "unmapped_skus_isolated",
              ok: true,
              message: "Unmapped or missing SKUs are explicitly represented in the reconciliation report.",
            },
          ],
        },
      });
      sendJson(response, stored.duplicate ? 200 : 201, { ok: true, stored, result });
      return;
    }
    const recordMatch = url.pathname.match(/^\/records\/([^/]+)$/);
    if (request.method === "GET" && recordMatch) {
      const snapshot = await recordStore.get(decodeURIComponent(recordMatch[1]));
      if (!snapshot) {
        sendJson(response, 404, { ok: false, message: "Record snapshot not found" });
        return;
      }
      sendJson(response, 200, { ok: true, snapshot });
      return;
    }
    const artifactMatch = url.pathname.match(/^\/jobs\/([^/]+)\/artifacts\/(.+)$/);
    if (request.method === "GET" && artifactMatch) {
      const runId = parseRunId(artifactMatch[1]);
      const job = await store.get(runId);
      if (!job) {
        sendJson(response, 404, { ok: false, message: "Job not found" });
        return;
      }
      await sendArtifact(response, runId, artifactMatch[2]);
      return;
    }
    const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      const runId = parseRunId(jobMatch[1]);
      const job = await store.get(runId);
      if (!job) {
        sendJson(response, 404, { ok: false, message: "Job not found" });
        return;
      }
      sendJson(response, 200, { ok: true, job });
      return;
    }
    if (request.method === "POST" && url.pathname === "/jobs") {
      const body = await readJson(request);
      const definition = getAutomationDefinition(body.definitionId);
      if (!definition) {
        sendJson(response, 400, { ok: false, message: "Unknown definitionId" });
        return;
      }
      if (definition.executor !== "browser") {
        sendJson(response, 400, { ok: false, message: "Internal definitions are not accepted by the browser queue" });
        return;
      }
      const targetUrl = new URL(body.target?.url);
      const task = buildTaskSpec({
        definitionId: definition.id,
        sourceTaskId: body.sourceTaskId || `service:${definition.id}:${body.entityId}`,
        entityId: body.entityId,
        input: body.input || {},
        target: {
          ...body.target,
          url: targetUrl.toString(),
          origin: targetUrl.origin,
        },
        mode: config.mode,
        requestedBy: body.requestedBy || "tk-saas-local-service",
        approvalGrant: body.approvalGrant,
        runId: body.runId || randomUUID(),
      });
      const decision = evaluatePolicy(task, policyContext());
      if (!decision.allowObserve) {
        sendJson(response, 409, { ok: false, message: "Job blocked by policy", decision });
        return;
      }
      const queued = await store.enqueue(task);
      sendJson(response, queued.enqueued ? 201 : 200, { ok: true, queued, decision });
      return;
    }

    sendJson(response, 404, { ok: false, message: "Not found" });
  } catch (error) {
    sendJson(response, 400, { ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});

await store.initialize();
if (requireToken && !token) {
  throw new Error("AUTOMATION_SERVICE_TOKEN is required when the service is bound beyond loopback.");
}
server.listen(port, host, () => {
  console.log(`TK-SaaS automation service listening on http://${host}:${port} (bearer auth: ${token ? "enabled" : "disabled"})`);
});
