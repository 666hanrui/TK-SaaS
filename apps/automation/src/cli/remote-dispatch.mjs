import { readFile } from "node:fs/promises";
import { loadAutomationConfig } from "../config.js";

function usage() {
  return `Usage:
  npm run dispatch -- --file <job-request.json>

The request is submitted to the store-manager PC's LAN service. The remote worker's policy
and mode remain authoritative; this command cannot enable external writes or bypass approvals.`;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
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

function normalizeEndpoint(value) {
  if (!value) throw new Error("AUTOMATION_REMOTE_ENDPOINT is required on the monitoring computer.");
  const endpoint = new URL(value);
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new Error("AUTOMATION_REMOTE_ENDPOINT must use http or https.");
  }
  endpoint.pathname = endpoint.pathname.replace(/\/$/, "");
  endpoint.search = "";
  endpoint.hash = "";
  return endpoint.toString().replace(/\/$/, "");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (!args.file) throw new Error(`--file is required\n\n${usage()}`);

const request = JSON.parse(await readFile(args.file, "utf8"));
const config = loadAutomationConfig();
const endpoint = normalizeEndpoint(config.monitor.remoteEndpoint);
if (!config.monitor.remoteToken) {
  throw new Error("AUTOMATION_REMOTE_TOKEN is required to dispatch a job to a LAN worker.");
}

const response = await fetch(`${endpoint}/jobs`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.monitor.remoteToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
});
const responseText = await response.text();
let payload;
try {
  payload = JSON.parse(responseText);
} catch {
  payload = { message: responseText.slice(0, 1_000) };
}
console.log(JSON.stringify({ ok: response.ok, endpoint, ...payload }, null, 2));
if (!response.ok) process.exitCode = 1;
