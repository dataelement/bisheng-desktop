// @vitest-environment jsdom
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import React, { act } from 'react'
import * as jsx from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const catalogue = JSON.parse(await readFile(resolve('packages/dsh-desktop-office/welcome-cases.json'), 'utf8'))
const workCase = id => catalogue.work.find(item => item.id === id)
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
function editor(initial = '') {
  let draft = initial, rev = 0, occurrences = []
  const listeners = new Set()
  let snapshot = { draft, draftRev: rev, occurrences, phase: 'plain' }
  const publish = () => { snapshot = { draft, draftRev: rev, occurrences, phase: 'plain' }; for (const listener of listeners) listener() }
  return {
    state: { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) } },
    insertText: vi.fn((text, span) => {
      if (span.draftRev !== rev) return false
      const chipExpansion = occurrences.reduce((sum, ref) => sum + ref.length - 1, 0)
      if (occurrences.length && span.start < draft.length - chipExpansion && text) throw new Error('Expected an append preserving chips')
      draft = draft.slice(0, span.start + chipExpansion) + text + draft.slice(span.end + chipExpansion)
      rev++; publish(); return true
    }),
    setDraft: vi.fn(), submit: vi.fn(), focus: vi.fn(),
    edit(text, refs = occurrences) { draft = text; occurrences = refs; rev++; publish() },
    read: () => snapshot
  }
}

async function fixture({ mode = null, presentationMode = null, selectedTemplateId = null, english = false, initial = '', bound = true, office = true, emptyCatalogue = false, withComposer = false } = {}) {
  let sessionId = bound ? 'session-a' : undefined, blank = true
  const dictionaries = new Map(), seats = [], calls = [], held = new Map(), editors = new Map(), states = new Map([['session-a', { mode, presentationMode, selectedTemplateId }]])
  const getEditor = id => { if (!editors.has(id)) editors.set(id, editor(id === 'session-a' ? initial : '')); return editors.get(id) }
  const pptTemplates = [{ id: 'ppt-example', name: 'PPT example', category: 'business', palette: { background: 'FFFFFF', surface: 'F4F4F4', text: '242424', muted: '666666', accent: '3888FF', secondary: 'E7E7E9' } }]
  const connection = { rpc: { async call(route, endpoint, payload, signal) {
    const operation = route === '/api' ? payload.endpoint : endpoint
    calls.push({ operation, payload, route })
    if (calls.length > 100) throw new Error('Fixture stopped a repeated catalogue request loop')
    if (held.has(operation)) await held.get(operation)
    signal?.throwIfAborted()
    let state = states.get(payload.sessionId) ?? { mode: null, presentationMode: null, selectedTemplateId: null }
    if (operation === 'welcome-cases') return { ok: true, value: { cases: catalogue.work, batches: catalogue.batches.work } }
    if (operation === 'case-mode') {
      const item = workCase(payload.caseId)
      state = { mode: ['word', 'excel'].includes(item.officeMode) ? item.officeMode : null,
        presentationMode: item.officeMode === 'ppt' ? 'ppt' : null,
        selectedTemplateId: null }
    }
    if (operation === 'mode') state = { ...state, mode: payload.mode, presentationMode: null, selectedTemplateId: null }
    if (operation === 'deselect') state = { ...state, selectedTemplateId: null }
    if (operation === 'presentation/mode') state = { ...state, mode: null, presentationMode: payload.mode, selectedTemplateId: null }
    states.set(payload.sessionId, state)
    return route === '/api' ? { ok: true, value: { ...state, templates: [] } } : { ok: true, value: { status: 'ok', data: { ...state, documentMode: state.mode, templates: emptyCatalogue ? [] : pptTemplates } } }
  } } }
  const core = new SlotCore(), factoryDisposers = new Map()
  const nativeSeats = ['conversation.hero.modeActions', 'conversation.hero.dock', 'conversation.composer.dock', 'conversation.input.accessory', 'conversation.chat.userMessageFooter']
  disposers.push(core.register({ name: 'root', children: Object.fromEntries(nativeSeats.map(name => [name, { kind: 'list', scope: 'root' }])) }, () => null))
  const ctx = {
    get: () => connection, effect(run) { disposers.push(run()) }, on() {},
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
    const slots = [...renderSlot('conversation.hero.modeActions'), ...renderSlot('conversation.hero.dock')]
    root.render(withComposer
      ? React.createElement('div', { 'data-conversation-scroll': '' },
          React.createElement('div', { 'data-composer-seat': '' },
            React.createElement('div', { 'data-composer-card': '' },
              React.createElement('div', { 'data-test-draft': '', style: { overflowY: 'auto' } },
                React.createElement('span', null, 'Draft text'))),
            ...slots))
      : React.createElement(React.Fragment, null, ...slots))
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
    hold(operation) { let release; held.set(operation, new Promise(resolve => { release = resolve })); return async () => { await act(async () => { held.delete(operation); release() }) } }
  }
}

