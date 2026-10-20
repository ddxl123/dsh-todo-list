# dsh-todo-list

在 DeepSeek Harness 里**随处打开的一份全局待办清单**：侧边栏面板图标、全局快捷键，支持新增 / 查看 / 修改 / 删除，数据由 Host 半端持久化，所有窗口共用同一份清单。

```
侧边栏  ☑ 待办清单        ← 点击进入（全局面板，任意会话可见）
快捷键  ⌘⌥D / Ctrl+Alt+D  ← 任意位置开关面板
面板    添加 · 勾选完成 · 内联改内容 · 删除 · 清除已完成 · 全部/未完成/已完成 过滤
        删除 / 清除已完成会先弹一次确认（取消 · Esc · 点遮罩）
```

---

## 功能

| 能力 | 说明 |
| --- | --- |
| **全局打开** | 侧边栏左栏新增一个全局面板图标（`sidebar.panellist`），任意会话、任意页面都能点开；同时注册快捷键，不用去够侧边栏 |
| **新增** | 顶部输入框：Enter 保存，Shift+Enter 换行。一条待办上限 2000 字；超出时面板当场提示并禁用「添加」，不会等 Host 拒绝，也不会吞掉你输入的内容 |
| **查看** | 顶部标题实时显示未完成 / 总数；完成进度条带百分比；「全部 / 未完成 / 已完成」过滤标签带数量；每种过滤各有自己的空状态 |
| **修改** | 勾选框切换完成状态（记录完成时间）；点内容就地编辑（失焦或 Ctrl/Cmd+Enter 保存，Esc 放弃），换行原样保留 |
| **删除** | 单条删除与「清除已完成」（没有已完成项时禁用）都要先过一道确认弹窗，确认前不会向 Host 发任何请求：焦点一开始在「取消」上，点「取消」、按 Esc 或点遮罩都能退出（关闭后焦点回到打开弹窗的按钮） |
| **界面刷新** | 品牌图标标题、悬停高亮的扁平行（悬停或聚焦才显示删除，附一行小字创建时间）、骨架加载态、按过滤区分的空状态、带图标的错误提示、窄窗口适配，以及与宿主一致的模态确认弹窗——遮罩变暗并模糊、面板抬升、取消在左、红色 Ghost 删除在右；动效短促，系统要求减少动态时关闭 |
| **持久化** | 每次写操作都原子落盘（临时文件 + rename），崩溃不会截断文件；文件损坏时移到一边而不是覆盖 |
| **多窗口一致** | 每次写操作都返回**整份权威清单**，另一个窗口下一次操作后即收敛 |

界面文字走 Client locale 服务（中英双语），颜色只用 `--dsw-*` 主题 token，因此浅色/深色主题都能跟随宿主；系统开启「减少动态效果」时，短动效会被关闭。

## 安装

仓库：<https://github.com/ddxl123/dsh-todo-list>（克隆到本地后按下文安装）。

插件是一个标准的 DSH bundle 包，安装即注册：

```
plugin_manager  action: install_bundle  target: /绝对路径/dsh-todo-list
```

等价于命令行方式：

```bash
dsh plugin --profile desktop add /绝对路径/dsh-todo-list
```

安装后 bundle 层被写入 profile（`package.json` 的 `dsh.profile.bundles` + `cordis.patch.yml` 行），重启或热加载后生效。

> **注意**：如果这个包是**替换**已经安装过的旧版本，DSH 需要重启才能加载新的 JS 模块代；此时 `set_bundle`（先 `enabled: false` 再 `enabled: true`）也可以强制重新应用一次。

## 使用

