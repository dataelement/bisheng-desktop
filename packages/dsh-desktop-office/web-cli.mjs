// Resolve from the installed plugin peer closure, including the host-owned native engine.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const manifest = require.resolve('@deepseek-ai/libreoffice-kit/package.json')
await import(pathToFileURL(join(dirname(manifest), 'lib/cli.js')).href)
