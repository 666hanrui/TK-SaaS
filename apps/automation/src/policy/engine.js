import { PolicyDecisionSchema, SchemaVersion, TaskSpecSchema } from "../protocol/schemas.js";
import { getAutomationDefinition } from "../catalog/taskCatalog.js";
import { sha256 } from "../protocol/builders.js";

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function originAllowed(origin, allowedOrigins) {
  if (!origin) return false;
  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === new URL(origin).origin;
    } catch {
      return false;
    }
  });
}

function approvalGrantValid(task, definition, now) {
  const grant = task.approvalGrant;
  if (!grant) return { ok: false, reason: "No scoped approval grant is attached." };
  if (grant.definitionId !== definition.id) {
    return { ok: false, reason: "Approval grant does not match the requested definition." };
  }
  if (grant.entityId && grant.entityId !== task.entityId) {
    return { ok: false, reason: "Approval grant does not match the requested entity." };
  }
  if (new Date(grant.expiresAt).getTime() <= now.getTime()) {
    return { ok: false, reason: "Approval grant has expired." };
  }

  const requestedAmount = Number(task.input.amount);
  if (
    Number.isFinite(requestedAmount) &&
    grant.maxAmount !== undefined &&
    requestedAmount > grant.maxAmount
  ) {
    return { ok: false, reason: "Requested amount exceeds the approval grant." };
  }

  return { ok: true };
}

function buildDecision({ task, definition, decision, allowObserve, allowExecute, reasons, now, context }) {
  const policyMaterial = {
    task: {
      runId: task.runId,
      definitionId: task.definitionId,
      mode: task.mode,
      riskLevel: task.riskLevel,
      entityId: task.entityId,
      targetOrigin: task.target?.origin,
      approvalGrant: task.approvalGrant,
    },
    definition: {
      id: definition.id,
      executor: definition.executor,
      riskLevel: definition.riskLevel,
      actionType: definition.actionType,
      dailyLimit: definition.dailyLimit,
    },
    context: {
      allowedOrigins: [...context.allowedOrigins].sort(),
      externalReadEnabled: context.externalReadEnabled,
      externalWriteEnabled: context.externalWriteEnabled,
      highRiskAutomationEnabled: context.highRiskAutomationEnabled,
      autoApprovedDefinitionIds: [...context.autoApprovedDefinitionIds].sort(),
      executionsToday: context.executionsToday[definition.id] ?? 0,
    },
  };

  return PolicyDecisionSchema.parse({
    schemaVersion: SchemaVersion,
    runId: task.runId,
    definitionId: definition.id,
    decision,
    allowObserve,
    allowExecute,
    reasons,
    policyHash: sha256(policyMaterial),
    decidedAt: now.toISOString(),
  });
}

export function evaluatePolicy(taskInput, policyContext = {}) {
  const task = TaskSpecSchema.parse(taskInput);
  const definition = getAutomationDefinition(task.definitionId);
  if (!definition) throw new Error(`Unknown automation definition: ${task.definitionId}`);

  const now = policyContext.now ? new Date(policyContext.now) : new Date();
  const context = {
    allowedOrigins: policyContext.allowedOrigins ?? [],
    externalReadEnabled: policyContext.externalReadEnabled === true,
    externalWriteEnabled: policyContext.externalWriteEnabled === true,
    highRiskAutomationEnabled: policyContext.highRiskAutomationEnabled === true,
    autoApprovedDefinitionIds: policyContext.autoApprovedDefinitionIds ?? [],
    executionsToday: policyContext.executionsToday ?? {},
  };

  const reasons = [];
  const finish = (decision, allowObserve, allowExecute) =>
    buildDecision({ task, definition, decision, allowObserve, allowExecute, reasons, now, context });

  if (task.riskLevel !== definition.riskLevel) {
    reasons.push("Task risk level does not match the catalog definition.");
    return finish("block", false, false);
  }

  if (definition.executor === "internal") {
    reasons.push("Internal deterministic or model computation does not require browser authority.");
    return finish("allow", true, true);
  }

  if (!task.target) {
    reasons.push("Browser task has no target URL or browser profile.");
    return finish("block", false, false);
  }

  const loopback = isLoopbackOrigin(task.target.origin);
  const explicitlyAllowed = originAllowed(task.target.origin, context.allowedOrigins);

  if (task.mode === "rehearsal") {
    if (!loopback) {
      reasons.push("Rehearsal mode is restricted to loopback origins.");
      return finish("block", false, false);
    }
    if (definition.riskLevel === "R1_READ") {
      reasons.push("Local read-only rehearsal is allowed.");
      return finish("allow", true, true);
    }
    reasons.push("Local rehearsal may observe and propose writes but cannot execute them.");
    return finish("observe_only", true, false);
  }

  if (!explicitlyAllowed) {
    reasons.push("Target origin is not in the runtime allowlist.");
    return finish("block", false, false);
  }

  if (!context.externalReadEnabled) {
    reasons.push("External browser observation is disabled.");
    return finish("block", false, false);
  }

  if (definition.riskLevel === "R1_READ") {
    reasons.push("Allowed-origin read task is enabled.");
    return finish("allow", true, true);
  }

  if (task.mode === "shadow") {
    reasons.push("Shadow mode never executes an external write.");
    return finish("observe_only", true, false);
  }

  if (!context.externalWriteEnabled) {
    reasons.push("External writes are disabled globally.");
    return finish("observe_only", true, false);
  }

  const completedToday = context.executionsToday[definition.id] ?? 0;
  if (definition.dailyLimit !== undefined && completedToday >= definition.dailyLimit) {
    reasons.push(`Daily limit reached for ${definition.id}.`);
    return finish("block", true, false);
  }

  const grantResult = approvalGrantValid(task, definition, now);
  const definitionAutoApproved = context.autoApprovedDefinitionIds.includes(definition.id);

  if (definition.riskLevel === "R2_REVERSIBLE_WRITE") {
    if (task.mode === "canary" && !grantResult.ok) {
      reasons.push(`Canary write requires a scoped grant. ${grantResult.reason}`);
      return finish("needs_approval", true, false);
    }
    if (!definitionAutoApproved && !grantResult.ok) {
      reasons.push(`Write is not covered by automatic policy or a scoped grant. ${grantResult.reason}`);
      return finish("needs_approval", true, false);
    }
    reasons.push(grantResult.ok ? "Scoped grant authorizes this reversible write." : "Catalog definition is auto-approved by runtime policy.");
    return finish("allow", true, true);
  }

  if (!context.highRiskAutomationEnabled) {
    reasons.push("Sensitive-write automation is disabled.");
    return finish("needs_approval", true, false);
  }
  if (!grantResult.ok) {
    reasons.push(`Sensitive write requires a valid scoped grant. ${grantResult.reason}`);
    return finish("needs_approval", true, false);
  }

  reasons.push("Sensitive write is enabled and covered by a valid scoped grant.");
  return finish("allow", true, true);
}

export { isLoopbackOrigin, originAllowed };
