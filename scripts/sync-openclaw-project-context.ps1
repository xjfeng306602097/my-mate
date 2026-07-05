param(
  [string]$SourceDir = (Join-Path (Split-Path -Parent $PSScriptRoot) ""),
  [string]$ProjectSlug = "my-mate",
  [string]$GithubUrl = "https://local.workspace/my-mate",
  [string]$ContainerName = "openclaw-local",
  [string]$ContainerRuntimeRoot = "/home/node/.openclaw/.openclaw"
)

$ErrorActionPreference = "Stop"
Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false -Scope Script -ErrorAction SilentlyContinue

function Invoke-DockerCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $output = & docker @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($Arguments -join ' ') failed: $output"
  }
  return ($output -join "`n")
}

$resolvedSourceDir = (Resolve-Path $SourceDir).Path
$repoRoot = Split-Path -Parent $PSScriptRoot
$stageRoot = Join-Path $repoRoot "tmp\openclaw-project-sync"
$syncStamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$stageDir = Join-Path $stageRoot "$ProjectSlug-$syncStamp"
$registryStagePath = Join-Path $stageRoot "registry-$syncStamp.json"

New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

$excludeDirs = @(".claude", ".codex-logs", "tmp", "node_modules")
$excludeFiles = @(
  ".debug-thread-evidence.png",
  ".debug-wide-orchestrator-workspace.png",
  ".api-gateway.dev.err.log",
  ".api-gateway.dev.log",
  ".api-gateway.live.err.log",
  ".api-gateway.live.log",
  ".control-plane.dev.err.log",
  ".control-plane.dev.log",
  ".control-plane.live.err.log",
  ".control-plane.live.log",
  ".mobile-web.dev.err.log",
  ".mobile-web.dev.log",
  ".tmp-api-gateway.log",
  ".tmp-control-plane.log",
  ".tmp-mobile-web.err.log",
  ".tmp-mobile-web.log",
  ".tmp-mobile-web.out.log",
  "tmp-mission-detail-2.json",
  "tmp-mission-detail.json",
  "tmp-api-gateway.log",
  "tmp-control-plane.log",
  "tmp-mobile-web.log"
)

$rootItems = Get-ChildItem -LiteralPath $resolvedSourceDir -Force
foreach ($item in $rootItems) {
  if ($item.PSIsContainer) {
    if ($excludeDirs -contains $item.Name) {
      continue
    }

    $destination = Join-Path $stageDir $item.Name
    $null = robocopy $item.FullName $destination /MIR /XD node_modules .git tmp .claude .codex-logs | Out-Null
    if ($LASTEXITCODE -gt 7) {
      throw "robocopy failed while copying '$($item.FullName)' (exit $LASTEXITCODE)."
    }
    continue
  }

  if ($excludeFiles -contains $item.Name) {
    continue
  }

  Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $stageDir $item.Name) -Force
}

$containerProjectsRoot = "/workspace/openclaw-projects"
$containerIncomingDir = "$containerProjectsRoot/__incoming-$ProjectSlug-$syncStamp"
$containerRepoDir = "$containerProjectsRoot/$ProjectSlug-$syncStamp"
$containerReqDir = "$containerRepoDir/.openclaw-requirements"

Invoke-DockerCommand -Arguments @("exec", "-u", "0", $ContainerName, "mkdir", "-p", $containerProjectsRoot)
Invoke-DockerCommand -Arguments @("exec", "-u", "0", $ContainerName, "rm", "-rf", $containerIncomingDir)
Invoke-DockerCommand -Arguments @("cp", $stageDir, "${ContainerName}:${containerIncomingDir}")
Invoke-DockerCommand -Arguments @("exec", "-u", "0", $ContainerName, "mv", $containerIncomingDir, $containerRepoDir)
Invoke-DockerCommand -Arguments @("exec", "-u", "0", $ContainerName, "mkdir", "-p", $containerReqDir)
Invoke-DockerCommand -Arguments @("exec", "-u", "0", $ContainerName, "chmod", "-R", "a+rwX", $containerRepoDir)
Invoke-DockerCommand -Arguments @("exec", $ContainerName, "git", "config", "--global", "--add", "safe.directory", $containerRepoDir)
Invoke-DockerCommand -Arguments @("exec", $ContainerName, "rm", "-f", "$containerRepoDir/.git/index.lock")
Invoke-DockerCommand -Arguments @("exec", $ContainerName, "git", "-C", $containerRepoDir, "init", "-q")
Invoke-DockerCommand -Arguments @("exec", $ContainerName, "git", "-C", $containerRepoDir, "config", "user.name", "OpenClaw Local Sync")
Invoke-DockerCommand -Arguments @("exec", $ContainerName, "git", "-C", $containerRepoDir, "config", "user.email", "openclaw-local@example.invalid")
Invoke-DockerCommand -Arguments @("exec", $ContainerName, "git", "-C", $containerRepoDir, "add", ".")
Invoke-DockerCommand -Arguments @("exec", $ContainerName, "sh", "-lc", "cd '$containerRepoDir' && git diff --cached --quiet || git commit -q -m 'Bootstrap $ProjectSlug workspace snapshot'")

$existingRegistryJson = Invoke-DockerCommand -Arguments @(
  "exec",
  $ContainerName,
  "cat",
  "$ContainerRuntimeRoot/workspace-architect/projects/registry.json"
)
$existingRegistry = $existingRegistryJson | ConvertFrom-Json
if (-not $existingRegistry.projects) {
  $existingRegistry | Add-Member -NotePropertyName projects -NotePropertyValue ([ordered]@{}) -Force
}
$registeredAt =
  if ($existingRegistry.projects.PSObject.Properties.Name -contains $ProjectSlug) {
    $existingRegistry.projects.$ProjectSlug.registered_at
  } else {
    (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  }
$existingRegistry.projects | Add-Member -NotePropertyName $ProjectSlug -NotePropertyValue ([ordered]@{
  slug = $ProjectSlug
  github_url = $GithubUrl
  local_repo = $containerRepoDir
  requirements_dir = $containerReqDir
  registered_at = $registeredAt
}) -Force
$existingRegistry.current = $ProjectSlug
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  $registryStagePath,
  (($existingRegistry | ConvertTo-Json -Depth 10) + "`n"),
  $utf8NoBom
)

Invoke-DockerCommand -Arguments @("cp", $registryStagePath, "${ContainerName}:$ContainerRuntimeRoot/workspace-architect/projects/registry.json")

$registryJson = Invoke-DockerCommand -Arguments @(
  "exec",
  $ContainerName,
  "cat",
  "$ContainerRuntimeRoot/workspace-architect/projects/registry.json"
)
$registry = $registryJson | ConvertFrom-Json
$entry = $registry.projects.$ProjectSlug

[ordered]@{
  synced_at = (Get-Date).ToString("s")
  source_dir = $resolvedSourceDir
  project_slug = $ProjectSlug
  github_url = $GithubUrl
  container_name = $ContainerName
  container_repo_dir = $entry.local_repo
  container_requirements_dir = $entry.requirements_dir
  registry_current = $registry.current
} | ConvertTo-Json -Depth 5
