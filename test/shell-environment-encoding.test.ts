import { describe, expect, it } from 'vitest'
import {
  mergeCapturedShellEnvironment,
  POSIX_SYSTEM_PATH,
  resolveEnvironmentPath,
  withoutUndecodableValues
} from '../src/main/runtime/harness-runtime'

/**
 * Windows PowerShell writes stdout in the console codepage. Decoding that as
 * UTF-8 on a CJK install turns every non-ASCII byte into U+FFFD, and the
 * value most likely to carry one is a path under the user's profile
 * directory. Passing such a TEMP to Harness points it at a directory that
 * does not exist, and it dies in mkdtemp before loading a plugin tree.
 */
describe('captured shell environment', () => {
  // C:\Users\数据项素\AppData\Local\Temp as GBK bytes decoded as UTF-8.
  const mojibakeTemp = 'C:\Users\\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\AppData\Local\Temp'
  const realTemp = 'C:\Users\数据项素\AppData\Local\Temp'

  it('replaces a mis-decoded value with the inherited one', () => {
    const result = withoutUndecodableValues({ TEMP: mojibakeTemp }, { TEMP: realTemp })
    expect(result.TEMP).toBe(realTemp)
  })

  it('keeps values that decoded cleanly', () => {
    const result = withoutUndecodableValues(
      { PATH: 'C:\bin;C:\Users\数据项素\.local\bin' },
      { PATH: 'C:\bin' }
    )
    expect(result.PATH).toBe('C:\bin;C:\Users\数据项素\.local\bin')
  })

  // A variable that exists only in the shell profile has nothing to fall back
  // to. Dropping it leaves the consumer its own default; passing it on broken
  // points it somewhere wrong.
  it('drops a mis-decoded value that has no inherited counterpart', () => {
    const result = withoutUndecodableValues({ CONDA_PREFIX: mojibakeTemp }, {})
    expect('CONDA_PREFIX' in result).toBe(false)
  })

  it('leaves an ASCII-only environment untouched', () => {
    const captured = { PATH: 'C:\bin', TEMP: 'C:\Temp' }
    expect(withoutUndecodableValues(captured, {})).toEqual(captured)
  })

  it('preserves an empty value', () => {
    expect(withoutUndecodableValues({ EMPTY: '' }, {})).toEqual({ EMPTY: '' })
  })

  // Windows does not normalise environment variable name casing either — the
  // captured block follows the registry value name, so PATH can arrive as
  // `path` or any other spelling and an exact-case read misses it (issue #232).
  it('reads PATH case-insensitively only on Windows', () => {
    expect(resolveEnvironmentPath({ path: 'C:\\lower' }, 'win32')).toBe('C:\\lower')
    expect(resolveEnvironmentPath({ PaTh: 'C:\\mixed' }, 'win32')).toBe('C:\\mixed')
    // POSIX: `path` is a different variable, not a spelling of PATH. A missing
    // PATH falls back to the system directories instead of an empty string.
    expect(resolveEnvironmentPath({ path: '/ignored' }, 'linux')).toBe(POSIX_SYSTEM_PATH)
    expect(resolveEnvironmentPath({ PATH: '/usr/bin', path: '/ignored' }, 'linux')).toBe(
      '/usr/bin'
    )
  })

  it('uses the system PATH when the POSIX PATH is missing or blank', () => {
    expect(resolveEnvironmentPath({}, 'darwin')).toBe(POSIX_SYSTEM_PATH)
    expect(resolveEnvironmentPath({ PATH: '' }, 'linux')).toBe(POSIX_SYSTEM_PATH)
    expect(resolveEnvironmentPath({ PATH: '   ' }, 'darwin')).toBe(POSIX_SYSTEM_PATH)
    expect(resolveEnvironmentPath({ PATH: '/opt/homebrew/bin:/usr/bin' }, 'darwin')).toBe(
      '/opt/homebrew/bin:/usr/bin'
    )
  })

  it('keeps an empty ordinary variable from the shell capture', () => {
    const merged = mergeCapturedShellEnvironment(
      { FOO: '', PATH: '/opt/homebrew/bin' },
      { FOO: 'inherited', PATH: '/usr/bin', HOME: '/Users/tester', SHELL: '/bin/zsh' },
      'darwin'
    )
    expect(merged.FOO).toBe('')
    expect(merged.PATH).toBe('/opt/homebrew/bin')
    expect(merged.HOME).toBe('/Users/tester')
    expect(merged.SHELL).toBe('/bin/zsh')
  })

  it('does not let a partial shell capture erase PATH, HOME, or SHELL', () => {
    const inherited = {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/tester',
      SHELL: '/bin/zsh',
      USER: 'tester'
    }
    const empty = mergeCapturedShellEnvironment({}, inherited, 'darwin')
    expect(empty.PATH).toBe('/usr/bin:/bin')
    expect(empty.HOME).toBe('/Users/tester')
    expect(empty.SHELL).toBe('/bin/zsh')
    expect(empty.USER).toBe('tester')

    const blankPath = mergeCapturedShellEnvironment({ PATH: '   ' }, inherited, 'darwin')
    expect(blankPath.PATH).toBe('/usr/bin:/bin')

    const richer = mergeCapturedShellEnvironment(
      { PATH: '/opt/homebrew/bin:/usr/bin' },
      inherited,
      'darwin'
    )
    expect(richer.PATH).toBe('/opt/homebrew/bin:/usr/bin')
  })

  it('fills POSIX launch variables when neither side captured them', () => {
    const merged = mergeCapturedShellEnvironment({ DSH_HOME: '/harness' }, {}, 'linux')
    expect(merged.PATH).toBe(POSIX_SYSTEM_PATH)
    expect(merged.HOME).toBeTruthy()
    expect(merged.SHELL).toBeTruthy()
    expect(merged.DSH_HOME).toBe('/harness')
  })
})
