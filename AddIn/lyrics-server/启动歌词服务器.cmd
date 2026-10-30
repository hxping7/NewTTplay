@echo off
chcp 65001 >nul
cd /d %~dp0

REM 优先使用 WorkBuddy managed Node，其次系统 node
set "NODE=%LOCALAPPDATA%\..\..\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not exist "%NODE%" set "NODE=node"

echo ============================================
echo   TTPlayer 本地歌词服务器 (NCAB 替代实现)
echo   监听 127.0.0.1:89 - QQ音乐/酷狗/酷我
echo   按 Ctrl+C 停止
echo ============================================
"%NODE%" server.js
pause
