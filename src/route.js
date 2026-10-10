/**
 * The exact Fetch route the browser panel posts to.
 *
 * ## Why an exact Fetch route and not a Connection RPC channel
 *
 * `ctx.connection.rpc.handle()` mounts each channel through
 * `owner.webServer.register(...)`, where `owner` is the Context that read the
 * service. Cordis hands a service method a shadowed Context whose service
 * resolution walks the *provider's* fiber chain, where `webServer` is not
 * visible, so a consumer plugin's call throws
 * `cannot get property "webServer" without inject` and the channel is never
 * mounted. `ctx.connection.fetch.register()` has no such dependency: it adds an
 * exact route to the `/api` channel Connection has already mounted, and the
 * browser reaches it with an ordinary same-origin authenticated `fetch`.
 *
 * The handler is harness-free — it receives the store and returns the
 * `{ ok, value }` / `{ ok, error }` envelope the panel unwraps — so the route
 * is unit-tested against a `Request` with no server running.
 *
 * `GET` answers the same list view as the `list` endpoint. It exists for
 * operators: `curl` against the route is the quickest way to see what the
 * plugin actually persisted.
 *
 * @module dsh-todo-list/src/route
 */

import { runOperation } from './ops.js'

/** The exact path this plugin owns below the `/api` channel. */
export const API_PATH = '/api/dsh-todo-list'

/**
 * Build the route object `ctx.connection.fetch.register` accepts.
 *
 * @param {object} deps - route dependencies.
 * @param {import('./store.js').TodoStore} deps.store - the durable list.
 * @returns {{ path: string, methods: string[], requestBody: 'buffered', fetch: (request: Request) => Promise<Response> }} the route.
 */
export function createTodoRoute({ store }) {
  return {
    path: API_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'GET') return Response.json(runOperation(store, 'list'))
      if (request.method !== 'POST') {
        return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
      }
      const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }
      let body
      try {
        body = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      if (body === null || typeof body !== 'object' || typeof body.endpoint !== 'string') {
        return new Response('body must carry a string "endpoint"', { status: 400 })
      }
      return Response.json(runOperation(store, body.endpoint, body.payload))
    },
  }
}
