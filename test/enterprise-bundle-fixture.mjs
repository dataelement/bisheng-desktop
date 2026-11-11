// Pure archive fixture builder retained from the historical enterprise packer.
import { deflateRawSync } from 'node:zlib'

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function zipEntries(entries) {
  const local = [], central = []
  let offset = 0
  for (const [path, value] of Object.entries(entries)) {
    const data = Buffer.isBuffer(value) ? value : value.data
    const executable = !Buffer.isBuffer(value) && value.executable
    const name = Buffer.from(path), compressed = deflateRawSync(data), crc = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(8, 8); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26)
    local.push(header, name, compressed)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0x800, 8); directory.writeUInt16LE(8, 10); directory.writeUInt16LE(33, 14)
    directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(((0o100000 | (executable ? 0o755 : 0o644)) << 16) >>> 0, 38)
    directory.writeUInt32LE(offset, 42); central.push(directory, name)
    offset += header.length + name.length + compressed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22), count = Object.keys(entries).length
  if (count > 50000) throw new Error('Bundle exceeds the 50,000 file limit.')
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
