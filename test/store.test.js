/**
 * Store contract tests.
 *
 * The store is the only place a todo is validated or written, so these tests
 * drive it directly against a temporary directory: no harness, no server, no
 * browser. Each test owns its file, so the order they run in cannot matter.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { MAX_TEXT, TodoError, TodoStore, stateDirectory } from '../src/store.js'

/** Every temporary directory this file creates, removed when the file is done. */
const roots = []

/**
 * Run a call that must throw and return what it threw.
 *
 * `assert.throws` returns nothing, and these tests assert on the error's own
 * fields rather than on its message.
 *
 * @param {() => unknown} fn - the call under test.
 * @returns {any} the thrown value.
 */
function capture(fn) {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw, but it returned')
}

/**
 * Create a store over a fresh file.
 *
 * @param {object} [options] - overrides for the store.
 * @returns {{ store: TodoStore, file: string, dir: string }} the fixture.
 */
function fixture(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-todo-list-'))
  roots.push(dir)
  const file = join(dir, 'todos.json')
  const store = new TodoStore({ path: file, ...options })
  return { store, file, dir }
}

/**
 * Read the document the store wrote.
 *
 * @param {string} file - the store's path.
 * @returns {any} the parsed document.
 */
function readDocument(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('TodoStore', () => {
  it('starts empty when no file exists', () => {
    const { store, file } = fixture()
    store.load()
    assert.deepEqual(store.snapshot().todos, [])
    assert.equal(store.snapshot().revision, 0)
    assert.equal(existsSync(file), false)
    assert.deepEqual(store.warnings, [])
  })

  it('adds a task, persists it, and reads it back from disk', () => {
    const { store, file } = fixture()
    const todo = store.load().add({ text: '  write the README  ' })

    assert.equal(todo.text, 'write the README')
    assert.equal(todo.done, false)
    assert.equal(todo.completedAt, null)
    assert.match(todo.id, /^t_[0-9a-f]{12}$/)
    assert.equal(todo.createdAt, todo.updatedAt)

    const document = readDocument(file)
    assert.equal(document.version, 1)
    assert.equal(document.revision, 1)
    assert.equal(document.todos.length, 1)
    assert.equal(document.todos[0].id, todo.id)

    const reopened = new TodoStore({ path: file }).load()
    assert.deepEqual(reopened.snapshot().todos, [todo])
    assert.equal(reopened.snapshot().revision, 1)
  })

  it('keeps the newest task first', () => {
    let clock = Date.parse('2026-01-01T00:00:00.000Z')
    const { store } = fixture({ now: () => (clock += 1000) })
    store.load()
    const first = store.add({ text: 'first' })
    const second = store.add({ text: 'second' })
    assert.deepEqual(store.snapshot().todos.map((todo) => todo.id), [second.id, first.id])
  })

  it('updates the task text and the completion state', () => {
    const { store, file } = fixture()
    store.load()
    const todo = store.add({ text: 'draft' })

    const renamed = store.update({ id: todo.id, text: 'final' })
    assert.equal(renamed.text, 'final')
    assert.equal(renamed.done, false)

    const completed = store.update({ id: todo.id, done: true })
    assert.equal(completed.done, true)
    assert.equal(typeof completed.completedAt, 'string')
    assert.ok(completed.completedAt >= completed.createdAt)

    const reopened = store.update({ id: todo.id, done: false })
    assert.equal(reopened.done, false)
    assert.equal(reopened.completedAt, null)

    // One write for the add, then one per accepted change.
    assert.equal(readDocument(file).revision, 4)
  })

  it('does not rewrite the document when an update changes nothing', () => {
    const { store, file } = fixture()
    store.load()
    const todo = store.add({ text: 'stable' })
    const before = readFileSync(file, 'utf8')

    const same = store.update({ id: todo.id, text: 'stable', done: false })
    assert.equal(same.updatedAt, todo.updatedAt)
    assert.equal(readFileSync(file, 'utf8'), before)
    assert.equal(store.snapshot().revision, 1)
  })

  it('removes one task and returns it', () => {
    const { store } = fixture()
    store.load()
    const kept = store.add({ text: 'keep' })
    const dropped = store.add({ text: 'drop' })

    const removed = store.remove({ id: dropped.id })
    assert.equal(removed.id, dropped.id)
    assert.equal(removed.text, 'drop')
    assert.deepEqual(store.snapshot().todos.map((todo) => todo.id), [kept.id])
  })

  it('clears completed tasks only', () => {
    const { store } = fixture()
    store.load()
    const open = store.add({ text: 'open' })
    const done = store.add({ text: 'done' })
    store.update({ id: done.id, done: true })

    assert.deepEqual(store.clearCompleted(), { removed: 1, ids: [done.id] })
    assert.deepEqual(store.snapshot().todos.map((todo) => todo.id), [open.id])
    assert.deepEqual(store.clearCompleted(), { removed: 0, ids: [] })
  })

  it('rejects an empty task and an unknown id with a code the caller can branch on', () => {
    const { store } = fixture()
    store.load()

    assert.throws(() => store.add({ text: '   ' }), (error) => {
      assert.ok(error instanceof TodoError)
      assert.equal(error.code, 'todo_invalid')
      return true
    })
    assert.throws(() => store.add({}), /task/)
    assert.throws(() => store.add({ text: 42 }), /text must be a string/)
    assert.throws(() => store.add({ text: 'x'.repeat(MAX_TEXT + 1) }), /at most/)

    const todo = store.add({ text: 'real' })
    assert.throws(() => store.update({ id: 't_missing' }), (error) => {
      assert.equal(error.code, 'todo_not_found')
      return true
    })
    assert.throws(() => store.remove({}), /an id is required/)
    assert.throws(() => store.update({ id: todo.id, done: 'yes' }), /done must be a boolean/)
  })

  it('names the offending field and limit, so a caller can localize the refusal', () => {
    const { store } = fixture()
    store.load()

    const long = capture(() => store.add({ text: 'x'.repeat(MAX_TEXT + 1) }))
    assert.equal(long.code, 'todo_invalid')
    assert.deepEqual(long.details, { field: 'text', limit: MAX_TEXT, length: MAX_TEXT + 1 })

    const empty = capture(() => store.add({ text: '  ' }))
    assert.deepEqual(empty.details, { field: 'text' })

    const missing = capture(() => store.update({ id: 't_missing', done: true }))
    assert.equal(missing.code, 'todo_not_found')
    assert.equal(missing.details.id, 't_missing')
  })

  it('refuses to grow past the configured cap', () => {
    const { store } = fixture({ maxTodos: 2 })
    store.load()
    store.add({ text: 'one' })
    store.add({ text: 'two' })
    assert.throws(() => store.add({ text: 'three' }), (error) => {
      assert.equal(error.code, 'todo_limit')
      return true
    })
  })

  it('moves an unreadable document aside instead of overwriting it', () => {
    const { store, file } = fixture()
    writeFileSync(file, '{ this is not json', 'utf8')

    store.load()
    assert.deepEqual(store.snapshot().todos, [])
    assert.equal(store.warnings.length, 1)
    assert.match(store.warnings[0], /moved to/)

    const moved = readdirSync(join(file, '..')).filter((name) => name.startsWith('todos.json.corrupt-'))
    assert.equal(moved.length, 1)
    assert.equal(readFileSync(join(file, '..', moved[0]), 'utf8'), '{ this is not json')

    // The list still works after the quarantine.
    store.add({ text: 'after the damage' })
    assert.equal(readDocument(file).todos.length, 1)
  })

  it('reads a 0.1 record — a title plus a note — as one task', () => {
    const { store, file } = fixture()
    writeFileSync(file, JSON.stringify({
      version: 1,
      revision: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
      todos: [
        { id: 't_legacy', title: 'buy milk', note: 'semi-skimmed', done: false, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 't_title_only', title: 'call the bank', done: true, createdAt: '2026-01-02T00:00:00.000Z', completedAt: '2026-01-02T01:00:00.000Z' },
        { id: 't_note_only', title: '   ', note: 'just the detail', done: false, createdAt: '2026-01-03T00:00:00.000Z' },
      ],
    }), 'utf8')

    store.load()
    assert.deepEqual(store.warnings, [])
    const byId = new Map(store.snapshot().todos.map((todo) => [todo.id, todo]))
    assert.equal(byId.get('t_legacy').text, 'buy milk\nsemi-skimmed')
    assert.equal(byId.get('t_title_only').text, 'call the bank')
    assert.equal(byId.get('t_note_only').text, 'just the detail')
    assert.equal(byId.get('t_title_only').done, true)

    // The next write persists the current shape, so the split is gone for good.
    store.update({ id: 't_legacy', done: true })
    const [migrated] = readDocument(file).todos.filter((todo) => todo.id === 't_legacy')
    assert.equal(migrated.text, 'buy milk\nsemi-skimmed')
    assert.equal(migrated.title, undefined)
    assert.equal(migrated.note, undefined)
  })

  it('drops malformed entries and keeps the readable ones', () => {
    const { store, file } = fixture()
    writeFileSync(file, JSON.stringify({
      version: 1,
      revision: 7,
      updatedAt: '2026-01-01T00:00:00.000Z',
      todos: [
        { id: 't_keep', text: 'keep', done: false, createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 5, text: 'no id', done: false, createdAt: '2026-01-01T00:00:00.000Z' },
        null,
      ],
    }), 'utf8')

    store.load()
    assert.deepEqual(store.snapshot().todos.map((todo) => todo.id), ['t_keep'])
    assert.equal(store.snapshot().revision, 7)
    assert.equal(store.warnings.length, 1)
    assert.match(store.warnings[0], /2 malformed/)

    // A readable-but-partial record keeps its defaults.
    const [todo] = store.snapshot().todos
    assert.equal(todo.updatedAt, todo.createdAt)
    assert.equal(todo.completedAt, null)
  })

  it('leaves no temporary file behind after a write', () => {
    const { store, dir } = fixture()
    store.load()
    store.add({ text: 'one' })
    store.update({ id: store.snapshot().todos[0].id, done: true })
    assert.deepEqual(readdirSync(dir), ['todos.json'])
  })

  it('keeps the change in memory when the write fails, and says so', () => {
    const { dir } = fixture()
    // A regular file where a directory must be makes every write fail.
    writeFileSync(join(dir, 'blocker'), '', 'utf8')
    const store = new TodoStore({ path: join(dir, 'blocker', 'todos.json') })
    store.load()

    assert.throws(() => store.add({ text: 'cannot persist' }), (error) => {
      assert.equal(error.code, 'todo_write_failed')
      return true
    })
    assert.equal(store.snapshot().todos.length, 1)
    assert.equal(store.snapshot().todos[0].text, 'cannot persist')
  })
})

describe('stateDirectory', () => {
  it('prefers the profile home', () => {
    assert.equal(
      stateDirectory({ profileContext: { home: '/tmp/harness-home' } }),
      join('/tmp/harness-home', 'dsh-todo-list'),
    )
  })

  it('falls back to DSH_HOME, then to ~/.dsh', () => {
    const previous = process.env.DSH_HOME
    try {
      process.env.DSH_HOME = '/tmp/from-env'
      assert.equal(stateDirectory(undefined), join('/tmp/from-env', 'dsh-todo-list'))
      assert.equal(stateDirectory({}), join('/tmp/from-env', 'dsh-todo-list'))
      process.env.DSH_HOME = ''
      assert.equal(stateDirectory(undefined), join(process.env.HOME ?? '.', '.dsh', 'dsh-todo-list'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
