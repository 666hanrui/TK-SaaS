# TK-SaaS 完整连接参考

## 服务一览
| 服务 | 地址 | 说明 | 端口 |
|------|------|------|------|
| **n8n** | http://localhost:5678 | 工作流引擎（9个工作流已导入） | 5678 |
| **Chatwoot** | http://localhost:3000 | 全渠道客服平台 | 3000 |
| **Chatwoot Vite** | http://localhost:3036/vite-dev/ | Chatwoot 前端资源服务 | 3036 |
| **Dify API** | http://localhost:5001 | AI 编排引擎 | 5001 |
| **Dify Plugin Daemon** | http://localhost:5002 | Dify 插件守护进程 | 5002 |
| **Dify Web** | http://localhost:3010 | AI 编排 UI | 3010 |
| **Qwen 模型** | http://192.168.9.111:8080/v1 | 多模态 LLM | 8080 |

## 账号
- **Chatwoot 管理员**: admin@tk-saas.com / Admin123!
- **Chatwoot API Token**: aNss9fbe6DHhxd6G5H4pDQUT
- **Chatwoot Account ID**: 3
- **Chatwoot API Header**: `api_access_token`
- **Dify 管理员**: admin@tk-saas.com / Admin123!
- **Dify Workspace**: 默认 workspace
- **n8n API Key**: 8464ae8877923cfbed589e792e666ea7ce4162968bd6c525fc8f862935c16eb6（需先在 UI 创建用户后才能用于 REST API）

## 已导入 n8n 工作流
| # | 文件 | 功能 |
|---|------|------|
| 01 | order-timeout-monitor | 订单超时监控（每1小时） |
| 02 | morning-inventory-check | 上班库存核对（09:00每日） |
| 03 | aftersales-deadline-tracker | 售后截止跟踪（每4小时） |
| 04 | afternoon-review-check | 下午评价检查（15:30每日） |
| 05 | evening-stock-reconciliation | 下班库存复核（18:30每日） |
| 06 | qwen-paraphrase | 客服话术 AI 变体生成 |
| 07 | chatwoot-integration | Chatwoot 自动回复（意图分类+AI回复） |
| 08 | review-response | 评价回复生成（按评分分流） |
| 09 | influencer-outreach | 达人批量外联（反风控限频） |

## 系统互联方式

### n8n 调用 Qwen
```
HTTP Request → POST http://192.168.9.111:8080/v1/chat/completions
Headers: Content-Type: application/json
Body: { "model": "default", "messages": [...] }
```

### Chatwoot ↔ n8n
```
Chatwoot 设置 → 集成 → Webhook → http://localhost:5678/webhook/chatwoot
n8n 回复: POST http://localhost:3000/api/v1/accounts/3/conversations/{id}/messages
Header: api_access_token: aNss9fbe6DHhxd6G5H4pDQUT
```

### n8n → Dify
```
POST http://localhost:5001/v1/workflows/run
（需先在 Dify Web UI 中生成 API Key）
```

## API 测试命令
```bash
# 测试 Qwen 对话
curl -X POST http://192.168.9.111:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"default","messages":[{"role":"user","content":"hello"}]}'

# 测试 n8n paraphrase webhook
curl -X POST http://localhost:5678/webhook/paraphrase \
  -H "Content-Type: application/json" \
  -d '{"template":"Dear, we are sorry...","customerName":"Alice","scenario":"refund","channel":"whatsapp"}'

# 测试 Chatwoot API
curl http://localhost:3000/api/v1/accounts/3/conversations \
  -H "api_access_token: aNss9fbe6DHhxd6G5H4pDQUT"

# 测试 Dify API 健康
curl http://localhost:5001/health

# 测试 Dify 登录
curl -X POST http://localhost:5001/console/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@tk-saas.com","password":"Admin123!","language":"zh-Hans","remember_me":true}'
```

## 启动/停止
```bash
# 启动全部
~/start-tk-saas.sh

# 停止全部
kill $(lsof -ti :5678) $(lsof -ti :3000 | head -1) $(lsof -ti :5001) $(lsof -ti :3010)
```
