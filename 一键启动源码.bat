@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
title 灵兔AI电商客服 - 源码运行
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-source.ps1"
if errorlevel 1 (
  echo.
  echo 启动失败，请查看上方错误。按任意键关闭。
  pause >nul
)
