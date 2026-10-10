# dsh-todo-list

A **global todo list for DeepSeek Harness**: open it from anywhere in the harness — a sidebar panel icon or a global shortcut — and add, read, edit and delete tasks. The Host half owns one durable list shared by every window.

```
sidebar  ☑ Todo list          ← click to open (global panel, visible in every session)
shortcut ⌘⌥D / Ctrl+Alt+D     ← toggle the panel from anywhere
panel    add · complete · inline edit · delete · clear completed · filters
```

---

## Features

| Capability | Detail |
| --- | --- |
| **Global open** | A rail icon registered in `sidebar.panellist` (reachable from any session) plus a shortcut, so the list never requires aiming at the rail |
| **Add** | One composer input: Enter saves, Shift+Enter starts a new line. A task holds 2000 characters; going over is reported in the panel with the count and the Add button disabled — the Host is never asked, and what you typed is never eaten |
| **Read** | Live open/total counts, `All / Open / Completed` filters, a dedicated empty state |
| **Edit** | Checkbox toggles completion (stamping `completedAt`); the task itself is an inline editor (blur or Ctrl/Cmd+Enter saves, Esc abandons), and its line breaks survive |
| **Delete** | Per-row delete, plus *Clear completed* (disabled when nothing is completed) |
| **Durable** | Every write is atomic (temp file + rename), so a crash cannot truncate the file; an unreadable file is moved aside rather than overwritten |
| **Consistent across windows** | Every write answers with the whole authoritative list, so a second window converges on the next operation |

UI text goes through the Client locale service (Chinese and English); colors come only from `--dsw-alias-*` theme tokens, so the panel follows light and dark themes.

## Install

Repository: <https://github.com/ddxl123/dsh-todo-list> (clone it, then install from the checkout).

The plugin is a standard DSH bundle:

```
plugin_manager  action: install_bundle  target: /absolute/path/dsh-todo-list
```

or, equivalently, from a shell:

```bash
dsh plugin --profile desktop add /absolute/path/dsh-todo-list
```

The bundle layer is written into the profile (`dsh.profile.bundles` plus the `cordis.patch.yml` row) and takes effect on hot reload or restart.

> **Note**: replacing an already-installed copy requires a restart to load a fresh JavaScript module generation. `set_bundle` (`enabled: false` then `enabled: true`) also forces a re-application.

## Use

1. Click the **Todo list** icon in the left rail, or press **⌘⌥D / Ctrl+Alt+D**.
2. Type in the composer and press Enter — the newest task lands on top.
3. The checkbox toggles completion, clicking the task text edits it, and the button on each row is *delete*.
4. The filter tabs switch between all, open and completed; *Clear completed* deletes every finished task.
5. Press the shortcut again to return to the conversation (it toggles while the panel is open).

The default binding is `primary+alt+KeyD` (⌘⌥D on macOS). If it clashes with your habits, rebind it in **Settings → Shortcuts**; `web:linux` ships with no default because a browser on Linux accepts only three bindings — bind it manually there.

## Data

Written to `<harness home>/dsh-todo-list/todos.json` (`harness home` is `ctx.profileContext.home`, usually `~/.dsh`):

```json
{
  "version": 1,
  "revision": 3,
  "updatedAt": "2026-10-10T07:25:00.000Z",
  "todos": [
    {
      "id": "t_4f2a9c1b8e30",
      "text": "Write the README",
      "done": false,
      "createdAt": "2026-10-10T07:24:00.000Z",
      "updatedAt": "2026-10-10T07:25:00.000Z",
      "completedAt": null
    }
  ]
}
```

- `revision` increments on every successful write, which is how a second window knows the list moved.
- A file that cannot be parsed, or has no `todos` array, is renamed to `todos.json.corrupt-<stamp>` and the list restarts empty — the bytes survive instead of being silently overwritten.
- An individual malformed record is dropped with a warning; the readable records still load.

### Upgrading from 0.1

0.1 stored a task as a `title` plus an optional `note`; 0.2 stores one `text`. Loading **joins** the two — the note becomes the second line — so nothing is lost, and the next write persists the current shape. The upgrade needs no manual edit of the file.

## Configuration

Configuration lives on the bundle's patch row (`config:` in `cordis.patch.yml`, overridable from a later profile layer):

| Key | Default | Meaning |
| --- | --- | --- |
| `fileName` | `todos.json` | File name inside the state directory |
| `maxTodos` | `5000` | Cap on stored tasks (open plus completed) |

```yaml
- id: dsh-todo-list
  config:
    fileName: todos.json
    maxTodos: 5000
```

> The plugin deliberately exports **no `Config` schema**, so the Plugins page renders no generated form for it. Those two keys are the whole configuration surface; the reason is in *Architecture* below.

