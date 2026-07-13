import { z } from "zod";

const sourceEvidence = z.object({
  sourceText: z.string().min(1),
  sourceSelector: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  capturedAt: z.string().datetime().optional(),
});

const summary = z.object({
  recordsValid: z.boolean(),
  visibleCount: z.number().int().nonnegative().optional(),
  capturedCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});

const record = z
  .object({
    id: z.string().min(1),
    evidence: z.array(sourceEvidence).min(1),
  })
  .passthrough();

const listOutput = z.object({ records: z.array(record), summary });

const inventoryRecord = record.extend({
  skuId: z.string().min(1),
  productTitle: z.string().optional(),
  variation: z.string().optional(),
  totalStock: z.number().int().nonnegative(),
  availableStock: z.number().int().nonnegative(),
  lockedStock: z.number().int().nonnegative(),
  stockAlert: z.union([z.string(), z.number()]).optional(),
  autoRestock: z.union([z.string(), z.number(), z.boolean()]).optional(),
  sales30d: z.union([z.string(), z.number()]).optional(),
  forecast30d: z.union([z.string(), z.number()]).optional(),
  recommendedRestock30d: z.union([z.string(), z.number()]).optional(),
  supplyDays: z.union([z.string(), z.number()]).optional(),
  reservedStock: z.union([z.string(), z.number()]).optional(),
  orderOccupiedStock: z.union([z.string(), z.number()]).optional(),
});

const inventoryListOutput = z.object({ records: z.array(inventoryRecord), summary });

const detailOutput = z
  .object({
    id: z.string().min(1),
    evidence: z.array(sourceEvidence).min(1),
    summary,
  })
  .passthrough();

export const stagehandOutputSchemas = Object.freeze({
  order_list: listOutput,
  order_detail: detailOutput,
  fulfillment_audit: detailOutput,
  aftersales_list: listOutput,
  aftersales_detail: detailOutput,
  evidence_manifest: listOutput,
  review_list: listOutput,
  review_detail: detailOutput,
  inventory_list: inventoryListOutput,
  in_transit_list: listOutput,
  creator_list: listOutput,
  creator_detail: detailOutput,
  contact_list: listOutput,
  mail_reply_list: listOutput,
  message_list: listOutput,
  message_thread: detailOutput,
  reply_draft: z.object({
    facts: z.array(z.string()),
    draft: z.string(),
    riskFlags: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    summary,
  }),
  inventory_reconciliation: z.object({
    records: z.array(record),
    summary,
  }),
  creator_qualification: detailOutput,
  outreach_draft: z.object({
    draft: z.string(),
    channel: z.string(),
    evidence: z.array(sourceEvidence),
    unsupportedClaimFlags: z.array(z.string()),
    contentHash: z.string().min(16),
    summary,
  }),
});
