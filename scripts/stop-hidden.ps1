$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $repoRoot "server.js"
$escapedScript = [Regex]::Escape($serverScript)

$running = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -match $escapedScript
}

if (-not $running) {
    Write-Output "OmniDrop is not running."
    exit 0
}

$running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output "OmniDrop stopped."
