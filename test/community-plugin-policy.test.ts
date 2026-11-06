import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { projectGenerations } from 'dsh-desktop-market-installer/generations/projection'
import { readDesired, writeDesired, writeGenerationMeta, registryLayout } from 'dsh-desktop-market-installer/generations/registry'
import { canReenableProfilePlugin } from '../src/main/state/community-plugin-policy'
import { enforceCommunityPluginPolicy } from '../src/main/enterprise/startup-plugin-policy'
import { rm } from 'node:fs/promises'

const homes: string[] = []
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

async function profileHome(): Promise<{ home: string; profile: string }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-community-policy-'))
  homes.push(home)
  const profile = join(home, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  return { home, profile }
}

describe('community plugin policy', () => {
  it('removes community bundles and dshmarket from the active profile without deleting dependencies', async () => {
    const { home, profile } = await profileHome()
    const pluginDir = join(profile, 'node_modules', 'community-plugin')
    await mkdir(pluginDir, { recursive: true })
    await writeFile(join(pluginDir, 'package.json'), JSON.stringify({
      name: 'community-plugin',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } }
    }))
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: {
        dshmarket: '1.65.1',
        'community-plugin': '1.0.0',
        'transitive-lib': '1.2.3',
        '@deepseek-ai/dsh-base': '0.1.0',
        'dsh-image-generation': '0.1.0'
      },
      dsh: {
        profile: {
          bundles: ['dshmarket', 'community-plugin', '@deepseek-ai/dsh-base', 'dsh-image-generation']
        }
      }
    }))

    const notes: string[] = []
    await enforceCommunityPluginPolicy(home, (line) => notes.push(line))
    await enforceCommunityPluginPolicy(home, (line) => notes.push(line))

    const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
    expect(manifest.dependencies['community-plugin']).toBe('1.0.0')
    expect(manifest.dependencies.dshmarket).toBe('1.65.1')
    expect(manifest.dependencies['transitive-lib']).toBe('1.2.3')
    expect(manifest.dsh.profile.bundles).toEqual(['community-plugin', '@deepseek-ai/dsh-base', 'dsh-image-generation'])
    expect(notes.filter((line) => line.includes('removed dshmarket'))).toHaveLength(1)
  })

  it('fails closed for corrupt policy and restores the market only when allowed', async () => {
    const { home, profile } = await profileHome()
    const policyDir = join(profile, '.dsh-desktop')
    await mkdir(policyDir, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { dshmarket: '1.0.0' }, dsh: { profile: { bundles: ['dshmarket'] } } }))
    await writeFile(join(policyDir, 'third-party-policy.json'), '{invalid')
    const notes: string[] = []
    await enforceCommunityPluginPolicy(home, line => notes.push(line))
    expect(JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')).dsh.profile.bundles).toEqual([])
    await writeFile(join(policyDir, 'third-party-policy.json'), JSON.stringify({ allowThirdPartyPlugins: true }))
    await enforceCommunityPluginPolicy(home, line => notes.push(line))
    expect(JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')).dsh.profile.bundles).toEqual(['dshmarket'])
    expect(notes).toEqual([
      '[desktop] removed dshmarket from the active profile until third-party plugins are allowed',
      '[desktop] restored dshmarket to the active profile'
    ])
  })

  it('keeps a switched-off generation installed and out of the running set', async () => {
    const { home, profile } = await profileHome()
    const generationDir = join(registryLayout(home).generations, 'community-plugin+1.0.0+abcd')
    const packageDir = join(generationDir, 'node_modules', 'community-plugin')
    await mkdir(packageDir, { recursive: true })
    await writeFile(join(packageDir, 'package.json'), JSON.stringify({
      name: 'community-plugin',
      version: '1.0.0'
    }))
    await writeGenerationMeta(generationDir, { pluginName: 'community-plugin', version: '1.0.0' })
    await writeDesired(home, ['community-plugin+1.0.0+abcd'])
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { '@deepseek-ai/dsh-base': '0.1.0' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }
    }))

    await enforceCommunityPluginPolicy(home, () => {})
    expect(await readDesired(home)).toEqual(['community-plugin+1.0.0+abcd'])
    await mkdir(join(profile, '.dsh-market'), { recursive: true })
    await writeFile(join(profile, '.dsh-market', 'state.json'), JSON.stringify({ disabled: ['community-plugin'] }))
    const projection = await projectGenerations(home)
    expect(projection.linked).toContain('community-plugin')
    expect(projection.bundles).toContain('community-plugin')
    expect(JSON.parse(await readFile(join(profile, '.dsh-market', 'state.json'), 'utf8')).disabled).toEqual(['community-plugin'])
  })
})

describe('profile plugin re-enable', () => {
  const listed = ['dsh-image-generation', 'community-plugin', 'dsh-ppt']
  const disabled = ['dsh-image-generation', 'community-plugin']

  it('allows a protected bundle that this page lists and that is disabled', () => {
    expect(canReenableProfilePlugin('dsh-image-generation', listed, disabled)).toBe(true)
  })

  it('rejects a community plugin, a protected plugin that is not disabled, and a name that is not listed', () => {
    expect(canReenableProfilePlugin('community-plugin', listed, disabled)).toBe(false)
    expect(canReenableProfilePlugin('dsh-ppt', listed, disabled)).toBe(false)
    expect(canReenableProfilePlugin('dsh-image-generation', ['community-plugin'], disabled)).toBe(false)
  })
})
