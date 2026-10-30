@echo off
chcp 65001 >nul
echo ============================================
echo  千千静听 集成版歌词插件 部署/更新
echo ============================================
echo  [1/3] 关闭 TTPlayer ...
taskkill /IM TTPlayer.exe /F >nul 2>&1
timeout /t 2 >nul

echo  [2/3] 复制新插件 ...
copy /Y "%~dp0ttp_lrcsh_new.dll" "%~dp0..\ttp_lrcsh.dll"
if errorlevel 1 (
  echo 复制失败：文件被占用，请确认 TTPlayer 已完全退出。
  pause
  exit /b 1
)

echo  [3/3] 重新启动 TTPlayer ...
start "" "%~dp0..\..\TTPlayer.exe"
echo.
echo 完成。播一首歌，观察 Lyrics 目录下生成的 .lrc 是否正常中文。
pause
