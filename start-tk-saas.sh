#!/bin/bash
# TK-SaaS 启动脚本
# 启动 n8n + Chatwoot + Dify API + Dify Web

echo "=== Starting TK-SaaS Services ==="

# Redis
redis-cli ping > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "Starting Redis..."
  brew services start redis
  sleep 2
fi

# PostgreSQL
pg_isready > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "Starting PostgreSQL..."
  # 清理可能存在的 stale PID 文件（异常关机后常见）
  if [ -f /opt/homebrew/var/postgresql@16/postmaster.pid ]; then
    rm -f /opt/homebrew/var/postgresql@16/postmaster.pid
  fi
  brew services start postgresql@16 || pg_ctl -D /opt/homebrew/var/postgresql@16 start -l /tmp/postgresql.log
  sleep 4
fi

# n8n
echo "Starting n8n (port 5678)..."
export $(grep -v '^#' ~/.n8n/.env | xargs) 2>/dev/null
nohup n8n > /tmp/n8n.log 2>&1 &
sleep 3

# Chatwoot
echo "Starting Chatwoot (port 3000 + Vite 3036 + Sidekiq)..."
export PATH="/opt/homebrew/opt/ruby@3.4/bin:$PATH"
cd /Users/hanrui/chatwoot
nohup bundle exec rails server -b 0.0.0.0 -p 3000 > /tmp/chatwoot.log 2>&1 &
nohup bin/vite dev > /tmp/chatwoot-vite.log 2>&1 &
nohup bundle exec sidekiq -C config/sidekiq.yml > /tmp/chatwoot-sidekiq.log 2>&1 &
sleep 8

# Dify Plugin Daemon
echo "Starting Dify Plugin Daemon (port 5002)..."
cd /Users/hanrui/dify/plugin-daemon
set -a && source /Users/hanrui/dify/plugin-daemon/.env && set +a
nohup /Users/hanrui/dify/plugin-daemon/dify-plugin-daemon-server > /tmp/dify-plugin-daemon.log 2>&1 &
sleep 4

# Dify API
echo "Starting Dify API (port 5001)..."
# 清理 Plugin Daemon 遗留的 DB 环境变量，避免 Dify API 连错数据库
unset DB_HOST DB_PORT DB_USERNAME DB_PASSWORD DB_DATABASE
cd /Users/hanrui/dify/api
lsof -ti :5001 | xargs -r kill -9 2>/dev/null
nohup .venv/bin/gunicorn --no-control-socket --bind 0.0.0.0:5001 --workers 1 --worker-class geventwebsocket.gunicorn.workers.GeventWebSocketWorker --worker-connections 10 --timeout 200 app:socketio_app > /tmp/dify.log 2>&1 &
sleep 6

# Dify Web (production mode, 更省内存)
echo "Starting Dify Web (port 3010, production mode)..."
cd /Users/hanrui/dify/web
PORT=3010 nohup pnpm start > /tmp/dify-web.log 2>&1 &
sleep 4

echo ""
echo "=== All TK-SaaS Services Started ==="
echo "n8n:       http://localhost:5678"
echo "Chatwoot:  http://localhost:3000"
echo "Dify API:  http://localhost:5001"
echo "Dify Web:  http://localhost:3010"
echo ""
echo "Chatwoot admin: admin@tk-saas.com / Admin123!"
echo "Dify admin:     admin@tk-saas.com / Admin123!"
echo ""
echo "请手动在浏览器中打开以上链接进行测试。"
