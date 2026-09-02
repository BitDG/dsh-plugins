import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

let dshRoot = process.env.DSH_ROOT ?? resolve(repoRoot, '../KB/deepseek-harness')
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--root') dshRoot = args[index + 1]
}

const overlay = join(repoRoot, 'cordis.dev.yml')
const generatedOverlay = join(repoRoot, 'tmp', 'cordis.dev.generated.yml')
const harnessPackage = join(dshRoot, 'package.json')
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
for (const project of requiredProjects) {
  if (!existsSync(join(repoRoot, project, 'node_modules'))) {
    console.error(`[dev] missing dependencies for ${project}; run: pnpm run setup`)
    process.exit(1)
  }
}

const storageRoot = join(repoRoot, 'tmp', 'workflow-governance-data').replaceAll('\\', '/')
const overlaySource = readFileSync(overlay, 'utf8')
if (!overlaySource.includes('__DSHP_WORKFLOW_STORAGE_ROOT__')) {
  console.error('[dev] overlay storage placeholder is missing')
  process.exit(1)
}
mkdirSync(dirname(generatedOverlay), { recursive: true })
writeFileSync(
  generatedOverlay,
  overlaySource.replace('__DSHP_WORKFLOW_STORAGE_ROOT__', storageRoot),
  'utf8',
)

const corepack = process.platform === 'win32' ? 'corepack.CMD' : 'corepack'
console.log(`[dev] DSH root : ${dshRoot}`)
console.log(`[dev] overlay  : ${generatedOverlay}`)
const child = spawn(corepack, ['pnpm', 'dsh', 'web', '--patch', generatedOverlay], {
  cwd: dshRoot,
  stdio: 'inherit',
  env: { ...process.env },
})
child.on('exit', code => process.exit(code ?? 0))
