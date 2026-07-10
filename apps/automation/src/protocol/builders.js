import { createHash, randomUUID } from "node:crypto";
import {
  ActionIntentSchema,
  LocatorCandidateSchema,
  SchemaVersion,
  TaskSpecSchema,
} from "./schemas.js";
import { getAutomationDefinition } from "../catalog/taskCatalog.js";

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function ensureRequiredInputs(definition, input) {
  const missing = definition.requiredInputs.filter((key) => {
    const value = input[key];
    return value === undefined || value === null || value === "";
  });

  if (missing.length > 0) {
    throw new Error(`Missing required inputs for ${definition.id}: ${missing.join(", ")}`);
  }
}

export function buildIdempotencyKey({ definition, entityId, input, target }) {
  const stableIdentity = {
    definitionId: definition.id,
    entityId,
    accountId: target?.accountId,
    shopId: target?.shopId,
    input,
  };

  return `${definition.id}:${sha256(stableIdentity)}`;
}

export function buildTaskSpec({
  definitionId,
  sourceTaskId,
  entityId,
  input = {},
  target,
  mode = "rehearsal",
  requestedBy = "tk-saas",
  requestedAt = new Date().toISOString(),
  runId = randomUUID(),
  approvalGrant,
}) {
  const definition = getAutomationDefinition(definitionId);
  if (!definition) {
    throw new Error(`Unknown automation definition: ${definitionId}`);
  }

  ensureRequiredInputs(definition, input);

  if (definition.executor === "browser" && !target) {
    throw new Error(`Browser definition ${definition.id} requires a target`);
  }

  let normalizedTarget;
  if (target) {
    const parsedUrl = new URL(target.url);
    normalizedTarget = {
      ...target,
      origin: target.origin || parsedUrl.origin,
    };
    if (normalizedTarget.origin !== parsedUrl.origin) {
      throw new Error(`Target origin does not match target URL for ${definition.id}`);
    }
  }

  return TaskSpecSchema.parse({
    schemaVersion: SchemaVersion,
    runId,
    definitionId: definition.id,
    mode,
    riskLevel: definition.riskLevel,
    status: "queued",
    sourceTaskId,
    entityId,
    idempotencyKey: buildIdempotencyKey({ definition, entityId, input, target: normalizedTarget }),
    target: normalizedTarget,
    input,
    requestedAt,
    requestedBy,
    approvalGrant,
  });
}

export function buildActionIntent({ task, candidate, payload }) {
  const definition = getAutomationDefinition(task.definitionId);
  if (!definition) {
    throw new Error(`Unknown automation definition: ${task.definitionId}`);
  }

  let normalizedCandidate;
  if (candidate) {
    normalizedCandidate = LocatorCandidateSchema.parse(candidate);
    if (!definition.allowedMethods.includes(normalizedCandidate.method)) {
      throw new Error(
        `Candidate method ${normalizedCandidate.method} is not allowed for ${definition.id}`,
      );
    }
  }

  if (definition.executor === "browser" && !task.target) {
    throw new Error(`Browser task ${definition.id} has no target`);
  }

  return ActionIntentSchema.parse({
    schemaVersion: SchemaVersion,
    runId: task.runId,
    definitionId: definition.id,
    actionType: definition.actionType,
    riskLevel: definition.riskLevel,
    entityType: definition.entityType,
    entityId: task.entityId,
    targetOrigin: task.target?.origin,
    idempotencyKey: task.idempotencyKey,
    payloadHash: sha256(payload ?? task.input),
    candidate: normalizedCandidate,
  });
}
