import { defineConfig } from 'tsdown'

const ID = '@dship/reference-library'
const isExternal = (specifier: string): boolean =>
  specifier === 'react'
  || specifier === 'react/jsx-runtime'
  || specifier === 'react-dom'
  || specifier.startsWith('@deepseek-ai/')

export default defineConfig([
  {
    name: ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    clean: false,
    dts: false,
    deps: { neverBundle: isExternal },
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    clean: false,
    dts: false,
    sourcemap: true,
    deps: {
      neverBundle: isExternal,
      alwaysBundle: (specifier: string) => !isExternal(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      sourcemapExcludeSources: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
