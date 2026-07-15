import { readFile } from "node:fs/promises";
import { loadAutomationConfig } from "../config.js";

function usage() {
  return `Usage:
  npm run inventory:reconcile -- --file <reconciliation-request.json>

Runs only deterministic comparison on verified local source snapshots; it never opens a browser or changes inventory.`;
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
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
if (!args.file) throw new Error(`--file is required\n\n${usage()}`);

const config = loadAutomationConfig();
if (!config.monitor.remoteEndpoint || !config.monitor.remoteToken) {
  throw new Error("AUTOMATION_REMOTE_ENDPOINT and AUTOMATION_REMOTE_TOKEN are required on the monitoring computer.");
}
const endpoint = new URL(config.monitor.remoteEndpoint);
if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Remote endpoint must use http or https.");
const request = JSON.parse(await readFile(args.file, "utf8"));
const response = await fetch(`${endpoint.toString().replace(/\/$/, "")}/inventory/reconcile`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.monitor.remoteToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
});
const body = await response.text();
let payload;
try {
  payload = JSON.parse(body);
} catch {
  payload = { message: body.slice(0, 1_000) };
}
console.log(JSON.stringify({ ok: response.ok, ...payload }, null, 2));
if (!response.ok) process.exitCode = 1;
