import { defineConfig } from 'tsdown'

const ID = '@dship/music-player'
const hostExternal = (specifier: string): boolean => specifier.startsWith('@deepseek-ai/') || specifier === 'youtubei.js' || specifier.startsWith('youtubei.js/')
const clientExternal = (specifier: string): boolean =>
  specifier === 'react' || specifier === 'react/jsx-runtime' || specifier === 'react-dom' || specifier.startsWith('@deepseek-ai/')

export default defineConfig([
  {
    name: ID,
    entry: { index: 'src/index.ts', 'runner-child': 'src/runner-child.ts', 'youtube-eval-child': 'src/youtube-eval-child.ts' },
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024', fixedExtension: false,
    clean: false, dts: false,
    deps: { neverBundle: hostExternal, alwaysBundle: specifier => !hostExternal(specifier) },
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2024', fixedExtension: false,
    clean: false, dts: false, sourcemap: true,
    deps: { neverBundle: clientExternal, alwaysBundle: specifier => !clientExternal(specifier) },
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    outputOptions: {
      entryFileNames: 'client.js', sourcemapExcludeSources: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
