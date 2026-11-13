// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import React, { act } from 'react'
import * as jsx from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', '') }
HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open') }
const catalogue = JSON.parse(await readFile(resolve('packages/dsh-desktop-office/welcome-cases.json'), 'utf8'))
const workCase = id => catalogue.work.find(item => item.id === id)
const referenceTemplates = ['word', 'excel'].map(mode => ({
  id: `${mode}-reference`, mode, title: `${mode} reference`, pages: 1, pageAspectRatios: [1], revision: 'a'.repeat(24),
  thumbnail: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"/>'
}))
const linkedTemplates = [
  ['annual-business', 'subscription-analysis'], ['port-cargo', 'port-review'], ['bio-assay', 'enzyme-quality'],
  ['meeting-minutes', 'event-minutes'], ['coffee-market', 'tea-market']
].map(([id, caseId]) => {
  const item = workCase(caseId)
  return { ...referenceTemplates.find(template => template.mode === item.officeMode), id, title: item.template }
})
const officeSource = await readFile(resolve('packages/dsh-desktop-office/client.js'), 'utf8')
const manager = await readFile(resolve('packages/ppt-runtime/client/personal-template-manager.js'), 'utf8')
const pptSource = (await readFile(resolve('packages/ppt-runtime/adapter/lib/client.js'), 'utf8')).replace('/* PERSONAL_TEMPLATE_MANAGER */', manager)
let root, container, disposers = []
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  for (const dispose of disposers.reverse()) dispose?.()
  disposers = []; container?.remove(); root = null; delete window.__ModuleLoader__
})

// Model the public editor contract: reference nodes occupy one Detect coordinate,
// insertText uses draftRev CAS, and no action in this fixture submits a message.
function editor(initial = '', attachmentIds = []) {
  let draft = initial, rev = 0, occurrences = []
  const listeners = new Set()
  let snapshot = { draft, draftRev: rev, occurrences, attachmentIds, phase: 'plain' }
  const publish = () => { snapshot = { ...snapshot, draft, draftRev: rev, occurrences }; for (const listener of listeners) listener() }
  const clipboardOffset = offset => {
    let expansion = 0
    for (const ref of occurrences) {
      if (offset <= ref.offset - expansion) break
      expansion += ref.length - 1
    }
    return offset + expansion
  }
  return {
    state: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    insertText: vi.fn((text, span) => {
      if (span.draftRev !== rev) return false
      const start = clipboardOffset(span.start), end = clipboardOffset(span.end)
      if (occurrences.some(ref => ref.offset < end && ref.offset + ref.length > start)) throw new Error('The replacement overlaps a chip')
      draft = draft.slice(0, start) + text + draft.slice(end)
      occurrences = occurrences.map(ref => ref.offset < end ? ref : { ...ref, offset: ref.offset + text.length - (end - start) })
      rev++; publish(); return true
    }),
    setDraft: vi.fn(), submit: vi.fn(), focus: vi.fn(), persistDraft: vi.fn(),
    edit(text, refs = occurrences) { draft = text; occurrences = refs; rev++; publish() },
    read: () => snapshot
  }
}

