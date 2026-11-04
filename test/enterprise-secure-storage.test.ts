import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startEnterpriseDesktop } from '../src/main/enterprise/enterprise-desktop'
import { createNodeKeySafeStorage, inspectSecureStorage } from '../src/main/enterprise/secure-storage'

describe('enterprise secure storage inspection', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('disables enterprise login when encryption is unavailable', () => {
    expect(inspectSecureStorage({
      isEncryptionAvailable: () => false
    })).toEqual({
      available: false,
      reason: 'Operating-system secure storage is unavailable.'
    })
  })

  it('disables Linux basic_text backends', () => {
    vi.stubGlobal('process', { ...process, platform: 'linux' })
    expect(inspectSecureStorage({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text'
    })).toMatchObject({
      available: false,
      backend: 'basic_text'
    })
  })

  it('accepts DPAPI and Keychain backends', () => {
    expect(inspectSecureStorage({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'dpapi'
    })).toEqual({
      available: true,
      backend: 'dpapi'
    })
  })

  it('provides a pure Node AES-256-GCM storage adapter for Web/Host runtimes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-node-safe-storage-'))
    try {
      const keyFile = join(dir, 'nested', '.enterprise-vault.key')
      const adapter = createNodeKeySafeStorage(keyFile)
      expect(inspectSecureStorage(adapter)).toEqual({
        available: true,
        backend: 'node_aes_256_gcm'
      })
      const ciphertext = adapter.encryptString('{"accessToken":"secret-token"}')
      expect(adapter.decryptString(ciphertext)).toBe('{"accessToken":"secret-token"}')

      // Re-instantiating with the persisted key file decrypts existing ciphertext.
      const reloaded = createNodeKeySafeStorage(keyFile)
      expect(reloaded.decryptString(ciphertext)).toBe('{"accessToken":"secret-token"}')

      const info = await stat(keyFile)
      expect(info.size).toBe(32)

      // Truncated or tampered payloads are rejected.
      expect(() => reloaded.decryptString(ciphertext.subarray(0, 10))).toThrow('Encrypted payload is truncated.')
      const tampered = Buffer.from(ciphertext)
      tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff
      expect(() => reloaded.decryptString(tampered)).toThrow()

      // Explicit hex master key overrides key file generation.
      const envAdapter = createNodeKeySafeStorage(join(dir, 'unused.key'), 'a'.repeat(64))
      const envCipher = envAdapter.encryptString('host-secret')
      expect(envAdapter.decryptString(envCipher)).toBe('host-secret')
      expect(() => reloaded.decryptString(envCipher)).toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('starts enterprise host runtime without Electron safeStorage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-enterprise-host-'))
    const runtime = await startEnterpriseDesktop({
      userDataPath: dir,
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })),
      allowInsecureLoopback: true
    })
    try {
      expect(runtime.snapshot().secureStorageAvailable).toBe(true)
      const env = runtime.harnessEnvironment()
      expect(env.DSH_DESKTOP_ENTERPRISE_BROKER_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(env.DSH_DESKTOP_ENTERPRISE_BROKER_CAPABILITY).toBeTruthy()
    } finally {
      await runtime.stop()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