## Architecture

```
dsh-todo-list/
├── src/
│   ├── index.js       Host plugin: config, state directory, store / route / tool wiring
│   ├── store.js       The only data layer: validation, ordering, atomic writes, quarantine
│   ├── ops.js         The five operations; the route only carries the request
│   ├── route.js       The exact /api/dsh-todo-list Fetch route (GET + POST)
├── client/index.js    Client half: hand-written bundle registering the rail icon, panel and shortcut
├── locale/{zh,en}.json  Plugin card title and description
└── test/              46 unit tests
```

The panel posts to `/api/dsh-todo-list`, which hands each request to `ops.js` and on to the one `TodoStore`. The HTTP layer decides only *how* a request arrives, never what an operation means, so validation, ordering and the meaning of "completed" are defined in exactly one place.

### Two deliberate decisions

**1. The Host half imports no `@deepseek-ai/*` package.**

A profile plugin's import of a shipped package depends on the launcher's profile resolution routing that name to the running installation. When that routing is unavailable — a profile whose dependency layer predates the current installation, for example — the consequence is not a missing feature: the import fails, activation fails, and the plugin the user installed never appears at all. Depending only on Node builtins makes activation unconditional. The cost is that no `Config` schema is exported, so the configuration keys live in the patch row and `resolveConfig` fills in the defaults.

**2. The Client half requires no Harness Client package.**

Packages such as `@deepseek-ai/dsh-client-ui-primitives` change without notice, and a plain-JS plugin has no type check; a throwing component blanks its whole slot entry (the console only prints `slot entry crashed`). The controls are written here instead, sharing nothing but theme tokens — a renamed token degrades the shade, it never removes the panel.

## Tests

```bash
node --test test/        # 46 tests
npm run check            # syntax check + the full suite
```

- `test/store.test.js` — CRUD, ordering, validation and error codes, the cap, atomic writes, no leftover temp file, corruption quarantine, malformed-record dropping, write-failure reporting, state-directory resolution.
- `test/route.test.js` — route declaration, GET reads, full round-trips for all five operations, a failed envelope (not a failed request), and 415/400/405.
- `test/manifest.test.js` — package name agreement across the bundle row and client bundle, declared entries exist, icon size, both locales, zero external Host imports, config keys aligned with the patch, the client requiring only `react`, colors drawn only from theme tokens, **every locale key the panel asks for present in both dictionaries**, and **every `className` defined in the stylesheet**.
- `test/manifest.test.js` (continued) — the client's mirrored `MAX_TEXT` match the Host half, an over-long value is refused by the panel before it is sent, the composer is cleared only after the Host accepts the task, and **"cannot reach the Host" and "the Host refused" never share one sentence**.
- `test/plugin.test.js` — runs the real `apply`: the state directory is created, only `connection` is awaited, **nothing is registered for the model**, the route is registered over the store (POST an add → it lands on disk → it reads back), `fileName` takes effect, and a connection that refuses the route **fails loudly** instead of activating a plugin that cannot work.

## Verification status

| Item | Status |
| --- | --- |
| Bundle installed | ✅ `dsh-todo-list` is in the profile's `dsh.profile.bundles`; row `include:dsh-todo-list` applied |
| Host row activated | ✅ Applied (`~/.dsh/dsh-todo-list/` created by `apply`) |
| Client registration | ✅ Confirmed in the live page: `sidebar.panellist` occupant `todo` (order 12, active) and `main` key `todo` (active) |
| Unit tests | ✅ 46/46 |
| Panel visuals and interaction | ⚠️ Needs your own look after a page refresh — this environment has no browser control |

### The running process is one module generation behind

Replacing an installed package does not invalidate the process's ESM module cache (documented DSH behaviour: *replacing an installed package requires restart to load a fresh JavaScript module generation*). The plugin was iterated during development, so:

- **Client half**: the bundle is served under a content revision, so **a page refresh** picks up the current code, including the shortcut-default correction.
- **Host half**: the running process still holds the first successfully imported generation (the old two-field model, plus a `todo` agent tool). On disk it is one field with no tool. **Restarting DSH** brings the two together — and that step is now required, because the data model changed too.

The panel behaves identically across those two generations, so it can be refreshed and used right away.

## Known limitations

- Deletion is immediate and has no undo, as is *Clear completed*.
- The active filter and any uncommitted composer text reset when the panel is closed (the component unmounts with the panel).
- No drag-to-reorder and no due dates; the list is newest-first by creation time.
- A task is one block of text (line breaks allowed): no rich text, no subtasks.
- Two windows editing at once resolve last-writer-wins rather than merging — but every write returns both windows to the same authoritative list.

## License

MIT
