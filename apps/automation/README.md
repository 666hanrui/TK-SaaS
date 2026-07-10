# TK-SaaS Browser Automation Worker

This app is the control boundary between TK-SaaS business tasks and browser automation.
It does not trust page text or model output to grant permissions. Stagehand proposes page
facts and locator candidates; the runtime validates a typed business action, applies policy,
claims an idempotency key, executes through Playwright/Stagehand, then verifies a business
postcondition before committing success.

## Safety modes

- `rehearsal`: local fixtures only; external execution is blocked.
- `shadow`: real allowed origins may be read, but writes are only proposed.
- `canary`: explicitly approved low-risk writes may execute within quotas.
- `live`: policy-approved automation may execute; sensitive actions still require a scoped grant.

## Commands

```bash
npm install
npm test
npm run catalog
npm run preflight
npm run frp:preflight
```

`preflight` is offline by default. It checks configuration, catalog integrity, writable data
paths, and policy gates without launching a browser or calling the model.

`frp:preflight` selects the configured FRP Qwen vision profile without overwriting an existing
local `.env`. The actual visual request is deliberately separate:

```bash
npm run frp:model:preflight -- --image-url http://49.235.153.151:8080/<safe-test-image>.jpg
```

Use a non-business image for this first check. A remote URL can prove the model path before the
worker is permitted to publish or send a real Seller Center screenshot to the image host.

## Runtime protocol

```text
TaskSpec
  -> profile lease
  -> origin/account/precondition checks
  -> Stagehand observation and typed extraction
  -> ActionIntent
  -> PolicyDecision
  -> idempotency claim
  -> deterministic execution
  -> business postcondition verification
  -> receipt, artifacts, commit/reconcile
```

The legacy probe under `apps/web/scripts/stagehand-local-probe.mjs` remains a development
experiment. New real-site recipes should be implemented here after the joint validation.

## Store-account execution on a separate Windows PC

When the shop account must remain on the store-manager Windows PC, run the browser worker and
the persistent profile there. The development machine controls only the authenticated LAN job
service and reads explicit evidence artifacts; the model computer may remain behind its existing
FRP endpoint. See [the Windows LAN worker deployment guide](../../docs/specs/windows-lan-worker-deployment.md).

Useful commands after the two machines are configured:

```bash
npm run profile:open -- --profile <profile-id> --url https://<seller-center-url>
npm run service
npm run worker -- --watch
npm run dispatch -- --file <shadow-job.json>
npm run monitor -- --run <run-id> --watch --download-screenshot
```

Real Seller Center validation requires the multimodal image path. Use the private image ingress
over an FRP STCP visitor rather than a public image directory; see [the private vision guide](../../docs/specs/private-vision-over-frp-stcp.md).

For the full store-manager Windows setup and R1 recording workflow across TikTok orders, after-sales,
inventory, HCRD, reviews, and messages, see [the operations SOP](../../docs/specs/store-manager-windows-operations-sop.md).
