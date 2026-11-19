import { expect, it } from 'vitest'
import { fixture, collect, flatten } from './helpers/ungrouped-collection.mjs'

it('keeps unassigned Work in the native Ungrouped section, outside Chat history', () => {
  const { collection, fallback } = collect(fixture())
  expect(collection.items).toHaveLength(0)
  const projects = flatten(collection.projects(true))
  expect(projects.filter(node => node.type === 'NativeProject').map(node => node.props.group.workspaceId)).toEqual(['project', undefined])
  expect(projects.filter(node => node.type === 'NativeSession').map(node => node.props.node.id)).toEqual(['assigned', 'loose'])
  expect(flatten(fallback).filter(node => node.type === 'NativeSession').map(node => node.props.node.id)).toEqual(['assigned', 'loose'])
})
it('returns sessions from a deleted project to Ungrouped without changing the sessions', () => {
  const props = fixture()
  const before = collect(props).collection
  expect(flatten(before.projects(true)).filter(node => node.type === 'NativeProject').map(node => node.props.group.workspaceId)).toEqual(['project', undefined])
  const sessionsBefore = JSON.stringify(props.list)
  props.workspaces = []
  const { collection } = collect(props)
  expect(collection.items).toHaveLength(0)
  const nodes = flatten(collection.projects(true))
  expect(nodes.filter(node => node.type === 'NativeProject').map(node => node.props.group.workspaceId)).toEqual([undefined])
  expect(nodes.filter(node => node.type === 'NativeSession').map(node => node.props.node.id)).toEqual(['assigned', 'loose'])
  expect(JSON.stringify(props.list)).toBe(sessionsBefore)
})

it('preserves native archive filtering in the ungrouped section', () => {
  const { collection } = collect(fixture(), { archivedFilter: 'only' })
  expect(collection.archivedOnly).toBe(true)
  expect(collection.items).toHaveLength(0)
  expect(flatten(collection.projects(true)).filter(node => node.type === 'NativeSession').map(node => node.props.node.id)).toEqual(['archived'])
})

it('preserves native group collapse state', () => {
  const { collection } = collect(fixture(), { groupExpansion: { project: true, '': false } })
  const nodes = flatten(collection.projects(true))
  expect(nodes.find(node => node.type === 'NativeProject' && node.props.group.workspaceId === undefined).props.group.expanded).toBe(false)
  expect(nodes.filter(node => node.type === 'NativeSession').map(node => node.props.node.id)).toEqual(['assigned'])
})

it('clears local selection when cloud Chat owns the right pane and updates membership on regrouping', () => {
  const props = fixture()
  const first = collect(props).collection
  expect(flatten(first.projects(false)).find(node => node.type === 'NativeSession').props.currentId).toBeUndefined()
  expect(flatten(first.projects(true)).find(node => node.type === 'NativeSession').props.currentId).toBe('assigned')
  props.workspaces[0].sessionIds.push('loose')
  // WorkspaceBrowser's authoritative membership projection feeds SessionTree.
  const nextProps = { ...props }
  const next = collect(nextProps).collection
  expect(next.items).toHaveLength(0)
  expect(flatten(next.projects(true)).filter(node => node.type === 'NativeSession').map(node => node.props.node.id)).toEqual(['assigned', 'loose'])
})
