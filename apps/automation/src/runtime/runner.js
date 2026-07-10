import {
  ExecutionReceiptSchema,
  TaskSpecSchema,
  VerificationResultSchema,
} from "../protocol/schemas.js";
import { buildActionIntent } from "../protocol/builders.js";
import { getAutomationDefinition } from "../catalog/taskCatalog.js";
import { evaluatePolicy } from "../policy/engine.js";
import { canTransition, transitionTask } from "./stateMachine.js";

function safeTransition(task, nextStatus) {
  return canTransition(task.status, nextStatus) ? transitionTask(task, nextStatus) : task;
}

function receiptForRead(task, now, message = "Read or internal task completed.") {
  return ExecutionReceiptSchema.parse({
    schemaVersion: task.schemaVersion,
    runId: task.runId,
    definitionId: task.definitionId,
    idempotencyKey: task.idempotencyKey,
    attempted: true,
    success: true,
    ambiguous: false,
    message,
    executedAt: now().toISOString(),
  });
}

export async function runAutomationTask({
  task: taskInput,
  driver,
  policyContext,
  ledger,
  profileManager,
  artifactStore,
  now = () => new Date(),
}) {
  let task = TaskSpecSchema.parse(taskInput);
  const definition = getAutomationDefinition(task.definitionId);
  if (!definition) throw new Error(`Unknown automation definition: ${task.definitionId}`);
  if (!driver) throw new Error("Automation driver is required");
  if (!ledger) throw new Error("Idempotency ledger is required");
  if (!artifactStore) throw new Error("Artifact store is required");

  let lease;
  let claimed = false;
  let executionStarted = false;
  let receipt;
  let observation;
  let result;
  let verification;
  let policyDecision;

  const event = async (type, payload = {}) =>
    artifactStore.appendEvent({ type, status: task.status, payload, at: now().toISOString() });

  const capture = async (phase, payload = {}) => {
    if (!driver.captureEvidence) return;
    const captured = await driver.captureEvidence({ task, definition, artifactStore, phase });
    await event("page_evidence_captured", { phase, captured, ...payload });
  };

  try {
    await event("task_received", { task, definition });
    policyDecision = evaluatePolicy(task, { ...policyContext, now: now().toISOString() });
    await event("policy_preflight", { policyDecision });

    if (!policyDecision.allowObserve) {
      task = transitionTask(task, "blocked");
      await event("task_blocked", { policyDecision });
      const summary = { task, policyDecision };
      await artifactStore.finalize(summary);
      return summary;
    }

    const claim = await ledger.claim({
      key: task.idempotencyKey,
      runId: task.runId,
      definitionId: definition.id,
      entityId: task.entityId,
      at: now().toISOString(),
    });
    if (!claim.claimed) {
      task = transitionTask(task, "blocked");
      await event("duplicate_blocked", { existing: claim.record });
      const summary = { task, policyDecision, duplicate: claim.record };
      await artifactStore.finalize(summary);
      return summary;
    }
    claimed = true;

    task = transitionTask(task, "acquiring_session");
    await event("acquiring_session");

    if (definition.executor === "browser") {
      if (!profileManager) throw new Error("Browser task requires a profile manager");
      lease = await profileManager.acquire({
        profileId: task.target.profileId,
        runId: task.runId,
        at: now().toISOString(),
      });
      await driver.acquireSession?.({ task, definition, profileDirectory: lease.directory });
    } else {
      await driver.acquireInternal?.({ task, definition });
    }

    task = transitionTask(task, "navigating");
    await event("navigating");
    if (definition.executor === "browser") {
      await driver.navigate({ task, definition });
      await capture("before_observe");
    }

    task = transitionTask(task, "observing");
    await event("observing");
    observation = await driver.observe({ task, definition });
    await event("observation_captured", { observation });

    if (definition.executor === "browser" && observation?.authenticated === false) {
      task = transitionTask(task, "auth_required");
      await ledger.markFailed(task.idempotencyKey, "Authentication is required.");
      await event("auth_required", { observation });
      const summary = { task, policyDecision, observation };
      await artifactStore.finalize(summary);
      return summary;
    }
    if (definition.executor === "browser" && observation?.challengeDetected === true) {
      task = transitionTask(task, "auth_required");
      await ledger.markFailed(task.idempotencyKey, "A verification challenge was detected.");
      await event("challenge_detected", { observation });
      const summary = { task, policyDecision, observation };
      await artifactStore.finalize(summary);
      return summary;
    }

    if (definition.riskLevel === "R0_INTERNAL" || definition.riskLevel === "R1_READ") {
      result =
        definition.executor === "internal"
          ? await driver.runInternal({ task, definition, observation })
          : await driver.runRead({ task, definition, observation });
      receipt = receiptForRead(task, now);
      task = transitionTask(task, "extracted");
      await event("result_captured", { result, receipt });
      if (definition.executor === "browser") await capture("after_extract", { result });
    } else {
      const proposal = await driver.proposeWrite({ task, definition, observation });
      const intent = buildActionIntent({
        task,
        candidate: proposal.candidate,
        payload: proposal.payload,
      });
      task = transitionTask(task, "proposed");
      await event("write_proposed", { intent, proposal });

      policyDecision = evaluatePolicy(task, { ...policyContext, now: now().toISOString() });
      await event("policy_action", { policyDecision, intent });

      if (!policyDecision.allowExecute) {
        task = transitionTask(
          task,
          policyDecision.decision === "needs_approval" ? "approval_required" : "shadow_completed",
        );
        await event("write_not_executed", { policyDecision, intent });
        const summary = { task, policyDecision, observation, intent };
        await artifactStore.finalize(summary);
        return summary;
      }

      task = transitionTask(task, "executing");
      executionStarted = true;
      await event("executing", { intent });
      receipt = ExecutionReceiptSchema.parse(
        await driver.execute({ task, definition, observation, intent }),
      );
      await event("execution_receipt", { receipt });
      await capture("after_execute", { receipt });

      if (receipt.ambiguous) {
        task = transitionTask(task, "ambiguous_reconcile");
        await ledger.markAmbiguous(task.idempotencyKey, receipt, receipt.message);
        await event("execution_ambiguous", { receipt });
        const summary = { task, policyDecision, observation, receipt };
        await artifactStore.finalize(summary);
        return summary;
      }
      if (!receipt.success) {
        task = transitionTask(task, "failed");
        await ledger.markFailed(task.idempotencyKey, receipt.message);
        await event("execution_failed", { receipt });
        const summary = { task, policyDecision, observation, receipt };
        await artifactStore.finalize(summary);
        return summary;
      }
    }

    task = transitionTask(task, "verifying");
    await event("verifying");
    verification = VerificationResultSchema.parse(
      await driver.verify({ task, definition, observation, result, receipt }),
    );
    await event("verification_result", { verification });

    if (!verification.ok) {
      if (executionStarted) {
        task = transitionTask(task, "ambiguous_reconcile");
        await ledger.markAmbiguous(
          task.idempotencyKey,
          receipt,
          "Execution returned success but business postconditions failed.",
        );
      } else {
        task = transitionTask(task, "failed");
        await ledger.markFailed(task.idempotencyKey, "Business postconditions failed.");
      }
      await event("postcondition_failed", { verification });
      const summary = { task, policyDecision, observation, result, receipt, verification };
      await artifactStore.finalize(summary);
      return summary;
    }

    task = transitionTask(task, "succeeded");
    await ledger.commit(task.idempotencyKey, receipt);
    await event("task_succeeded", { verification, receipt });
    const summary = { task, policyDecision, observation, result, receipt, verification };
    await artifactStore.finalize(summary);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (claimed) {
      if (executionStarted) {
        task = safeTransition(task, "ambiguous_reconcile");
        await ledger.markAmbiguous(task.idempotencyKey, receipt, message).catch(() => {});
      } else {
        task = safeTransition(task, "failed");
        await ledger.markFailed(task.idempotencyKey, message).catch(() => {});
      }
    } else {
      task = safeTransition(task, "failed");
    }
    await event("run_error", { message }).catch(() => {});
    await capture("failure", { message }).catch(() => {});
    const summary = { task, policyDecision, observation, result, receipt, verification, error: message };
    await artifactStore.finalize(summary).catch(() => {});
    return summary;
  } finally {
    await driver.close?.().catch(() => {});
    await lease?.release().catch(() => {});
  }
}
