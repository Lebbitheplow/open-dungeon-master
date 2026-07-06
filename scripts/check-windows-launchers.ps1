$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Repo = Resolve-Path (Join-Path $PSScriptRoot "..")

# The primary launcher lives at the repo root for double-click discovery; the
# secondary tools live in windows\ and cd up one level to the repo root.
$Launchers = @(
  @{
    Path = "Launch-Windows.bat"
    Cd = 'cd /d "%~dp0"'
    Command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-windows.ps1"'
  },
  @{
    Path = "windows\Launch-Windows-CPU.bat"
    Cd = 'cd /d "%~dp0.."'
    Command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\launch-windows.ps1" -CpuOnly'
  },
  @{
    Path = "windows\Launch-Windows-Image-Smoke.bat"
    Cd = 'cd /d "%~dp0.."'
    Command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\smoke-windows-image.ps1"'
  },
  @{
    Path = "windows\Launch-Windows-Image-Smoke-CPU.bat"
    Cd = 'cd /d "%~dp0.."'
    Command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\smoke-windows-image.ps1" -CpuOnly'
  },
  @{
    Path = "windows\Launch-Windows-Image-Loop.bat"
    Cd = 'cd /d "%~dp0.."'
    Command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\run-windows-image-loop.ps1" -Device both -Count 1 -DiagnoseOnSuccess'
  },
  @{
    Path = "windows\Stop-Windows.bat"
    Cd = 'cd /d "%~dp0.."'
    Command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\stop-windows.ps1"'
  },
  @{
    Path = "windows\Diagnose-Windows.bat"
    Cd = 'cd /d "%~dp0.."'
    Command = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\diagnose-windows.ps1" -IncludeLogTails'
  }
)

foreach ($launcher in $Launchers) {
  $path = Join-Path $Repo $launcher.Path
  if (-not (Test-Path $path)) {
    throw "Missing Windows launcher: $($launcher.Path)"
  }

  $lines = Get-Content -LiteralPath $path
  $text = $lines -join "`n"

  if ($lines.Count -lt 5) {
    throw "$($launcher.Path) is unexpectedly short."
  }
  if ($lines[0].Trim() -ne "@echo off") {
    throw "$($launcher.Path) must start with '@echo off'."
  }
  if ($text -notmatch '(?m)^setlocal$') {
    throw "$($launcher.Path) is missing setlocal."
  }
  if (-not $text.Contains($launcher.Cd)) {
    throw "$($launcher.Path) is missing repo-root cd command: $($launcher.Cd)"
  }
  if (-not $text.Contains($launcher.Command)) {
    throw "$($launcher.Path) is missing expected PowerShell command: $($launcher.Command)"
  }
  if ($text -notmatch '(?m)^if errorlevel 1 \($') {
    throw "$($launcher.Path) is missing the failure pause block."
  }

  $blockDepth = 0
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $trimmed = $lines[$i].Trim()
    if ($trimmed -match '^if errorlevel 1 \($') {
      $blockDepth += 1
      continue
    }
    if ($trimmed -eq ")") {
      $blockDepth -= 1
      if ($blockDepth -lt 0) {
        throw "$($launcher.Path): unmatched ')' on line $($i + 1)."
      }
    }
  }
  if ($blockDepth -ne 0) {
    throw "$($launcher.Path): unclosed parenthesized block."
  }
}

Write-Host "Windows batch launcher checks passed."