1. 点侧边栏左栏的 **待办清单** 图标，或按 **⌘⌥D / Ctrl+Alt+D**。
2. 顶部输入框输入内容 → 回车 → 新增一条（最新的在最上面）。
3. 勾选框切换完成；点内容就地修改。每行右侧的「删除」只会先打开确认弹窗，你点确认之前不会向 Host 发送任何请求；点「取消」、按 Esc 或点遮罩即可退出。
4. 过滤标签切换「全部 / 未完成 / 已完成」（每个标签带数量）；「清除已完成」同样先确认，确认后才批量删除。
5. 再按一次快捷键回到会话（面板打开时快捷键是切换）。

快捷键绑定是 `primary+alt+KeyD`（macOS 为 ⌘⌥D）。若与你的习惯冲突，可在 **设置 → 快捷键** 里改；`web:linux` 组合没有默认绑定（浏览器在 Linux 上只接受 3 种组合键），在那里手动绑定即可。

## 数据

默认写在 `<harness home>/dsh-todo-list/todos.json`（`harness home` 即 `ctx.profileContext.home`，通常是 `~/.dsh`）：

```json
{
  "version": 1,
  "revision": 3,
  "updatedAt": "2026-10-10T07:25:00.000Z",
  "todos": [
    {
      "id": "t_4f2a9c1b8e30",
      "text": "写 README",
      "done": false,
      "createdAt": "2026-10-10T07:24:00.000Z",
      "updatedAt": "2026-10-10T07:25:00.000Z",
      "completedAt": null
    }
  ]
}
```

- `revision` 每次成功写入 +1，用来判断是否有别的窗口改过。
- 文件无法解析、或缺少 `todos` 数组时，会被重命名为 `todos.json.corrupt-<时间戳>`，清单从空开始（证据保留，不静默覆盖）。
- 单条结构不合法的记录会被丢弃并记一条 warning，其余记录照常读取。

### 从 0.1 升级

0.1 把一条待办存成 `title` + 可选 `note`，0.2 只存一个 `text`。读取时会把两者**合并**成一条（`note` 作为第二行），不会丢数据；下一次写入就按新结构落盘。所以直接升级即可，不需要手工改文件。

## 配置

配置写在 bundle 的 patch 行里（`cordis.patch.yml` 的 `config:`，或在 profile 的 patch 层覆盖）：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `fileName` | `todos.json` | 状态目录里的文件名 |
| `maxTodos` | `5000` | 清单上限（未完成 + 已完成） |

```yaml
- id: dsh-todo-list
  config:
    fileName: todos.json
    maxTodos: 5000
```

> 本插件**不导出 `Config` schema**，所以「插件」页面不会为它生成配置表单；原因见下节。上面两个键就是全部可配置项。

## 架构

```
dsh-todo-list/
├── src/
│   ├── index.js       Host 插件：读配置、建目录、装配 store / 路由 / 工具
│   ├── store.js       唯一的数据层：校验、排序、原子落盘、损坏隔离
│   ├── ops.js         五个操作：路由只负责收请求，含义在这里
│   ├── route.js       /api/dsh-todo-list 精确 Fetch 路由（GET + POST）
├── client/index.js    Client 半端：手写 bundle，注册面板图标 / 面板 / 确认弹窗 / 快捷键
├── locale/{zh,en}.json  插件卡片标题与描述
└── test/              49 个单元测试
```

面板 POST 到 `/api/dsh-todo-list` → `ops.js` → 同一个 `TodoStore`。路由只管请求怎么进来，不管操作是什么意思；校验规则、排序、完成语义只有一处定义。

### 两个刻意的设计决定

**1. Host 半端不 import 任何 `@deepseek-ai/*` 包。**

profile 插件 import 宿主包时，靠启动器的 profile resolution 把它路由到当前安装的副本；一旦这层解析不可用（例如 profile 的依赖层比当前安装更旧），失败的不是「少一个功能」，而是**整行 import 失败、插件根本没装上**。只依赖 Node 内置模块，激活就永远成立。代价是不导出 `Config` schema——因此配置项在 patch 行里写，`src/index.js` 的 `resolveConfig` 负责补默认值和兜底。

**2. Client 半端不 require 任何 Harness Client 包。**

