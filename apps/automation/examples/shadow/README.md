# Shadow 只读任务模板

这些文件通过监控电脑执行 `npm run dispatch -- --file <file>` 提交到店长 Windows worker。

提交前必须替换所有 `<...>` 字段，尤其是 `url`、店铺别名、profile ID、日期和分页范围。`AUTOMATION_MODE=shadow` 是 Windows worker 的唯一权威设置；模板无法提升权限，所有 R2/R3 写入仍被禁止。

每次新快照应使用新的 `entityId` 和 `sourceTaskId`。相同业务输入会命中幂等键，不会生成第二份源数据快照。

首次真实会话每个模块只提交一个任务。TikTok 订单、售后等页面任务仍使用 `first-page`、`first-50` 或当天增量；TikTok 库存任务通过页面自身的会话 API 完成全部可见分页。HCRD 现货任务通过已登录 profile 的同源 `JSESSIONID` 调用只读库存接口并完成全部分页，默认每页 200 条。两种库存任务都只让多模态模型核对当前截图中最多 5 行。成功后可从监控电脑用 `npm run records -- --definition <definition-id>` 查看验证过的本地源数据快照。

完成 `hcrd.inventory.sync`、`tiktok.inventory.sync`（和可选的 `hcrd.inventory.sync_in_transit`）后，编辑 `inventory-reconcile.json` 并运行 `npm run inventory:reconcile -- --file inventory-reconcile.json`。它只做本地确定性对账，不能打开浏览器或保存 TikTok 库存。

达人只读采集使用 `echotik-creators-search.json` 和 `echotik-creator-detail.json`。先在店长电脑建立独立 `echotik-main` profile 并人工登录；搜索模板首轮固定 `maxPages: 1`，先确认筛选条件、会员限制和模型视觉证据，再逐步扩大。详情模板每次只查一个达人，必须返回最近十条视频的真实 ID、日期、播放量和商品关联；缺失就记录缺口，不能用平均值补齐。采集结果可导出/归一化后导入 `apps/web` 达人工作台。

`mapping.entries` 支持两种经过确认的关系：`direct` 表示一个 HCRD SKU 对应一个 TikTok SKU ID；`bundle` 表示多个 HCRD 组件共同组成一个 TikTok SKU。组合 SKU 的 HCRD 可用量按 `min(floor(组件可用量 / 单套用量))` 计算，不能把组件库存相加。`estrella-hcrd-sku-mapping-v1.json` 保存了由订单号和物流单号交叉验证得到的首批映射及赠品组合规则。
