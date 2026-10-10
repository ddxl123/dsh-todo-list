/**
 * Durable todo storage for `dsh-todo-list`.
 *
 * This module is deliberately free of harness imports: it knows a file path, a
 * clock and an id factory, and nothing about Cordis, agents or the browser. The
 * Host plugin owns one instance, the `/api/dsh-todo-list` route and the `todo`
 * agent tool both call it through `ops.js`, and the unit tests drive it against
 * a temporary directory — so the storage contract is verified without a running
 * harness.
 *
 * ## What the file holds
 *
 * One JSON document: a `version`, a monotonic `revision`, the time of the last
 * write and the task array. Every mutation rewrites the whole document through
 * a temp file and a rename, so a crash mid-write can never truncate the list,
 * and a reader never observes a half-written file. A document that cannot be
 * parsed or fails the shape check is moved aside as `<name>.corrupt-<stamp>`
 * instead of being overwritten: the operator keeps the bytes that were there,
 * and the list starts empty rather than taking the process down.
 *
 * ## Why the timestamps are ISO strings
 *
 * The file is read by humans and by the model through the agent tool. ISO
 * instants sort lexicographically, survive a round trip through JSON exactly,
 * and need no timezone explanation at the call site.
 *
 * @module dsh-todo-list/src/store
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Document version written by this module. */
export const STORE_VERSION = 1
/**
 * Maximum length of a task, in characters. One field holds the whole task, so
 * the limit has to fit what people actually paste into a checklist item — a
 * paragraph of context, not a one-line reminder. It stays bounded because the
 * list itself is capped, and unbounded text would make the document grow
 * without limit.
 */
export const MAX_TEXT = 2000
/** Default maximum number of tasks one list holds. */
export const DEFAULT_MAX_TODOS = 5000

/**
 * A rejected todo operation. `code` is the machine-readable reason the route
 * and the tool report; `message` is the human sentence they show; `details`
 * names the field that failed and, for a length violation, the limit — so a
 * caller with a locale of its own can say it in the user's language instead of
 * echoing this English sentence.
 */
export class TodoError extends Error {
  /**
   * @param {string} code - machine-readable reason, e.g. `todo_not_found`.
   * @param {string} message - human-readable explanation.
   * @param {Record<string, unknown>} [details] - the field and limit involved.
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'TodoError'
    this.code = code
    this.details = details
  }
}

/**
 * One task as it is stored.
 *
 * @typedef {object} Todo
 * @property {string} id - stable identifier, `t_` plus 12 hex characters.
 * @property {string} text - the whole task, trimmed, 1..MAX_TEXT characters, may span lines.
 * @property {boolean} done - whether the task is complete.
 * @property {string} createdAt - ISO instant the task was added.
 * @property {string} updatedAt - ISO instant of the last change.
 * @property {string | null} completedAt - ISO instant it was completed, else null.
 */

/**
 * @param {unknown} value - a candidate task.
 * @param {string} field - field name used in the error message.
 * @param {number} max - maximum accepted length.
 * @returns {string} the trimmed value.
 */
function normalizeText(value, field, max) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new TodoError('todo_invalid', `${field} must be a string`, { field })
  // One line ending for every platform: a pasted Windows or classic-Mac newline
  // must not make two identical-looking tasks differ in bytes.
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (text.length > max) {
    throw new TodoError('todo_invalid', `${field} must be at most ${max} characters`, { field, limit: max, length: text.length })
  }
  return text
}

/**
 * The id of one new task: short enough to read in a tool result, random enough
 * that two tasks created in the same millisecond cannot collide.
 *
 * @returns {string} the identifier.
 */
