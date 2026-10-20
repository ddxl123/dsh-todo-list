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
 * ## Destructive actions ask twice
 *
 * Deleting a task and clearing every completed task both go through
 * {@link ConfirmDialog}: the row button (and the toolbar button) only *asks*,
 * and the Host is called from the dialog's confirm button. The dialog takes
 * focus, traps Tab, cancels on Escape or a backdrop click, restores focus to
 * the control that opened it, and labels itself for assistive technology — so
 * the second confirmation is a real gate, not a flash message.
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
      'progress.percent': '{percent}%',
      'progress.aria': '完成进度 {percent}%',
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
      'emptyHint.all': '在上方输入框添加第一项。',
      'emptyHint.active': '所有事项都完成了，休息一下。',
      'emptyHint.completed': '勾选一项待办后，它会出现在这里。',
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
      'confirm.cancel': '取消',
      'confirm.cancelHint': '按 Esc 取消',
      'confirm.deleteTitle': '删除这条待办？',
      'confirm.deleteBody': '“{text}”将被永久删除，此操作无法撤销。',
      'confirm.deleteAction': '删除',
      'confirm.clearTitle': '清除所有已完成的待办？',
      'confirm.clearBody': '{count} 项已完成的待办将被永久删除，此操作无法撤销。',
      'confirm.clearAction': '清除',
      'shortcut.open': '打开待办清单',
    }
    const en = {
      'panel': 'Todo list',
      'title': 'Todo list',
      'counts': '{active} open · {total} total',
      'progress.percent': '{percent}%',
      'progress.aria': '{percent}% complete',
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
      'emptyHint.all': 'Add your first task above.',
      'emptyHint.active': 'Everything is done. Take a break.',
      'emptyHint.completed': 'Check a task off and it will show up here.',
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
      'confirm.cancel': 'Cancel',
      'confirm.cancelHint': 'Press Esc to cancel',
      'confirm.deleteTitle': 'Delete this task?',
      'confirm.deleteBody': '“{text}” will be permanently deleted. This cannot be undone.',
      'confirm.deleteAction': 'Delete',
      'confirm.clearTitle': 'Clear all completed tasks?',
      'confirm.clearBody': 'This permanently deletes {count} completed task(s) and cannot be undone.',
      'confirm.clearAction': 'Clear',
      'shortcut.open': 'Open the todo list',
    }

    /**
     * The panel's stylesheet.
     *
     * Follows the shell's own design language rather than inventing one:
     * the Schedule page's page/scroll/content geometry, pill filter tabs,
     * flat hover-tinted rows, the shared input/button/notice patterns, and the
     * shell modal's mask + elevated panel for the delete confirmation. Colors
     * come only from `--dsw-*` theme tokens (including the pre-mixed
     * interactive/state/mask tints), so light and dark themes both follow the
     * shell. Motion is 150–200 ms and disabled under `prefers-reduced-motion`.
     */
    const css = `
.dshTodoPage{width:100%;min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6;display:flex;overflow:hidden}
.dshTodoScroll{scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px;flex:1;min-height:0;overflow:auto}
.dshTodoContent{width:100%;max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}
.dshTodoHeading{display:flex;align-items:center;gap:14px;margin:0 0 18px;padding-top:28px}
[data-platform=darwin] .dshTodoHeading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.dshTodoHeadingMain{display:flex;align-items:center;gap:14px;flex:1;min-width:0}
.dshTodoBrandMark{width:42px;height:42px;flex:none;display:grid;place-items:center;color:var(--dsw-alias-state-business-primary);border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.dshTodoHeadingText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshTodoHeading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.dshTodoCounts{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}
.dshTodoProgress{display:flex;align-items:center;gap:10px;margin:0 0 18px}
.dshTodoProgressTrack{flex:1;min-width:0;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dshTodoProgressFill{height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary);transition:width .2s ease-in-out}
.dshTodoProgressValue{flex:none;min-width:32px;text-align:right;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dshTodoComposer{display:flex;align-items:flex-end;gap:8px;margin:0 0 4px;padding:4px 4px 4px 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-base);transition:border-color .15s}
.dshTodoComposer:hover{border-color:var(--dsw-alias-border-l2)}
.dshTodoComposer:focus-within{border-color:var(--dsw-alias-state-business-primary)}
.dshTodoInput{box-sizing:border-box;field-sizing:content;flex:1;min-width:0;max-height:132px;margin:7px 0;padding:0;color:var(--dsw-alias-label-primary);background:0 0;border:0;outline:none;resize:none;overflow:auto;font:inherit;font-size:14px;line-height:22px}
.dshTodoInput::placeholder{color:var(--dsw-alias-label-caption)}
.dshTodoButton{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;flex:none;padding:0 14px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer;transition:background .15s,border-color .15s,color .15s,opacity .15s}
.dshTodoButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dshTodoButton:disabled{cursor:not-allowed;opacity:.4}
.dshTodoButtonCompact{height:32px;padding:0 12px;border-radius:16px;font-size:13px;line-height:20px}
.dshTodoButtonPrimary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:500}
.dshTodoButtonPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshTodoButtonOutline{border:.5px solid var(--dsw-alias-border-l3)}
.dshTodoButtonDanger{color:var(--dsw-alias-state-error-primary);font-weight:500}
.dshTodoButtonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.dshTodoHint{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dshTodoHintWarn{color:var(--dsw-alias-state-error-primary)}
.dshTodoComposerHint{margin:8px 0 0}
.dshTodoFilters{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;margin:18px 0 12px;flex-wrap:wrap}
.dshTodoFilterTabs{display:flex;align-items:center;gap:2px;flex-wrap:wrap;min-width:0}
.dshTodoFilterTab{display:inline-flex;align-items:center;gap:5px;height:28px;flex:none;padding:0 10px;border:0;border-radius:14px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:22px;cursor:pointer;transition:background .15s,color .15s}
.dshTodoFilterTab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshTodoFilterTabActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshTodoFilterCount{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dshTodoFilterTabActive .dshTodoFilterCount{color:var(--dsw-alias-label-secondary)}
.dshTodoClear{display:inline-flex;align-items:center;height:28px;flex:none;padding:0 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .15s,color .15s}
.dshTodoClear:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.dshTodoClear:disabled{cursor:not-allowed;opacity:.4}
.dshTodoList{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.dshTodoRow{display:flex;align-items:flex-start;gap:10px;padding:8px;border-radius:12px;background:transparent;transition:background .15s;animation:dshTodoRowIn .2s ease-in-out}
.dshTodoRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshTodoCheckWrap{display:grid;place-items:center;width:26px;height:26px;flex:none;border-radius:8px;cursor:pointer;transition:background .15s}
.dshTodoCheckWrap:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshTodoCheck{display:block;width:16px;height:16px;margin:0;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.dshTodoBody{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
.dshTodoTitle{width:100%;margin:0;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;overflow-wrap:anywhere;white-space:pre-wrap;font:inherit;font-size:14px;line-height:22px;cursor:text}
.dshTodoDone .dshTodoTitle{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dshTodoMeta{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dshTodoEdit{box-sizing:border-box;width:100%;min-height:36px;margin:0;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:12px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);outline:none;resize:vertical;font:inherit;font-size:14px;line-height:22px}
.dshTodoEdit:focus{border-color:var(--dsw-alias-state-business-primary)}
.dshTodoRowActions{display:flex;align-items:center;gap:2px;flex:none;opacity:0;transition:opacity .15s}
.dshTodoRow:hover .dshTodoRowActions,.dshTodoRow:focus-within .dshTodoRowActions{opacity:1}
.dshTodoIconButton{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:none;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background .15s,color .15s}
.dshTodoIconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshTodoIconButtonDanger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.dshTodoEmpty{display:flex;flex-direction:column;align-items:center;padding:48px 20px;text-align:center;animation:dshTodoFadeIn .2s ease-in-out}
.dshTodoEmptyArt{display:grid;place-items:center;width:56px;height:56px;margin-bottom:12px;border:.5px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-caption)}
.dshTodoEmptyTitle{margin:0 0 8px;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:22px}
.dshTodoEmptyHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:21px}
.dshTodoLoading{display:flex;flex-direction:column;gap:2px}
.dshTodoSkeleton{height:52px;border-radius:12px;background:var(--dsw-alias-bg-skeleton);animation:dshTodoPulse 2s cubic-bezier(.36,0,.64,1) infinite}
.dshTodoSrOnly{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.dshTodoNotice{display:flex;align-items:flex-start;flex-wrap:wrap;gap:9px;margin:0 0 16px;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dshTodoNotice p{flex:1;min-width:0;margin:0}
.dshTodoNotice .dshTodoButton{margin-left:auto}
.dshTodoNoticeError{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.dshTodoNoticeIcon{display:inline-flex;flex:none;margin-top:2px;color:var(--dsw-alias-state-warn-primary)}
.dshTodoNoticeError .dshTodoNoticeIcon{color:var(--dsw-alias-state-error-primary)}
.dshTodoOverlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px}
.dshTodoBackdrop{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur);-webkit-backdrop-filter:var(--dsw-mask-blur);animation:dshTodoFadeIn .2s ease-in-out}
.dshTodoDialog{position:relative;z-index:1;width:min(380px,100%);padding:24px;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);animation:dshTodoDialogIn .2s ease-in-out}
.dshTodoDialogTitle{margin:0 0 8px;color:var(--dsw-alias-label-primary);font-size:16px;font-weight:500;line-height:24px}
.dshTodoDialogBody{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;overflow-wrap:anywhere}
.dshTodoDialogHint{margin:10px 0 0;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}
.dshTodoDialogActions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.dshTodoDialogActions .dshTodoButton{min-width:72px}
.dshTodoPage :focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dshTodoEdit:focus-visible{outline:none}
.dshTodoIcon{display:block}
@keyframes dshTodoRowIn{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
@keyframes dshTodoFadeIn{from{opacity:0}to{opacity:1}}
@keyframes dshTodoDialogIn{from{opacity:0;transform:translateY(6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes dshTodoPulse{0%,100%{opacity:1}50%{opacity:.55}}
@media (hover:none){.dshTodoRowActions{opacity:1}}
@media (max-width:760px){.dshTodoContent{padding:0 20px 32px}.dshTodoHeading{padding-top:20px}.dshTodoFilters{margin-top:14px}.dshTodoRowActions{opacity:1}}
@media (prefers-reduced-motion:reduce){.dshTodoPage *{animation:none!important;transition:none!important}}
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
     * Flatten and shorten a task text for a confirmation sentence, so deleting a
     * 2000-character task does not turn the dialog into a wall of text.
     *
     * @param {string} text - the task text.
     * @param {number} [limit] - the character budget.
     * @returns {string} a single-line snippet.
     */
    function snippet(text, limit = 80) {
      const flattened = text.replace(/\s+/g, ' ').trim()
      return flattened.length > limit ? `${flattened.slice(0, limit)}…` : flattened
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
     * Delete is the exception to "one click does the thing": the row button
     * only hands the task to the panel's confirmation dialog, which is what
     * calls the Host.
     *
     * @param {object} props - row props.
     * @returns {object} the row element.
     */
    function TodoRow({ todo, client, t, onRequestDelete }) {
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
        body.push(h('p', { key: 'meta', className: 'dshTodoMeta' }, t('row.added', { time: addedLabel })))
      }

      return h('li', { className: todo.done ? 'dshTodoRow dshTodoDone' : 'dshTodoRow' }, [
        h('label', { key: 'check', className: 'dshTodoCheckWrap' }, h('input', {
          type: 'checkbox',
          className: 'dshTodoCheck',
          checked: todo.done,
          'aria-label': todo.done ? t('row.reopen') : t('row.complete'),
          onChange: (event) => client.update(todo.id, { done: event.target.checked }),
        })),
        h('div', { key: 'body', className: 'dshTodoBody' }, body),
        h('div', { key: 'actions', className: 'dshTodoRowActions' }, [
          h('button', {
            key: 'delete',
            type: 'button',
            className: 'dshTodoIconButton dshTodoIconButtonDanger',
            title: t('row.delete'),
            'aria-label': t('row.delete'),
            onClick: (event) => onRequestDelete(todo, event.currentTarget),
          }, trashGlyph()),
        ]),
      ])
    }

    /**
     * The second confirmation for a destructive action.
     *
     * Focus moves to *Cancel*, so a stray Enter dismisses instead of deleting;
     * Tab is trapped inside the dialog, Escape and a backdrop click cancel, and
     * the control that opened it gets focus back. It renders inside the panel,
     * so the confirmation is scoped to the list it is about.
     *
     * @param {object} props - dialog props.
     * @returns {object} the dialog element.
     */
    function ConfirmDialog({ request, t, onCancel, onConfirm }) {
      const cancelRef = React.useRef(null)
      const dialogRef = React.useRef(null)
      /** The latest cancel callback, so the keyboard listener registers once. */
      const cancelHandler = React.useRef(onCancel)
      cancelHandler.current = onCancel

      React.useEffect(() => {
        if (typeof document === 'undefined') return () => {}
        const previous = document.activeElement
        cancelRef.current?.focus()
        // Listen on the document in the capture phase instead of on the
        // overlay: clicking the dialog's text moves focus to <body>, and a
        // keydown that starts outside the dialog would never bubble through it.
        const trap = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancelHandler.current()
            return
          }
          if (event.key !== 'Tab') return
          // Keep Tab inside the dialog: two buttons, so wrap at either end.
          const root = dialogRef.current
          if (root === null) return
          const focusable = [...root.querySelectorAll('button:not([disabled])')]
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          const active = document.activeElement
          if (event.shiftKey) {
            if (active === first || !root.contains(active)) {
              event.preventDefault()
              last.focus()
            }
          } else if (active === last || !root.contains(active)) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', trap, true)
        return () => {
          document.removeEventListener('keydown', trap, true)
          if (previous !== null && previous.isConnected) previous.focus()
        }
      }, [])

      const deleting = request.kind === 'delete'
      const title = deleting ? t('confirm.deleteTitle') : t('confirm.clearTitle')
      const body = deleting
        ? t('confirm.deleteBody', { text: snippet(request.text) })
        : t('confirm.clearBody', { count: request.count })
      const action = deleting ? t('confirm.deleteAction') : t('confirm.clearAction')

      return h('div', {
        className: 'dshTodoOverlay',
        onClick: (event) => {
          if (event.target === event.currentTarget) onCancel()
        },
      }, [
        h('div', {
          key: 'backdrop',
          className: 'dshTodoBackdrop',
          onClick: onCancel,
          'aria-hidden': true,
        }),
        h('div', {
          key: 'dialog',
          ref: dialogRef,
          className: 'dshTodoDialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'todo-confirm-title',
          'aria-describedby': 'todo-confirm-desc',
        }, [
          h('h2', { key: 'title', id: 'todo-confirm-title', className: 'dshTodoDialogTitle' }, title),
          h('p', { key: 'body', id: 'todo-confirm-desc', className: 'dshTodoDialogBody' }, body),
          h('p', { key: 'hint', className: 'dshTodoDialogHint' }, t('confirm.cancelHint')),
          h('div', { key: 'actions', className: 'dshTodoDialogActions' }, [
            h('button', {
              key: 'cancel',
              ref: cancelRef,
              type: 'button',
              className: 'dshTodoButton dshTodoButtonOutline',
              onClick: onCancel,
            }, t('confirm.cancel')),
            h('button', {
              key: 'confirm',
              type: 'button',
              className: 'dshTodoButton dshTodoButtonDanger',
              onClick: onConfirm,
            }, action),
          ]),
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
      /** The pending destructive action, or null. Nothing is deleted while it is set. */
      const [confirm, setConfirm] = React.useState(null)

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

      const requestDelete = (todo, trigger) => setConfirm({ kind: 'delete', id: todo.id, text: todo.text, trigger })
      const requestClear = (trigger) => setConfirm({ kind: 'clear', count: snapshot.counts.done, trigger })
      const acceptConfirm = () => {
        const request = confirm
        if (request === null) return
        setConfirm(null)
        if (request.kind === 'delete') client.remove(request.id)
        else client.clearCompleted()
      }

      const todos = filter === 'active'
        ? snapshot.todos.filter((todo) => !todo.done)
        : filter === 'completed'
          ? snapshot.todos.filter((todo) => todo.done)
          : snapshot.todos
      const filterCounts = {
        all: snapshot.counts.total,
        active: snapshot.counts.active,
        completed: snapshot.counts.done,
      }
      const total = snapshot.counts.total
      const percent = total === 0 ? 0 : Math.round((snapshot.counts.done / total) * 100)

      const children = [
        h('header', { key: 'heading', className: 'dshTodoHeading' }, [
          h('div', { key: 'main', className: 'dshTodoHeadingMain' }, [
            h('span', { key: 'mark', className: 'dshTodoBrandMark', 'aria-hidden': true }, h(TodoIcon, { size: 22 })),
            h('div', { key: 'text', className: 'dshTodoHeadingText' }, [
              h('h1', { key: 'title' }, t('title')),
              h('span', {
                key: 'counts',
                className: 'dshTodoCounts',
                'aria-live': 'polite',
              }, t('counts', { active: snapshot.counts.active, total })),
            ]),
          ]),
        ]),
      ]

      if (total > 0) {
        children.push(h('div', { key: 'progress', className: 'dshTodoProgress' }, [
          h('div', {
            key: 'track',
            className: 'dshTodoProgressTrack',
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': total,
            'aria-valuenow': snapshot.counts.done,
            'aria-label': t('progress.aria', { percent }),
          }, h('div', {
            key: 'fill',
            className: 'dshTodoProgressFill',
            style: { width: `${percent}%` },
          })),
          h('span', { key: 'value', className: 'dshTodoProgressValue' }, t('progress.percent', { percent })),
        ]))
      }

      children.push(h('form', {
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
          className: 'dshTodoButton dshTodoButtonPrimary dshTodoButtonCompact',
          disabled: text === '' || tooLong,
        }, [plusGlyph(), t('composer.add')]),
      ]))

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
          h('span', { key: 'icon', className: 'dshTodoNoticeIcon', 'aria-hidden': true }, alertGlyph()),
          h('p', { key: 'text' }, unreachable
            ? t('error.unreachable', { message })
            : localized ?? t('error.rejected', { message })),
          h('button', {
            key: 'action',
            type: 'button',
            className: 'dshTodoButton dshTodoButtonCompact',
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
        }, [
          t(`filter.${value}`),
          h('span', { key: 'count', className: 'dshTodoFilterCount' }, String(filterCounts[value])),
        ]))),
        h('button', {
          key: 'clear',
          type: 'button',
          className: 'dshTodoClear',
          disabled: snapshot.counts.done === 0,
          onClick: (event) => requestClear(event.currentTarget),
        }, t('clearDone')),
      ]))

      if (snapshot.status === 'loading') {
        children.push(h('div', { key: 'loading', className: 'dshTodoLoading', 'aria-busy': 'true' }, [
          h('span', { key: 'sr', className: 'dshTodoSrOnly' }, t('loading')),
          ...[0, 1, 2].map((index) => h('div', { key: index, className: 'dshTodoSkeleton' })),
        ]))
      } else if (todos.length === 0) {
        children.push(h('div', { key: 'empty', className: 'dshTodoEmpty' }, [
          h('div', { key: 'art', className: 'dshTodoEmptyArt', 'aria-hidden': true }, h(TodoIcon, { size: 24 })),
          h('p', { key: 'title', className: 'dshTodoEmptyTitle' }, t(`empty.${filter}`)),
          h('p', { key: 'hint', className: 'dshTodoEmptyHint' }, t(`emptyHint.${filter}`)),
        ]))
      } else {
        children.push(h('ul', { key: 'list', className: 'dshTodoList' }, todos.map((todo) => h(TodoRow, {
          key: todo.id,
          todo,
          client,
          t,
          onRequestDelete: requestDelete,
        }))))
      }

      const page = [h('div', { key: 'scroll', className: 'dshTodoScroll' }, [
        h('div', { key: 'content', className: 'dshTodoContent' }, children),
      ])]
      if (confirm !== null) {
        page.push(h(ConfirmDialog, {
          key: 'confirm',
          request: confirm,
          t,
          onCancel: () => setConfirm(null),
          onConfirm: acceptConfirm,
        }))
      }

      return h('section', { className: 'dshTodoPage', 'aria-label': t('title'), 'data-testid': 'todo-page' }, page)
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

    /** @returns {object} a trash glyph for a destructive action. */
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

    /** @returns {object} a plus glyph for the composer's add action. */
    function plusGlyph() {
      return h('svg', {
        key: 'plus',
        width: 13, height: 13, viewBox: '0 0 20 20', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
        'aria-hidden': true, focusable: false,
      }, [
        h('path', { key: 'vertical', d: 'M10 4.5 V15.5' }),
        h('path', { key: 'horizontal', d: 'M4.5 10 H15.5' }),
      ])
    }

    /** @returns {object} a warning glyph for the error notice. */
    function alertGlyph() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
      }, [
        h('path', { key: 'ring', d: 'M10 2.9 L17.3 16.1 H2.7 Z' }),
        h('path', { key: 'bar', d: 'M10 7.4 V11' }),
        h('path', { key: 'dot', d: 'M10 13.4 V13.6' }),
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
