import { execFileSync } from 'node:child_process'
import React from 'react'
import * as ReactDOM from 'react-dom'
import * as jsxRuntime from 'react/jsx-runtime'

/**
 * Load the installed sidebar primitives for jsdom tests. The distributed ESM also
 * initializes unrelated markdown highlighters, so only the UI prefix through Modal
 * and the relative-time helper are bundled, with their real focus and menu behavior.
 * @param {string[]} names - primitive exports the test needs.
 */
export function loadSidebarPrimitives(names) {
  const bundle = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { build } from 'esbuild'; import { readFileSync } from 'node:fs'; import { createRequire } from 'node:module';
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8');
    const boundary = source.indexOf('//#region lib/types/RiskConfirmation.js');
    const timeStart = source.indexOf('//#region lib/types/relative-time.js');
    const timeEnd = source.indexOf('//#region lib/types/rank-by-name.js', timeStart);
    if (boundary < 0 || timeStart < boundary || timeEnd < timeStart) throw new Error('Recheck the installed primitive layout');
    const result = await build({ stdin: { contents: source.slice(0, boundary) + source.slice(timeStart, timeEnd) + '\\nexport { ${names.join(', ')} };', resolveDir: process.cwd() },
      bundle: true, write: false, format: 'cjs', platform: 'browser',
      plugins: [{ name: 'ui-only', setup(build) {
        build.onResolve({ filter: /\\.css$/ }, args => ({ path: args.path, namespace: 'css' }));
        build.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: 'export default {}', loader: 'js' }));
        build.onResolve({ filter: /^[^./]/ }, args => ({ path: args.path, external: true, sideEffects: false }));
      } }]
    }); process.stdout.write(result.outputFiles[0].text)`
  ], { encoding: 'utf8', maxBuffer: 4_000_000 })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', bundle)(module, module.exports, name => {
    if (name === 'react') return React
    if (name === 'react-dom') return ReactDOM
    if (name === 'react/jsx-runtime') return jsxRuntime
    if (name === 'clsx') return (...values) => values.filter(Boolean).join(' ')
    throw new Error(name)
  })
  return module.exports
}
