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

$gitmodules = Join-Path $repoRoot '.gitmodules'
if (-not (Test-Path -LiteralPath $gitmodules)) { throw 'missing .gitmodules' }

$status = @(git -C $repoRoot submodule status --recursive)
if ($LASTEXITCODE -ne 0) { throw 'git submodule status failed' }
if ($status.Count -ne $projects.Count) {
  throw "expected $($projects.Count) submodules, found $($status.Count)"
}
if ($status | Where-Object { $_ -match '^[-+U]' }) {
  throw 'submodule checkout is missing, modified, or conflicted'
}

foreach ($relativePath in $projects) {
  $project = Join-Path $repoRoot $relativePath
  foreach ($required in @('package.json', 'README.md', 'LICENSE')) {
    if (-not (Test-Path -LiteralPath (Join-Path $project $required))) {
      throw "missing $required in $relativePath"
    }
  }
  $nested = git -C $project status --porcelain
  if ($LASTEXITCODE -ne 0) { throw "not a git repository: $relativePath" }
  if ($nested) { throw "dirty plugin worktree: $relativePath" }
}

if (Test-Path -LiteralPath (Join-Path $repoRoot 'plugins/demo-hello')) {
  throw 'removed demo-hello directory is present'
}

Write-Host "COLLECTION_VERIFY_OK submodules=$($projects.Count) demoHello=absent"
