/**
 * dsh-todo-list — Host half.
 *
 * One durable todo list. The browser panel posts to `/api/dsh-todo-list` on
 * Connection's authenticated channel; every request lands in the single
 * {@link TodoStore} instance this row owns, which is why the row is host-plane
 * rather than preset-plane — every browser window shares one list instead of
 * keeping its own copy of the file.
 *
 * ## What this half does not do
 *
 * It renders nothing, and it exposes nothing to the model. The panel is the
 * Client half (`client/index.js`), loaded by the web module loader from this
 * package's `./client` export. This is a page feature: the list belongs to the
 * person using the panel, so no agent tool, prompt section or context is
 * registered on its behalf.
 *
 * ## Why this module imports no shipped package
 *
 * A profile plugin that imports `@deepseek-ai/*` depends on the launcher
 * routing that name to the running installation. When that routing is
 * unavailable — a profile whose dependency layer predates the current
 * installation, for example — the row does not partially work: the import
 * fails, activation fails, and the plugin the user installed never appears.
 * Importing nothing but Node builtins and its own files makes activation
 * unconditional. The row's `config` is therefore validated here rather than by
 * a `Config` schema.
 *
 * ## Failure posture
 *
 * The recoverable failures degrade instead of throwing: a state directory that
 * cannot be created, an unreadable file and a missing service each produce a
 * warning plus a list that still works in memory, because a todo plugin that
 * takes the harness down with it is worse than one that loses a write.
 *
 * The one thing that fails loudly is the route registration itself. The route
 * is the plugin's only data path, so a connection that refuses it must report
 * as a failed row — activating a panel that then errors on every read would
 * hide the fault behind a UI that looks fine.
 *
 * @module dsh-todo-list/src/index
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { createTodoRoute, API_PATH } from './route.js'
import { DEFAULT_MAX_TODOS, TodoStore, stateDirectory } from './store.js'

/** Stable Cordis plugin name; also the row id the bundle patch inserts. */
export const name = 'dsh-todo-list'

/**
 * The composition entry's accepted keys and their defaults.
 *
 * A row that omits a key keeps the default; a row that sets an unusable value
 * (an empty file name, a zero cap, a non-boolean switch) falls back instead of
 * degrading later, at the first write. The keys and defaults are the ones
 * `cordis.patch.yml` and the README document.
 */
export const CONFIG_DEFAULTS = Object.freeze({
  /** Name of the JSON document inside this plugin's state directory. */
  fileName: 'todos.json',
  /** Maximum number of tasks one list holds, open and completed together. */
  maxTodos: DEFAULT_MAX_TODOS,
})

/**
 * Fill in the defaults when `apply` is called without a validated config, which
 * happens in unit tests and in a composition that boots the module directly.
 *
 * @param {unknown} rawConfig - the row's config, possibly absent.
 * @returns {{ fileName: string, maxTodos: number }} the effective config.
 */
export function resolveConfig(rawConfig) {
  const config = rawConfig !== null && typeof rawConfig === 'object' ? /** @type {Record<string, unknown>} */ (rawConfig) : {}
  const fileName = typeof config.fileName === 'string' && config.fileName.trim() !== '' ? config.fileName.trim() : CONFIG_DEFAULTS.fileName
  const maxTodos = Number.isInteger(config.maxTodos) && /** @type {number} */ (config.maxTodos) > 0
    ? /** @type {number} */ (config.maxTodos)
    : CONFIG_DEFAULTS.maxTodos
  return { fileName, maxTodos }
}

/**
 * Register the plugin.
 *
 * @param {any} ctx - the loader-provided plugin context.
 * @param {unknown} rawConfig - the validated composition entry.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      // A logger that refuses the line must not take the plugin down with it.
      console.warn(`[dsh-todo-list] ${message}`)
    }
  }

  const directory = stateDirectory(ctx)
  try {
    mkdirSync(directory, { recursive: true })
  } catch (error) {
    warn(`could not create the state directory ${directory}: ${describe(error)}`)
  }

  const store = new TodoStore({ path: join(directory, config.fileName), maxTodos: config.maxTodos }).load()
  for (const warning of store.warnings) warn(warning)
  ctx.logger?.info?.(`todo list stored at ${store.path}`)

  // The browser half posts here. `connection.fetch` rather than
  // `connection.rpc.handle`, for the reason spelled out in src/route.js.
  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(
      () => connectionCtx.connection.fetch.register(createTodoRoute({ store })),
      'dsh-todo-list: api route',
    )
    connectionCtx.logger?.info?.(`todo endpoint published on ${API_PATH}`)
  })
}

/**
 * @param {unknown} error - a thrown value.
 * @returns {string} a one-line description.
 */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

export default { name, CONFIG_DEFAULTS, apply }
