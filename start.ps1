$ErrorActionPreference = 'Stop'
$port = 8899
$root = $PSScriptRoot

$existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        if ($health.app -eq 'nailong-laugh-challenge') {
            Start-Process "http://127.0.0.1:$port/"
            Write-Host "奶龙模仿挑战已经在运行: http://127.0.0.1:$port/"
            exit 0
        }
    } catch {}
    throw "端口 $port 被其他程序占用了。请先关闭占用 8899 端口的程序，或运行 python server.py 让它自动选择其他端口。"
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "没有找到 python，请先安装 Python 3。" }

$proc = Start-Process -FilePath $python -ArgumentList @('server.py') `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $root 'server.log') `
    -RedirectStandardError (Join-Path $root 'server-error.log')

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 400
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        if ($health.ok -eq $true) { $ready = $true; break }
    } catch {}
}

if (-not $ready) {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    throw "服务器没有启动成功，请查看 server-error.log。"
}

Set-Content -LiteralPath (Join-Path $root 'server.pid') -Value $proc.Id -Encoding ascii
Start-Process "http://127.0.0.1:$port/"
Write-Host "奶龙模仿挑战已启动: http://127.0.0.1:$port/"
