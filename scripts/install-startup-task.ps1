param(
    [string]$TaskName = "OmniDropHeadless"
)

$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "start-hidden.ps1"
if (-not (Test-Path $scriptPath)) {
    throw "start-hidden.ps1 not found at $scriptPath"
}

$arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
$triggerUser = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $triggerUser
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Start OmniDrop server in hidden mode at user logon." `
    -Force | Out-Null

Write-Output "Installed scheduled task: $TaskName"
