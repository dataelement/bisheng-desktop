import { isAbsolute, join } from 'node:path'
import { createTemplateLibrary } from './lib/templates.js'
import { registerBusinessSkills } from './lib/business-skills.js'
import { registerOfficeContext, registerOfficeRoutes } from './lib/modes.js'
import { templateTool } from './lib/template-tool.js'
import { createDocxWorkflow, docxWriteTool, registerDocxDelivery } from './lib/docx-workflow.js'

export const name = 'desktop-office'
export const inject = ['skills']

/** Installation-owned resources; neither Profile paths nor cwd are anchors. */
export async function apply(ctx, config) {
  return composeOffice(ctx, config)
}

/**
 * Reuse the same tools and resources with an independently owned Web mode bridge.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./index.js').Config} config
 * @param {import('./index.js').OfficeModes} [modes]
 * @param {import('./index.js').OfficeRuntimeModules} [runtime]
 */
export async function composeOffice(ctx, config, modes, runtime) {
  const { officeSkills, workspaceDependencies } = runtime ?? {
    officeSkills: await import('@deepseek-ai/dsh-skill-office'),
    workspaceDependencies: await import('@deepseek-ai/dsh-tool-workspace-dependencies')
  }
  if (!config || typeof config.resources !== 'string' || !isAbsolute(config.resources)
    || typeof config.cli !== 'string' || !isAbsolute(config.cli)) {
    throw new Error('desktop-office: absolute resources and CLI paths are required')
  }
  if (typeof officeSkills?.apply !== 'function' || typeof workspaceDependencies?.apply !== 'function'
    || typeof workspaceDependencies.resolvePrimaryRuntime !== 'function') throw new Error('Office runtime modules must implement the official composition protocol')
  // Validate the immutable payload at activation; tool calls still use upstream
  // validation and retry behavior. Safe Mode omits this optional composition.
  await workspaceDependencies.resolvePrimaryRuntime(join(config.resources, 'primary-runtime'))
  await ctx.plugin(workspaceDependencies, { source: join(config.resources, 'primary-runtime') })
  await ctx.plugin(officeSkills, {
    assetRoot: join(config.resources, 'office-skills'),
    node: process.execPath,
    cli: config.cli
  })
  registerBusinessSkills(ctx, join(config.resources, 'business-skills'))
  const library = await createTemplateLibrary(join(config.resources, 'templates'))
  ctx.inject([...(modes ? [] : ['officeModes']), 'tools', 'skills', 'workingDirectory', 'sandboxPolicy', 'sandbox', 'subprocess'], scoped => {
    const officeModes = modes ?? scoped.officeModes
    registerOfficeContext(scoped, library, officeModes)
    const docx = createDocxWorkflow(scoped, library, officeModes, config.resources)
    scoped.tools.register(templateTool(scoped, library, officeModes, docx))
    scoped.tools.register(docxWriteTool(docx))
    registerDocxDelivery(scoped, library, officeModes, docx)
    scoped.inject(['connection'], routes => registerOfficeRoutes(routes, library, officeModes))
  })
}
