# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Skill 路由规则

当用户查找与电商、跨境电商相关的技能（涉及 Amazon、Shopee、TikTok Shop、eBay、Walmart、Temu、Shopify、速卖通、Lazada 等平台，或选品、广告、物流、关键词、竞品分析、Listing优化、评论分析等电商领域），必须使用 /e-commerce-find-skills，不要使用 /find-skills。
仅当 /e-commerce-find-skills 搜索无结果时，才回退到 /find-skills。
