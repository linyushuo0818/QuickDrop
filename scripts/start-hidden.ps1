param(
    [switch]$ForceRestart
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $repoRoot "server.js"

if (-not (Test-Path $serverScript)) {
    throw "server.js not found at $serverScript"
}

$nodeCmd = Get-Command node -ErrorAction Stop
$nodePath = $nodeCmd.Source

$escapedScript = [Regex]::Escape($serverScript)
$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -match $escapedScript
}

if ($running -and -not $ForceRestart) {
    Write-Output "OmniDrop is already running."
    exit 0
}

if ($running -and $ForceRestart) {
    $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

Start-Process `
    -FilePath $nodePath `
    -ArgumentList @($serverScript, "--panel=none") `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden

Write-Output "OmniDrop started in hidden mode."
