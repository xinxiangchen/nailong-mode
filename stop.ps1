$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot
$pidFile = Join-Path $root 'server.pid'
$port = 8899

$stopped = $false
if (Test-Path -LiteralPath $pidFile) {
    $serverPid = [int](Get-Content -LiteralPath $pidFile -Raw).Trim()
    $proc = Get-Process -Id $serverPid -ErrorAction SilentlyContinue
    $isOurs = $false
    if ($proc) {
        try {
            $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction Stop
            $isOurs = $cim.CommandLine -like '*server.py*'
        } catch {}
        if (-not $isOurs) {
            try {
                $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
                $isOurs = $health.app -eq 'nailong-laugh-challenge'
            } catch {}
        }
        if ($isOurs) {
            Stop-Process -Id $serverPid -Force
            $stopped = $true
        }
    }
    Remove-Item -LiteralPath $pidFile -Force
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener -and -not $stopped) {
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        if ($health.app -eq 'nailong-laugh-challenge') {
            Stop-Process -Id $listener.OwningProcess -Force
            $stopped = $true
        }
    } catch {}
}

if ($stopped) { Write-Host "奶龙模仿挑战已停止。" } else { Write-Host "奶龙模仿挑战没有在运行（或 8899 端口属于其他程序，未做处理）。" }