function newId() {
  return `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

/**
 * The task text of one stored record.
 *
 * 0.1 stored a task as a `title` plus an optional `note`. 0.2 stores one
 * `text`. The split is joined rather than dropped — a list someone already
 * wrote must survive the upgrade, and the note was the detail of the same task,
 * so it becomes the second line.
 *
 * @param {Record<string, unknown>} record - the parsed record.
 * @returns {string | null} the task text, or null when the record holds none.
 */
function textOf(record) {
  if (typeof record.text === 'string') return record.text
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const note = typeof record.note === 'string' ? record.note.trim() : ''
  if (title === '') return note === '' ? null : note
  return note === '' ? title : `${title}\n${note}`
}

/**
 * Normalize one parsed record, or reject it.
 *
 * @param {unknown} value - a candidate from the document.
 * @returns {Todo | null} the stored shape, or null when the record is unusable.
 */
function normalizeRecord(value) {
  if (value === null || typeof value !== 'object') return null
  const record = /** @type {Record<string, unknown>} */ (value)
  if (typeof record.id !== 'string' || record.id === '') return null
  if (typeof record.done !== 'boolean') return null
  if (typeof record.createdAt !== 'string') return null
  const text = textOf(record)
  if (text === null) return null
  return {
    id: record.id,
    text,
    done: record.done,
    createdAt: record.createdAt,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : record.createdAt,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
  }
}

/**
 * One durable todo list.
 *
 * Every mutating method persists before it returns, so a returned task is
 * already on disk. Methods return the affected task; the caller reads the new
 * list with {@link TodoStore.snapshot}.
 */
export class TodoStore {
  /** @type {string} */
  #path
  /** @type {() => number} */
  #now
  /** @type {() => string} */
  #idFactory
  /** @type {number} */
  #maxTodos
  /** @type {Todo[]} */
  #todos = []
  /** @type {number} */
  #revision = 0
  /** @type {string | null} */
  #updatedAt = null
  /** @type {string[]} */
  #warnings = []

  /**
   * @param {object} options - store options.
   * @param {string} options.path - absolute path of the JSON document.
   * @param {() => number} [options.now] - clock, injectable for tests.
   * @param {() => string} [options.idFactory] - id source, injectable for tests.
   * @param {number} [options.maxTodos] - cap on the number of stored tasks.
   */
  constructor({ path, now = Date.now, idFactory = newId, maxTodos = DEFAULT_MAX_TODOS }) {
    if (typeof path !== 'string' || path === '') throw new TodoError('todo_invalid', 'a store path is required')
    this.#path = path
    this.#now = now
    this.#idFactory = idFactory
    this.#maxTodos = Number.isInteger(maxTodos) && maxTodos > 0 ? maxTodos : DEFAULT_MAX_TODOS
  }

  /** @returns {string} the absolute path of the JSON document. */
  get path() {
    return this.#path
  }

  /** @returns {string[]} diagnostics collected by {@link TodoStore.load}. */
  get warnings() {
    return [...this.#warnings]
  }

  /**
   * Read the document from disk. A missing file is an empty list, not an error.
   *
   * @returns {TodoStore} this store, for chaining.
   */
  load() {
    let raw
    try {
      raw = readFileSync(this.#path, 'utf8')
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== 'ENOENT') {
        this.#warnings.push(`could not read ${this.#path}: ${describe(error)}`)
      }
      return this
    }
    let document
    try {
      document = JSON.parse(raw)
    } catch {
      this.#quarantine('it is not valid JSON')
      return this
    }
    if (document === null || typeof document !== 'object' || !Array.isArray(document.todos)) {
      this.#quarantine('it has no todos array')
      return this
    }
    const todos = []
    for (const candidate of document.todos) {
      const todo = normalizeRecord(candidate)
      if (todo === null) continue
      todos.push(todo)
    }
    if (todos.length !== document.todos.length) {
      this.#warnings.push(`${document.todos.length - todos.length} malformed entr(ies) were dropped from ${this.#path}`)
    }
    this.#todos = todos.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    this.#revision = Number.isInteger(document.revision) && document.revision > 0 ? document.revision : 0
    this.#updatedAt = typeof document.updatedAt === 'string' ? document.updatedAt : null
    return this
  }

  /**
   * The whole list, newest first, as plain JSON values the caller may keep.
   *
   * @returns {{ revision: number, updatedAt: string | null, todos: Todo[] }} the snapshot.
   */
  snapshot() {
    return {
      revision: this.#revision,
      updatedAt: this.#updatedAt,
      todos: this.#todos.map((todo) => ({ ...todo })),
    }
  }

  /**
   * Add one task at the top of the list.
   *
   * @param {{ text?: unknown }} input - the new task.
   * @returns {Todo} the stored task.
   */
  add(input = {}) {
    const text = normalizeText(input.text, 'text', MAX_TEXT)
    if (text === '') throw new TodoError('todo_invalid', 'a task is required', { field: 'text' })
    if (this.#todos.length >= this.#maxTodos) {
      throw new TodoError('todo_limit', `the list is full (${this.#maxTodos} tasks); delete one first`, { limit: this.#maxTodos })
    }
    const now = this.#stamp()
    /** @type {Todo} */
    const todo = {
      id: this.#idFactory(),
      text,
      done: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    }
    this.#todos = [todo, ...this.#todos]
    this.#persist()
    return { ...todo }
  }

  /**
   * Change one task. Omitted fields keep their current value; `done` also
   * maintains `completedAt`, so completing a task records when it happened and
   * reopening it clears the stamp again.
   *
   * @param {{ id?: unknown, text?: unknown, done?: unknown }} input - the change.
   * @returns {Todo} the stored task.
   */
  update(input = {}) {
    const todo = this.#require(input.id)
    let touched = false
    if (input.text !== undefined) {
      const text = normalizeText(input.text, 'text', MAX_TEXT)
      if (text === '') throw new TodoError('todo_invalid', 'a task is required', { field: 'text' })
      if (text !== todo.text) {
        todo.text = text
        touched = true
      }
    }
    if (input.done !== undefined) {
      if (typeof input.done !== 'boolean') throw new TodoError('todo_invalid', 'done must be a boolean', { field: 'done' })
      if (input.done !== todo.done) {
        todo.done = input.done
        todo.completedAt = input.done ? this.#stamp() : null
        touched = true
      }
    }
    if (!touched) return { ...todo }
    todo.updatedAt = this.#stamp()
    this.#persist()
    return { ...todo }
  }

  /**
   * Delete one task.
   *
   * @param {{ id?: unknown }} input - the task to delete.
   * @returns {Todo} the task as it was before the deletion.
   */
  remove(input = {}) {
    const todo = this.#require(input.id)
    this.#todos = this.#todos.filter((candidate) => candidate.id !== todo.id)
    this.#persist()
    return { ...todo }
  }

  /**
   * Delete every completed task.
   *
   * @returns {{ removed: number, ids: string[] }} what was deleted.
   */
  clearCompleted() {
    const ids = this.#todos.filter((todo) => todo.done).map((todo) => todo.id)
    if (ids.length === 0) return { removed: 0, ids: [] }
    this.#todos = this.#todos.filter((todo) => !todo.done)
    this.#persist()
    return { removed: ids.length, ids }
  }

  /**
   * Find one stored task by id.
   *
   * @param {unknown} id - the identifier.
   * @returns {Todo | undefined} the live record, not a copy.
   */
  #find(id) {
    return typeof id === 'string' ? this.#todos.find((todo) => todo.id === id) : undefined
  }

  /**
   * Find one stored task or fail with the reason.
   *
   * @param {unknown} id - the identifier.
   * @returns {Todo} the live record.
   */
  #require(id) {
    if (typeof id !== 'string' || id === '') throw new TodoError('todo_invalid', 'an id is required', { field: 'id' })
    const todo = this.#find(id)
    if (todo === undefined) throw new TodoError('todo_not_found', `no todo with id ${id}`, { field: 'id', id })
    return todo
  }

  /** @returns {string} the current instant as an ISO string */
  #stamp() {
    return new Date(this.#now()).toISOString()
  }

  /**
   * Move an unusable document aside so the bytes survive and the list starts
   * empty. The suffix keeps every previous quarantine, so two corruptions in a
   * row do not delete the first one's evidence.
   *
   * @param {string} reason - why the document was rejected.
   * @returns {void}
   */
  #quarantine(reason) {
    const stamp = new Date(this.#now()).toISOString().replace(/[:.]/g, '-')
    const target = `${this.#path}.corrupt-${stamp}`
    try {
      renameSync(this.#path, target)
      this.#warnings.push(`${this.#path} was unreadable (${reason}) and was moved to ${target}`)
    } catch (error) {
      this.#warnings.push(`${this.#path} was unreadable (${reason}) and could not be moved aside: ${describe(error)}`)
    }
  }

  /**
   * Write the whole document through a temp file and a rename.
   *
   * @returns {void}
   */
  #persist() {
    this.#revision += 1
    this.#updatedAt = this.#stamp()
    const document = {
      version: STORE_VERSION,
      revision: this.#revision,
      updatedAt: this.#updatedAt,
      todos: this.#todos,
    }
    const temp = `${this.#path}.tmp`
    try {
      mkdirSync(dirname(this.#path), { recursive: true })
      writeFileSync(temp, `${JSON.stringify(document, undefined, 2)}\n`, 'utf8')
      renameSync(temp, this.#path)
    } catch (error) {
      // The in-memory change is kept: the next successful write persists it,
      // and the caller learns immediately that durability is not assured.
      try {
        rmSync(temp, { force: true })
      } catch {
        // The temp file is best-effort cleanup; the write error is the news.
      }
      throw new TodoError('todo_write_failed', `could not save the todo list to ${this.#path}: ${describe(error)}`, { path: this.#path })
    }
  }
}

/**
 * @param {unknown} error - a thrown value.
 * @returns {string} a one-line description.
 */
function describe(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Resolve the directory holding this plugin's durable state.
 *
 * `ctx.profileContext.home` is present in every profile `dsh` launches; the
 * environment fallback covers a composition booted without a profile and
 * resolves to the same place, so an upgraded deployment keeps reading the file
 * it already wrote.
 *
 * @param {any} ctx - the plugin context, when one is available.
 * @returns {string} `<harness home>/dsh-todo-list`
 */
export function stateDirectory(ctx) {
  const profileHome = ctx?.profileContext?.home
  if (typeof profileHome === 'string' && profileHome !== '') return join(profileHome, 'dsh-todo-list')
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : join(process.env.HOME ?? '.', '.dsh')
  return join(home, 'dsh-todo-list')
}
