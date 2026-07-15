import { loadAutomationConfig } from "../config.js";

function usage() {
  return `Usage:
  npm run records -- [--definition <definition-id>] [--limit 100]
  npm run records -- --run <run-id>

Reads verified R1 source snapshots from the store-manager Windows worker. This command is read-only.`;
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

function endpointFor(value) {
  if (!value) throw new Error("AUTOMATION_REMOTE_ENDPOINT is required on the monitoring computer.");
  const endpoint = new URL(value);
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Remote endpoint must use http or https.");
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
if (args.run && (args.definition || args.limit)) throw new Error("--run cannot be combined with --definition or --limit.");

const config = loadAutomationConfig();
const endpoint = endpointFor(config.monitor.remoteEndpoint);
if (!config.monitor.remoteToken) throw new Error("AUTOMATION_REMOTE_TOKEN is required to read source snapshots.");
const route = args.run
  ? `${endpoint}/records/${encodeURIComponent(args.run)}`
  : `${endpoint}/records?${new URLSearchParams({
      ...(args.definition ? { definitionId: args.definition } : {}),
      ...(args.limit ? { limit: args.limit } : {}),
    })}`;
const response = await fetch(route, { headers: { Authorization: `Bearer ${config.monitor.remoteToken}` } });
const body = await response.text();
let payload;
try {
  payload = JSON.parse(body);
} catch {
  payload = { message: body.slice(0, 1_000) };
}
console.log(JSON.stringify({ ok: response.ok, endpoint, ...payload }, null, 2));
if (!response.ok) process.exitCode = 1;
