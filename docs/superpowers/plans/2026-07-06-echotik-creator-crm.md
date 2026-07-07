# EchoTik Creator CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a visual EchoTik creator CRM inside the existing Creator Leads module.

**Architecture:** Keep the current React/Vite single-page prototype. Add creator screening and funnel business logic to `apps/web/src/lib/operations.js`, add realistic EchoTik mock leads to `apps/web/src/lib/mockData.js`, and render the new Creator Leads page from `apps/web/src/App.jsx` using the existing CSS token system.

**Tech Stack:** React 19, Vite, Vitest, lucide-react, plain CSS.

---

## File Structure

- Modify `apps/web/src/lib/operations.test.js` to add failing tests for EchoTik creator screening, metrics, status updates, and profile URL generation.
- Modify `apps/web/src/lib/operations.js` to add focused creator CRM helper functions.
- Modify `apps/web/src/lib/mockData.js` to add `creatorSearchKeywords`, `creatorFunnelStages`, and realistic `creatorLeads`.
- Modify `apps/web/src/App.jsx` to route the `creators` module to a custom visual CRM page and to add an EchoTik import modal.
- Modify `apps/web/src/styles.css` to add creator CRM layout, cards, image handling, score bars, contact fields, and responsive behavior while preserving the current design language.
- Update `design-qa.md` after visual verification.

## Tasks

### Task 1: Add Creator Screening Tests

**Files:**
- Modify: `apps/web/src/lib/operations.test.js`

- [ ] **Step 1: Write failing tests**

Add tests that import and exercise:

```js
buildTikTokProfileUrl
calculateCreatorMetrics
evaluateCreatorLead
updateCreatorStatus
```

The tests should cover:

```js
expect(evaluateCreatorLead(qualifiedLead, new Date("2026-07-06")).qualified).toBe(true);
expect(evaluateCreatorLead(missingProductLead, new Date("2026-07-06")).qualified).toBe(false);
expect(evaluateCreatorLead(missingProductLead, new Date("2026-07-06")).gaps).toContain("带货迹象不足");
expect(calculateCreatorMetrics([qualifiedLead, publishedLead], new Date("2026-07-06")).qualified).toBe(2);
expect(updateCreatorStatus([qualifiedLead], qualifiedLead.id, "needs_contact")[0].crmStatus).toBe("needs_contact");
expect(buildTikTokProfileUrl("arihairdaily")).toBe("https://www.tiktok.com/@arihairdaily");
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
cd apps/web && npm test -- src/lib/operations.test.js
```

Expected: FAIL because the new creator CRM functions are not exported yet.

### Task 2: Implement Creator CRM Helpers

**Files:**
- Modify: `apps/web/src/lib/operations.js`

- [ ] **Step 1: Add helper constants and functions**

Implement:

```js
export function buildTikTokProfileUrl(handleOrId) {}
export function evaluateCreatorLead(lead, now = new Date()) {}
export function calculateCreatorMetrics(leads, now = new Date()) {}
export function updateCreatorStatus(leads, leadId, nextStatus) {}
export function filterCreatorLeads(leads, filters, now = new Date()) {}
```

The screening rule must require followers greater than 1000, at least 6 of the latest 10 videos above 1000 views, activity within 30 days, at least one product-associated video, and at least one matched target keyword.

- [ ] **Step 2: Run tests and verify green**

Run:

```bash
cd apps/web && npm test -- src/lib/operations.test.js
```

Expected: PASS.

### Task 3: Add EchoTik Mock Data

**Files:**
- Modify: `apps/web/src/lib/mockData.js`

- [ ] **Step 1: Add realistic creator exports**

Add:

```js
export const creatorSearchKeywords = [...]
export const creatorFunnelStages = [...]
export const creatorLeads = [...]
```

Each creator lead should include handle, display name, follower count, recent videos with views, dates, cover image URLs, product-associated videos, matched keywords, description, recommended products, contact fields, and CRM status.

- [ ] **Step 2: Run tests**

Run:

```bash
cd apps/web && npm test
```

Expected: PASS.

### Task 4: Build Creator CRM UI

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Render the custom Creator Leads page**

When `activeSection === "creators"`, show the Creator CRM workspace instead of the generic `ModulePage`.

- [ ] **Step 2: Add cards and detail drawer**

Cards must show cover image, status, creator identity, description, evidence chips, matched keywords, and score bars. The detail drawer must show TikTok profile link, evidence, contact fields, checklist, status controls, and disabled AI first-message placeholder.

- [ ] **Step 3: Add import modal**

The Creator page import button opens an EchoTik CSV/Excel modal explaining supported fields and missing contact limitations.

- [ ] **Step 4: Run tests and build**

Run:

```bash
cd apps/web && npm test && npm run build
```

Expected: PASS and successful Vite build.

### Task 5: Visual Verification

**Files:**
- Modify: `design-qa.md`

- [ ] **Step 1: Run the dev server**

Run:

```bash
cd apps/web && npm run dev -- --port 5173
```

- [ ] **Step 2: Inspect in browser**

Open the app, switch to Creator Leads, and confirm the page renders as an image-led CRM workspace with no overlapping text.

- [ ] **Step 3: Record QA**

Update `design-qa.md` with the viewport, screenshot path, findings, and fixes.

- [ ] **Step 4: Final verification**

Run:

```bash
cd apps/web && npm test && npm run build
```

Expected: PASS and successful Vite build.
