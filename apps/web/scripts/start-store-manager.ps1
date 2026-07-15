param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$WebRoot = Split-Path -Parent $PSScriptRoot
$HealthUrl = "http://127.0.0.1:5173/api/health"
$WorkbenchUrl = "http://127.0.0.1:5173/?section=creators"
Set-Location -LiteralPath $WebRoot

function Test-CreatorWorkbench {
  try {
    $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    return ($Health.ok -eq $true -and $Health.creatorCount -ge 188)
  } catch {
    return $false
  }
}

if (-not (Test-CreatorWorkbench)) {
  if (-not (Test-Path -LiteralPath "node_modules") -or -not (Test-Path -LiteralPath "dist\index.html")) {
    & (Join-Path $PSScriptRoot "install-store-manager.ps1")
  }

  $EscapedRoot = $WebRoot.Replace("'", "''")
  $Command = "Set-Location -LiteralPath '$EscapedRoot'; npm.cmd run start:manager"
  Start-Process powershell.exe -WorkingDirectory $WebRoot -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", $Command
  )

  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
    Start-Sleep -Seconds 1
    if (Test-CreatorWorkbench) {
      $Ready = $true
      break
    }
  }
  if (-not $Ready) {
    throw "达人工作台 30 秒内没有启动。请查看新开的 PowerShell 窗口。"
  }
}

$Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
Write-Host "达人工作台已就绪：$($Health.creatorCount) 人；数据目录 $($Health.dataDirectory)"
if (-not $NoBrowser) { Start-Process $WorkbenchUrl }
