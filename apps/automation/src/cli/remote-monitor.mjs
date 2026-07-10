import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadAutomationConfig } from "../config.js";

function usage() {
  return `Usage:
  npm run monitor -- --run <run-id> [--watch] [--poll-ms 1500] [--download-screenshot]
  npm run monitor -- --list

The monitor is read-only. It uses AUTOMATION_REMOTE_ENDPOINT and AUTOMATION_REMOTE_TOKEN
from the monitoring computer's .env, then reads only queue status and explicitly requested
artifacts from the store-manager PC over the LAN.`;
}

function parseArgs(argv) {
  const args = { watch: false, list: false, downloadScreenshot: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--watch" || key === "--list" || key === "--download-screenshot") {
      args[
        key === "--download-screenshot" ? "downloadScreenshot" : key.slice(2)
      ] = true;
      continue;
    }
    if (key === "--help" || key === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeEndpoint(value) {
  const endpoint = new URL(value);
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("AUTOMATION_REMOTE_ENDPOINT must use http or https.");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/$/, "");
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString().replace(/\/$/, "");
}

function artifactUrl(endpoint, runId, relativePath) {
  const safePath = relativePath.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/jobs/${encodeURIComponent(runId)}/artifacts/${safePath}`;
}

function jobSummary(job) {
  return {
    runId: job.task.runId,
    definitionId: job.task.definitionId,
    entityId: job.task.entityId,
    queueStatus: job.queueStatus,
    runStatus: job.result?.task?.status || job.task.status,
    updatedAt: job.updatedAt,
    claimedBy: job.claimedBy,
  };
}

async function fetchResponse(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Remote monitor request failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response;
}

async function fetchJson(url, token) {
  return (await fetchResponse(url, token)).json();
}

async function downloadLatestScreenshot({ endpoint, token, runId, directory }) {
  const manifestResponse = await fetchJson(artifactUrl(endpoint, runId, "manifest.json"), token);
  const screenshot = manifestResponse.files?.find((file) => /\.png$/i.test(file.path));
  if (!screenshot) return null;

  const targetDirectory = path.resolve(directory, runId);
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const targetFile = path.join(targetDirectory, path.basename(screenshot.path));
  const image = await fetchResponse(artifactUrl(endpoint, runId, screenshot.path), token);
  await writeFile(targetFile, Buffer.from(await image.arrayBuffer()), { mode: 0o600 });
  return targetFile;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (args.list && (args.run || args.watch || args.downloadScreenshot)) {
  throw new Error("--list cannot be combined with --run, --watch, or --download-screenshot.");
}
if (!args.list && !args.run) throw new Error(`--run is required unless --list is used.\n\n${usage()}`);
if (args.watch && !args.run) throw new Error("--watch requires --run.");

const config = loadAutomationConfig();
if (!config.monitor.remoteEndpoint) {
  throw new Error("AUTOMATION_REMOTE_ENDPOINT is required on the monitoring computer.");
}
const endpoint = normalizeEndpoint(config.monitor.remoteEndpoint);
const token = config.monitor.remoteToken;
const pollMs = Number(args["poll-ms"] || config.worker.pollMs);
if (!Number.isFinite(pollMs) || pollMs < 250) throw new Error("--poll-ms must be at least 250.");

if (args.list) {
  const payload = await fetchJson(`${endpoint}/jobs`, token);
  console.log(JSON.stringify({ ok: true, endpoint, jobs: (payload.jobs || []).map(jobSummary) }, null, 2));
  process.exit(0);
}

let previous = "";
let downloaded = false;
do {
  const payload = await fetchJson(`${endpoint}/jobs/${encodeURIComponent(args.run)}`, token);
  const summary = jobSummary(payload.job);
  const serialized = JSON.stringify(summary);
  if (serialized !== previous) {
    console.log(JSON.stringify({ ok: true, endpoint, job: summary }, null, 2));
    previous = serialized;
  }

  if (summary.queueStatus === "completed") {
    if (args.downloadScreenshot && !downloaded) {
      const screenshot = await downloadLatestScreenshot({
        endpoint,
        token,
        runId: summary.runId,
        directory: config.monitor.downloadDirectory,
      });
      console.log(JSON.stringify({ ok: true, screenshot: screenshot || "No screenshot artifact exists for this run." }, null, 2));
      downloaded = true;
    }
    break;
  }
  if (!args.watch) break;
  await sleep(pollMs);
} while (true);
