@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\stop-windows.ps1"
if errorlevel 1 (
  echo.
  echo Open Dungeon stop failed. See the PowerShell output above.
  pause
  exit /b 1
)

echo.
echo Open Dungeon stopped.
pause
