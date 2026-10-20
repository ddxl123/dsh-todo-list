/**
 * Manifest and wiring consistency tests.
 *
 * A bundle that installs but never loads fails silently — the loader reads the
 * manifest, the module system reads `exports["./client"]`, and neither reports a
 * mismatch as a plugin error. These tests are static: they compare what
 * `package.json` promises with what is on disk and with what the sources
 * import, which is the check that catches a rename before installation does.
 *
 * They deliberately do not execute the client bundle: it is browser code, and
 * the live slot after installation is the authority on whether it renders.
 */

import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

/** This package's root directory. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** @param {string} relative - a path relative to the package root. @returns {string} the file text */
function read(relative) {
  return readFileSync(join(root, relative), 'utf8')
}

const pkg = JSON.parse(read('package.json'))

describe('manifest', () => {
  it('names the package, the bundle row and the client bundle consistently', () => {
    assert.equal(pkg.name, 'dsh-todo-list')
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.main, 'src/index.js')
    assert.equal(pkg.exports['.'], './src/index.js')
    assert.equal(pkg.exports['./client'], './client/index.js')
    assert.equal(pkg.exports['./package.json'], './package.json')
    assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
    assert.equal(pkg.dsh.client.platform, 'web')
    assert.ok(Array.isArray(pkg.dsh.client.inject), 'dsh.client.inject must be an array')
  })

  it('points every declared entry at a file that exists', () => {
    for (const relative of [pkg.main, pkg.exports['./client'], pkg.dsh.bundle.patch, pkg.icon]) {
      assert.equal(statSync(join(root, relative)).isFile(), true, `${relative} must be a file`)
    }
    for (const pattern of ['locale/*.json']) {
      assert.ok(pkg.exports[`./${pattern}`] !== undefined, `exports must publish ${pattern}`)
    }
    assert.ok(pkg.files.includes('client'), 'the published files must include the client half')
    assert.ok(pkg.files.includes('src'), 'the published files must include the host half')
  })

  it('keeps the icon inside the size the manifest reader accepts', () => {
    const icon = statSync(join(root, pkg.icon))
    assert.ok(icon.size < 256 * 1024, `icon is ${icon.size} bytes, over the 256 KiB limit`)
    assert.match(read(pkg.icon), /^<svg[\s>]/, 'the icon must be an SVG document')
  })

  it('describes itself in both locales', () => {
    for (const locale of ['en', 'zh']) {
      const dict = JSON.parse(read(`locale/${locale}.json`))
      assert.equal(typeof dict.meta?.title, 'string', `${locale}.json needs meta.title`)
      assert.equal(typeof dict.meta?.description, 'string', `${locale}.json needs meta.description`)
      assert.ok(dict.meta.title.length > 0 && dict.meta.description.length > 0)
    }
  })

  it('inserts exactly one row, named after the package', () => {
    const patch = read(pkg.dsh.bundle.patch)
    const rows = [...patch.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((match) => match[1])
    assert.deepEqual(rows, [pkg.name])
    assert.match(patch, new RegExp(`name:\\s*'${pkg.name}'`))
  })
})