`@deepseek-ai/dsh-client-ui-primitives` 之类的包会无预警变更，而纯 JS 插件没有类型检查；一个抛异常的组件会把整个 slot 条目清空（控制台只会打印 `slot entry crashed`）。所以控件全部自己写，只共享主题 token——token 改名最多让配色退化，不会让面板消失。

## 测试

```bash
node --test test/        # 49 个测试
npm run check            # 语法检查 + 全量测试
```

覆盖范围：

- `test/store.test.js` — 增删改查、排序、校验与错误码、上限、原子写、无残留临时文件、损坏文件隔离、非法记录丢弃、写失败时内存与报错、状态目录解析。
- `test/route.test.js` — 路由声明、GET 读、五种操作的完整往返、失败信封（不是失败请求）、415/400/405。
- `test/manifest.test.js` — 包名与 bundle 行/客户端 bundle 一致、声明入口都存在、图标大小、双语 meta、Host 半端零外部依赖、配置键与 patch 对齐、客户端只 require `react`、样式只用主题 token、**面板用到的每个 locale key 都在中英词典里**、**每个 className 都在样式表里有定义**。
- `test/manifest.test.js`（续）—— 客户端镜像的 `MAX_TEXT` 与 Host 半端一致、超长值在发送前就被面板拦下、输入框内容只在 Host 接受后才清空、**「连不上 Host」与「Host 拒绝」两种失败不混用同一句话**。
- `test/plugin.test.js` — 真正跑一遍 `apply`：状态目录被创建、只等待 `connection` 一个服务、**不向模型注册任何东西**、路由注册在 store 上（POST 新增 → 落盘 → 读回）、`fileName` 生效、路由注册被拒时**大声失败**而不是静默激活一个坏的插件。

## 验证状态

| 项 | 状态 |
| --- | --- |
| Bundle 安装 | ✅ `dsh-todo-list` 已进入 profile 的 `dsh.profile.bundles`，行 `include:dsh-todo-list` 已应用 |
| Host 行激活 | ✅ 已应用（`~/.dsh/dsh-todo-list/` 由 `apply` 创建） |
| Client 注册 | ✅ 实时页面已确认：`sidebar.panellist` 占位 `todo`（order 12，active）、`main` 键 `todo`（active） |
| 单元测试 | ✅ 49/49 |
| 面板视觉与交互 | ⚠️ 需你刷新页面后自行确认（当前环境没有浏览器控制能力）：新的布局、主题配色和确认弹窗全在 Client 半端，页面加载到 bundle 的新内容修订后才会出现 |

### 关于「运行中的进程比磁盘旧一代」

DSH 替换已安装包时，进程内的 ESM 模块缓存不会自动失效（官方说明：replacing an installed package requires restart to load a fresh JavaScript module generation）。本次开发过程中插件被迭代过，所以：

- **Client 半端**：bundle 按内容修订号提供，**刷新页面**即可拿到最新代码（含快捷键默认值的修正，以及带删除确认的新界面）。
- **Host 半端**：运行中的进程仍持有第一次成功导入的那一代（旧数据模型 + 一个 `todo` Agent 工具）。磁盘上的版本已经是单字段、无工具。**重启 DSH** 后二者一致 —— 这一步现在是必须的，因为数据模型也变了。

界面刷新和确认流程都在 Client 半端，两代 Host 都能用；刷新页面即可加载。

## 已知限制

- 删除一旦确认就是永久的 —— 没有撤销、没有回收站，单条删除和「清除已完成」都一样。
- 面板的过滤标签和未提交的输入框内容不会跨面板切换保留（组件随面板卸载）。
- 没有拖拽排序和截止日期；清单按创建时间倒序。
- 一条待办是一整块文本（可含换行），不做富文本、不拆子任务。
- 两个窗口同时编辑时按「后写入者赢」，不做冲突合并——但每次写入都会让两个窗口回到同一份权威数据。

## License

MIT
