$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $repoRoot "tmp\main-openclaw-stack\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$projectSyncScript = Join-Path $PSScriptRoot "sync-openclaw-project-context.ps1"

$bridgeApiKey = "main-openclaw-bridge-key"
$callbackToken = "main-openclaw-callback-token"

function Stop-ServiceProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ServiceRoot
  )

  $escaped = [Regex]::Escape($ServiceRoot)
  $targets = Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "node.exe" -and
      $_.CommandLine -match $escaped -and
      $_.CommandLine -match "src/server.ts"
    }

  foreach ($target in $targets) {
    try {
      Stop-Process -Id $target.ProcessId -Force -ErrorAction Stop
    } catch {
      Write-Warning "Failed to stop PID $($target.ProcessId): $($_.Exception.Message)"
    }
  }
}

function Start-ServiceProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$WorkDir,
    [Parameter(Mandatory = $true)]
    [hashtable]$EnvVars
  )

  $stdout = Join-Path $logDir "$Name.out.log"
  $stderr = Join-Path $logDir "$Name.err.log"
  if (Test-Path $stdout) { Remove-Item -Force $stdout }
  if (Test-Path $stderr) { Remove-Item -Force $stderr }

  $lines = @(
    '$ErrorActionPreference = "Stop"',
    'Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false -Scope Script -ErrorAction SilentlyContinue',
    "Set-Location '$WorkDir'"
  )
  foreach ($entry in $EnvVars.GetEnumerator()) {
    $value = [string]$entry.Value
    $escapedValue = $value.Replace("'", "''")
    $lines += "`$env:$($entry.Key)='$escapedValue'"
  }
  $lines += "npm run dev 1>> '$stdout' 2>> '$stderr'"
  $command = $lines -join "`n"

  Start-Process powershell `
    -ArgumentList @("-NoProfile", "-Command", $command) `
    -WorkingDirectory $WorkDir `
    -WindowStyle Hidden | Out-Null

  return @{
    Name = $Name
    Stdout = $stdout
    Stderr = $stderr
  }
}

function Wait-ForHttpOk {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [Parameter(Mandatory = $true)]
    [string]$Label,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = "unknown"
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        return $response.Content
      }
      $lastError = "$($response.StatusCode) $($response.StatusDescription)"
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 500
  }

  throw "Timed out waiting for ${Label} at ${Url}: $lastError"
}

$controlPlaneDir = Join-Path $repoRoot "services\control-plane"
$executionAdapterDir = Join-Path $repoRoot "services\execution-adapter"
$apiGatewayDir = Join-Path $repoRoot "services\api-gateway"

Stop-ServiceProcesses -ServiceRoot $controlPlaneDir
Stop-ServiceProcesses -ServiceRoot $executionAdapterDir
Stop-ServiceProcesses -ServiceRoot $apiGatewayDir
Start-Sleep -Seconds 1

$projectSyncRaw = & $projectSyncScript | Where-Object { $_ -and $_.ToString().Trim() }
$projectSyncSummary =
  if ($projectSyncRaw) {
    ($projectSyncRaw -join "`n") | ConvertFrom-Json
  } else {
    $null
  }
$defaultProjectRepo =
  if (
    $projectSyncSummary -and
    $projectSyncSummary.PSObject.Properties.Name -contains "container_repo_dir" -and
    $projectSyncSummary.container_repo_dir
  ) {
    [string]$projectSyncSummary.container_repo_dir
  } else {
    "/workspace/openclaw-projects/my-mate"
  }

$executionAdapter = Start-ServiceProcess -Name "execution-adapter-4020" -WorkDir $executionAdapterDir -EnvVars @{
  PORT = "4020"
  MY_MATE_EXECUTION_ADAPTER_MODE = "container-exec"
  MY_MATE_EXECUTION_ADAPTER_API_KEY = $bridgeApiKey
  MY_MATE_OPENCLAW_GATEWAY_BASE_URL = "http://127.0.0.1:18789"
  MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL = "http://127.0.0.1:4315"
  MY_MATE_OPENCLAW_CONTAINER_NAME = "openclaw-local"
  MY_MATE_OPENCLAW_CONTAINER_EXECUTION_STRATEGY = "direct-agent"
  MY_MATE_OPENCLAW_DIRECT_AGENT_MODEL = "deepseek/deepseek-v4-pro"
  MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG = "my-mate"
  MY_MATE_OPENCLAW_DEFAULT_PROJECT_REPO = $defaultProjectRepo
}

$controlPlane = Start-ServiceProcess -Name "control-plane-4010" -WorkDir $controlPlaneDir -EnvVars @{
  PORT = "4010"
  MY_MATE_ENABLE_LOCAL_EXECUTION = "false"
  MY_MATE_EXECUTION_ADAPTER = "openclaw"
  MY_MATE_PUBLIC_BASE_URL = "http://127.0.0.1:4010"
  MY_MATE_OPENCLAW_BRIDGE_BASE_URL = "http://127.0.0.1:4020"
  MY_MATE_OPENCLAW_BRIDGE_API_KEY = $bridgeApiKey
  MY_MATE_OPENCLAW_CALLBACK_TOKEN = $callbackToken
  MY_MATE_OPENCLAW_BRIDGE_EXECUTION_MODE = "container-exec"
  MY_MATE_OPENCLAW_GATEWAY_BASE_URL = "http://127.0.0.1:18789"
  MY_MATE_OPENCLAW_APPROVAL_CONSOLE_BASE_URL = "http://127.0.0.1:4315"
  MY_MATE_OPENCLAW_CONTAINER_NAME = "openclaw-local"
  MY_MATE_PLANNER_PROVIDER = "local_semantic_v1"
  MY_MATE_OPENCLAW_DEFAULT_PROJECT_SLUG = "my-mate"
}

$apiGateway = Start-ServiceProcess -Name "api-gateway-4030" -WorkDir $apiGatewayDir -EnvVars @{
  PORT = "4030"
  MY_MATE_CONTROL_PLANE_BASE_URL = "http://127.0.0.1:4010"
}

$adapterHealth = Wait-ForHttpOk -Url "http://127.0.0.1:4020/health" -Label "execution-adapter"
$controlPlaneHealth = Wait-ForHttpOk -Url "http://127.0.0.1:4010/health" -Label "control-plane"
$apiGatewayHealth = Wait-ForHttpOk -Url "http://127.0.0.1:4030/health" -Label "api-gateway"

$sweepResponse = Invoke-WebRequest `
  -UseBasicParsing `
  -Method Post `
  -Uri "http://127.0.0.1:4010/api/internal/ops/execution/dispatch-sweep" `
  -ContentType "application/json" `
  -Body "{}" `
  -TimeoutSec 20

$summary = [ordered]@{
  started_at = (Get-Date).ToString("s")
  health = [ordered]@{
    execution_adapter = $adapterHealth | ConvertFrom-Json
    control_plane = $controlPlaneHealth | ConvertFrom-Json
    api_gateway = $apiGatewayHealth | ConvertFrom-Json
  }
  project_sync = $projectSyncSummary
  dispatch_sweep = $sweepResponse.Content | ConvertFrom-Json
  logs = [ordered]@{
    execution_adapter_out = $executionAdapter.Stdout
    execution_adapter_err = $executionAdapter.Stderr
    control_plane_out = $controlPlane.Stdout
    control_plane_err = $controlPlane.Stderr
    api_gateway_out = $apiGateway.Stdout
    api_gateway_err = $apiGateway.Stderr
  }
}

$summary | ConvertTo-Json -Depth 8
