# EchoTik Creator CRM Design

## Goal

Upgrade the Creator Leads module into a visual CRM workspace for the first EchoTik-based creator screening wave.

The page must help operators import EchoTik CSV/Excel exports, identify qualified Black women hair creators, inspect why each creator passed or failed, supplement contact information manually, and move creators through a collaboration funnel. The first build focuses on screening and contact preparation, not automated outreach.

## Source And Scope

EchoTik free data is treated as the screening source.

Expected available fields:

- TikTok user ID or creator handle
- Follower count
- Recent video view counts
- Recent video publish dates
- High-performing video cover image when available
- Product-associated video list when available
- Matching keywords or video/category text when available

Fields not expected from EchoTik:

- Creator email
- Creator off-platform contact details
- Direct TikTok profile URL
- A reliable boolean that says "has sold before"

The system should infer "has sold before" from product-associated videos. TikTok profile links are generated from the available creator handle or user ID and remain editable in the detail panel.

## Search Keywords

The first screening keyword set is:

- drawstring ponytail
- half wig
- wig
- crochet hair
- braids
- black girl

These should appear as visible chips in the page header, filters, creator cards, and detail drawer when matched.

## Screening Rules

A creator passes first-wave screening when all of these are true:

- Follower count is greater than 1000.
- At least 6 of the latest 10 videos have more than 1000 views.
- The creator posted within the last 30 days.
- Product-associated videos exist, which means there is an indirect prior selling or product-tagging signal.
- At least one target keyword matches creator content or tags.

If required data is missing, the creator should remain visible but show a clear evidence gap rather than being silently dropped.

## CRM Funnel

The full CRM funnel is:

1. Imported
2. Qualified
3. Needs contact
4. Ready to contact
5. Contacted
6. Replied
7. Sample sent
8. Published
9. Review

The first build must support the full status model, filters, and manual status changes. It should not send messages automatically.

## Page Structure

The Creator Leads module becomes a visual CRM workspace instead of a plain task list.

Top area:

- EchoTik import action for CSV/Excel.
- Screening rule summary.
- Keyword chips.
- Metrics for imported creators, qualified creators, creators needing contact, and published creators.

Main area:

- Funnel/status filters.
- Visual creator cards.
- Each card uses the highest-view recent video cover as the primary image. Avatar or a neutral image is only a fallback when the cover is missing.
- Each card shows creator name, TikTok ID, short description, key screening evidence, matched keywords, CRM status, and score bars.

Right detail drawer:

- Creator profile summary.
- TikTok profile link.
- Screening evidence.
- Contact checklist.
- Manual contact fields for email, Instagram, and notes.
- CRM status controls.
- AI first-message area as a reserved disabled or draft placeholder, without generating or sending outreach in this version.

## Visual Direction

Keep the existing TK-SaaS internal console style:

- Dense but scannable operations UI.
- White and warm gray base.
- Charcoal text.
- Teal, amber, red, green, blue, and indigo semantic accents.
- 8px radius or less.
- Thin dividers.
- Minimal shadows.
- No landing page, hero, marketing copy, decorative blobs, or nested card-heavy layout.

Unlike the old task-only Creator Leads page, this surface should be image-led. The user should be able to scan each creator visually before reading the evidence.

## Interaction Requirements

- Sidebar still switches to Creator Leads.
- Creator page supports status filtering and search/keyword filtering where practical.
- Selecting a creator card updates the right detail drawer.
- Manual status buttons update the selected creator and card state.
- Contact fields can be typed into and retained in local UI state.
- Import action opens a lightweight modal explaining the EchoTik CSV/Excel lane and supported fields.
- AI outreach is visibly reserved but not active.

## Testing

Business logic must be covered with Vitest:

- Screening rules classify qualified creators correctly.
- Missing evidence does not disappear; it records clear reasons.
- Metrics count imported, qualified, needs-contact, and published creators.
- Status updates can move a creator through the CRM funnel.
- TikTok profile URLs are generated from handles or user IDs.

Build verification must include:

- `npm test`
- `npm run build`
- Local browser screenshot after running the app.
