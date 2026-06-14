param(
  [switch]$IncludeLogTails
)

$ErrorActionPreference = "Continue"
$Repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Repo

$LogDir = Join-Path $Repo "logs"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogPath = Join-Path $LogDir ("windows-diagnostics-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-DiagnosticLine($Message = "") {
  $text = [string]$Message
  Write-Host $text
  Add-Content -LiteralPath $LogPath -Value $text -Encoding UTF8
}

function Write-DiagnosticSection($Title) {
  Write-DiagnosticLine ""
  Write-DiagnosticLine ("== {0} ==" -f $Title)
}

function Test-DiagnosticCommand($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-DiagnosticCommand($Title, $Exe, [string[]]$CommandArgs = @()) {
  Write-DiagnosticSection $Title
  if (-not (Test-DiagnosticCommand $Exe) -and -not (Test-Path $Exe)) {
    Write-DiagnosticLine ("{0} not found." -f $Exe)
    return
  }

  Write-DiagnosticLine ("> {0} {1}" -f $Exe, ($CommandArgs -join " "))
  try {
    $output = & $Exe @CommandArgs 2>&1
    if ($LASTEXITCODE -ne $null) {
      Write-DiagnosticLine ("exit_code={0}" -f $LASTEXITCODE)
    }
    if ($output) {
      $output | ForEach-Object { Write-DiagnosticLine $_ }
    } else {
      Write-DiagnosticLine "(no output)"
    }
  } catch {
    Write-DiagnosticLine ("failed: {0}" -f $_.Exception.Message)
  }
}

function Invoke-DiagnosticHttpJson($Title, $Url) {
  Write-DiagnosticSection $Title
  Write-DiagnosticLine ("> GET {0}" -f $Url)
  try {
    $response = Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 -Uri $Url
    $json = $response | ConvertTo-Json -Depth 8
    Write-DiagnosticLine $json
  } catch {
    Write-DiagnosticLine ("not reachable: {0}" -f $_.Exception.Message)
  }
}

function Get-UltraFastImageGenDir {
  if ($env:ULTRA_FAST_IMAGE_GEN_DIR) {
    $expanded = [Environment]::ExpandEnvironmentVariables($env:ULTRA_FAST_IMAGE_GEN_DIR)
    if ($expanded -eq "~") {
      return $HOME
    }
    if ($expanded.StartsWith("~\") -or $expanded.StartsWith("~/")) {
      return Join-Path $HOME $expanded.Substring(2)
    }
    return $expanded
  }
  return Join-Path $HOME "ultra-fast-image-gen"
}

function Write-FileTail($Path, $Title, $LineCount = 80) {
  Write-DiagnosticSection $Title
  if (-not (Test-Path $Path)) {
    Write-DiagnosticLine ("Missing: {0}" -f $Path)
    return
  }

  Write-DiagnosticLine ("Path: {0}" -f $Path)
  Get-Content -LiteralPath $Path -Tail $LineCount -ErrorAction SilentlyContinue |
    ForEach-Object { Write-DiagnosticLine $_ }
}

function Write-PythonProbe($PythonExe, $Title) {
  Write-DiagnosticSection $Title
  if (-not (Test-Path $PythonExe)) {
    Write-DiagnosticLine ("Missing Python executable: {0}" -f $PythonExe)
    return
  }

  $probe = @"
import os
import sys

print(f"python={sys.version.split()[0]}")
try:
    import torch
    print(f"torch={torch.__version__}")
    print(f"cuda_available={torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"cuda_device={torch.cuda.get_device_name(0)}")
        print(f"cuda_version={torch.version.cuda}")
except Exception as exc:
    print(f"torch_probe_error={exc}")

try:
    import torchvision
    print(f"torchvision={torchvision.__version__}")
except Exception as exc:
    print(f"torchvision_probe_error={exc}")

print(f"IMAGE_SERVER_DEVICE={os.environ.get('IMAGE_SERVER_DEVICE', '')}")
print(f"ULTRA_FAST_IMAGE_GEN_DIR={os.environ.get('ULTRA_FAST_IMAGE_GEN_DIR', '')}")
"@

  try {
    $output = & $PythonExe -c $probe 2>&1
    if ($LASTEXITCODE -ne $null) {
      Write-DiagnosticLine ("exit_code={0}" -f $LASTEXITCODE)
    }
    $output | ForEach-Object { Write-DiagnosticLine $_ }
  } catch {
    Write-DiagnosticLine ("failed: {0}" -f $_.Exception.Message)
  }
}

Write-DiagnosticLine "Open Dungeon Windows diagnostics"
Write-DiagnosticLine ("timestamp={0}" -f (Get-Date -Format o))
Write-DiagnosticLine ("repo={0}" -f $Repo)
Write-DiagnosticLine ("log={0}" -f $LogPath)

Write-DiagnosticSection "Windows"
try {
  $os = Get-CimInstance Win32_OperatingSystem
  Write-DiagnosticLine ("caption={0}" -f $os.Caption)
  Write-DiagnosticLine ("version={0}" -f $os.Version)
  Write-DiagnosticLine ("build={0}" -f $os.BuildNumber)
  Write-DiagnosticLine ("architecture={0}" -f $os.OSArchitecture)
} catch {
  Write-DiagnosticLine ("os_probe_error={0}" -f $_.Exception.Message)
}
Write-DiagnosticLine ("powershell={0}" -f $PSVersionTable.PSVersion)

Invoke-DiagnosticCommand "Repository commit" "git" @("rev-parse", "--short", "HEAD")
Invoke-DiagnosticCommand "Repository status" "git" @("status", "--short", "--branch")
Invoke-DiagnosticCommand "Node" "node" @("-v")
Invoke-DiagnosticCommand "npm" "npm" @("-v")
Invoke-DiagnosticCommand "Python launcher" "py" @("-0p")
Invoke-DiagnosticCommand "Python" "python" @("--version")
Invoke-DiagnosticCommand "Git" "git" @("--version")
Invoke-DiagnosticCommand "NVIDIA driver" "nvidia-smi" @("--query-gpu=name,driver_version,memory.total", "--format=csv,noheader")
Invoke-DiagnosticCommand "Ollama version" "ollama" @("--version")
Invoke-DiagnosticCommand "Ollama models" "ollama" @("list")

Invoke-DiagnosticHttpJson "Open Dungeon app health" "http://127.0.0.1:3000/api/health"
Invoke-DiagnosticHttpJson "Ollama health" "http://127.0.0.1:11434/api/version"
Invoke-DiagnosticHttpJson "Image worker health" "http://127.0.0.1:7869/health"

$UltraDir = Get-UltraFastImageGenDir
Write-DiagnosticSection "ultra-fast-image-gen"
Write-DiagnosticLine ("path={0}" -f $UltraDir)
if (Test-Path $UltraDir) {
  Push-Location $UltraDir
  try {
    Invoke-DiagnosticCommand "ultra-fast-image-gen commit" "git" @("rev-parse", "--short", "HEAD")
    Invoke-DiagnosticCommand "ultra-fast-image-gen status" "git" @("status", "--short", "--branch")
  } finally {
    Pop-Location
  }

  $Generate = Join-Path $UltraDir "generate.py"
  if (Test-Path $Generate) {
    Write-DiagnosticLine ("generate.py=present")
  } else {
    Write-DiagnosticLine "generate.py=missing"
  }

  $VenvPython = Join-Path $UltraDir ".venv\Scripts\python.exe"
  Write-PythonProbe $VenvPython "ultra-fast-image-gen Python probe"
} else {
  Write-DiagnosticLine "checkout=missing"
}

$LatestImageServerLog = Join-Path $LogDir "windows-image-server-latest.txt"
if (Test-Path $LatestImageServerLog) {
  $ImageServerLog = Get-Content -LiteralPath $LatestImageServerLog -TotalCount 1
  if ($ImageServerLog) {
    Write-DiagnosticLine ("latest_image_server_log={0}" -f $ImageServerLog)
    if ($IncludeLogTails) {
      Write-FileTail $ImageServerLog "Latest image server log tail"
    }
  }
}

if ($IncludeLogTails) {
  $latestSmokeLog = Get-ChildItem -Path $LogDir -Filter "windows-image-smoke-*.log" -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1
  if ($latestSmokeLog) {
    Write-FileTail $latestSmokeLog.FullName "Latest image smoke log tail"
  }
}

Write-DiagnosticLine ""
Write-DiagnosticLine ("Diagnostics written to {0}" -f $LogPath)
