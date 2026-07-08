# n8n Credentials Configuration Guide

## 1. OpenAI (for Qwen model)
- Type: OpenAI
- API Key: (any value, e.g., "not-used")
- Base URL: http://192.168.9.111:8080/v1

## 2. WhatsApp
- Use "WhatsApp Business Cloud API" credential
- Need: Phone Number ID, Permanent Access Token from Meta Business Platform
- Or use: WhatsApp Web API (unofficial, for personal testing)

## 3. Email (SMTP)
- Type: SMTP
- Configure your email provider credentials

## 4. Chatwoot Webhook
- Chatwoot can send webhooks to n8n
- In Chatwoot: Settings → Integrations → Webhook → http://localhost:5678/webhook/chatwoot

## 5. Dify API
- Dify API endpoint: http://localhost:5001/v1
- API Key: (generate in Dify console)
