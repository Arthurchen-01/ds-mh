@echo off
chcp 65001 >nul
title DSH 离线免授权环境一键部署
echo ========================================================
echo   正在启动 DSH 离线免授权环境一键部署向导...
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_new_pc.ps1"
pause
