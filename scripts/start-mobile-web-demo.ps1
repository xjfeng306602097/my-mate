$ErrorActionPreference = "Stop"

$workspace = "C:\project\my-mate"
$mobileDir = Join-Path $workspace "apps\mobile"
$logDir = Join-Path $workspace "tmp\mobile-web-demo"
$logPath = Join-Path $logDir "web.out.log"
$errLogPath = Join-Path $logDir "web.err.log"
$port = 19007

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -and $_.CommandLine -match "expo start --web" -and $_.CommandLine -match "apps\\mobile"
}

foreach ($proc in $existing) {
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
  } catch {
  }
}

if (Test-Path $logPath) {
  Remove-Item -LiteralPath $logPath -Force
}
if (Test-Path $errLogPath) {
  Remove-Item -LiteralPath $errLogPath -Force
}

$env:EXPO_PUBLIC_MY_MATE_API_BASE_URL = "http://127.0.0.1:4030"

$process = Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "web", "--", "--port", "$port", "--clear") `
  -WorkingDirectory $mobileDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errLogPath `
  -PassThru

$deadline = (Get-Date).AddSeconds(120)
$started = $false

while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port" -TimeoutSec 5
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      $started = $true
      break
    }
  } catch {
  }

  if ($process.HasExited) {
    break
  }
}

if (-not $started) {
  Write-Output "START_FAILED"
  if (Test-Path $logPath) {
    Get-Content -Tail 160 $logPath
  }
  if (Test-Path $errLogPath) {
    Get-Content -Tail 160 $errLogPath
  }
  exit 1
}

Write-Output "STARTED http://127.0.0.1:$port"
Write-Output "PID $($process.Id)"
Get-Content -Tail 80 $logPath
