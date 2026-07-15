param(
  [switch]$SkipDependencies
)

$ErrorActionPreference = "Stop"
$WebRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $WebRoot

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw "未找到 Node.js。请先在店长电脑安装 Node.js LTS，再重新运行本脚本。"
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "未找到 npm.cmd。请修复 Node.js 安装后重试。"
}

if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.store-manager.example" -Destination ".env"
  Write-Host "已创建 apps\web\.env；默认连接店长机 127.0.0.1:16081 模型 visitor。"
}

if (-not $SkipDependencies) {
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci 失败。" }
}

npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "达人工作台构建失败。" }

npm.cmd run creator:check
if ($LASTEXITCODE -ne 0) { throw "达人库初始化检查失败。" }

Write-Host "安装完成：达人库至少 188 人，本地数据目录和生产页面已就绪。"
