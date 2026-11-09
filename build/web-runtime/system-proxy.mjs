import { execFileSync } from 'node:child_process'

function proxyUrl(value) {
  if (!value || /[\s/@]/u.test(value)) return undefined
  try {
    const url = new URL(`http://${value}`)
    return url.hostname && url.port ? url.href : undefined
  } catch { return undefined }
}

export function systemProxyEnvironment({ platform = process.platform, env = process.env, run = (file, args) => execFileSync(file, args, { encoding: 'utf8', timeout: 3000, windowsHide: true }) } = {}) {
  const result = { ...env }
  const configured = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some(key => result[key])
  if (!configured) {
    try {
      let address, exclusions = []
      if (platform === 'darwin') {
        const output = run('/usr/sbin/scutil', ['--proxy'])
        const get = key => output.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, 'm'))?.[1]?.trim()
        if (get('ProxyAutoConfigEnable') !== '1' && get('ProxyAutoDiscoveryEnable') !== '1' && get('HTTPSEnable') === '1') address = proxyUrl(`${get('HTTPSProxy')}:${get('HTTPSPort')}`)
        const list = output.match(/ExceptionsList\s*:\s*<array>\s*\{([^}]*)\}/)?.[1] ?? ''
        exclusions = [...list.matchAll(/^\s*\d+\s*:\s*(.+)$/gm)].map(match => match[1].trim())
        if (get('ExcludeSimpleHostnames') === '1') exclusions.push('<local>')
      } else if (platform === 'win32') {
        const output = run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'])
        const get = key => output.match(new RegExp(`^\\s*${key}\\s+REG_\\w+\\s+(.+)$`, 'mi'))?.[1]?.trim()
        if (!get('AutoConfigURL') && Number(get('ProxyEnable')) === 1) {
          const server = get('ProxyServer') ?? ''
          const selected = server.includes('=') ? server.split(';').map(item => item.split('=')).find(item => item[0]?.toLowerCase() === 'https')?.[1] : server
          address = proxyUrl(selected)
          exclusions = (get('ProxyOverride') ?? '').split(';').filter(Boolean)
        }
      }
      // Node's NO_PROXY cannot represent the OS rule for all unqualified names.
      if (exclusions.some(item => item.toLowerCase() === '<local>')) address = undefined
      if (address) {
        result.HTTPS_PROXY = address
        result.HTTP_PROXY = address
        const noProxy = exclusions.filter(item => item !== '<local>').map(item => item.startsWith('*.') ? item.slice(1) : item)
        result.NO_PROXY = [result.NO_PROXY || result.no_proxy, 'localhost', '127.0.0.1', '::1', ...noProxy].filter(Boolean).join(',')
      }
    } catch { /* Missing or unsupported system proxy settings leave Node's default networking intact. */ }
  }
  if (['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].some(key => result[key])) result.NODE_USE_ENV_PROXY = '1'
  return result
}
