/**
 * The todo operations.
 *
 * The browser panel reaches the list through `/api/dsh-todo-list`, which hands
 * each request to {@link runOperation}; nothing else does. Keeping the verbs
 * here rather than in the route means the HTTP layer only decides *how* a
 * request arrives, never what an operation means — so the route stays thin
 * enough to read in one sitting and the operations are tested without a
 * `Request`.
 *
 * The result shape is uniform on purpose. Every successful operation answers
 * with the whole authoritative list plus what it changed, so the panel never
 * has to merge a delta into a stale snapshot, and a second window converges on
 * the same state after any write.
 *
 * @module dsh-todo-list/src/ops
 */

import { TodoError } from './store.js'

/** Every endpoint this plugin answers, in the order the panel uses them. */
export const TODO_ENDPOINTS = Object.freeze(['list', 'add', 'update', 'remove', 'clearCompleted'])

/**
 * Count the list by state.
 *
 * @param {import('./store.js').Todo[]} todos - the current tasks.
 * @returns {{ total: number, active: number, done: number }} the counts.
 */
function countsOf(todos) {
  let done = 0
  for (const todo of todos) if (todo.done) done += 1
  return { total: todos.length, active: todos.length - done, done }
}

/**
 * The authoritative list view every operation answers with.
 *
 * @param {import('./store.js').TodoStore} store - the store to read.
 * @returns {{ todos: import('./store.js').Todo[], revision: number, updatedAt: string | null, counts: { total: number, active: number, done: number } }} the view.
 */
export function listView(store) {
  const snapshot = store.snapshot()
  return {
    todos: snapshot.todos,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    counts: countsOf(snapshot.todos),
  }
}

/**
 * Run one operation against the store.
 *
 * @param {import('./store.js').TodoStore} store - the durable list.
 * @param {string} endpoint - one of {@link TODO_ENDPOINTS}.
 * @param {any} payload - the operation's arguments.
 * @returns {{ ok: true, value: any } | { ok: false, error: { code: string, message: string, details: Record<string, unknown> } }} the envelope.
 */
export function runOperation(store, endpoint, payload) {
  const input = payload !== null && typeof payload === 'object' ? payload : {}
  try {
    switch (endpoint) {
      case 'list':
        return ok(listView(store))
      case 'add':
        return ok({ todo: store.add(input), ...listView(store) })
      case 'update':
        return ok({ todo: store.update(input), ...listView(store) })
      case 'remove':
        return ok({ removed: store.remove(input), ...listView(store) })
      case 'clearCompleted':
        return ok({ ...store.clearCompleted(), ...listView(store) })
      default:
        return fail('todo_unknown_endpoint', `unknown endpoint "${String(endpoint)}"`, { endpoint: String(endpoint) })
    }
  } catch (error) {
    if (error instanceof TodoError) return fail(error.code, error.message, error.details)
    return fail('todo_failed', error instanceof Error ? error.message : String(error))
  }
}

/**
 * @param {any} value - a business result.
 * @returns {{ ok: true, value: any }} the success envelope.
 */
function ok(value) {
  return { ok: true, value }
}

/**
 * @param {string} code - machine-readable reason.
 * @param {string} message - human-readable explanation.
 * @param {Record<string, unknown>} [details] - the field and limit involved.
 * @returns {{ ok: false, error: { code: string, message: string, details: Record<string, unknown> } }} the failure envelope.
 */
function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}
