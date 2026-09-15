@echo off
chcp 65001 >nul
title DeepSeek Harness 离线高阶破甲环境
echo ========================================================
echo   正在启动 DeepSeek Harness Web 界面 (端口 3080)...
echo ========================================================
start "" "http://127.0.0.1:3080"
cmd /c "dsh web --port 3080"
pause