async function fixture({ mode = null, presentationMode = null, selectedTemplateId = null, english = false, initial = '', attachmentIds = [], bound = true, office = true, emptyCatalogue = false, withComposer = false, failFirstCatalogue = false, officeTemplates = [] } = {}) {
  let sessionId = bound ? 'session-a' : undefined, blank = true
  const dictionaries = new Map(), seats = [], calls = [], held = new Map(), failures = new Map(), editors = new Map(), states = new Map([['session-a', { mode, presentationMode, selectedTemplateId }]])
  const getEditor = id => { if (!editors.has(id)) editors.set(id, id === 'session-a' ? editor(initial, attachmentIds) : editor()); return editors.get(id) }
  const pptTemplates = [{ id: 'ppt-example', name: 'PPT example', category: 'business', palette: { background: 'FFFFFF', surface: 'F4F4F4', text: '242424', muted: '666666', accent: '3888FF', secondary: 'E7E7E9' } }]
  const connection = { rpc: { async call(route, endpoint, payload, signal) {
    const operation = route === '/api' ? payload.endpoint : endpoint
    calls.push({ operation, payload, route })
    if (calls.length > 100) throw new Error('Fixture stopped a repeated catalogue request loop')
    if (held.has(operation)) await held.get(operation)
    signal?.throwIfAborted()
    if (failures.has(operation)) return { ok: false, error: { message: failures.get(operation) } }
    let state = states.get(payload.sessionId) ?? { mode: null, presentationMode: null, selectedTemplateId: null }
    if (operation === 'welcome-cases') {
      if (failFirstCatalogue) { failFirstCatalogue = false; return { ok: false, error: { message: 'Catalogue unavailable' } } }
      return { ok: true, value: { cases: catalogue.work, batches: catalogue.batches.work } }
    }
    if (operation === 'preview') return { ok: true, value: { page: payload.page, image: referenceTemplates[0].thumbnail } }
    if (operation === 'case-mode') {
      const item = workCase(payload.caseId)
      state = { mode: ['word', 'excel'].includes(item.officeMode) ? item.officeMode : null,
        presentationMode: item.officeMode === 'ppt' ? 'ppt' : null,
        selectedTemplateId: officeTemplates.find(template => template.mode === item.officeMode && template.title === item.template)?.id ?? null }
    }
    if (operation === 'mode') state = { ...state, mode: payload.mode, presentationMode: null, selectedTemplateId: null, selectedPptTemplateId: null }
    if (operation === 'select') state = { ...state, selectedTemplateId: payload.templateId }
    if (operation === 'deselect') state = { ...state, selectedTemplateId: null }
    if (operation === 'presentation/mode') state = { ...state, mode: null, presentationMode: payload.mode, selectedTemplateId: null }
    if (operation === 'template/select') state = { ...state, mode: null, presentationMode: payload.mode, selectedTemplateId: null, selectedPptTemplateId: payload.templateId }
    states.set(payload.sessionId, state)
    return route === '/api' ? { ok: true, value: { ...state, templates: officeTemplates } } : { ok: true, value: { status: 'ok', data: { ...state, documentMode: state.mode, selectedTemplateId: state.selectedPptTemplateId, templates: emptyCatalogue ? [] : pptTemplates } } }
  } } }
  const core = new SlotCore(), factoryDisposers = new Map()
  const nativeSeats = ['conversation.hero.modeActions', 'conversation.hero.dock', 'conversation.composer.dock', 'conversation.input.accessory', 'conversation.chat.userMessageFooter']
  disposers.push(core.register({ name: 'root', children: Object.fromEntries(nativeSeats.map(name => [name, { kind: 'list', scope: 'root' }])) }, () => null))
  const ctx = {
    get: () => connection, effect(run) { disposers.push(run()) }, on() {},
    sessions: { scope: id => id }, conversation: { input: { for: getEditor } },
    locale: { register(ns, values) { dictionaries.set(ns, values); return () => {} }, bind(ns) { return key => dictionaries.get(ns)?.[english ? 'en' : 'zh'][key] ?? key } },
    slots: { inject(_seat, run) { run() }, register(meta, component) { const dispose = core.register(meta, component); disposers.push(dispose); seats.push({ meta, component }); return dispose }, registerFactory(meta, component) { const dispose = core.registerFactory(meta, component); factoryDisposers.set(meta.name, dispose); disposers.push(dispose); return dispose } }
  }
  for (const source of office ? [officeSource, pptSource] : [pptSource]) {
    let plugin
    window.__ModuleLoader__ = { load({ factory }) { plugin = factory(name => name === 'react' ? React : name === 'react/jsx-runtime' ? jsx : {}) } }
    new Function(source)(); plugin.apply(ctx)
  }
  function renderSlot(name, owner = {}) {
    const matches = seats.filter(({ meta }) => meta.name === name).sort((a, b) => a.meta.order - b.meta.order)
    if (!matches.length) return null
    return matches.map(({ meta, component }) => React.createElement(component, {
      ...meta.inject?.(sessionId), ...owner, key: meta.name + meta.id,
      sessionId, session: { blank },
      inputActions: sessionId ? getEditor(sessionId) : undefined,
      useInput: sessionId ? selector => selector(React.useSyncExternalStore(getEditor(sessionId).state.subscribe, getEditor(sessionId).state.getSnapshot)) : undefined,
      t: (key, vars) => Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), dictionaries.get(meta.locale)?.[english ? 'en' : 'zh'][key] ?? key),
      renderSlot, renderFactorySlot
    }))
  }
  function renderFactorySlot(name, owner = {}, options = {}) {
    const definition = core.factory(name)
    if (!definition) return options.fallback ?? null
    return React.createElement(definition.component, { ...definition.inject?.(), ...owner, t: (key, vars) => Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), dictionaries.get(definition.locale)?.[english ? 'en' : 'zh'][key] ?? key) })
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  const render = () => {
    const actions = renderSlot('conversation.hero.modeActions')
    const seat = sessionId ? 'conversation.composer.dock' : 'conversation.hero.dock'
    const dock = React.createElement('div', { 'data-slot': seat, style: { display: 'contents' } }, renderSlot(seat))
    const card = React.createElement('div', { 'data-composer-card': '' }, React.createElement('span', null, 'Draft text'))
    root.render(withComposer
      ? React.createElement('div', { 'data-conversation-scroll': '' },
          React.createElement('div', { 'data-composer-seat': '' },
            actions, React.createElement('div', null, card, sessionId ? React.createElement('div', null, dock) : null),
            sessionId ? null : dock))
      : React.createElement(React.Fragment, null, actions, renderSlot('conversation.hero.dock')))
  }
  await act(async () => render())
  return {
    calls, states, core, input: () => getEditor(sessionId),
    ids: () => [...container.querySelectorAll('[data-welcome-case]')].map(node => node.dataset.welcomeCase),
    async click(label) { const button = [...container.querySelectorAll('button')].find(node => node.textContent === label || node.getAttribute('aria-label') === label); expect(button, label).toBeDefined(); await act(async () => button.click()) },
    async choose(item = 0) { await act(async () => {
      const cards = [...container.querySelectorAll('[data-welcome-case]')]
      const button = typeof item === 'string' ? cards.find(card => card.dataset.welcomeCase === item) : cards[item]
      expect(button, String(item)).toBeDefined()
      button.click()
    }) },
    async unloadQuickStart() { await act(async () => { factoryDisposers.get('desktop.office.quickStart')?.(); render() }) },
    async switchSession(id) { sessionId = id; await act(async () => render()) },
    async edit(text, refs) { await act(async () => getEditor(sessionId).edit(text, refs)) },
    async existingConversation() { blank = false; await act(async () => render()) },
    fail(operation, message) { failures.set(operation, message) },
    hold(operation) { let release; held.set(operation, new Promise(resolve => { release = resolve })); return async () => { await act(async () => { held.delete(operation); release() }) } }
  }
}

