# install-autostart.ps1 - Registers NoFollow Web Agent in Windows Task Scheduler at User Logon
[CmdletBinding()]
param(
    [string]$TaskName = "NoFollowWebAgent",
    [string]$ProjectDir = $PSScriptRoot | Split-Path -Parent
)

$ErrorActionPreference = "Stop"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   NoFollow Web - Install Windows Automatic Agent Startup  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify Node.js availability
$nodePath = (Get-Command node -ErrorAction SilentlyContinue)?.Source
if (-not $nodePath) {
    Write-Error "Node.js executable was not found in PATH. Please ensure Node.js is installed."
    exit 1
}
Write-Host "[✓] Node.js located: $nodePath" -ForegroundColor Green

# 2. Verify Project Directory and unfollow.mjs
$entryFile = Join-Path $ProjectDir "unfollow.mjs"
if (-not (Test-Path $entryFile)) {
    Write-Error "Entry point unfollow.mjs not found at $entryFile"
    exit 1
}
Write-Host "[✓] Project Directory: $ProjectDir" -ForegroundColor Green

# 3. Create or update runner script for clean background execution
$launcherVbs = Join-Path $PSScriptRoot "run-agent-hidden.vbs"
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$ProjectDir"
WshShell.Run "node unfollow.mjs", 0, False
"@
Set-Content -Path $launcherVbs -Value $vbsContent -Encoding ASCII
Write-Host "[✓] Launcher script created: $launcherVbs" -ForegroundColor Green

# 4. Configure Task Scheduler Action & Trigger
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$launcherVbs`"" -WorkingDirectory $ProjectDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# 5. Configure Task Settings (Restart on failure, ignore duplicates, run on battery)
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -Priority 7

# 6. Register Task
try {
    # Remove existing task if already present
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Description "NoFollow Web Local Automation Agent. Automatically boots on user logon in idle state." | Out-Null

    Write-Host "`n[SUCCESS] Windows Task '$TaskName' successfully registered!" -ForegroundColor Green
    Write-Host "  Trigger: At logon for user '$env:USERNAME'"
    Write-Host "  Directory: $ProjectDir"
    Write-Host "  Safety Guard: Agent starts in IDLE mode. Zero mutations will run on startup." -ForegroundColor Yellow
} catch {
    Write-Error "Failed to register Scheduled Task: $_"
    exit 1
}
