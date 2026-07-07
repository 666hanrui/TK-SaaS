# TK-SaaS Admin Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable React/Vite admin skeleton for TK-SaaS that prioritizes daily order shipping work and exposes a realistic task console.

**Architecture:** The first build is a frontend-only app under `apps/web` with a mock adapter and pure business selectors. UI state lives in `App.jsx`; task and module data lives in `src/lib/mockData.js`; deterministic rules live in `src/lib/operations.js` so they can be tested and later reused by a backend.

**Tech Stack:** React, Vite, Vitest, Testing Library, lucide-react icons.

---

### Task 1: Scaffold And Dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] Add scripts for test/build/dev and dependencies for React, Vite, Vitest, jsdom, Testing Library, and lucide-react.
- [ ] Run `npm install` in `apps/web`.

### Task 2: Business Rules First

**Files:**
- Create: `apps/web/src/lib/operations.test.js`
- Create: `apps/web/src/lib/operations.js`
- Create: `apps/web/src/lib/mockData.js`

- [ ] Write tests proving left nav excludes script templates.
- [ ] Write tests proving tasks group into morning, afternoon, and before-leaving buckets.
- [ ] Write tests proving shipping workload counts both pickup-risk and shipping-contact tasks.
- [ ] Run tests and confirm they fail before implementation.
- [ ] Implement the selectors and mock data.
- [ ] Run tests and confirm they pass.

### Task 3: Admin UI Shell

**Files:**
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/styles.css`

- [ ] Build the sidebar without a template-script nav item.
- [ ] Build the top bar with date, store selector, sync status, and import action.
- [ ] Build the KPI strip with shipping workload emphasis.
- [ ] Build the grouped task table and filters.
- [ ] Build the right task detail drawer with script preview and copy/complete controls.
- [ ] Build lightweight section views for orders, aftersales, reviews, inventory, creators, and settings.

### Task 4: Local Verification

**Files:**
- Create: `design-qa.md`

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start the local dev server.
- [ ] Capture a 1440x1024 screenshot.
- [ ] Compare selected source visual against rendered app.
- [ ] Fix blocking P0/P1/P2 issues.
- [ ] Save `design-qa.md` with `final result: passed` or `blocked`.
