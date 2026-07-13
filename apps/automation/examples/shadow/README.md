# Shadow 只读任务模板

这些文件通过监控电脑执行 `npm run dispatch -- --file <file>` 提交到店长 Windows worker。

提交前必须替换所有 `<...>` 字段，尤其是 `url`、店铺别名、profile ID、日期和分页范围。`AUTOMATION_MODE=shadow` 是 Windows worker 的唯一权威设置；模板无法提升权限，所有 R2/R3 写入仍被禁止。

每次新快照应使用新的 `entityId` 和 `sourceTaskId`。相同业务输入会命中幂等键，不会生成第二份源数据快照。

首次真实会话每个模块只提交一个任务。TikTok 页面任务使用 `first-page`、`first-50` 或当天增量；HCRD 现货任务通过已登录 profile 的同源 `JSESSIONID` 调用只读库存接口并完成全部分页，默认每页 200 条，同时只让多模态模型核对当前截图中最多 5 行。成功后可从监控电脑用 `npm run records -- --definition <definition-id>` 查看验证过的本地源数据快照。

完成 `hcrd.inventory.sync`、`tiktok.inventory.sync`（和可选的 `hcrd.inventory.sync_in_transit`）后，编辑 `inventory-reconcile.json` 并运行 `npm run inventory:reconcile -- --file inventory-reconcile.json`。它只做本地确定性对账，不能打开浏览器或保存 TikTok 库存。