it('keeps automatically visible PPT templates in the native welcome scrollport', async () => {
  const f = await fixture({ withComposer: true })
  await f.click('PPT')
  const host = container.querySelector('[data-conversation-scroll]')
  const templates = host.querySelector('.dso-reference')
  expect(templates.hidden).toBe(false)
  expect(templates.textContent).toContain('PPT example')
  expect(host.querySelector('[data-native-wheel-owner]')).toBeNull()
  expect(container.querySelector('[data-welcome-cases] header [aria-controls]')).toBeNull()
  expect(f.input().read().draft).toBe('')
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

it.each([false, true])('directly replaces text with the exact sourced prompt and supports undo (English=%s)', async english => {
  const f = await fixture({ english, initial: 'Existing notes' })
  const button = container.querySelector('[data-welcome-case]')
  const item = workCase(button.dataset.welcomeCase)
  expect(button.textContent).toContain(item.title[english ? 'en' : 'zh'])
  button.focus(); expect(document.activeElement).toBe(button)
  // jsdom does not supply the keyboard activation default of native buttons.
  await act(async () => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); button.click() })
  expect(f.input().read().draft).toBe(item.prompt)
  expect(f.input().submit).not.toHaveBeenCalled()
  expect(f.input().setDraft).not.toHaveBeenCalled()
  await f.click(english ? 'Undo text' : '撤销填词')
  expect(f.input().read().draft).toBe('Existing notes')
})

it('selects each real output mode in the existing controls without remounting the case list', async () => {
  const f = await fixture()
  const initialBatch = f.ids()
  for (const [index, mode, label] of [[0, 'ppt', 'PPT'], [1, 'word', 'Word'], [2, 'excel', 'Excel'], [3, 'normal', null]]) {
    await f.choose(index)
    expect(container.querySelectorAll('[data-welcome-cases]')).toHaveLength(1)
    expect(container.querySelector('[data-welcome-cases]').dataset.welcomeCases).toBe(mode)
    expect(f.ids()).toEqual(initialBatch)
    expect(f.input().read().draft).toBe(workCase(initialBatch[index]).prompt)
    for (const button of [...container.querySelectorAll('[data-office-mode],button[data-desktop-ppt]')]) {
      expect(button.getAttribute('aria-pressed')).toBe(String(button.textContent === label))
    }
  }
  await f.click('Word')
  expect(f.input().read().draft).toBe(workCase(initialBatch[3]).prompt)
  expect(f.input().submit).not.toHaveBeenCalled()
})

it('appends when an occupied input contains an inline reference and undo keeps the chip', async () => {
  const f = await fixture()
  const reference = { source: 'files', ref: 'sample.pdf', clipboardText: '@a-very-long-file-name.pdf', offset: 7, length: 26 }
  const original = `Please ${reference.clipboardText} inspect`
  await f.edit(original, [reference])
  expect(container.querySelector('[data-welcome-cases]').textContent).toMatch(/追加/)
  await f.choose()
  expect(f.input().read().draft).toBe(original + '\n\n' + workCase(f.ids()[0]).prompt)
  expect(f.input().read().occurrences).toEqual([reference])
  await f.click('撤销填词')
  expect(f.input().read().draft).toBe(original)
  expect(f.input().read().occurrences).toEqual([reference])
})

it('refuses to overwrite an edit while an Office mode request is pending', async () => {
  const f = await fixture()
  const release = f.hold('case-mode')
  await f.choose(); await f.edit('New input while saving')
  expect(container.querySelector('button[data-desktop-ppt]').disabled).toBe(true)
  await release()
  expect(f.input().read().draft).toBe('New input while saving')
  expect(container.querySelector('[data-welcome-cases] [role=alert]')).not.toBeNull()
  await f.choose()
  expect(f.input().read().draft).toBe(workCase(f.ids()[0]).prompt)
})

