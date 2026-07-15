@echo off
setlocal
set "ROOT=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%apps\web\scripts\start-store-manager.ps1"
if errorlevel 1 (
  echo.
  echo 达人工作台启动失败，请把上方错误交给店长电脑 Agent。
  pause
)
endlocal
