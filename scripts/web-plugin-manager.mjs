import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const VERSION = '0.2.2-alpha.3'
const MARKER = '// BISHENG Web verified install contract v1'

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('Unsupported alpha.3 Plugin Manager: patch anchor is missing or ambiguous')
  return source.replace(before, () => after)
}

/** Add only the verified package boundary; ordinary installs and enablement keep upstream semantics. */
export function addWebVerifiedInstalls(source) {
  if (source.includes(MARKER)) {
    // A partial/stale patch must never advertise a capability it cannot enforce.
    for (const token of ['verifiedInstallContract = 1;', 'Package backend declined verified install', 'await mutation?.rollback?.();', 'manifest.name !== options.expectedName', 'this.packageOperations.add(installation);']) {
      if (source.split(token).length !== 2) throw new Error('Incomplete Web verified install patch')
    }
    return source
  }
  if (source.includes('verifiedInstallContract') || source.includes('profileBundlePackageBackend')) throw new Error('Plugin Manager already has a package backend; review the upstream contract')
  source = replaceOnce(source, '\t\tstatic inject = ["loader", "profileContext"];', '\t\t' + MARKER + '\n\t\tverifiedInstallContract = 1;\n\t\tmanagedBundleSourceContract = 1;\n\t\tstatic inject = ["loader", "profileContext"];')
  const start = '\t\tinstallBundle(spec, options) {'
  const end = '\n\t\t/** Recover the result of an active installation without cancelling it.'
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('Unsupported alpha.3 Plugin Manager install method')
  const from = source.indexOf(start), to = source.indexOf(end, from)
  if (to < from) throw new Error('Unsupported alpha.3 Plugin Manager method order')
  const original = source.slice(from, to)
  let method = replaceOnce(original,
    'const known = specPackageName(spec, before, this.profile.dir);\n\t\t\t\tif (this.ownerContext.get("hmr") !== void 0 && known !== void 0 && Object.hasOwn(before, known))',
    'const verified = options?.expectedName !== void 0 || options?.expectedVersion !== void 0;\n\t\t\t\tconst known = options?.expectedName ?? specPackageName(spec, before, this.profile.dir);\n\t\t\t\tif ((options?.replace !== true || !verified) && (verified || this.ownerContext.get("hmr") !== void 0) && known !== void 0 && Object.hasOwn(before, known))')
  method = replaceOnce(method, '\t\t\t\tlet name;\n\t\t\t\tlet version;', '\t\t\t\tlet mutation;\n\t\t\t\tlet run;\n\t\t\t\tlet used = null;\n\t\t\t\tlet name;\n\t\t\t\tlet version;')
  const verifiedBranch = [
    '\t\t\t\t\tif (verified) {',
    '\t\t\t\t\t\tconst backend = this.ownerContext.get("profileBundlePackageBackend");',
    '\t\t\t\t\t\tif (backend?.supportsVerifiedInstall !== true) throw new Error("Package backend does not support verified installs");',
    '\t\t\t\t\t\tfor (const value of [options?.expectedName, options?.expectedVersion]) if (value !== void 0 && (typeof value !== "string" || value.trim() === "")) throw new ManagementFailure("invalid-spec");',
    '\t\t\t\t\t\tconst parsed = parseInstallSpec(spec);',
    '\t\t\t\t\t\tconst signal = AbortSignal.any([this.abort.signal, control.abort.signal]);',
    '\t\t\t\t\t\tannounce("installing");',
    '\t\t\t\t\t\tconst jobId = randomUUID();',
    '\t\t\t\t\t\tconst installation = backend.install({',
    '\t\t\t\t\t\t\tspec: parsed.spec, kind: parsed.kind, path: parsed.path, registry: options?.registry,',
    '\t\t\t\t\t\t\texpectedName: options?.expectedName, expectedVersion: options?.expectedVersion, signal,',
    '\t\t\t\t\t\t\tonOutput: (text, stream) => this.ownerContext.emit("plugin-manager/install-log", {',
    '\t\t\t\t\t\t\t\t...requestId === void 0 ? {} : { requestId }, jobId,',
    '\t\t\t\t\t\t\t\targv: ["pnpm", "add", parsed.spec], cwd: this.profile.dir, text, stream',
    '\t\t\t\t\t\t\t})',
    '\t\t\t\t\t\t});',
    '\t\t\t\t\t\tthis.packageOperations.add(installation);',
    '\t\t\t\t\t\ttry { mutation = await installation; } finally { this.packageOperations.delete(installation); }',
    '\t\t\t\t\t\tif (mutation === void 0) throw new Error("Package backend declined verified install");',
    '\t\t\t\t\t\trun = mutation.packageResult;',
    '\t\t\t\t\t\tresult.packageResult = run;',
    '\t\t\t\t\t\tif (stopped()) throw new InstallCancelledError();',
    '\t\t\t\t\t\tif (run.incompatible !== void 0) throw new ManagementFailure("incompatible-version", run.incompatible);',
    '\t\t\t\t\t} else {',
    '\t\t\t\t\tconst parsed = parsedForRegistry(spec);'
  ].join('\n')
  method = replaceOnce(method, '\t\t\t\t\tconst parsed = parsedForRegistry(spec);', verifiedBranch)
  method = replaceOnce(method, '\t\t\t\t\tlet run;\n\t\t\t\t\tlet used = null;\n', '')
  method = replaceOnce(method, '\t\t\t\t\tif (run === void 0) throw new Error("no registry was asked");', '\t\t\t\t\tif (run === void 0) throw new Error("no registry was asked");\n\t\t\t\t\t}')
  method = replaceOnce(method, '\t\t\t\t\t\ttry {\n\t\t\t\t\t\t\tresult.pendingBuilds = await recordPendingBuilds(this.profile.dir, run.output);', '\t\t\t\t\t\tif (mutation?.pendingBuilds !== void 0) result.pendingBuilds = mutation.pendingBuilds;\n\t\t\t\t\t\telse try {\n\t\t\t\t\t\t\tresult.pendingBuilds = await recordPendingBuilds(this.profile.dir, run.output);')
  method = replaceOnce(method, 'const installed = Object.keys(after).filter((name) => before[name] !== after[name]);', 'const installed = mutation?.bundle === void 0 ? Object.keys(after).filter((name) => before[name] !== after[name]) : [mutation.bundle];')
  method = replaceOnce(method, '\t\t\t\t\tversion = manifest.version;', '\t\t\t\t\tversion = manifest.version;\n\t\t\t\t\tif (options?.expectedName !== void 0 && (name !== options.expectedName || manifest.name !== options.expectedName) || options?.expectedVersion !== void 0 && version !== options.expectedVersion) throw new Error("Installed package identity does not match the verified artifact");')
  method = replaceOnce(method, '\t\t\t\t} catch (error) {\n\t\t\t\t\tawait this.restoreFiles(files);', '\t\t\t\t} catch (error) {\n\t\t\t\t\ttry { await mutation?.rollback?.(); } finally { await this.restoreFiles(files); }')
  return source.slice(0, from) + method + source.slice(to)
}

