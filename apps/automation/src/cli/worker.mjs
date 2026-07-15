import os from "node:os";
import { ArtifactStore } from "../artifacts/artifactStore.js";
import { StagehandAutomationDriver } from "../adapters/stagehand/stagehandDriver.js";
import { loadAutomationConfig } from "../config.js";
import { FileJobStore } from "../queue/fileJobStore.js";
import { FileIdempotencyLedger } from "../runtime/idempotencyLedger.js";
import { runAutomationTask } from "../runtime/runner.js";
import { RecordSnapshotStore } from "../records/snapshotStore.js";
import { ProfileLeaseManager } from "../session/profileManager.js";

function parseArgs(argv) {
  const args = { watch: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--watch") {
      args.watch = true;
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

function usage() {
  return `Usage:
  npm run worker
  npm run worker -- --watch [--poll-ms 1500]

The worker only claims jobs already admitted by policy. --watch polls the local queue; it does not bypass approval, external-write, or postcondition gates.`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const config = loadAutomationConfig();
const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}
const pollMs = Number(args["poll-ms"] || config.worker.pollMs);
if (!Number.isFinite(pollMs) || pollMs < 250) {
  throw new Error("--poll-ms must be a number of at least 250 milliseconds.");
}
const workerId = process.env.AUTOMATION_WORKER_ID || `${os.hostname()}:${process.pid}`;
const store = new FileJobStore({ directory: `${config.dataDirectory}/jobs` });

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    console.log(JSON.stringify({ ok: true, workerId, message: `Received ${signal}; worker will stop after the current job.` }));
  });
}

async function processOneJob() {
  const job = await store.claimNext({ workerId, leaseMs: config.worker.leaseMs });
  if (!job) return false;

  let result;
  try {
    result = await runAutomationTask({
      task: job.task,
      driver: new StagehandAutomationDriver({ config }),
      policyContext: {
        allowedOrigins: config.allowedOrigins,
        externalReadEnabled: config.externalReadEnabled,
        externalWriteEnabled: config.externalWriteEnabled,
        highRiskAutomationEnabled: config.highRiskAutomationEnabled,
        autoApprovedDefinitionIds: config.autoApprovedDefinitionIds,
      },
      ledger: new FileIdempotencyLedger({ directory: config.ledgerDirectory }),
      profileManager: new ProfileLeaseManager({ rootDirectory: config.profileDirectory }),
      artifactStore: new ArtifactStore({ rootDirectory: config.artifactDirectory, runId: job.task.runId }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = { task: { ...job.task, status: "failed" }, error: message };
  }

  try {
    result.recordSnapshot = await new RecordSnapshotStore({ directory: config.recordDirectory }).store(result);
  } catch (error) {
    result.recordSnapshot = {
      stored: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await store.complete(job.task.runId, result);
  console.log(JSON.stringify({ ok: true, workerId, runId: job.task.runId, status: result.task.status }, null, 2));
  return true;
}

do {
  const handled = await processOneJob();
  if (!args.watch) {
    if (!handled) console.log(JSON.stringify({ ok: true, workerId, message: "No queued browser jobs." }));
    break;
  }
  if (!handled && !stopping) await sleep(pollMs);
} while (!stopping);
