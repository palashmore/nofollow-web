# check-agent.ps1 - Health, Scheduled Task, and Process Diagnostics for NoFollow Web Agent
[CmdletBinding()]
param(
    [string]$TaskName = "NoFollowWebAgent",
    [int]$Port = 4173
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "         NoFollow Web - Agent Diagnostics & Health        " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Scheduled Task Status
Write-Host ""
Write-Host "1. Windows Scheduled Task Status:" -ForegroundColor Yellow
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "  [OK] Task Name:    $($task.TaskName)" -ForegroundColor Green
    Write-Host "  [OK] State:        $($task.State)" -ForegroundColor Green
    Write-Host "  [i] Last Run:     $($info.LastRunTime)"
    Write-Host "  [i] Last Result:  $($info.LastTaskResult)"
    Write-Host "  [i] Next Run:     $($info.NextRunTime)"
} else {
    Write-Host "  [-] Scheduled Task '$TaskName' is not registered." -ForegroundColor DarkYellow
}

# 2. Port & Process Listening Status
Write-Host ""
Write-Host "2. Local Loopback Port ($Port) Status:" -ForegroundColor Yellow
$conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Listen" }
if ($conn) {
    $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
    Write-Host "  [OK] Port $Port is ACTIVE and LISTENING on 127.0.0.1" -ForegroundColor Green
    Write-Host "  [OK] Owning Process: $($proc.ProcessName) (PID: $($proc.Id))" -ForegroundColor Green
    Write-Host "  [i] Memory Working Set: $([math]::Round($proc.WorkingSet64 / 1MB, 2)) MB"
} else {
    Write-Host "  [-] No process is currently listening on port $Port." -ForegroundColor DarkYellow
}

# 3. HTTP Health & Ping Verification
Write-Host ""
Write-Host "3. Local Agent API Health Check:" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/ping" -TimeoutSec 3 -ErrorAction Stop
    Write-Host "  [OK] HTTP Ping: SUCCESS" -ForegroundColor Green
    Write-Host "  [OK] Application: $($response.app)" -ForegroundColor Green
    Write-Host "  [OK] Agent PID:   $($response.pid)" -ForegroundColor Green
    if ($response.pairing) {
        Write-Host "  [i] Pairing Status: $($response.pairing.status)"
        Write-Host "  [i] Active Sessions: $($response.pairing.activeSessions)"
    }
} catch {
    Write-Host "  [X] Could not query http://127.0.0.1:$Port/api/ping: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Cyan
