# TK-SaaS Admin Skeleton Design

## Goal

Build the first usable internal admin console for the store manager's daily TikTok Shop workflow.

The first version must help the manager monitor and trigger daily automation from one SaaS surface, with order shipping as the highest-priority workload. It uses realistic mock data and keeps external API, n8n, TikTok Shop, browser RPA, and HCRD integrations behind an adapter boundary.

## Product Scope

The first screen is the actual work console, not a landing page.

Primary modules:

- Today overview
- Order shipping
- Aftersales work orders
- Product reviews
- Inventory check
- Creator leads
- Settings

Template scripts are not a left-side module. They appear inside task details and support one-click send actions.

Task 4, account health and creator health score, is intentionally excluded from this build.

## Information Architecture

The shell has a fixed left sidebar, top operational bar, main task surface, and right detail drawer.

Left navigation:

- Today overview
- Order shipping
- Aftersales work orders
- Product reviews
- Inventory check
- Creator leads
- Settings

Top bar:

- Date
- Store selector
- Sync status
- Opening-order automation action

Dashboard:

- KPI strip for urgent tasks, 24h pickup risk, shipping workload, aftersales, inventory exceptions, bad review follow-up
- Unified task ranking tabs
- Task filters
- Shift groups: morning must-do, afternoon must-do, before leaving
- Right drawer with selected task details, automation action, script preview, one-click send, and completion controls

Order shipping receives extra emphasis:

- It is the first operational nav item after Today overview
- Shipping workload appears as a KPI
- Shipping tasks sort above lower-risk non-shipping tasks when urgency is equal
- The default selected task is a shipping risk task
- Task copy must not send the user to another platform to finish the work. It should describe the automation the system will run.

## API And Automation Boundary

The frontend talks only to TK-SaaS application APIs.

Planned API shape:

- `GET /api/tasks`
- `PATCH /api/tasks/:id`
- `GET /api/orders`
- `GET /api/aftersales`
- `GET /api/reviews`
- `GET /api/inventory`
- `GET /api/creators`
- `POST /api/opening-orders/import`
- `POST /api/automation-runs`
- `POST /api/rpa/shipping/run`
- `POST /api/webhooks/n8n/:workflow`

First implementation uses a mock adapter inside the frontend. Later implementation can replace it with FastAPI endpoints without changing UI behavior.

n8n and browser RPA should be used as workflow automation:

- Scheduled syncs
- External API calls
- Webhook notifications
- Email, chat, and customer-message sending flows
- Browser automation for pages that do not expose usable APIs
- Uploading and filling shipping information pages
- Morning, afternoon, and after-work reminders

n8n should not own the primary database, permissions, task state, or high-risk platform actions.

## Interaction Requirements

The skeleton must be interactive:

- Sidebar switches sections
- Task type and priority filters work
- Selecting a task updates the right drawer
- Status buttons update task status
- One-click automation buttons move tasks into processing state
- One-click send buttons enqueue message/RPA sending from the current SaaS
- Opening-order automation opens a lightweight modal explaining CSV/API/RPA/n8n lanes
- Detail drawer exposes script preview without making scripts a top-level nav module

## Visual Direction

Use the selected Image Gen option 1, adjusted for the user's corrections.

Style:

- Quiet internal operations tool
- Dense, scannable tables
- White and warm gray base
- Charcoal text
- Teal, amber, red, green, and blue semantic accents
- 8px radius or less
- Thin dividers
- Minimal shadows
- No marketing hero
- No decorative gradient blobs
- No nested card-heavy layout

## Verification

The build is acceptable when:

- `npm test` passes for business grouping and navigation rules
- `npm run build` succeeds
- The app runs locally
- A screenshot confirms the dashboard renders with the selected structure
- `design-qa.md` records the source visual, implementation screenshot, viewport, findings, and final result
