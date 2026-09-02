import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

let dshRoot = process.env.DSH_ROOT ?? resolve(repoRoot, '../KB/deepseek-harness')
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--root') dshRoot = args[index + 1]
}

const overlay = join(repoRoot, 'cordis.dev.yml')
const generatedOverlay = join(repoRoot, 'cordis.dev.generated.yml')
const harnessPackage = join(dshRoot, 'package.json')
const devPort = Number(process.env.DSHP_DEV_PORT ?? '3081')
const requiredProjects = [
  'plugins/model-radar',
  'plugins/project-actions',
  'plugins/workflow-governance',
]

if (!existsSync(overlay)) {
  console.error(`[dev] missing overlay: ${overlay}`)
  process.exit(1)
}
if (!existsSync(harnessPackage)) {
  console.error(`[dev] invalid DSH_ROOT: ${dshRoot}`)
  process.exit(1)
}
if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
  console.error('[dev] DSHP_DEV_PORT must be an integer between 1 and 65535')
  process.exit(1)
}
for (const project of requiredProjects) {
  if (!existsSync(join(repoRoot, project, 'node_modules'))) {
    console.error(`[dev] missing dependencies for ${project}; run: pnpm run setup`)
    process.exit(1)
  }
}

const storageRoot = join(repoRoot, 'tmp', 'workflow-governance-data').replaceAll('\\', '/')
const overlaySource = readFileSync(overlay, 'utf8')
if (
  !overlaySource.includes('__DSHP_WORKFLOW_STORAGE_ROOT__') ||
  !overlaySource.includes('__DSHP_DEV_PORT__')
) {
  console.error('[dev] overlay storage or port placeholder is missing')
  process.exit(1)
}
writeFileSync(
  generatedOverlay,
  overlaySource
    .replace('__DSHP_WORKFLOW_STORAGE_ROOT__', storageRoot)
    .replace('__DSHP_DEV_PORT__', String(devPort)),
  'utf8',
)

console.log(`[dev] DSH root : ${dshRoot}`)
console.log(`[dev] overlay  : ${generatedOverlay}`)
console.log(`[dev] endpoint : http://127.0.0.1:${devPort}`)
const childOptions = {
  cwd: dshRoot,
  stdio: 'inherit',
  env: { ...process.env },
}
const child = process.platform === 'win32'
  ? spawn(
      process.env.ComSpec ?? 'cmd.exe',
      ['/d', '/s', '/c', `corepack pnpm dsh web --patch "${generatedOverlay.replaceAll('"', '""')}"`],
      { ...childOptions, windowsVerbatimArguments: true },
    )
  : spawn('corepack', ['pnpm', 'dsh', 'web', '--patch', generatedOverlay], childOptions)
child.on('exit', code => process.exit(code ?? 0))
