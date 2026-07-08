# Real EchoTik Creator Module Plan

## Goal

Make the creator workspace use only real EchoTik/API/imported data for creator rows and videos. No synthetic creator/video evidence should be shown as if it came from EchoTik.

## Scope

- Keep the existing React/Vite internal ops UI.
- Use EchoTik Open API credentials already configured in `apps/web/.env` for manual sync.
- Keep file import as the batch path for EchoTik CSV/Excel/JSON.
- Keep outreach/AI messaging reserved; no automatic sending.

## Tasks

1. Extend creator/video normalization.
   - Preserve real summary metrics such as average 30-day views without turning them into fake video rows.
   - Map real video IDs, URLs, share URLs, covers, titles, dates, views, sales, and product flags from Open API and imports.
   - Record evidence gaps when video detail is missing.

2. Update creator UI.
   - Show an empty truthful state before data is imported/synced.
   - Add a video detail section in the creator drawer.
   - Let each video card open the real TikTok video when a real video URL or ID exists.

3. Tighten EchoTik sync/fetch flows.
   - Manual sync pulls real US 1K+ creators through EchoTik Open API and enriches the first page with video details.
   - Web internal API script can optionally fetch detail videos after a saved login state.
   - Do not auto-sync on page entry.

4. Verify.
   - Update unit tests for real-only video evidence.
   - Run `npm test` and `npm run build`.
   - Run a Playwright smoke import with a real-shaped video URL row.
