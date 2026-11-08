# remove-autostart.ps1 - Unregisters NoFollow Web Agent from Windows Task Scheduler
[CmdletBinding()]
param(
    [string]$TaskName = "NoFollowWebAgent"
)

$ErrorActionPreference = "Stop"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   NoFollow Web - Remove Windows Automatic Agent Startup   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

try {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[OK] Windows Task '$TaskName' has been cleanly removed." -ForegroundColor Green
    } else {
        Write-Host "[-] Windows Task '$TaskName' is not registered. Nothing to remove." -ForegroundColor Yellow
    }
} catch {
    Write-Error "Failed to remove Scheduled Task: $_"
    exit 1
}
