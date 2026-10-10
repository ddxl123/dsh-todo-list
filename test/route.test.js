/**
 * Route contract tests.
 *
 * The route is a plain object with a Fetch-shaped handler, so it is driven here
 * with real `Request` values and no server: what these tests assert is exactly
 * what the browser half receives.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { API_PATH, createTodoRoute } from '../src/route.js'
import { TodoStore } from '../src/store.js'

/** Every temporary directory this file creates, removed when the file is done. */
const roots = []

/**
 * Build a route over a fresh, empty store.
 *
 * @returns {{ route: any, store: TodoStore }} the fixture.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-todo-list-route-'))
  roots.push(dir)
  const store = new TodoStore({ path: join(dir, 'todos.json') }).load()
  return { route: createTodoRoute({ store }), store }
}

/**
 * Post one envelope to the route.
 *
 * @param {any} route - the route under test.
 * @param {any} body - the request body, serialized as JSON.
 * @returns {Promise<any>} the parsed response body.
 */
async function post(route, body) {
  const response = await route.fetch(new Request(`http://localhost${API_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  assert.equal(response.status, 200)
  return response.json()
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('createTodoRoute', () => {
  it('declares the exact path, both methods and a buffered body', () => {
    const { route } = fixture()
    assert.equal(route.path, API_PATH)
    assert.equal(route.path, '/api/dsh-todo-list')
    assert.deepEqual(route.methods, ['GET', 'POST'])
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  })

  it('answers GET with the list view, so curl can read what was persisted', async () => {
    const { route, store } = fixture()
    store.add({ text: 'from the host' })

    const response = await route.fetch(new Request(`http://localhost${API_PATH}`))
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.value.counts.total, 1)
    assert.equal(body.value.todos[0].text, 'from the host')
  })

  it('round-trips add, update, remove and clearCompleted', async () => {
    const { route } = fixture()

    const added = await post(route, { endpoint: 'add', payload: { text: 'buy milk' } })
    assert.equal(added.ok, true)
    assert.equal(added.value.todo.text, 'buy milk')
    assert.deepEqual(added.value.counts, { total: 1, active: 1, done: 0 })

    const completed = await post(route, { endpoint: 'update', payload: { id: added.value.todo.id, done: true } })
    assert.equal(completed.value.todo.done, true)
    assert.deepEqual(completed.value.counts, { total: 1, active: 0, done: 1 })

    const listed = await post(route, { endpoint: 'list', payload: {} })
    assert.equal(listed.value.todos.length, 1)

    const cleared = await post(route, { endpoint: 'clearCompleted', payload: {} })
    assert.equal(cleared.value.removed, 1)
    assert.deepEqual(cleared.value.counts, { total: 0, active: 0, done: 0 })

    const readded = await post(route, { endpoint: 'add', payload: { text: 'again' } })
    const removed = await post(route, { endpoint: 'remove', payload: { id: readded.value.todo.id } })
    assert.equal(removed.value.removed.text, 'again')
    assert.equal(removed.value.counts.total, 0)
  })

  it('reports a rejected operation as a failed envelope, not a failed request', async () => {
    const { route } = fixture()
    const missing = await post(route, { endpoint: 'update', payload: { id: 't_nope', done: true } })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'todo_not_found')

    const invalid = await post(route, { endpoint: 'add', payload: { text: '   ' } })
    assert.equal(invalid.error.code, 'todo_invalid')

    const unknown = await post(route, { endpoint: 'nope', payload: {} })
    assert.equal(unknown.error.code, 'todo_unknown_endpoint')
  })

  it('carries the field and limit of a length refusal, so the panel can localize it', async () => {
    const { route } = fixture()
    const refused = await post(route, { endpoint: 'add', payload: { text: 'x'.repeat(2001) } })
    assert.equal(refused.ok, false)
    assert.equal(refused.error.code, 'todo_invalid')
    assert.deepEqual(refused.error.details, { field: 'text', limit: 2000, length: 2001 })

    // A refusal is not a change: nothing was written.
    const listed = await post(route, { endpoint: 'list', payload: {} })
    assert.equal(listed.value.counts.total, 0)
  })

  it('refuses a non-JSON content type', async () => {
    const { route } = fixture()
    const response = await route.fetch(new Request(`http://localhost${API_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'endpoint=list',
    }))
    assert.equal(response.status, 415)
  })

  it('refuses a body that is not JSON', async () => {
    const { route } = fixture()
    const response = await route.fetch(new Request(`http://localhost${API_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    }))
    assert.equal(response.status, 400)
  })

  it('refuses a body without an endpoint', async () => {
    const { route } = fixture()
    for (const body of ['{}', '[]', '"list"', '{"endpoint":7}']) {
      const response = await route.fetch(new Request(`http://localhost${API_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }))
      assert.equal(response.status, 400, `body ${body}`)
    }
  })

  it('refuses any other method', async () => {
    const { route } = fixture()
    const response = await route.fetch(new Request(`http://localhost${API_PATH}`, { method: 'DELETE' }))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET, POST')
  })
})
