import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
}

export interface SafeStorageCryptoAdapter extends SafeStorageAdapter {
  encryptString(plainText: string): Buffer
  decryptString(encrypted: NodeJS.ArrayBufferView): string
}

export interface SecureStorageInspection {
  available: boolean
  backend?: string
  reason?: string
}

export function inspectSecureStorage(safeStorage: SafeStorageAdapter): SecureStorageInspection {
  if (!safeStorage.isEncryptionAvailable()) {
    return {
      available: false,
      reason: 'Operating-system secure storage is unavailable.'
    }
  }
  const backend = safeStorage.getSelectedStorageBackend?.()
  if (process.platform === 'linux' && backend === 'basic_text') {
    return {
      available: false,
      backend,
      reason: 'Linux secure storage fell back to basic_text and cannot protect enterprise credentials.'
    }
  }
  return {
    available: true,
    ...(backend ? { backend } : {})
  }
}

const NODE_KEY_BYTES = 32
const GCM_IV_BYTES = 12
const GCM_TAG_BYTES = 16

function resolveOrCreateMasterKey(keyFilePath: string, masterKeyHex?: string): Buffer {
  if (typeof masterKeyHex === 'string' && /^[0-9a-fA-F]{64}$/.test(masterKeyHex.trim())) {
    return Buffer.from(masterKeyHex.trim(), 'hex')
  }
  try {
    const existing = readFileSync(keyFilePath)
    if (existing.byteLength === NODE_KEY_BYTES) return existing
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  mkdirSync(dirname(keyFilePath), { recursive: true, mode: 0o700 })
  const generated = randomBytes(NODE_KEY_BYTES)
  writeFileSync(keyFilePath, generated, { mode: 0o600 })
  return generated
}

/**
 * Pure Node.js AES-256-GCM credential encryption adapter for Web/Host environments
 * where Electron's OS-bound `safeStorage` is not present.
 */
export function createNodeKeySafeStorage(
  keyFilePath: string,
  masterKeyHex?: string
): SafeStorageCryptoAdapter {
  let cachedKey: Buffer | undefined
  const getKey = (): Buffer => {
    cachedKey ??= resolveOrCreateMasterKey(keyFilePath, masterKeyHex)
    return cachedKey
  }
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'node_aes_256_gcm',
    encryptString(plainText: string): Buffer {
      const key = getKey()
      const iv = randomBytes(GCM_IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return Buffer.concat([iv, tag, ciphertext])
    },
    decryptString(encrypted: NodeJS.ArrayBufferView): string {
      const bytes = Buffer.from(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength)
      if (bytes.byteLength < GCM_IV_BYTES + GCM_TAG_BYTES) {
        throw new Error('Encrypted payload is truncated.')
      }
      const key = getKey()
      const iv = bytes.subarray(0, GCM_IV_BYTES)
      const tag = bytes.subarray(GCM_IV_BYTES, GCM_IV_BYTES + GCM_TAG_BYTES)
      const ciphertext = bytes.subarray(GCM_IV_BYTES + GCM_TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    }
  }
}