it.each([true, false])('shows PPT templates when the case catalogue fails and lets the normal dock retry (bound=%s)', async bound => {
  const f = await fixture({ withComposer: true, bound, failFirstCatalogue: true })
  const host = container.querySelector('[data-conversation-scroll]')
  expect(host.querySelector('[data-welcome-cases] [role=alert]').textContent).toContain('案例加载失败')
  await f.click('PPT')
  expect(host.querySelector('[data-welcome-cases]')).toBeNull()
  expect(host.querySelector('[role=alert]')).toBeNull()
  expect(host.querySelectorAll('[data-office-ppt-template-panel]')).toHaveLength(1)
  expect(host.querySelector('.dso-reference').textContent).toContain('PPT example')
  expect(host.querySelector('[data-native-wheel-owner]')).toBeNull()
  await f.click('PPT')
  await f.click('重新加载')
  expect(f.ids()).toHaveLength(4)
  expect(host.querySelector('[role=alert]')).toBeNull()
  if (bound) expect(f.input().read().draft).toBe('')
})

it('rotates diverse four-case batches in Work, covers all cases, and never changes the draft', async () => {
  const f = await fixture({ initial: 'Keep my working notes' }), batches = []
  for (let i = 0; i < catalogue.batches.work.length; i++) {
    const ids = f.ids()
    batches.push(ids)
    expect(ids).toHaveLength(4)
    expect(ids.map(id => workCase(id).officeMode)).toContain('ppt')
    expect(new Set(ids.map(id => workCase(id).category)).size).toBe(4)
    await f.click('切换一批')
  }
  expect(new Set(batches.flat())).toEqual(new Set(catalogue.work.map(item => item.id)))
  expect(f.ids()).toEqual(batches[0])
  expect(f.input().read().draft).toBe('Keep my working notes')
  expect(f.calls.filter(call => call.operation === 'welcome-cases')).toHaveLength(1)
  expect(f.input().submit).not.toHaveBeenCalled()
})

it.each([false, true])('shows the template empty state when Excel has no templates (English=%s)', async english => {
  const f = await fixture({ english })
  await f.click('Excel')
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(container.querySelector('.dso-reference [role=status]').textContent).toBe(english ? 'No templates available' : '暂无模板')
  await f.click('Excel')
  expect(f.ids()).toEqual(catalogue.batches.work[0])
})

it.each([false, true])('directly fills the exact sourced prompt without success feedback or an undo button (English=%s)', async english => {
  const f = await fixture({ english, initial: 'Existing notes' })
  expect(container.querySelector('.dso-quick-heading h3').textContent).toBe(english ? 'Start with an example' : '从一个案例开始')
  expect(container.querySelector('.dso-quick-batch').textContent).toBe(english ? 'Try another set' : '切换一批')
  expect(container.querySelector('.dso-quick-heading').textContent).toBe(english ? 'Start with an exampleTry another set' : '从一个案例开始切换一批')
  const button = container.querySelector('[data-welcome-case]')
  const item = workCase(button.dataset.welcomeCase)
  expect(button.textContent).toContain(item.title[english ? 'en' : 'zh'])
  button.focus(); expect(document.activeElement).toBe(button)
  // jsdom does not supply the keyboard activation default of native buttons.
  await act(async () => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); button.click() })
  expect(f.input().read().draft).toBe(item.prompt)
  expect(f.input().submit).not.toHaveBeenCalled()
  expect(f.input().setDraft).not.toHaveBeenCalled()
  expect(container.querySelector('.dso-quick-status')).toBeNull()
  expect([...container.querySelectorAll('button')].some(button => button.textContent === (english ? 'Undo text' : '撤销填词'))).toBe(false)
})

