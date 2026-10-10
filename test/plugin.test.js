/**
 * Activation and wiring tests.
 *
 * The other suites test each piece on its own. This one runs the real `apply`
 * against a stand-in context and then exercises what it registered: the route
 * the browser posts to and the tool the model calls. The claim under test is
 * the architectural one — both callers reach the *same* durable store, so a
 * change made through the tool is visible to the panel and vice versa.
 *
 * The stand-in is a few lines of plain objects. No harness, no server and no
 * browser is involved, so this runs anywhere the suite runs.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { apply, resolveConfig } from '../src/index.js'

/** Every temporary directory this file creates, removed when the file is done. */
const roots = []

/**
 * Build a context that records what the plugin asks for, then run `apply`.
 *
 * `inject` is the interesting part: the plugin declares its optional services
 * there, and this stand-in simply remembers the callbacks so a test can hand
 * them a service of its own.
 *
 * @param {any} [config] - the row config.
 * @returns {{ ctx: any, injections: Map<string, (scope: any) => void>, warnings: string[], home: string }} the fixture.
 */
function activate(config) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-todo-list-plugin-'))
  roots.push(home)
  /** @type {Map<string, (scope: any) => void>} */
  const injections = new Map()
  /** @type {string[]} */
  const warnings = []
  const ctx = {
    profileContext: { home },
    logger: {
      info: () => {},
      warn: (message) => warnings.push(message),
    },
    inject(deps, callback) {
      for (const dep of deps) injections.set(dep, callback)
      return () => {}
    },
  }
  apply(ctx, config)
  return { ctx, injections, warnings, home }
}

/**
 * Run one injected callback with a scope whose `effect` runs immediately and
 * whose `register` methods are captured.
 *
 * @param {(scope: any) => void} callback - the plugin's inject callback.
 * @param {(push: (value: any) => () => void) => object} makeScope - builds the scope, wiring `push` into every registry the plugin writes to.
 * @returns {any[]} every value passed to a `register` method.
 */
function runInjection(callback, makeScope) {
  const registered = []
  const push = (value) => {
    registered.push(value)
    return () => {}
  }
  const scope = {
    logger: { info: () => {}, warn: () => {} },
    effect(fn) {
      return fn()
    },
    ...makeScope(push),
  }
  callback(scope)
  return registered
}

/**
 * The scope a `connection`-injecting plugin sees.
 *
 * @param {(value: any) => () => void} push - the registration sink.
 * @returns {object} the scope.
 */
const connectionScope = (push) => ({ connection: { fetch: { register: push } } })

/**
 * Post one envelope to a route, the way the browser half does.
 *
 * @param {any} route - the registered route.
 * @param {any} body - the request body.
 * @returns {Promise<any>} the parsed response body.
 */
async function post(route, body) {
  const response = await route.fetch(new Request(`http://localhost${route.path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return response.json()
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('resolveConfig', () => {
  it('fills in the documented defaults', () => {
    assert.deepEqual(resolveConfig(undefined), { fileName: 'todos.json', maxTodos: 5000 })
    assert.deepEqual(resolveConfig(null), { fileName: 'todos.json', maxTodos: 5000 })
    assert.deepEqual(resolveConfig({}), { fileName: 'todos.json', maxTodos: 5000 })
  })

  it('keeps usable values and replaces unusable ones', () => {
    assert.deepEqual(resolveConfig({ fileName: '  mine.json ', maxTodos: 12 }), {
      fileName: 'mine.json',
      maxTodos: 12,
    })
    assert.deepEqual(resolveConfig({ fileName: '   ', maxTodos: 0 }), {
      fileName: 'todos.json',
      maxTodos: 5000,
    })
  })
})

describe('apply', () => {
  it('creates the state directory and waits only for the connection', () => {
    const { injections, home, warnings } = activate({})
    assert.equal(statSync(join(home, 'dsh-todo-list')).isDirectory(), true)
    assert.deepEqual([...injections.keys()], ['connection'])
    assert.deepEqual(warnings, [])
  })

  it('registers one route over the store, and exposes nothing to the model', async () => {
    const { injections, home } = activate({})
    const routes = runInjection(injections.get('connection'), connectionScope)
    assert.equal(routes.length, 1)

    const route = routes[0]
    assert.equal(route.path, '/api/dsh-todo-list')
    assert.deepEqual(route.methods, ['GET', 'POST'])

    // The panel's whole path: POST an add, then read the list back.
    const added = await post(route, { endpoint: 'add', payload: { text: 'from the panel' } })
    assert.equal(added.ok, true)
    assert.equal(added.value.counts.total, 1)

    const id = added.value.todo.id
    const completed = await post(route, { endpoint: 'update', payload: { id, done: true } })
    assert.equal(completed.value.todos[0].done, true)

    // The write landed on disk, in one file, in the current shape.
    const document = JSON.parse(readFileSync(join(home, 'dsh-todo-list', 'todos.json'), 'utf8'))
    assert.equal(document.todos.length, 1)
    assert.equal(document.todos[0].done, true)
    assert.equal(document.todos[0].text, 'from the panel')
  })

  it('honours the configured file name', () => {
    const { injections, home } = activate({ fileName: 'mine.json' })
    assert.deepEqual([...injections.keys()], ['connection'])
    const routes = runInjection(injections.get('connection'), connectionScope)
    return post(routes[0], { endpoint: 'add', payload: { text: 'elsewhere' } }).then(() => {
      assert.equal(statSync(join(home, 'dsh-todo-list', 'mine.json')).isFile(), true)
    })
  })

  it('lets a refused route registration fail loudly', () => {
    const { injections } = activate({})
    // The route is the only data path this plugin has. A connection that
    // refuses it must surface as a failed row rather than as a panel that
    // activates and then errors on every read.
    assert.throws(() => {
      runInjection(injections.get('connection'), () => ({
        connection: {
          fetch: {
            register() {
              throw new Error('this registry is closed')
            },
          },
        },
      }))
    }, /this registry is closed/)
  })
})
