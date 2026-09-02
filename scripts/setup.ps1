param(
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$projects = @(
  'plugins/model-radar',
  'plugins/project-actions',
  'plugins/workflow-governance',
  'plugins/cloud-model-providers',
  'plugins/omniroute-persistent',
  'plugins/tablerag'
)
$installProjects = @(
  'plugins/model-radar',
  'plugins/project-actions',
  'plugins/workflow-governance',
  'plugins/cloud-model-providers',
  'plugins/omniroute-persistent'
)

git -C $repoRoot submodule sync --recursive
if ($LASTEXITCODE -ne 0) { throw 'git submodule sync failed' }
git -C $repoRoot submodule update --init --recursive
if ($LASTEXITCODE -ne 0) { throw 'git submodule update failed' }

if ($SkipInstall) {
  Write-Host '[ok] submodules initialized'
  exit 0
}

foreach ($relativePath in $installProjects) {
  $project = Join-Path $repoRoot $relativePath
  $lockfile = Join-Path $project 'pnpm-lock.yaml'
  if (-not (Test-Path -LiteralPath $lockfile)) {
    throw "missing lockfile: $lockfile"
  }

  Write-Host "[setup] $relativePath"
  Push-Location $project
  try {
    corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw "dependency installation failed: $relativePath" }
  } finally {
    Pop-Location
  }
}

Write-Host '[ok] all plugin dependencies installed from lockfiles'
