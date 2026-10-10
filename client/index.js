/**
 * dsh-todo-list — browser half.
 *
 * ## What it registers
 *
 * Three contributions, all of them global (root-scoped), which is what "open
 * the list from anywhere" means in this shell:
 *
 *   - `sidebar.panellist` — the icon in the left rail. The sidebar renders one
 *     row per entry and calls `layout.selectPanel(entry.options.id)`, so the
 *     entry's `id` is the panel id and no click handler of ours is involved.
 *   - `main` (keyed by the same id) — the page itself, rendered whenever the
 *     active panel is this one.
 *   - a shortcut (`todo.open`) that toggles the panel from any session, so the
 *     list is reachable without aiming at the rail.
 *
 * ## Why it is a hand-written bundle
 *
 * Client halves are loaded by the web module loader (`window.__ModuleLoader__`)
 * as prebuilt CJS-table bundles rather than through Node resolution, so this
 * file registers one factory instead of exporting ESM. Everything — CSS
 * injection included — lives inside the factory closure, because executing the
 * bundle only *registers* it; the body runs when the module is first
 * materialized. `react` is a platform seed word the shell always installs, so
 * requiring it needs no build step and no dependency of our own. No other
 * Harness Client package is imported: a plain-JS plugin has no type check, and
 * a throwing component blanks its slot entry. The controls are written here and
 * styled from the host's theme tokens.
 *
 * ## Where the data lives
 *
 * Nowhere in this file. The panel is a view over the Host half's durable list:
 * every mutation posts to `/api/dsh-todo-list` on Connection's authenticated
 * `/api` channel (the browser's own cookie carries the session) and answers
 * with the whole authoritative list, so a second window converges after any
 * write and this half never invents state the Host does not have. Writes are
 * serialized through one promise chain, so two fast clicks cannot land out of
 * order.
 *
 * @module dsh-todo-list/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-todo-list',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** This package's name: the locale namespace and the slot ids' owner. */
    const NS = 'dsh-todo-list'
    /** The panel id, shared by the rail entry and the `main` slot key. */
    const PANEL_ID = 'todo'
    /** The exact Fetch route the Host half publishes for this panel. */
    const API_PATH = '/api/dsh-todo-list'
    /** The filter tabs, in render order. */
    const FILTERS = ['all', 'active', 'completed']
    /** The shortcut id this plugin registers. */
    const SHORTCUT_ID = 'todo.open'
    /**
     * The Host half's task limit, mirrored here so the panel can refuse an
     * over-long task *before* it is sent, instead of reporting a rejection
     * after the user has typed it. `test/manifest.test.js` asserts this matches
     * `MAX_TEXT` in `src/store.js`.
     */
    const MAX_TEXT = 2000
    /**
     * The failure code this half raises when the Host cannot be reached at all,
     * as opposed to answering and refusing the change. Only the first is an
     * error about the connection; the second carries a reason the user can act
     * on, and saying "cannot reach the Host" for it is simply wrong.
     */
    const UNREACHABLE = 'todo_unreachable'

    const zh = {
      'panel': '待办清单',
      'title': '待办清单',
      'counts': '{active} 项未完成 · 共 {total} 项',
      'composer.placeholder': '添加一项待办，Enter 保存，Shift+Enter 换行',
      'composer.add': '添加',
      'composer.tooLong': '一条待办最多 {limit} 字，当前 {length} 字',
      'filter.all': '全部',
      'filter.active': '未完成',
      'filter.completed': '已完成',
      'clearDone': '清除已完成',
      'empty.all': '还没有待办事项',
      'empty.active': '没有未完成的事项',
      'empty.completed': '还没有已完成的事项',
      'empty.hint': '在上方输入框添加第一项。',
      'loading': '正在载入待办清单…',
      'error.unreachable': '无法访问 Host 半端：{message}',
      'error.rejected': 'Host 拒绝了这个操作：{message}',
      'error.textTooLong': '一条待办最多 {limit} 字，当前 {length} 字。',
      'retry': '重试',
      'dismiss': '知道了',
      'row.complete': '标记为已完成',
      'row.reopen': '标记为未完成',
      'row.edit': '编辑内容',
      'row.delete': '删除',
      'row.editHint': '失焦或按 Ctrl+Enter 保存，Esc 取消',
      'row.added': '创建于 {time}',
      'shortcut.open': '打开待办清单',
    }
    const en = {
      'panel': 'Todo list',
      'title': 'Todo list',
      'counts': '{active} open · {total} total',
      'composer.placeholder': 'Add a task — Enter saves, Shift+Enter starts a new line',
      'composer.add': 'Add',
      'composer.tooLong': 'A task holds at most {limit} characters; this one has {length}.',
      'filter.all': 'All',
      'filter.active': 'Open',
      'filter.completed': 'Completed',
      'clearDone': 'Clear completed',
      'empty.all': 'No tasks yet',
      'empty.active': 'Nothing open',
      'empty.completed': 'Nothing completed yet',
      'empty.hint': 'Add your first task above.',
      'loading': 'Loading the todo list…',
      'error.unreachable': 'Cannot reach the Host half: {message}',
      'error.rejected': 'The Host refused this change: {message}',
      'error.textTooLong': 'A task holds at most {limit} characters; this one has {length}.',
      'retry': 'Retry',
      'dismiss': 'Dismiss',
      'row.complete': 'Mark as done',
      'row.reopen': 'Mark as open',
      'row.edit': 'Edit task',
      'row.delete': 'Delete',
      'row.editHint': 'Saves on blur or Ctrl+Enter; Esc cancels',
      'row.added': 'Added {time}',
      'shortcut.open': 'Open the todo list',
    }

    /**
     * The panel's stylesheet.
     *
     * Spacing, type sizes and row patterns follow the Host's own management
     * pages (the Schedule page is the closest sibling). Colors are theme tokens
     * only; a token the running theme does not define falls back to a token
     * this plugin's theme inspection did report, so a renamed token degrades
     * the shade rather than the rendering.
     */
    const css = `
.dshTodoPage{width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}
.dshTodoScroll{scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px;flex:1;min-height:0;overflow:auto}
.dshTodoContent{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.dshTodoHeading{align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:18px;padding-top:28px;display:flex}
[data-platform=darwin] .dshTodoHeading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.dshTodoHeading h1{flex:1;min-width:0;margin:0;font-size:20px;font-weight:500;line-height:28px}
.dshTodoCounts{flex:none;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}
.dshTodoComposer{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);border-radius:12px;align-items:center;gap:8px;padding:4px 4px 4px 10px;margin:0 0 16px;display:flex;transition:border-color .15s}
.dshTodoComposer:hover{border-color:var(--dsw-alias-border-l2)}
.dshTodoComposer:focus-within{border-color:var(--dsw-alias-brand-primary)}
.dshTodoInput{box-sizing:border-box;field-sizing:content;flex:1;min-width:0;max-height:132px;color:var(--dsw-alias-label-primary);background:0 0;border:0;outline:none;resize:none;overflow:auto;font:inherit;font-size:14px;line-height:22px;margin:7px 0;padding:0}
.dshTodoInput::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75}
.dshTodoButton{height:32px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:16px;cursor:pointer;flex:none;align-items:center;padding:0 14px;font:inherit;font-size:13px;line-height:20px;display:inline-flex}
.dshTodoButton:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dshTodoButton:disabled{color:var(--dsw-alias-label-secondary);cursor:default;opacity:.55}
.dshTodoButtonPrimary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-bg-base);font-weight:500}
.dshTodoButtonPrimary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);opacity:.88}
.dshTodoFilters{flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;margin-bottom:10px;display:flex}
.dshTodoFilterTabs{flex-wrap:wrap;align-items:center;gap:8px 4px;display:flex}
.dshTodoFilterTab{height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:14px;flex:none;align-items:center;padding:0 10px;font:inherit;font-size:14px;line-height:22px;display:inline-flex}
.dshTodoFilterTab:hover{background:var(--dsw-alias-bg-layer-1)}
.dshTodoFilterTabActive{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dshTodoClear{color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:14px;padding:4px 10px;font:inherit;font-size:13px;line-height:20px}
.dshTodoClear:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dshTodoClear:disabled{cursor:default;opacity:.5}
.dshTodoList{flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;display:flex}
.dshTodoRow{align-items:flex-start;gap:10px;border-radius:12px;padding:8px;display:flex}
.dshTodoRow:hover{background:var(--dsw-alias-bg-layer-1)}
.dshTodoCheck{accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px;flex:none;cursor:pointer;margin:4px 0 0}
.dshTodoBody{flex:1;min-width:0;flex-direction:column;display:flex}
.dshTodoTitle{color:var(--dsw-alias-label-primary);text-align:left;cursor:text;background:0 0;border:0;width:100%;overflow-wrap:anywhere;white-space:pre-wrap;margin:0;padding:0;font:inherit;font-size:14px;line-height:22px}
.dshTodoTitle:hover{color:var(--dsw-alias-brand-primary)}
.dshTodoDone .dshTodoTitle{color:var(--dsw-alias-label-secondary);text-decoration:line-through}
.dshTodoEdit{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);width:100%;color:var(--dsw-alias-label-primary);font:inherit;border-radius:8px;outline:none;resize:vertical;padding:3px 8px;font-size:14px;line-height:22px}
.dshTodoEdit:focus{border-color:var(--dsw-alias-brand-primary)}
.dshTodoHint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;margin:4px 0 0}
.dshTodoHintWarn{color:var(--dsw-alias-state-error-primary)}
.dshTodoComposerHint{font-size:13px;margin:0 0 12px}
.dshTodoRowActions{flex:none;align-items:center;gap:2px;display:flex}
.dshTodoIconButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:8px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}
.dshTodoIconButton:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dshTodoIconButtonDanger:hover{color:var(--dsw-alias-state-error-primary)}
.dshTodoEmpty{text-align:center;color:var(--dsw-alias-label-secondary);flex-direction:column;align-items:center;padding:44px 20px;display:flex}
.dshTodoEmptyTitle{color:var(--dsw-alias-label-secondary);margin:0 0 6px;font-size:14px;font-weight:400}
.dshTodoEmpty p{margin:0}
.dshTodoNotice{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:10px;flex-wrap:wrap;align-items:flex-start;gap:9px;margin:0 0 16px;padding:12px 14px;font-size:13px;line-height:20px;display:flex}
.dshTodoNotice p{flex:1;min-width:0;margin:0}
.dshTodoNoticeError{color:var(--dsw-alias-state-error-primary)}
.dshTodoPage :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshTodoTitle:focus-visible,.dshTodoEdit:focus-visible{outline:none}
.dshTodoEdit:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.dshTodoIcon{display:block}
`

    /** The `<style>` element id, so a second materialization cannot double-inject. */
    const STYLE_ID = `${NS}/panel.css`

    /**
     * Inject the stylesheet once. Called inside an effect, so unloading the
     * plugin removes what it added.
     *
     * @returns {() => void} the cleanup.
     */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = css
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /**
     * The panel's data layer: one authoritative snapshot, refreshed by the Host
     * after every write.
     *
     * It owns no state of its own beyond the last answer, so a stale panel is
     * impossible: each response replaces the list wholesale, and the two
     * boolean flags only say whether a request is in flight or has failed.
     *
     * @returns {object} the client.
     */
    function createTodoClient() {
      /** @type {Set<() => void>} */
      const listeners = new Set()
      let snapshot = {
        status: 'loading',
        todos: [],
        counts: { total: 0, active: 0, done: 0 },
        error: null,
      }
      /** Serializes writes so two fast clicks cannot land out of order. */
      let chain = Promise.resolve()

      function publish(next) {
        snapshot = { ...snapshot, ...next }
        for (const listener of [...listeners]) {
          try {
            listener()
          } catch (error) {
            console.warn(`[${NS}] a panel subscriber threw:`, error)
          }
        }
      }

      /**
       * A failure that means the Host could not be reached at all: no fetch, a
       * refused connection, a non-2xx status, or a body that is not the
       * envelope. Nothing about the list is known after one of these.
       *
       * @param {string} message - what went wrong on the wire.
       * @returns {Error} the classified failure.
       */
      function unreachable(message) {
        const error = new Error(message)
        error.code = UNREACHABLE
        error.details = {}
        return error
      }

      /**
       * A failure that means the Host answered and refused the change. The
       * reason is the user's to act on, so it is carried through verbatim
       * together with the field and limit the Host named.
       *
       * @param {any} reason - the envelope's `error` member.
       * @returns {Error} the classified failure.
       */
      function refused(reason) {
        const error = new Error(
          reason !== null && typeof reason === 'object' && typeof reason.message === 'string'
            ? reason.message
            : 'the Host refused the request',
        )
        error.code = reason !== null && typeof reason === 'object' && typeof reason.code === 'string' ? reason.code : 'todo_failed'
        error.details = reason !== null && typeof reason === 'object' && reason.details !== null && typeof reason.details === 'object'
          ? reason.details
          : {}
        return error
      }

      /**
       * Reduce a thrown value to the snapshot's error shape.
       *
       * @param {any} error - the thrown value.
       * @returns {{ code: string, message: string, details: object }} the failure.
       */
      function describeFailure(error) {
        return {
          code: typeof error?.code === 'string' ? error.code : UNREACHABLE,
          message: error instanceof Error ? error.message : String(error),
          details: error?.details !== null && typeof error?.details === 'object' ? error.details : {},
        }
      }

      /**
       * Post one endpoint to the Host half.
       *
       * @param {string} endpoint - the operation name.
       * @param {any} payload - its arguments.
       * @returns {Promise<any>} the operation value.
       */
      async function post(endpoint, payload) {
        const doFetch = globalThis.fetch
        if (typeof doFetch !== 'function') throw unreachable('this page cannot reach the host')
        let response
        try {
          response = await doFetch(API_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint, payload: payload ?? {} }),
            credentials: 'same-origin',
          })
        } catch (error) {
          throw unreachable(error instanceof Error ? error.message : String(error))
        }
        if (!response.ok) {
          throw unreachable(response.status === 404
            ? 'the Host half is not published on this page (HTTP 404)'
            : `HTTP ${response.status}`)
        }
        let result
        try {
          result = await response.json()
        } catch {
          throw unreachable('the Host answered with a body that is not JSON')
        }
        if (result === null || typeof result !== 'object' || result.ok !== true) {
          throw refused(result?.error)
        }
        return result.value
      }

      /**
       * Read the list. A failure keeps the last known tasks on screen and
       * reports why, instead of blanking the panel.
       *
       * @returns {Promise<void>} resolves when the snapshot is current.
       */
      async function refresh() {
        try {
          const value = await post('list')
          publish({ status: 'ready', todos: value.todos, counts: value.counts, error: null })
        } catch (error) {
          const failure = describeFailure(error)
          publish({
            error: failure,
            ...(failure.code === UNREACHABLE ? { status: 'error' } : {}),
          })
        }
      }

      /**
       * Run one write, then adopt the list it answers with.
       *
       * The returned promise says whether the Host accepted the change, so a
       * caller can keep what the user typed instead of throwing it away when
       * the answer was no.
       *
       * @param {string} endpoint - the operation name.
       * @param {any} payload - its arguments.
       * @returns {Promise<boolean>} whether the change was accepted.
       */
      function write(endpoint, payload) {
        const run = async () => {
          try {
            const value = await post(endpoint, payload)
            publish({ status: 'ready', todos: value.todos, counts: value.counts, error: null })
            return true
          } catch (error) {
            const failure = describeFailure(error)
            publish({
              error: failure,
              ...(failure.code === UNREACHABLE ? { status: 'error' } : {}),
            })
            return false
          }
        }
        chain = chain.then(run, run)
        return chain
      }

      return {
        /** @returns {object} the current snapshot. */
        getSnapshot: () => snapshot,
        /**
         * @param {() => void} listener - called after every change.
         * @returns {() => void} the unsubscribe.
         */
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        refresh,
        /** Drop the current failure notice without touching the list. */
        dismiss: () => publish({ error: null }),
        add: (text) => write('add', { text }),
        update: (id, patch) => write('update', { id, ...patch }),
        remove: (id) => write('remove', { id }),
        clearCompleted: () => write('clearCompleted'),
      }
    }

    /**
     * Subscribe a component to the client.
     *
     * @param {object} client - the panel's data layer.
     * @returns {object} the current snapshot.
     */
    function useTodoClient(client) {
      const [snapshot, setSnapshot] = React.useState(client.getSnapshot())
      React.useEffect(() => client.subscribe(() => setSnapshot(client.getSnapshot())), [client])
      return snapshot
    }

    /**
     * One task row.
     *
     * A task is one field, so the row is one line of text — rendered with its
     * line breaks intact — and editing it is explicit: the text is a button
     * that opens a textarea, so a stray click never changes anything. The
     * editor commits on blur or Ctrl/Cmd+Enter and abandons on Escape, which is
     * what every other list in the shell has taught the user to expect.
     *
     * @param {object} props - row props.
     * @returns {object} the row element.
     */
    function TodoRow({ todo, client, t }) {
      const [editing, setEditing] = React.useState(false)
      const [draft, setDraft] = React.useState(todo.text)
      const abandoned = React.useRef(false)
      /** Whether the draft exceeds the Host's limit, so the commit can refuse it here. */
      const tooLong = draft.trim().length > MAX_TEXT

      const begin = () => {
        abandoned.current = false
        setDraft(todo.text)
        setEditing(true)
      }
      const commit = () => {
        // An over-long task keeps the editor open with the reason on screen:
        // the Host would refuse it, and closing would throw the edit away.
        if (tooLong) return
        setEditing(false)
        if (abandoned.current) {
          abandoned.current = false
          return
        }
        const next = draft.trim()
        if (next !== '' && next !== todo.text) client.update(todo.id, { text: next })
      }
      const onKeyDown = (event) => {
        // Enter composes: the field may span lines, so a bare Enter is a
        // newline and Ctrl/Cmd+Enter is the save.
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          commit()
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          abandoned.current = true
          setEditing(false)
        }
      }

      const added = new Date(todo.createdAt)
      const addedLabel = Number.isNaN(added.getTime()) ? todo.createdAt : added.toLocaleString()

      const body = []
      if (editing) {
        body.push(h('textarea', {
          key: 'editor',
          className: 'dshTodoEdit',
          value: draft,
          rows: 2,
          autoFocus: true,
          'aria-label': t('row.edit'),
          'aria-invalid': tooLong,
          onChange: (event) => setDraft(event.target.value),
          onKeyDown,
          onBlur: commit,
        }))
        body.push(h('p', {
          key: 'hint',
          className: tooLong ? 'dshTodoHint dshTodoHintWarn' : 'dshTodoHint',
        }, tooLong
          ? t('error.textTooLong', { limit: MAX_TEXT, length: draft.trim().length })
          : t('row.editHint')))
      } else {
        body.push(h('button', {
          key: 'text',
          type: 'button',
          className: 'dshTodoTitle',
          title: t('row.added', { time: addedLabel }),
          onClick: begin,
        }, todo.text))
      }

      return h('li', { className: todo.done ? 'dshTodoRow dshTodoDone' : 'dshTodoRow' }, [
        h('input', {
          key: 'check',
          type: 'checkbox',
          className: 'dshTodoCheck',
          checked: todo.done,
          'aria-label': todo.done ? t('row.reopen') : t('row.complete'),
          onChange: (event) => client.update(todo.id, { done: event.target.checked }),
        }),
        h('div', { key: 'body', className: 'dshTodoBody' }, body),
        h('div', { key: 'actions', className: 'dshTodoRowActions' }, [
          h('button', {
            key: 'delete',
            type: 'button',
            className: 'dshTodoIconButton dshTodoIconButtonDanger',
            title: t('row.delete'),
            'aria-label': t('row.delete'),
            onClick: () => client.remove(todo.id),
          }, trashGlyph()),
        ]),
      ])
    }

    /**
     * The panel page. Rendered by the `main` slot while this panel is active.
     *
     * @param {object} props - slot props: the injected client plus the bound translator.
     * @returns {object} the page element.
     */
    function TodoPanel({ client, t }) {
      const snapshot = useTodoClient(client)
      const [draft, setDraft] = React.useState('')
      const [filter, setFilter] = React.useState('all')

      // The first paint has no list yet: ask once, and again whenever the Host
      // half reappears after a failure.
      React.useEffect(() => {
        if (client.getSnapshot().status === 'loading') client.refresh()
      }, [client])

      const text = draft.trim()
      /** Whether the composer's text is beyond what the Host will accept. */
      const tooLong = text.length > MAX_TEXT

      const submit = () => {
        if (text === '' || tooLong) return
        // The text stays until the Host accepts it: a rejected add used to take
        // the user's typing with it, which is worse than a stale composer.
        client.add(text).then((accepted) => {
          if (accepted) setDraft((current) => (current.trim() === text ? '' : current))
        })
      }

      const todos = filter === 'active'
        ? snapshot.todos.filter((todo) => !todo.done)
        : filter === 'completed'
          ? snapshot.todos.filter((todo) => todo.done)
          : snapshot.todos

      const children = [
        h('header', { key: 'heading', className: 'dshTodoHeading' }, [
          h('h1', { key: 'title' }, t('title')),
          h('span', {
            key: 'counts',
            className: 'dshTodoCounts',
            'aria-live': 'polite',
          }, t('counts', { active: snapshot.counts.active, total: snapshot.counts.total })),
        ]),
        h('form', {
          key: 'composer',
          className: 'dshTodoComposer',
          onSubmit: (event) => {
            event.preventDefault()
            submit()
          },
        }, [
          h('textarea', {
            key: 'input',
            className: 'dshTodoInput',
            value: draft,
            rows: 1,
            placeholder: t('composer.placeholder'),
            'aria-label': t('composer.placeholder'),
            'aria-invalid': tooLong,
            onChange: (event) => setDraft(event.target.value),
            onKeyDown: (event) => {
              // A textarea does not submit its form on Enter, so the composer
              // asks for it explicitly: Enter saves, Shift+Enter breaks the line.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
            },
          }),
          h('button', {
            key: 'add',
            type: 'submit',
            className: 'dshTodoButton dshTodoButtonPrimary',
            disabled: text === '' || tooLong,
          }, t('composer.add')),
        ]),
      ]

      // Refusing the text here, with the count and the way out, is the whole
      // point: the alternative is the Host's refusal after the fact.
      if (tooLong) {
        children.push(h('p', {
          key: 'too-long',
          className: 'dshTodoHint dshTodoHintWarn dshTodoComposerHint',
          role: 'alert',
        }, t('composer.tooLong', { limit: MAX_TEXT, length: text.length })))
      }

      if (snapshot.error !== null) {
        const { code, message, details } = snapshot.error
        const overLimit = typeof details.limit === 'number' && typeof details.length === 'number'
        const localized = overLimit && details.field === 'text'
          ? t('error.textTooLong', { limit: details.limit, length: details.length })
          : null
        const unreachable = code === UNREACHABLE
        children.push(h('div', {
          key: 'error',
          className: unreachable ? 'dshTodoNotice dshTodoNoticeError' : 'dshTodoNotice',
          role: 'alert',
        }, [
          h('p', { key: 'text' }, unreachable
            ? t('error.unreachable', { message })
            : localized ?? t('error.rejected', { message })),
          h('button', {
            key: 'action',
            type: 'button',
            className: 'dshTodoButton',
            onClick: () => (unreachable ? client.refresh() : client.dismiss()),
          }, unreachable ? t('retry') : t('dismiss')),
        ]))
      }

      children.push(h('div', { key: 'filters', className: 'dshTodoFilters' }, [
        h('div', { key: 'tabs', className: 'dshTodoFilterTabs' }, FILTERS.map((value) => h('button', {
          key: value,
          type: 'button',
          'aria-pressed': filter === value,
          className: filter === value ? 'dshTodoFilterTab dshTodoFilterTabActive' : 'dshTodoFilterTab',
          onClick: () => setFilter(value),
        }, t(`filter.${value}`)))),
        h('button', {
          key: 'clear',
          type: 'button',
          className: 'dshTodoClear',
          disabled: snapshot.counts.done === 0,
          onClick: () => client.clearCompleted(),
        }, t('clearDone')),
      ]))

      if (snapshot.status === 'loading') {
        children.push(h('div', { key: 'loading', className: 'dshTodoEmpty' }, h('p', undefined, t('loading'))))
      } else if (todos.length === 0) {
        children.push(h('div', { key: 'empty', className: 'dshTodoEmpty' }, [
          h('p', { key: 'title', className: 'dshTodoEmptyTitle' }, t(`empty.${filter}`)),
          h('p', { key: 'hint' }, t('empty.hint')),
        ]))
      } else {
        children.push(h('ul', { key: 'list', className: 'dshTodoList' }, todos.map((todo) => h(TodoRow, {
          key: todo.id,
          todo,
          client,
          t,
        }))))
      }

      return h('section', { className: 'dshTodoPage', 'aria-label': t('title'), 'data-testid': 'todo-page' }, [
        h('div', { key: 'scroll', className: 'dshTodoScroll' }, [
          h('div', { key: 'content', className: 'dshTodoContent' }, children),
        ]),
      ])
    }

    /**
     * The rail glyph. The sidebar sizes it and colors it through the row's own
     * state, so this draws in `currentColor` only.
     *
     * @param {object} props - slot props, including `size` and `active`.
     * @returns {object} the icon element.
     */
    function TodoIcon({ size }) {
      const edge = typeof size === 'number' ? size : 18
      return h('svg', {
        className: 'dshTodoIcon',
        width: edge,
        height: edge,
        viewBox: '0 0 20 20',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
      }, [
        h('path', { key: 'check', d: 'M3.5 6.2 L5.6 8.3 L9.2 4.4' }),
        h('path', { key: 'line-1', d: 'M11.8 6.4 H16.6' }),
        h('path', { key: 'check-2', d: 'M3.5 13.2 L5.6 15.3 L9.2 11.4' }),
        h('path', { key: 'line-2', d: 'M11.8 13.4 H16.6' }),
      ])
    }

    /** @returns {object} a trash glyph for the row's delete action. */
    function trashGlyph() {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 20 20', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        'aria-hidden': true, focusable: false,
      }, [
        h('path', { key: 'lid', d: 'M4 6 H16' }),
        h('path', { key: 'body', d: 'M6.5 6 V15.5 H13.5 V6' }),
        h('path', { key: 'handle', d: 'M8.2 6 V4.2 H11.8 V6' }),
      ])
    }

    /**
     * The shortcut's default binding.
     *
     * `primary+alt+KeyD` is free on every combination the shell can run: the
     * shipped commands already claim B, O, P, T, Slash and Comma, and the
     * registry refuses a conflicting default rather than silently stealing a
     * key. `web:linux` is deliberately absent — a browser on Linux accepts only
     * three bindings (`primary+Slash`, `primary+shift+Comma`,
     * `primary+shift+Period`), and declaring a rejected one would make the
     * whole registration throw and leave the command with no default at all.
     * There the user binds it from the shortcuts page instead.
     *
     * @returns {object} the `defaults` map.
     */
    function shortcutDefaults() {
      /** @type {Record<string, object>} */
      const defaults = {}
      for (const runtime of ['desktop', 'web']) {
        for (const platform of ['macos', 'windows', 'linux']) {
          if (runtime === 'web' && platform === 'linux') continue
          defaults[`${runtime}:${platform}`] = { code: 'KeyD', modifiers: ['primary', 'alt'] }
        }
      }
      return defaults
    }

    return {
      inject: ['slots', 'locale'],
      /**
       * Register the panel, its rail entry and its shortcut.
       *
       * @param {any} ctx - the Client root context.
       * @returns {void}
       */
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`)
        ctx.effect(() => installStyles(), `${NS}: styles`)
        const t = ctx.locale.bind(NS)
        const client = createTodoClient()

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ client }),
        }, TodoPanel))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 12,
          locale: NS,
          label: () => t('panel'),
        }, TodoIcon))

        // Global open: the rail entry is the mouse path, this is the keyboard
        // one. `shortcuts` and `layout` are optional services, so a shell
        // without them keeps the panel and only loses the key.
        ctx.inject(['shortcuts', 'layout'], (scope) => {
          try {
            scope.effect(() => scope.shortcuts.register({
              id: SHORTCUT_ID,
              label: () => t('shortcut.open'),
              aliases: ['todo', 'todos', 'todo list', 'tasks', 'checklist'],
              defaults: shortcutDefaults(),
              regions: ['page', 'editable'],
              modals: [],
              resolve: () => ({
                status: 'handled',
                run: () => {
                  const active = scope.layout?.panelInfo?.getSnapshot?.()?.activePanelId
                  scope.layout.selectPanel(active === PANEL_ID ? null : PANEL_ID)
                },
              }),
            }), `${NS}: shortcut`)
          } catch (error) {
            console.warn(`[${NS}] could not register the shortcut:`, error)
          }
        })
      },
    }
  },
})