const backendType = `/** Web host boundary for verified package installation; activation remains Manager-owned. */
export interface ProfileBundlePackageBackend {
    supportsVerifiedInstall?: boolean;
    install(request: { spec: string; kind: 'registry' | 'path' | 'git' | 'tarball'; path?: string; registry?: string; expectedName?: string; expectedVersion?: string; signal: AbortSignal; onOutput(text: string, stream: 'stdout' | 'stderr'): void }): Promise<{ packageResult: import('./types.ts').PackageResult; bundle?: string; pendingBuilds?: string[]; rollback?(): Promise<void> } | undefined>;
}
`

function patchTypes(source, kind) {
  const additions = kind === 'index'
    ? [["export type * from './types.ts';", "export type * from './types.ts';\n" + backendType], ['export declare class PluginManager extends TypertRemoteService {', 'export declare class PluginManager extends TypertRemoteService {\n    readonly verifiedInstallContract: 1;']]
    : [['export interface InstallBundleOptions {', 'export interface InstallBundleOptions {\n    expectedName?: string;\n    expectedVersion?: string;\n    /** Replace an existing verified package; ordinary install semantics are unchanged. */\n    replace?: boolean;']]
  for (const [before, after] of additions) {
    if (source.includes(after)) {
      if (source.split(after).length !== 2) throw new Error('Ambiguous Web verified install types')
    } else source = replaceOnce(source, before, after)
  }
  return source
}

/** Replayed by each Web staging entrypoint; never patch an unrelated root installation. */
export async function applyWebPluginManagerPatch(modules) {
  const directory = path.join(modules, '@deepseek-ai/dsh-plugin-manager')
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-plugin-manager' || manifest.version !== VERSION) throw new Error('Unsupported Plugin Manager package: expected ' + VERSION)
  const targets = [['lib/index.js', addWebVerifiedInstalls], ['lib/types/index.d.ts', source => patchTypes(source, 'index')], ['lib/types/types.d.ts', source => patchTypes(source, 'options')]]
  // Validate every input before writing any output, including partially copied packages.
  const edits = await Promise.all(targets.map(async ([relative, transform]) => {
    const file = path.join(directory, relative)
    const before = await readFile(file, 'utf8')
    return { file, before, after: transform(before) }
  }))
  for (const { file, before, after } of edits) if (before !== after) await writeFile(file, after)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const modules = process.argv[2]
  if (!modules || !path.isAbsolute(modules)) {
    console.error('An absolute staged node_modules path is required')
    process.exitCode = 1
  } else {
    try { await applyWebPluginManagerPatch(modules) } catch {
      // Package-manager/authentication settings and machine paths stay out of launcher output.
      console.error('Web Plugin Manager patch failed: unsupported or incomplete runtime package')
      process.exitCode = 1
    }
  }
}