describe('wiring', () => {
  it('imports nothing but Node builtins and its own files', () => {
    const sources = ['src/index.js', 'src/store.js', 'src/ops.js', 'src/route.js']
    for (const source of sources) {
      const text = read(source)
      const specifiers = [
        ...text.matchAll(/from\s+'([^']+)'/g),
        ...text.matchAll(/import\(\s*'([^']+)'\s*\)/g),
      ].map((match) => match[1])
      for (const specifier of specifiers) {
        assert.match(
          specifier,
          /^(?:node:|\.)/,
          `${source} imports "${specifier}": a profile plugin's import of a shipped package fails activation outright when the profile cannot resolve it, so the Host half must stay dependency-free`,
        )
      }
    }
    assert.equal(pkg.peerDependencies, undefined, 'the Host half declares no peer dependencies')
  })

  it('documents the same config keys the patch row sets', () => {
    const patch = read(pkg.dsh.bundle.patch)
    const block = patch.slice(patch.indexOf('config:'))
    const declared = [...block.matchAll(/^\s{8}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((match) => match[1])
    assert.deepEqual(declared.sort(), ['fileName', 'maxTodos'])

    const source = read('src/index.js')
    const defaults = [...source.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((match) => match[1])
    for (const key of declared) {
      assert.ok(defaults.includes(key), `CONFIG_DEFAULTS must document "${key}"`)
    }
  })

  it('registers the client bundle under the package name', () => {
    const bundle = read(pkg.exports['./client'])
    assert.match(bundle, /window\.__ModuleLoader__\.load\(\{/)
    assert.match(bundle, new RegExp(`id:\\s*'${pkg.name}'`))
    assert.match(bundle, /factory\(require\)/)
    // The panel id is shared by the rail entry and the `main` slot key.
    assert.match(bundle, /ctx\.slots\.register\(\{\s*name:\s*'main',\s*key:\s*PANEL_ID/)
    assert.match(bundle, /name:\s*'sidebar\.panellist',\s*id:\s*PANEL_ID/)
    // No Harness Client package may be loaded as a module.
    assert.doesNotMatch(bundle, /require\('@deepseek-ai\//)
  })

  it('uses only theme tokens for color', () => {
    const bundle = read(pkg.exports['./client'])
    const declarations = bundle.slice(bundle.indexOf('const css = `'), bundle.indexOf('const STYLE_ID'))
    assert.ok(declarations.length > 0, 'the stylesheet must be found')
    for (const match of declarations.matchAll(/(?:color|background|border-color|accent-color)\s*:\s*([^;}]+)/g)) {
      const value = match[1].trim()
      if (value === '0 0' || value === 'transparent' || value === 'inherit' || value === 'none') continue
      assert.match(
        value,
        /^(?:var\(--dsw-[a-z0-9-]+(?:,\s*var\(--dsw-[a-z0-9-]+\))?\)|currentColor)$/,
        `literal color "${value}" — colors must come from theme tokens`,
      )
    }
  })

  it("mirrors the Host half's task limit and refuses an over-long value before sending it", () => {
    const bundle = read(pkg.exports['./client'])
    const store = read('src/store.js')
    const hostLimits = Object.fromEntries(
      [...store.matchAll(/export const MAX_(TEXT) = (\d+)/g)].map((match) => [match[1], Number(match[2])]),
    )
    assert.deepEqual(hostLimits, { TEXT: 2000 })
    for (const [name, value] of Object.entries(hostLimits)) {
      assert.match(
        bundle,
        new RegExp(`const MAX_${name} = ${value}\\b`),
        `the panel must mirror MAX_${name} (${value}) so it can refuse the value itself`,
      )
    }

    // The composer refuses an over-long task and disables its own submit,
    // rather than letting the Host refuse it after the user has typed it.
    assert.match(bundle, /if \(text === '' \|\| tooLong\) return/)
    assert.match(bundle, /disabled: text === '' \|\| tooLong/)
    // The inline editor refuses the same way instead of closing over the edit.
    assert.match(bundle, /if \(tooLong\) return/)
  })

  it('never clears the composer before the Host has accepted the task', () => {
    const bundle = read(pkg.exports['./client'])
    // The regression this guards: `setDraft('')` used to run before the
    // request, so a refused add silently ate what the user had typed.
    assert.doesNotMatch(bundle, /setDraft\(''\)/)
    assert.match(bundle, /setDraft\(\(current\) => \(current\.trim\(\) === text \? '' : current\)\)/)
  })

  it('separates "cannot reach the Host" from "the Host refused"', () => {
    const bundle = read(pkg.exports['./client'])
    // A refusal must not be reported as a connection failure.
    assert.match(bundle, /const UNREACHABLE = 'todo_unreachable'/)
    assert.match(bundle, /error\.unreachable/)
    assert.match(bundle, /error\.rejected/)
    // A refusal keeps the last known list; only an unreachable Host blanks it.
    assert.match(bundle, /failure\.code === UNREACHABLE \? \{ status: 'error' \} : \{\}/)
  })

  it('asks for a second confirmation before deleting a task or clearing completed ones', () => {
    const bundle = read(pkg.exports['./client'])
    // The user requirement: one click must not reach the Host. The row and
    // toolbar handlers only open the dialog; the mutation happens from the
    // dialog's confirm action, after the user has answered it.
    assert.doesNotMatch(bundle, /onClick: \(\) => client\.remove\(/)
    assert.doesNotMatch(bundle, /onClick: \(\) => client\.clearCompleted\(/)
    assert.match(bundle, /onClick: \(event\) => onRequestDelete\(todo, event\.currentTarget\)/)
    assert.match(bundle, /onClick: \(event\) => requestClear\(event\.currentTarget\)/)
    assert.match(bundle, /if \(confirm !== null\)/)
    assert.match(bundle, /if \(request\.kind === 'delete'\) client\.remove\(request\.id\)/)
    assert.match(bundle, /else client\.clearCompleted\(\)/)
    assert.match(bundle, /onConfirm: acceptConfirm/)
  })

  it('renders the confirmation as a real modal with safe focus and dismissal', () => {
    const bundle = read(pkg.exports['./client'])
    // An announced modal, not a strip of text the pointer can miss.
    assert.match(bundle, /role: 'dialog'/)
    assert.match(bundle, /'aria-modal': 'true'/)
    assert.match(bundle, /'aria-labelledby': 'todo-confirm-title'/)
    assert.match(bundle, /'aria-describedby': 'todo-confirm-desc'/)
    // Focus starts on Cancel, so a stray Enter dismisses instead of deleting,
    // and it returns to the control that opened the dialog.
    assert.match(bundle, /cancelRef\.current\?\.focus\(\)/)
    assert.match(bundle, /previous\.isConnected\) previous\.focus\(\)/)
    // Escape works from anywhere: the listener is document-level capture,
    // because clicking the dialog's text moves focus to <body>.
    assert.match(bundle, /document\.addEventListener\('keydown', trap, true\)/)
    assert.match(bundle, /event\.key === 'Escape'/)
    // The backdrop is its own element and cancels on a click.
    assert.match(bundle, /className: 'dshTodoBackdrop'[\s\S]{0,200}?onClick: onCancel/)
  })

  it('ships the confirmation copy in both locales', () => {
    const bundle = read(pkg.exports['./client'])
    const keys = [
      'confirm.cancel',
      'confirm.cancelHint',
      'confirm.deleteTitle',
      'confirm.deleteBody',
      'confirm.deleteAction',
      'confirm.clearTitle',
      'confirm.clearBody',
      'confirm.clearAction',
    ]
    for (const locale of ['en', 'zh']) {
      const start = bundle.indexOf(`const ${locale} = {`)
      const dictionary = bundle.slice(start, bundle.indexOf('\n    }', start))
      assert.ok(dictionary.length > 0, `${locale} dictionary not found`)
      for (const key of keys) {
        assert.match(
          dictionary,
          new RegExp(`'${key.replace(/\./g, '\\.')}':`),
          `${locale} dictionary has no entry for "${key}"`,
        )
      }
    }
  })

  it('resolves every locale key the panel asks for', () => {
    const bundle = read(pkg.exports['./client'])
    const used = new Set()
    for (const match of bundle.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) used.add(match[1])

    // `t(\`filter.${value}\`)` and its siblings: the interpolated variable is
    // either the FILTERS array itself or a loop/state variable over it.
    const filters = [...bundle.matchAll(/const FILTERS = \[([^\]]+)\]/g)][0]?.[1]
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
    assert.deepEqual(filters, ['all', 'active', 'completed'])
    for (const match of bundle.matchAll(/\bt\(`([a-zA-Z][\w.]*)\.\$\{(\w+)\}`\)/g)) {
      const [, prefix, variable] = match
      const values = ['filter', 'value'].includes(variable)
        ? filters
        : [...bundle.matchAll(new RegExp(`const ${variable} = \\[([^\\]]+)\\]`, 'g'))]
          .flatMap((entry) => entry[1].split(','))
          .map((value) => value.trim().replace(/^'|'$/g, ''))
          .filter(Boolean)
      assert.ok(values.length > 0, `could not resolve the values of ${variable}`)
      for (const value of values) used.add(`${prefix}.${value}`)
    }
    assert.ok(used.size > 10, `expected the panel to use many locale keys, found ${used.size}`)

    for (const locale of ['en', 'zh']) {
      const source = read(`locale/${locale}.json`)
      const dictionary = bundle.slice(
        bundle.indexOf(`const ${locale} = {`),
        bundle.indexOf('\n    }', bundle.indexOf(`const ${locale} = {`)),
      )
      const keys = new Set([...dictionary.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]))
      assert.ok(keys.size > 10, `${locale} dictionary looks empty`)
      for (const key of used) {
        assert.ok(keys.has(key), `the ${locale} dictionary has no entry for "${key}"`)
      }
      assert.ok(source.includes('"meta"'), `locale/${locale}.json must keep the card metadata`)
    }
  })

  it('names only CSS classes the stylesheet defines', () => {
    const bundle = read(pkg.exports['./client'])
    const stylesheet = bundle.slice(bundle.indexOf('const css = `'), bundle.indexOf('const STYLE_ID'))
    const defined = new Set([...stylesheet.matchAll(/\.(dshTodo[A-Za-z0-9]+)/g)].map((match) => match[1]))
    assert.ok(defined.size > 20, 'the stylesheet looks empty')

    // Every class-shaped string literal anywhere in the bundle — a plain
    // `className`, or one branch of the ternaries that pick between two — must
    // exist in the stylesheet, so a typo cannot silently render unstyled.
    const used = new Set(
      [...bundle.matchAll(/'((?:dshTodo[A-Za-z0-9]+\s*)+)'/g)]
        .flatMap((match) => match[1].trim().split(/\s+/)),
    )
    assert.ok(used.size > 20, `expected the panel to use many classes, found ${used.size}`)
    for (const name of used) {
      assert.ok(defined.has(name), `class "${name}" is used but never defined in the stylesheet`)
    }
    // The stylesheet must not carry classes nothing renders.
    for (const name of defined) {
      assert.ok(used.has(name), `class "${name}" is defined but never used`)
    }
  })
})
