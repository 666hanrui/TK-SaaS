import { RunStatusSchema, TaskSpecSchema } from "../protocol/schemas.js";

const transitions = Object.freeze({
  queued: ["acquiring_session", "blocked", "failed"],
  acquiring_session: ["navigating", "auth_required", "blocked", "failed"],
  navigating: ["observing", "auth_required", "blocked", "failed"],
  observing: ["extracted", "proposed", "auth_required", "blocked", "failed"],
  extracted: ["verifying", "succeeded", "shadow_completed", "failed"],
  proposed: ["approval_required", "executing", "shadow_completed", "blocked", "failed"],
  approval_required: ["executing", "blocked", "failed"],
  executing: ["verifying", "ambiguous_reconcile", "failed"],
  verifying: ["succeeded", "ambiguous_reconcile", "failed"],
  auth_required: [],
  ambiguous_reconcile: ["verifying", "succeeded", "failed"],
  shadow_completed: [],
  succeeded: [],
  blocked: [],
  failed: [],
});

export function canTransition(from, to) {
  RunStatusSchema.parse(from);
  RunStatusSchema.parse(to);
  return transitions[from].includes(to);
}

export function transitionTask(taskInput, nextStatus) {
  const task = TaskSpecSchema.parse(taskInput);
  RunStatusSchema.parse(nextStatus);

  if (!canTransition(task.status, nextStatus)) {
    throw new Error(`Invalid browser automation transition: ${task.status} -> ${nextStatus}`);
  }

  return TaskSpecSchema.parse({ ...task, status: nextStatus });
}

export function isTerminalStatus(status) {
  RunStatusSchema.parse(status);
  return transitions[status].length === 0;
}

export { transitions as browserAutomationTransitions };
