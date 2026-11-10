import { realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const PLUGIN = 'bisheng-cloud-workbench-context'
async function workspaceContains(root, path) {
  const child = relative(await realpath(root), await realpath(path))
  return !isAbsolute(child) && child !== '..' && !child.startsWith('../') && !child.startsWith('..\\')
}
export function registerCloudTools(ctx, store) {
  ctx.inject(['desktopCloud', 'tools', 'sandboxPolicy'], scoped => {
    scoped.tools.register(defineTool({
      name: 'cloud_workbench',
      description: 'Call guide first, then visit the returned guideUrl for this enterprise server’s workbench requirements, deployment and publishing protocol. Guide also returns all current enterprise toolkit URLs, including SDK docs, package index and the platform-wiring tar.gz; call it again after switching conversations instead of guessing endpoints or creating another project. Use the current BiSheng identity to discover hosted workbenches, fetch editable source only for an explicit code/style/layout change, create a cloud project, submit it through the existing approval pipeline, or read release progress. Ordinary business use opens the hosted URL and must not fetch source. Publishing is Agent-led: explain the release scope and obtain user authorization in the conversation before submitting; check actual progress and never ask the user to click a publishing button. Set confirmSchemaChange to true only after explaining the schema migration and data impact and receiving the user’s explicit confirmation. General development or publication approval does not confirm schema changes. Never request a publishing key.',
      parameters: {
        operation: { type: 'string', enum: ['guide', 'list', 'create', 'checkout', 'publish', 'progress', 'limits'], required: true },
        appId: { type: 'string' }, versionId: { type: 'string' }, projectId: { type: 'string' },
        deploymentId: { type: 'string' }, releaseNotes: { type: 'string' }, cursor: { type: 'string' }, managed: { type: 'boolean' },
        confirmSchemaChange: { type: 'boolean', description: 'Publish only. True only after the user explicitly confirms the explained schema migration and data impact. Omit otherwise.' }
      },
      output: { schema: { type: 'object', additionalProperties: true, properties: {} },
        render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
      timeoutMs: 150000,
      isConcurrencySafe: () => false,
      async execute(input, exec) {
        exec.signal?.throwIfAborted()
        let policy
        if (['create', 'checkout', 'publish'].includes(input.operation)) {
          policy = scoped.sandboxPolicy.resolve({ session: exec.agent.session })
          if (!['workspace-write', 'danger-full-access'].includes(policy.mode)) throw new Error('Publishing requires a writable development session.')
          if (input.operation === 'publish' && policy.mode === 'workspace-write') {
            const project = await scoped.desktopCloud.request({ operation: 'project', projectId: input.projectId })
            if (!await workspaceContains(policy.workspaceRoot, project.path)) throw new Error('Open the source directory as this session workspace before publishing.')
          }
        }
        const result = await scoped.desktopCloud.request(input)
        exec.signal?.throwIfAborted()
        if (['create', 'checkout'].includes(input.operation)) {
          const ready = policy.mode === 'danger-full-access' || await workspaceContains(policy.workspaceRoot, result.path)
          return { ...result, developmentWorkspace: { path: result.path, ready,
            instruction: ready ? 'Develop in this project and retain its projectId.' :
              'Stop before writing. Ask the user to open this exact directory as a development conversation workspace, then continue there with this projectId and the confirmed requirements. Changing working_directory does not change the writable workspace. Do not inspect the Desktop implementation or broaden sandbox permissions to work around this boundary.' } }
        }
        return result
      }
    }))
    scoped.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      const { state } = await store.read()
      const owner = state.sessionBindings[agent.id]
      const entry = state.cloudWorkbenches?.[owner]
      const projectId = state.cloudDevelopmentSessions?.[agent.id]
      if (!entry && !projectId) return decision
      const fingerprint = `${owner || ''}:${entry?.versionId || ''}:${projectId || ''}`
      for (const seq of agent.session.surface.nodes) {
        const event = agent.session.eventAt(seq)
        if (event?.type === 'user/message' && event.data?.source?.plugin === PLUGIN && event.data.source.fingerprint === fingerprint) return decision
      }
      const text = (entry ? `Current hosted workbench: ${entry.title}\nappId: ${entry.appId}\nKnown version: ${entry.versionId || 'not loaded'}\n` : 'Cloud workbench development.\n') +
        (projectId ? `The editable project is already prepared in this session workspace. projectId: ${projectId}. Do not create or checkout another copy; use this project for publish.\n` : '') +
        'Use the hosted URL for ordinary business tasks; do not download source for viewing, querying or changing business records. ' +
        (projectId ? 'Continue editing the prepared project. ' : 'For an explicit style, layout or feature change, call cloud_workbench list(managed=true) to resolve the current version, then checkout. ') +
        'Edit only the returned source project under the session sandbox; if its directory is outside your authorized workspace, open that directory as the development workspace rather than bypassing the sandbox. ' +
        'Publishing is Agent-led: explain the release scope and obtain user authorization in the conversation before submitting; check actual progress and never ask the user to click a publishing button. Use the returned projectId for publish, handle base-version conflicts by merge, and report the real approval/online status. Reuse the current BiSheng account; never ask for a key. ' +
        'For a new workbench, first assess continuous processing, team collaboration, local dependencies and shared versus personal state. Call cloud_workbench with operation guide for the protocol.'
      return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text }],
        source: { kind: `plugin:${PLUGIN}`, plugin: PLUGIN, fingerprint } })] }
    })
  })
}