it('does not insert into either draft after a pending case request loses its session', async () => {
  const f = await fixture()
  const release = f.hold('case-mode')
  await f.choose(); await f.switchSession('session-b'); await f.click('Excel'); await release()
  expect(container.querySelector('[data-welcome-cases]').dataset.welcomeCases).toBe('excel')
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
  expect(f.input().insertText).toHaveBeenCalledTimes(1)
  expect(f.input().submit).not.toHaveBeenCalled()
})

it('claims staged intent to the first session without leaking into another empty session', async () => {
  const f = await fixture({ bound: false, initial: 'Existing draft' })
  await f.choose(); await f.switchSession('session-a')
  expect(f.input().read().draft).toBe('Existing draft')
  expect(container.querySelector('[data-welcome-cases]').textContent).toMatch(/确认填入/)
  await f.switchSession('session-b')
  expect(f.input().read().draft).toBe('')
  expect(f.input().insertText).not.toHaveBeenCalled()
  await f.switchSession('session-a'); await f.choose()
  expect(f.input().read().draft).toBe(workCase(f.ids()[0]).prompt)
  expect(f.input().insertText).toHaveBeenCalledTimes(1)
})

it('clears staged task intent when the user switches output modes', async () => {
  const f = await fixture({ bound: false })
  await f.choose(); await f.click('Word'); await f.switchSession('session-new')
  expect(container.querySelector('[data-welcome-cases]').dataset.welcomeCases).toBe('word')
  expect(f.input().read().draft).toBe('')
})

it('retains the original PPT chooser when Office quick-start contribution is absent', async () => {
  const f = await fixture({ office: false })
  await f.click('PPT')
  expect(container.querySelector('[data-office-ppt-template-panel]')).not.toBeNull()
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
})

it('prompts for a real PPT reference style when the selected case needs one', async () => {
  const f = await fixture()
  await f.choose()
  expect(container.querySelector('[data-welcome-cases] [role=status]').textContent).toContain('PPT 模板')
  expect(container.querySelector('.dso-reference').hidden).toBe(false)
  expect(container.querySelector('.dso-reference').textContent).toContain('PPT example')
})

it('loads an empty PPT catalogue without repeatedly requesting state', async () => {
  const f = await fixture({ emptyCatalogue: true })
  await f.click('PPT')
  expect(f.calls.length).toBeLessThan(30)
  expect(container.querySelector('[data-welcome-cases]').dataset.welcomeCases).toBe('ppt')
})

it('loads one reusable root factory across both dock layouts and releases its fallback on removal', async () => {
  const f = await fixture()
  expect(f.core.factory('desktop.office.quickStart')?.scope).toBe('root')
  expect(f.core.factory('desktop.office.quickStart')?.children).toBeUndefined()
  await f.click('PPT')
  expect(container.querySelector('[data-welcome-cases]')).not.toBeNull()
  await f.unloadQuickStart()
  expect(f.core.factory('desktop.office.quickStart')).toBeUndefined()
  expect(container.querySelector('[data-welcome-cases]')).toBeNull()
  expect(container.querySelector('[data-office-ppt-template-panel]')).not.toBeNull()
  expect(container.textContent).toContain('PPT example')
})

it('opens reference styles from the case header and closes them on mode or session changes', async () => {
  const f = await fixture()
  const referenceControl = () => {
    const button = container.querySelector('[data-welcome-cases] header .dso-reference-toggle[aria-controls]')
    expect(button).not.toBeNull()
    const target = document.getElementById(button.getAttribute('aria-controls'))
    expect(target?.classList.contains('dso-reference')).toBe(true)
    return { button, target }
  }
  const expectClosed = () => {
    const { button, target } = referenceControl()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(target.hidden).toBe(true)
  }
  const open = async () => {
    const { button, target } = referenceControl()
    await act(async () => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(target.hidden).toBe(false)
  }
  expect(container.querySelector('[data-welcome-cases] .dso-reference-toggle[aria-controls]')).toBeNull()
  await f.click('Word'); expectClosed(); await open()
  await f.click('Excel'); expectClosed(); await open()
  await f.switchSession('session-b'); await f.click('Word'); expectClosed()
  await f.click('PPT')
  expect(container.querySelector('.dso-reference').hidden).toBe(false)
  expect(container.querySelector('.dso-reference').textContent).toContain('PPT example')
  await f.switchSession('session-a'); expectClosed()
})
