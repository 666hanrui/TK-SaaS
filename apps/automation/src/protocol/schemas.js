import { z } from "zod";

export const SchemaVersion = "1.0";

export const RunModeSchema = z.enum(["rehearsal", "shadow", "canary", "live"]);

export const RiskLevelSchema = z.enum([
  "R0_INTERNAL",
  "R1_READ",
  "R2_REVERSIBLE_WRITE",
  "R3_SENSITIVE_WRITE",
]);

export const ActionTypeSchema = z.enum([
  "NAVIGATE",
  "OBSERVE",
  "EXTRACT",
  "DOWNLOAD",
  "UPLOAD",
  "CLICK",
  "TYPE_DRAFT",
  "SEND_MESSAGE",
  "SUBMIT_FORM",
  "SET_INVENTORY",
  "MARK_FULFILLED",
  "ISSUE_REFUND",
  "INTERNAL_COMPUTE",
]);

export const RunStatusSchema = z.enum([
  "queued",
  "acquiring_session",
  "navigating",
  "observing",
  "extracted",
  "proposed",
  "approval_required",
  "executing",
  "verifying",
  "succeeded",
  "shadow_completed",
  "auth_required",
  "ambiguous_reconcile",
  "blocked",
  "failed",
]);

export const EvidenceTypeSchema = z.enum([
  "screenshot_before",
  "screenshot_after",
  "screenshot_failure",
  "accessibility_snapshot",
  "visible_text",
  "structured_output",
  "download",
  "trace",
  "execution_receipt",
]);

export const ConditionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  source: z.enum(["runtime", "page", "extraction", "receipt"]),
  path: z.string().min(1),
  operator: z.enum([
    "exists",
    "equals",
    "not_equals",
    "contains",
    "matches",
    "greater_than_or_equal",
    "less_than_or_equal",
  ]),
  expected: z.unknown().optional(),
  required: z.boolean().default(true),
});

export const AutomationDefinitionSchema = z.object({
  schemaVersion: z.literal(SchemaVersion),
  id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  label: z.string().min(1),
  module: z.enum(["orders", "aftersales", "reviews", "inventory", "creators", "messages"]),
  platform: z.enum(["tiktok_shop", "hcrd", "echotik", "mail", "social", "internal"]),
  executor: z.enum(["browser", "internal"]),
  riskLevel: RiskLevelSchema,
  actionType: ActionTypeSchema,
  entityType: z.string().min(1),
  description: z.string().min(1),
  requiredInputs: z.array(z.string().min(1)),
  allowedMethods: z.array(z.enum(["click", "fill", "type", "press", "selectOption", "extract", "download", "upload"])),
  observeInstruction: z.string().min(1),
  extractInstruction: z.string().optional(),
  verifyInstruction: z.string().min(1),
  outputSchemaKey: z.string().min(1).optional(),
  preconditions: z.array(ConditionSchema),
  postconditions: z.array(ConditionSchema),
  evidence: z.array(EvidenceTypeSchema).min(1),
  dailyLimit: z.number().int().positive().optional(),
  recipeStatus: z.enum(["catalogued", "fixture_ready", "shadow_validated", "canary_validated", "live_ready"]),
});

export const TaskTargetSchema = z.object({
  url: z.string().url(),
  origin: z.string().url(),
  accountId: z.string().min(1),
  shopId: z.string().min(1).optional(),
  profileId: z.string().regex(/^[a-zA-Z0-9._-]+$/),
});

export const TaskSpecSchema = z.object({
  schemaVersion: z.literal(SchemaVersion),
  runId: z.string().min(1),
  definitionId: z.string().min(1),
  mode: RunModeSchema,
  riskLevel: RiskLevelSchema,
  status: RunStatusSchema,
  sourceTaskId: z.string().min(1),
  entityId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  target: TaskTargetSchema.optional(),
  input: z.record(z.string(), z.unknown()),
  requestedAt: z.string().datetime(),
  requestedBy: z.string().min(1),
  approvalGrant: z
    .object({
      grantId: z.string().min(1),
      definitionId: z.string().min(1),
      expiresAt: z.string().datetime(),
      entityId: z.string().min(1).optional(),
      maxAmount: z.number().nonnegative().optional(),
    })
    .optional(),
});

export const LocatorCandidateSchema = z.object({
  description: z.string().min(1),
  method: z.enum(["click", "fill", "type", "press", "selectOption", "extract", "download", "upload"]),
  selector: z.string().min(1),
  arguments: z.array(z.unknown()).default([]),
  pageFingerprint: z.string().min(1),
});

export const ActionIntentSchema = z.object({
  schemaVersion: z.literal(SchemaVersion),
  runId: z.string().min(1),
  definitionId: z.string().min(1),
  actionType: ActionTypeSchema,
  riskLevel: RiskLevelSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  targetOrigin: z.string().url().optional(),
  idempotencyKey: z.string().min(8),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  candidate: LocatorCandidateSchema.optional(),
});

export const PolicyDecisionSchema = z.object({
  schemaVersion: z.literal(SchemaVersion),
  runId: z.string().min(1),
  definitionId: z.string().min(1),
  decision: z.enum(["allow", "observe_only", "needs_approval", "block"]),
  allowObserve: z.boolean(),
  allowExecute: z.boolean(),
  reasons: z.array(z.string()),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
  decidedAt: z.string().datetime(),
});

export const ExecutionReceiptSchema = z.object({
  schemaVersion: z.literal(SchemaVersion),
  runId: z.string().min(1),
  definitionId: z.string().min(1),
  idempotencyKey: z.string().min(8),
  attempted: z.boolean(),
  success: z.boolean(),
  ambiguous: z.boolean().default(false),
  message: z.string(),
  pageFingerprintBefore: z.string().optional(),
  pageFingerprintAfter: z.string().optional(),
  externalReferenceId: z.string().optional(),
  executedAt: z.string().datetime(),
});

export const VerificationResultSchema = z.object({
  ok: z.boolean(),
  checks: z.array(
    z.object({
      id: z.string().min(1),
      ok: z.boolean(),
      observed: z.unknown().optional(),
      message: z.string(),
    }),
  ),
});

export const RunEventSchema = z.object({
  schemaVersion: z.literal(SchemaVersion),
  runId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  type: z.string().min(1),
  status: RunStatusSchema,
  at: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const JobRecordSchema = z.object({
  schemaVersion: z.literal(SchemaVersion),
  task: TaskSpecSchema,
  queueStatus: z.enum(["queued", "claimed", "completed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  claimedBy: z.string().min(1).optional(),
  leaseExpiresAt: z.string().datetime().optional(),
  result: z.record(z.string(), z.unknown()).optional(),
});
