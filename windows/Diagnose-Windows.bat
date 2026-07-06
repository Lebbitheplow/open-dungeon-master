@echo off
setlocal
cd /d "%~dp0.."

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\diagnose-windows.ps1" -IncludeLogTails
if errorlevel 1 (
  echo.
  echo Open Dungeon diagnostics failed. See the PowerShell output above.
  pause
  exit /b 1
)

echo.
echo Open Dungeon diagnostics completed.
pause