it('keeps the mixed case batch beside templates when a case activates an Office mode', async () => {
  const f = await fixture({ withComposer: true, officeTemplates: linkedTemplates })
  const initialBatch = f.ids()
  for (const [index, mode, label] of [[0, 'ppt', 'PPT'], [1, 'word', 'Word'], [2, 'excel', 'Excel'], [3, 'normal', null]]) {
    await f.choose(initialBatch[index])
    expect(container.querySelector('[data-office-dock]').dataset.officeDock).toBe(mode)
    const item = workCase(initialBatch[index])
    expect(f.ids()).toEqual(initialBatch)
    if (label) {
      const templates = container.querySelector('.dso-reference')
      expect(templates).not.toBeNull()
      expect(container.querySelector('[data-welcome-cases]').compareDocumentPosition(templates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      if (mode === 'ppt') expect(templates.querySelector('[data-office-ppt-template-panel]')).not.toBeNull()
      else expect(templates.querySelector('[data-office-template][data-selected=true]').textContent).toContain(item.template)
    } else {
      expect(container.querySelector('.dso-reference')).toBeNull()
    }
    expect(f.input().read().draft).toBe(item.prompt)
    for (const button of [...container.querySelectorAll('[data-office-mode],button[data-desktop-ppt]')]) {
      expect(button.getAttribute('aria-pressed')).toBe(String(button.textContent === label))
    }
    expect(container.querySelector('.dso-quick-status')).toBeNull()
    if (label) {
      await f.click(label)
      expect(f.ids()).toEqual(initialBatch)
      await f.click(label)
      expect(container.querySelector('[data-welcome-cases]')).toBeNull()
      expect(container.querySelector('.dso-reference')).not.toBeNull()
      await f.click(label)
    }
  }
  await f.click('Word')
  expect(f.input().read().draft).toBe(workCase(initialBatch[3]).prompt)
  expect(f.input().submit).not.toHaveBeenCalled()
})

it('keeps a later mixed batch when a case brings up templates and rotates only on request', async () => {
  const f = await fixture({ officeTemplates: linkedTemplates })
  await f.click('切换一批')
  const batch = f.ids()
  await f.choose('port-review')
  expect(f.ids()).toEqual(batch)
  expect(container.querySelector('.dso-reference')).not.toBeNull()
  await f.choose('tea-market')
  expect(f.ids()).toEqual(batch)
  expect(container.querySelector('[data-office-template][data-selected=true]').dataset.officeTemplate).toBe('coffee-market')
  expect(f.input().read().draft).toBe(workCase('tea-market').prompt)
  await f.choose('tea-market')
  expect(f.ids()).toEqual(batch)
  expect(f.input().read().draft).toBe('')
  await f.click('切换一批')
  expect(f.ids()).toEqual(catalogue.batches.work[2])
})

it('resizes the composer when switching cases and continues from the visible height if interrupted', async () => {
  const f = await fixture({ officeTemplates: linkedTemplates, withComposer: true })
  const editor = container.querySelector('[data-composer-card] span')
  editor.setAttribute('data-input-scroll', '')
  let visibleHeight
  editor.getBoundingClientRect = () => {
    const mode = container.querySelector('[data-office-dock]').dataset.officeDock
    const height = f.input().read().draft ? (mode === 'excel' ? 184 : 112) : 76
    return { height: visibleHeight ?? height }
  }
  const cancel = vi.fn(() => { visibleHeight = undefined })
  editor.animate = vi.fn(() => ({ cancel }))
  const chooseAndPaint = async id => {
    await f.choose(id)
    await new Promise(resolve => window.requestAnimationFrame(resolve))
  }

  await chooseAndPaint('customer-success-review')
  await chooseAndPaint('subscription-analysis')
  expect(editor.animate).toHaveBeenLastCalledWith({ blockSize: ['112px', '184px'] }, expect.anything())

  visibleHeight = 156
  await chooseAndPaint('customer-success-review')
  expect(editor.animate).toHaveBeenLastCalledWith({ blockSize: ['156px', '112px'] }, expect.anything())
  expect(f.input().read().draft).toBe(workCase('customer-success-review').prompt)
})

it.each(['customer-success-review', 'pomodoro-timer'])('clears the case highlight when the draft for %s is emptied', async id => {
  const f = await fixture()
  await f.choose(id)
  const pressed = () => container.querySelector('[data-welcome-case][aria-pressed=true]')?.dataset.welcomeCase
  expect(pressed()).toBe(id)
  if (workCase(id).officeMode === 'ppt') {
    await f.click('PPT')
    expect(container.querySelector('[data-office-dock]').dataset.officeDock).toBe('normal')
    expect(pressed()).toBe(id)
  }
  await f.edit('')
  expect(pressed()).toBeUndefined()
  expect(f.ids()).toEqual(catalogue.batches.work[0])
})

it.each(['customer-success-review', 'event-minutes', 'subscription-analysis', 'pomodoro-timer'])('toggles %s off and clears the input without changing the case batch', async id => {
  const f = await fixture({ officeTemplates: linkedTemplates, attachmentIds: ['uploaded-a'], withComposer: true })
  await f.choose(id)
  if (id === 'customer-success-review') await f.click('PPT example')
  expect(f.input().read().draft).toBe(workCase(id).prompt)
  expect(container.querySelector('[data-welcome-case][aria-pressed=true]').dataset.welcomeCase).toBe(id)

  await f.choose(id)
  expect(f.input().read()).toMatchObject({ draft: '', attachmentIds: ['uploaded-a'] })
  expect(f.input().persistDraft).toHaveBeenCalledTimes(2)
  expect(f.input().submit).not.toHaveBeenCalled()
  expect(f.ids()).toEqual(catalogue.batches.work[0])
  expect(container.querySelector('[data-welcome-case][aria-pressed=true]')).toBeNull()
  expect(container.querySelector('[data-office-dock]').dataset.officeDock).toBe('normal')
  expect(container.querySelector('.dso-reference')).toBeNull()
  expect(container.querySelector('button[data-desktop-ppt]').hasAttribute('data-selected')).toBe(false)
  expect(f.states.get('session-a')).toMatchObject({ mode: null, presentationMode: null, selectedTemplateId: null })
  if (id === 'customer-success-review') expect(f.states.get('session-a').selectedPptTemplateId).toBeNull()
})

it('preserves text typed while a case cancellation is being saved', async () => {
  const f = await fixture()
  await f.choose()
  const release = f.hold('mode')
  await f.choose()
  await f.edit('New input while canceling')
  await release()
  expect(f.input().read().draft).toBe('New input while canceling')
  expect(container.querySelector('[data-welcome-case][aria-pressed=true]')).toBeNull()
})

it('keeps the selected case and its prompt if clearing its mode fails', async () => {
  const f = await fixture()
  await f.choose()
  f.fail('mode', 'Mode could not be cleared')
  await f.choose()
  expect(f.input().read().draft).toBe(workCase('customer-success-review').prompt)
  expect(container.querySelector('[data-welcome-case][aria-pressed=true]').dataset.welcomeCase).toBe('customer-success-review')
  expect(container.querySelector('.dso-reference')).not.toBeNull()
  expect(container.querySelector('[data-welcome-cases] [role=alert]').textContent).toBe('Mode could not be cleared')
})

it('keeps the case entry scoped to its session and clears it on a direct mode change', async () => {
  const f = await fixture({ withComposer: true, officeTemplates: linkedTemplates })
  await f.choose('subscription-analysis')
  await f.switchSession('session-b')
  await f.click('Excel')
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(container.querySelector('.dso-reference')).not.toBeNull()
  await f.switchSession('session-a')
  expect(f.ids()).toEqual(catalogue.batches.work[0])
  await f.click(`选用案例 ${workCase('enzyme-quality').template}`)
  expect(f.ids()).toEqual(catalogue.batches.work[0])
  expect(f.input().read().draft).toBe(workCase('enzyme-quality').prompt)
  await f.click('Word')
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(container.querySelector('[data-office-template="meeting-minutes"]')).not.toBeNull()
  await f.click('Excel')
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(container.querySelector('[data-office-template="annual-business"]')).not.toBeNull()
})

it('appends a case prompt to an occupied draft and removes only that prompt on cancellation', async () => {
  const f = await fixture()
  const reference = { source: 'files', ref: 'sample.pdf', clipboardText: '@a-very-long-file-name.pdf', offset: 7, length: 26 }
  const original = `Please ${reference.clipboardText} inspect`
  await f.edit(original, [reference])
  const chosen = workCase(f.ids()[0])
  await f.choose()
  expect(f.input().read().draft).toBe(original + '\n\n' + chosen.prompt)
  expect(f.input().read().occurrences).toEqual([reference])
  expect(container.querySelector('.dso-quick-status')).toBeNull()
  await f.choose()
  expect(f.input().read()).toMatchObject({ draft: original, occurrences: [reference] })
  expect(container.querySelector('[data-welcome-case][aria-pressed=true]')).toBeNull()
})

it('refuses to overwrite an edit while an Office mode request is pending', async () => {
  const f = await fixture()
  const release = f.hold('case-mode')
  await f.choose(); await f.edit('New input while saving')
  expect(container.querySelector('button[data-desktop-ppt]').disabled).toBe(true)
  await release()
  expect(f.input().read().draft).toBe('New input while saving')
  expect(container.querySelector('[data-office-dock] [role=alert]')).not.toBeNull()
  await f.click('PPT')
  const chosen = workCase(f.ids()[0])
  await f.choose()
  expect(f.input().read().draft).toBe(chosen.prompt)
})

it('does not insert into either draft after a pending case request loses its session', async () => {
  const f = await fixture()
  const release = f.hold('case-mode')
  await f.choose(); await f.switchSession('session-b'); await f.click('Excel'); await release()
  expect(container.querySelector('[data-office-dock]').dataset.officeDock).toBe('excel')
  expect(f.input().read().draft).toBe('')
  await f.switchSession('session-a')
  expect(f.input().read().draft).toBe('')
})

it('does not present welcome cases once the conversation has messages', async () => {
  const f = await fixture(); await f.existingConversation()
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
})

it('stages an unbound case then adopts it into a newly selected empty session', async () => {
  const f = await fixture({ bound: false })
  await f.choose()
  expect(container.querySelector('[data-welcome-case][aria-pressed=true]')).not.toBeNull()
  expect(f.input().insertText).not.toHaveBeenCalled()
  await f.switchSession('session-new')
  expect(f.input().read().draft.length).toBeGreaterThan(20)
  expect(f.ids()).toContain('customer-success-review')
  expect(container.querySelector('.dso-reference [data-office-ppt-template-panel]')).not.toBeNull()
  expect(f.input().insertText).toHaveBeenCalledTimes(1)
  expect(f.input().submit).not.toHaveBeenCalled()
})

it('cancels a staged case before it can fill a new session', async () => {
  const f = await fixture({ bound: false })
  await f.choose()
  await f.choose()
  expect(container.querySelector('[data-welcome-case][aria-pressed=true]')).toBeNull()
  await f.switchSession('session-new')
  expect(f.input().read().draft).toBe('')
  expect(f.calls.some(({ operation }) => operation === 'case-mode')).toBe(false)
})

it('claims staged intent to the first session without leaking into another empty session', async () => {
  const f = await fixture({ bound: false, initial: 'Existing draft' })
  await f.choose(); await f.switchSession('session-a')
  expect(f.input().read().draft).toBe('Existing draft')
  expect(container.querySelector('[data-welcome-cases]').textContent).toMatch(/确认填入/)
  await f.switchSession('session-b')
  expect(f.input().read().draft).toBe('')
  expect(f.input().insertText).not.toHaveBeenCalled()
  const chosen = workCase(f.ids()[0])
  await f.switchSession('session-a'); await f.choose()
  expect(f.input().read().draft).toBe(chosen.prompt)
  expect(f.input().insertText).toHaveBeenCalledTimes(1)
})

it('clears staged task intent when the user switches output modes', async () => {
  const f = await fixture({ bound: false })
  await f.choose(); await f.click('Word'); await f.switchSession('session-new')
  expect(container.querySelector('[data-office-dock]').dataset.officeDock).toBe('word')
  expect(f.input().read().draft).toBe('')
})

it('retains the original PPT chooser when Office quick-start contribution is absent', async () => {
  const f = await fixture({ office: false })
  await f.click('PPT')
  expect(container.querySelector('[data-office-ppt-template-panel]')).not.toBeNull()
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
})

it('keeps the case list when selecting a PPT style inside the case flow', async () => {
  const f = await fixture()
  await f.choose()
  expect(container.querySelector('.dso-quick-status')).toBeNull()
  expect(container.querySelector('.dso-reference').hidden).toBe(false)
  expect(container.querySelector('.dso-reference').textContent).toContain('PPT example')
  await f.click('PPT example')
  expect(f.states.get('session-a').selectedPptTemplateId).toBe('ppt-example')
  expect(f.ids()).toContain('customer-success-review')
  expect(container.querySelector('.dso-reference [data-office-ppt-template-panel]')).not.toBeNull()
})

it('loads an empty PPT catalogue without repeatedly requesting state', async () => {
  const f = await fixture({ emptyCatalogue: true })
  await f.click('PPT')
  expect(f.calls.length).toBeLessThan(30)
  expect(container.querySelector('[data-office-dock]').dataset.officeDock).toBe('ppt')
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
})

it('loads one reusable root factory across both dock layouts and releases its fallback on removal', async () => {
  const f = await fixture()
  expect(f.core.factory('desktop.office.quickStart')?.scope).toBe('root')
  expect(f.core.factory('desktop.office.quickStart')?.children).toBeUndefined()
  await f.click('PPT')
  expect(container.querySelector('.dso-reference [data-office-ppt-template-panel]')).not.toBeNull()
  await f.unloadQuickStart()
  expect(f.core.factory('desktop.office.quickStart')).toBeUndefined()
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(container.querySelector('[data-office-ppt-template-panel]')).not.toBeNull()
  expect(container.textContent).toContain('PPT example')
})

it.each([
  { bound: true, english: false }, { bound: false, english: false },
  { bound: true, english: true }, { bound: false, english: true }
])('shows only the selected mode’s templates and restores cases when the mode is cleared: %j', async ({ bound, english }) => {
  const f = await fixture({ bound, english, withComposer: true, officeTemplates: referenceTemplates, initial: 'Keep my working notes' })
  const expectReferences = mode => {
    const templates = container.querySelector('.dso-reference')
    expect(templates).not.toBeNull()
    expect(templates.hidden).toBe(false)
    expect(container.querySelector('[data-welcome-cases]')).toBeNull()
    expect(container.querySelector('.dso-quick-batch')).toBeNull()
    expect(container.querySelectorAll('.dso-reference')).toHaveLength(1)
    expect(container.querySelector('.dso-reference-toggle[aria-controls]')).toBeNull()
    const heading = english ? 'Reference templates' : '参考模板'
    expect(templates.querySelector('h3').textContent).toBe(heading)
    expect([...container.querySelectorAll('button')].some(button => button.textContent === heading)).toBe(false)
    expect([...templates.querySelectorAll('[data-office-template]')].map(card => card.dataset.officeTemplate)).toEqual(mode === 'ppt' ? [] : [`${mode}-reference`])
    if (mode === 'ppt') expect(templates.querySelector('[data-office-ppt-template-panel]')).not.toBeNull()
  }
  expect(container.querySelector('.dso-reference')).toBeNull()
  await f.click(english ? 'Try another set' : '切换一批')
  expect(f.ids()).toEqual(catalogue.batches.work[1])
  await f.click('Word'); expectReferences('word')
  await f.click(`${english ? 'Select example' : '选用案例'} word reference`)
  expect(container.querySelector('[data-office-template="word-reference"]').dataset.selected).toBe('true')
  await f.click('Excel'); expectReferences('excel')
  await f.click('Excel')
  expect(container.querySelector('.dso-reference')).toBeNull()
  expect(f.ids()).toEqual(catalogue.batches.work[0])
  await f.click('PPT'); expectReferences('ppt')
  await f.click('Word'); expectReferences('word')
  if (bound) expect(f.input().read().draft).toBe('Keep my working notes')
  expect(f.input().insertText).not.toHaveBeenCalled()
  expect(f.input().submit).not.toHaveBeenCalled()
  expect(f.calls.filter(call => call.operation === 'welcome-cases')).toHaveLength(1)
})

it('automatically restores the active session reference templates when switching sessions', async () => {
  const f = await fixture({ mode: 'word', officeTemplates: referenceTemplates })
  expect(container.querySelector('.dso-reference').hidden).toBe(false)
  expect(container.querySelector('[data-office-template="word-reference"]')).not.toBeNull()
  await f.switchSession('session-b')
  expect(container.querySelector('.dso-reference')).toBeNull()
  await f.click('Excel')
  expect(container.querySelector('.dso-reference').hidden).toBe(false)
  expect(container.querySelector('[data-office-template="excel-reference"]')).not.toBeNull()
  await f.switchSession('session-a')
  expect(container.querySelector('.dso-reference').hidden).toBe(false)
  expect(container.querySelector('[data-office-template="word-reference"]')).not.toBeNull()
  expect(container.querySelector('[data-office-template="excel-reference"]')).toBeNull()
})

it.each(['card', 'preview'])('switches the entire Excel example prompt with its template from the %s', async source => {
  const f = await fixture({ mode: 'excel', officeTemplates: linkedTemplates, withComposer: true })
  await f.click(`选用案例 ${workCase('port-review').template}`)
  expect(f.input().read().draft).toBe(workCase('port-review').prompt)
  expect(f.states.get('session-a').selectedTemplateId).toBe('port-cargo')

  const example = workCase('enzyme-quality')
  if (source === 'preview') {
    await f.click(`查看案例 ${example.template}`)
    await f.click('做同款')
    expect(container.querySelector('dialog')).toBeNull()
  } else await f.click(`选用案例 ${example.template}`)
  expect(f.states.get('session-a').selectedTemplateId).toBe('bio-assay')
  expect(f.input().read().draft).toBe(example.prompt)
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(f.input().persistDraft).toHaveBeenCalledTimes(2)
  expect(f.input().submit).not.toHaveBeenCalled()
  await f.click(`选用案例 ${workCase('port-review').template}`)
  expect(f.input().read().draft).toBe(workCase('port-review').prompt)
})

it('fills a blank Word draft and can switch from a template without a paired example', async () => {
  const extra = { ...referenceTemplates[0], id: 'equity-research', title: '小米汽车研究报告', titleEn: 'Company research report' }
  const f = await fixture({ mode: 'word', english: true, officeTemplates: [...linkedTemplates, extra] })
  await f.click('Select example Company research report')
  expect(f.input().read().draft).toContain('Use the “Company research report” template to create an editable DOCX')
  await f.click(`Select example ${workCase('tea-market').template}`)
  expect(f.input().read().draft).toBe(workCase('tea-market').prompt)
})

it('updates a restored prompt between user notes and references while keeping attachments', async () => {
  const first = workCase('port-review'), next = workCase('enzyme-quality')
  const prefix = 'Use @input.xlsx\n\n', suffix = '\n\nInclude @context.pdf and add my summary.'
  const text = prefix + first.prompt + suffix
  const refs = ['@input.xlsx', '@context.pdf'].map(clipboardText => ({ source: 'files', ref: clipboardText, clipboardText, offset: text.indexOf(clipboardText), length: clipboardText.length }))
  const f = await fixture({ mode: 'excel', selectedTemplateId: 'port-cargo', attachmentIds: ['uploaded-a'], officeTemplates: linkedTemplates })
  await f.edit(text, refs)
  await f.click(`选用案例 ${next.template}`)
  const updated = prefix + next.prompt + suffix
  expect(f.input().read()).toMatchObject({
    draft: updated, attachmentIds: ['uploaded-a'],
    occurrences: refs.map(ref => ({ ...ref, offset: updated.indexOf(ref.clipboardText) }))
  })
  expect(f.input().setDraft).not.toHaveBeenCalled()
})

it('keeps a prompt that the user has rewritten when changing templates', async () => {
  const manual = workCase('port-review').prompt.replace('海岚港', '我自己的码头')
  const f = await fixture({ mode: 'excel', initial: manual, selectedTemplateId: 'port-cargo', officeTemplates: linkedTemplates })
  await f.click(`选用案例 ${workCase('enzyme-quality').template}`)
  expect(f.states.get('session-a').selectedTemplateId).toBe('bio-assay')
  expect(f.input().read().draft).toBe(manual)
  expect(f.input().insertText).not.toHaveBeenCalled()
  expect(container.querySelector('[role=status]').textContent).toContain('已保留你编辑的提示词')
})

it('keeps changes typed while template selection is saving', async () => {
  const first = workCase('port-review'), next = workCase('enzyme-quality')
  const f = await fixture({ mode: 'excel', initial: first.prompt, selectedTemplateId: 'port-cargo', officeTemplates: linkedTemplates })
  const release = f.hold('select')
  await f.click(`选用案例 ${next.template}`)
  const edited = first.prompt + '\nMy edit during selection'
  await f.edit(edited)
  await release()
  expect(f.input().read().draft).toBe(edited)
  expect(f.input().persistDraft).not.toHaveBeenCalled()
})

it('does not update the draft when the new template cannot be saved', async () => {
  const first = workCase('port-review'), next = workCase('enzyme-quality')
  const f = await fixture({ mode: 'excel', initial: first.prompt, selectedTemplateId: 'port-cargo', officeTemplates: linkedTemplates })
  f.fail('select', 'Template expired')
  await f.click(`选用案例 ${next.template}`)
  expect(f.states.get('session-a').selectedTemplateId).toBe('port-cargo')
  expect(f.input().read().draft).toBe(first.prompt)
  expect(f.input().insertText).not.toHaveBeenCalled()
  expect(container.querySelector('.dso-dock [role=alert]').textContent).toContain('Template expired')
})

it('does not fill either editor when template selection finishes after changing sessions', async () => {
  const first = workCase('port-review'), next = workCase('enzyme-quality')
  const f = await fixture({ mode: 'excel', initial: first.prompt, selectedTemplateId: 'port-cargo', officeTemplates: linkedTemplates })
  const release = f.hold('select')
  await f.click(`选用案例 ${next.template}`)
  await f.switchSession('session-b')
  await release()
  expect(f.input().read().draft).toBe('')
  await f.switchSession('session-a')
  expect(f.input().read().draft).toBe(first.prompt)
  expect(f.input().insertText).not.toHaveBeenCalled()
})

it('adopts the latest staged template and prompt when a workspace is selected', async () => {
  const f = await fixture({ bound: false, withComposer: true, officeTemplates: linkedTemplates })
  await f.click('Excel')
  await f.click(`选用案例 ${workCase('port-review').template}`)
  await f.click(`选用案例 ${workCase('enzyme-quality').template}`)
  await f.switchSession('session-new')
  expect(f.states.get('session-new').selectedTemplateId).toBe('bio-assay')
  expect(f.input().read().draft).toBe(workCase('enzyme-quality').prompt)
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(f.input().insertText).toHaveBeenCalledTimes(1)
})
