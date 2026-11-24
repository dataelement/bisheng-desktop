import { readFileSync } from 'node:fs'
import ts from 'typescript'

// Execute declarations from the installed, patched bundle. AST boundaries survive
// minification; source maps and removed //#region comments are not runtime inputs.
export function shippedFixture(source) {
  const filename = 'shipped-client.js'
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const program = ts.createProgram([filename], { allowJs: true, noLib: true, noResolve: true }, {
    ...ts.createCompilerHost({}), getSourceFile: name => name === filename ? file : undefined
  })
  const checker = program.getTypeChecker()
  let body = file
  const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)) }
  walk(file, node => { if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'factory' && node.initializer.body?.statements) body = node.initializer.body })
  const declarations = new Map(), names = new Map()
  for (const statement of body.statements) {
    const nodes = ts.isVariableStatement(statement) ? statement.declarationList.declarations : ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ? [statement] : []
    for (const node of nodes) if (node.name && ts.isIdentifier(node.name)) {
      if (ts.isVariableDeclaration(node) && node.initializer && /^require\(/.test(node.initializer.getText(file))) continue
      declarations.set(node, ts.isVariableDeclaration(node) ? (node.parent.flags & ts.NodeFlags.Const ? 'const ' : 'let ') + node.getText(file) + ';' : node.getText(file))
      names.set(node.name.text, node)
    }
  }
  const unique = (predicate, name) => {
    const found = []
    walk(file, node => { if (predicate(node)) found.push(node) })
    if (found.length !== 1) throw new Error(`Expected one shipped ${name}; got ${found.length}`)
    return found[0]
  }
  const dependencies = roots => {
    const selected = new Set()
    const visit = node => {
      walk(node, child => {
        if (!ts.isIdentifier(child)) return
        for (const declaration of checker.getSymbolAtLocation(child)?.declarations || []) {
          if (!declarations.has(declaration) || selected.has(declaration)) continue
          selected.add(declaration); visit(declaration)
        }
      })
    }
    for (const root of roots) { if (declarations.has(root)) selected.add(root); visit(root) }
    return [...selected].sort((a, b) => a.pos - b.pos).map(node => declarations.get(node)).join('\n')
  }
  return {
    declarations: (...requested) => dependencies(requested.map(name => {
      const node = names.get(name)
      if (!node) throw new Error(`Missing shipped declaration: ${name}`)
      return node
    })),
    method: name => unique(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name, name).getText(file),
    property: name => unique(node => ts.isPropertyAssignment(node) && node.name.getText(file) === name, name).initializer.getText(file),
    returnContaining: text => unique(node => ts.isReturnStatement(node) && node.getText(file).includes(text), text).getText(file)
  }
}

export const workUiBundle = readFileSync('packages/dsh-desktop-enterprise/work-ui-client.js', 'utf8').replace('export function createWorkUi(React, primitives = {}) {', "window.__ModuleLoader__.load({ factory(require) { const React = require('react'); const primitives = require('@deepseek-ai/dsh-client-ui-primitives');").replace(/}\s*$/, '} })')
