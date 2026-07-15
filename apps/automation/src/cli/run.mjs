import { readFile } from "node:fs/promises";
import { ArtifactStore } from "../artifacts/artifactStore.js";
import { getAutomationDefinition } from "../catalog/taskCatalog.js";
import { loadAutomationConfig } from "../config.js";
import { buildTaskSpec } from "../protocol/builders.js";
import { FileIdempotencyLedger } from "../runtime/idempotencyLedger.js";
import { runAutomationTask } from "../runtime/runner.js";
import { ProfileLeaseManager } from "../session/profileManager.js";
import { StagehandAutomationDriver } from "../adapters/stagehand/stagehandDriver.js";

function usage() {
  return `Usage:
  npm run run -- --definition <id> --entity <id> --target <url> --account <alias> --profile <profile-id> --input <json-file> [--shop <id>] [--mode rehearsal|shadow|canary|live] [--headed]

The runtime policy still decides whether any external action can execute. This CLI does not bypass modes, allowlists, approval grants, or postcondition verification.`;
}

function parseArgs(argv) {
  const args = { headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--help" || key === "-h") {
      args.help = true;
      continue;
    }
    if (key === "--headed") {
      args.headed = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    index += 1;
    args[key.slice(2)] = value;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
for (const key of ["definition", "entity", "target", "account", "profile", "input"]) {
  if (!args[key]) throw new Error(`--${key} is required\n\n${usage()}`);
}

const definition = getAutomationDefinition(args.definition);
if (!definition) throw new Error(`Unknown definition: ${args.definition}`);
if (definition.executor !== "browser") {
  throw new Error(`Definition ${definition.id} is internal; use the application service rather than the browser CLI.`);
}

const input = JSON.parse(await readFile(args.input, "utf8"));
const config = loadAutomationConfig();
const targetUrl = new URL(args.target);
const task = buildTaskSpec({
  definitionId: definition.id,
  sourceTaskId: args["source-task"] || `cli:${definition.id}:${args.entity}`,
  entityId: args.entity,
  target: {
    url: targetUrl.toString(),
    origin: targetUrl.origin,
    accountId: args.account,
    shopId: args.shop,
    profileId: args.profile,
  },
  mode: args.mode || config.mode,
  input,
  requestedBy: "automation-cli",
});

const runtimeConfig = {
  ...config,
  browser: { ...config.browser, headless: args.headed ? false : config.browser.headless },
};
const result = await runAutomationTask({
  task,
  driver: new StagehandAutomationDriver({ config: runtimeConfig }),
  policyContext: {
    allowedOrigins: config.allowedOrigins,
    externalReadEnabled: config.externalReadEnabled,
    externalWriteEnabled: config.externalWriteEnabled,
    highRiskAutomationEnabled: config.highRiskAutomationEnabled,
    autoApprovedDefinitionIds: config.autoApprovedDefinitionIds,
  },
  ledger: new FileIdempotencyLedger({ directory: config.ledgerDirectory }),
  profileManager: new ProfileLeaseManager({ rootDirectory: config.profileDirectory }),
  artifactStore: new ArtifactStore({ rootDirectory: config.artifactDirectory, runId: task.runId }),
});

console.log(JSON.stringify(result, null, 2));
if (!["succeeded", "shadow_completed", "approval_required"].includes(result.task.status)) {
  process.exitCode = 1;
}
