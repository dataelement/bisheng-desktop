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
      description: 'For confirmed enterprise cloud hosting, call guide first and read the complete returned guideMarkdown for this enterprise server’s workbench requirements, deployment and publishing protocol. The authenticated Desktop fetches that Markdown from the current enterprise server, including private networks and reverse-proxy subpaths. guideUrl records its actual source and guideSha256 identifies the fetched content. A successful guide result already contains the protocol; use it directly instead of sending the URL to a public web-fetch or search service. If it fails, report the real URL and error, retain the confirmed requirements and project, and resume cloud hosting after enterprise service availability is restored. Do not ask the user to manually fetch or paste the protocol. Guide also returns all current enterprise toolkit URLs, including SDK docs, package index and the platform-wiring tar.gz; call it again after switching conversations instead of guessing endpoints or creating another project. Use the current BiSheng identity to discover hosted workbenches, fetch editable source only for an explicit code/style/layout change, create a cloud project, submit it through the existing approval pipeline, or read release progress. Ordinary business use opens the hosted URL and must not fetch source. Publishing is Agent-led: explain the release scope and obtain user authorization in the conversation before submitting; check actual progress and never ask the user to click a publishing button. Set confirmSchemaChange to true only after explaining the schema migration and data impact and receiving the user’s explicit confirmation. General development or publication approval does not confirm schema changes. Use resume with projectId to continue an older local project in this conversation’s authorized workspace, then retain the returned projectId. Never request a publishing key.',
      parameters: {
        operation: { type: 'string', enum: ['guide', 'list', 'create', 'checkout', 'resume', 'publish', 'progress', 'limits'], required: true },
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
        if (['create', 'checkout', 'resume', 'publish'].includes(input.operation)) {
          policy = scoped.sandboxPolicy.resolve({ session: exec.agent.session })
          if (!['workspace-write', 'danger-full-access'].includes(policy.mode)) throw new Error('Publishing requires a writable development session.')
          if (input.operation === 'publish' && policy.mode === 'workspace-write') {
            const project = await scoped.desktopCloud.request({ operation: 'project', projectId: input.projectId })
            if (!await workspaceContains(policy.workspaceRoot, project.path)) throw new Error('Call cloud_workbench resume with this projectId to prepare its source in the current workspace, then publish using the returned projectId.')
          }
        }
        // The destination comes from the effective session policy, never model arguments.
        const request = ['create', 'checkout', 'resume'].includes(input.operation)
          ? { ...input, workspaceRoot: await realpath(policy.workspaceRoot) } : input
        const result = await scoped.desktopCloud.request(request)
        exec.signal?.throwIfAborted()
        if (['create', 'checkout', 'resume'].includes(input.operation) && result.projectId && store.write) {
          // Rebind an existing workbench-owned conversation without replacing
          // other UI state written while source was being prepared.
          for (let attempt = 0; attempt < 3; attempt++) {
            const saved = await store.read()
            saved.state.cloudDevelopmentSessions ??= {}
            saved.state.cloudDevelopmentSessions[exec.agent.id] = result.projectId
            try { await store.write(saved); break }
            catch (error) {
              if (error.status !== 409 || attempt === 2) {
                result.sessionBindingWarning = 'Source is prepared. Retain the returned projectId; its conversation binding could not be saved because workbench state could not be updated.'
                break
              }
            }
          }
        }
        if (['create', 'checkout', 'resume'].includes(input.operation)) {
          const currentPolicy = scoped.sandboxPolicy.resolve({ session: exec.agent.session })
          const ready = currentPolicy.mode === 'danger-full-access' || (currentPolicy.mode === 'workspace-write' && await workspaceContains(currentPolicy.workspaceRoot, result.path))
          return { ...result, developmentWorkspace: { path: result.path, ready,
            instruction: ready ? 'Continue in this conversation. Develop in the returned project directory and retain its projectId; changing the conversation workspace is not required.' :
              'The project directory is outside this session’s writable workspace. Preserve the confirmed requirements and projectId, report the returned path and current workspace, and resolve the directory authorization before writing. Cloud hosting does not require switching conversations.' } }
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
        (projectId ? `The editable project is registered for this conversation. projectId: ${projectId}. Do not create or checkout another copy; use this project for publish. If its existing directory is outside the authorized workspace, use resume and retain the returned projectId.\n` : '') +
        'Use the hosted URL for ordinary business tasks; do not download source for viewing, querying or changing business records. ' +
        (projectId ? 'Continue editing the prepared project. ' : 'For an explicit style, layout or feature change, call cloud_workbench list(managed=true) to resolve the current version, then checkout. ') +
        'Create and checkout prepare source inside this conversation’s authorized workspace. Continue in this conversation and edit the returned source directory; keep its projectId for publishing. Resolve any actual directory permission error without treating cloud hosting as a requirement to switch conversations. ' +
        'Publishing is Agent-led: explain the release scope and obtain user authorization in the conversation before submitting; check actual progress and never ask the user to click a publishing button. Use the returned projectId for publish, handle base-version conflicts by merge, and report the real approval/online status. Reuse the current BiSheng account; never ask for a key. ' +
        'For a new workbench, first assess continuous processing, team collaboration, local dependencies and shared versus personal state. Call cloud_workbench with operation guide for the protocol.'
      return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text }],
        source: { kind: `plugin:${PLUGIN}`, plugin: PLUGIN, fingerprint } })] }
    })
  })
}
