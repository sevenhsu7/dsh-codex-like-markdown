# dsh-codex-like-markdown

[English](README.md) | 中文

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，让右侧栏的 Markdown 预览**就地可编辑**——文档保持渲染后的样子，点段落、点表格单元格、点标题，光标就落在那里，直接改字。

DSH 自带的预览插件在自己的 README 里就写明了这个缺口：*"Preview, not editing. The viewers provide no file editing."*，而且它没有暴露任何可以写工作区文件内容的客户端 API。所以这个插件自己补上写入通道（一个独立的 Remote 命名空间），再提供一个使用它的渲染器。

## 你能得到什么

| | |
|---|---|
| 打开 `.md` 文件 | 以 **Markdown（可编辑）** 打开，渲染效果与内置视图完全一致 |
| 编辑 | 点段落、标题、列表、代码围栏 → 就地变成可编辑：没有边框盒子，用的是文档自己的字体，屏幕上不出现 Markdown 标记 |
| 光标 | 点哪个字，光标就落在哪个字上，和普通文本编辑器一样 |
| 打字 | 改动立即拼回文档，所以「未保存」状态与自动保存都是实时的（停顿约 1.2 秒自动保存）；`Esc` 或 `⌘Enter` 关闭当前块 |
| 表格 | 表格保持渲染器自己的表格；点某一格只在**那一格**上浮出编辑面，也只回写那一格 |
| 新增 | **+ 新增段落** 追加一个段落并打开它 |
| 格式化 | **B** / *I* / `</>` / 🔗 给当前选区套上对应的 Markdown |
| `⌘S` / `Ctrl+S` | 立即保存 |
| 源码视图 | **源码** 开关把整个面板切成原始文档 |
| 文件在别处被改 | 未保存的内容**不会被覆盖**，工具栏给出 *仍然覆盖* 或 *从磁盘重新载入*；在你再次编辑前暂停自动保存 |
| 只读渲染视图 | 仍然可用：预览的渲染器下拉里可以选回内置的 **Markdown** |

## 设计

**渲染完全一致。** 正文通过 `@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText` 渲染——就是内置 Markdown 视图用的那个组件——所以标题、列表、表格、代码块、公式、脚注（含它的链接净化策略）看起来都一样。该模块在浏览器冻结的基线模块表里，因此 `require` 它不需要任何构建步骤；万一某个部署里没有它，插件会退化成「只能编辑源码」。

**Markdown 本身就是文本，从不反推。** 编辑面是一个 `contenteditable`，它的文本内容**就是**该块的 Markdown：语法标记仍在 DOM 里、但用 CSS 隐藏，加粗、代码、链接、标题、列表符号、引用、围栏都在标记周围做样式。**任何时候都不会把样式反向序列化成语法**，所以一次编辑只可能改变字符——不存在「富文本转 Markdown」这一步把文件改花的可能。读回内容就是对文本节点做一次遍历，浏览器自己生成的块级元素算作换行。

**看起来像文档，是因为它是从文档上量出来的。** 打开一个块时，插件会读取该渲染块的计算样式（字族、字号、行高、内边距）套到编辑面上，所以进入编辑不会改变文档的字体。光标用浏览器自己的命中测试（`caretRangeFromPoint`）按你点击的坐标放置。

**表格单元格按格编辑。** 表格是一个块，为了改一格而替换整张表不叫编辑——所以表格保持渲染器自己的表格，点某一格时只在那一格上浮出一个单格编辑面。单元格文本通过它在行内的**字节区间**改写，行内其它格、分隔行、表外内容一个字节都不动。编辑面每次渲染都重新量一次该格的位置，所以行变高时它会跟着走；它是单行的：回车即提交、粘贴进来的换行会变成空格，因此一次单元格编辑**不可能**多出一行。

**是块，不是第二套文档模型。** 源码按空行切块，代码围栏保持完整。每个块记录精确的 `[start, end)` 区间，所以一次编辑只替换那段区间，其余字节——空格、列表符号、结尾换行——原样保留。块做了 memo，敲一个键只重画被改动的范围而不是整篇文档。每个块都有错误边界，渲染失败时退回原文而不是让整个面板变空。

**一个小小的 Remote 命名空间。** `markdownDocs/write` 接收 `{ sessionId, path, absolutePath, content, expectedVersion? }`，返回状态信封（`saved` / `stale` / `denied` / `missing` / `error`）。宿主半通过 `ctx.fs.writeText` 写入，所以目标身份、原子性、沙箱围栏都由文件系统后端负责：`read-only` 会话会被拒绝，`workspace-write` 只能写工作区内。传 `expectedVersion` 时写入是 compare-and-set；除非用户明确选择 *仍然覆盖*，编辑器都会带上它。

`index.js` 不 import 任何 `@deepseek-ai/*`。Typert 绑定是手工拼的（`ctx.provide` 加一个冻结的 `typertRemote`），调用描述符用 `ctx.typert.register` 注册——这是生成物管线之外的宿主被文档认可的路径。避免这些 import 让插件不依赖「profile 如何解析运行时包」。`client.js` 是一个普通的 module-loader bundle，无需构建。

## 安装

这是一个 profile bundle：它声明了 `dsh.bundle.patch`，所以装上即启用。

**在 Harness 会话里** —— 让 agent 安装，它会用 `plugin_manager` 的 `action: install_bundle`，`target` 指向本目录。

**在终端里** —— 先退出应用：

```sh
# macOS 应用自带的 CLI
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add /absolute/path/to/dsh-codex-like-markdown
```

安装需要授权或 Full access，因为 profile bundle 会在宿主进程内执行代码。本包没有安装脚本、也没有依赖。卸载用 `remove_bundle`。

之后修改 `client.js` 会**即时生效**——客户端模块注册表在监视这个 bundle——而改动 `index.js` 需要重启应用以加载新的模块代。

## 环境要求

本插件是针对把 `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` 与 API Gateway 挂进 Web 组合的 Harness 版本开发的（0.2.0-rc.2 前后）。如果某个 profile 没有它们，客户端半会保持 inactive 而不是报错：它在等 `slots`、`documentPreviews`、`remote`、`locale` 这四个服务。

## 已知限制

- **编辑过程中**现敲的 Markdown 语法会先以原文显示，直到该块被关闭——因为编辑面在持有你的光标与输入法组合态时不会重渲染。`Esc` 之后就会渲染。
- 标记被隐藏意味着它不能手工编辑；在标记旁边删字可能把标记删掉，结果是那处格式丢失（下一次渲染可见），**不会改变你的文字**。
- 表格是逐格编辑；增删整行整列属于结构性修改，请用**源码**视图。
- 块按空行切分。用空行隔开的松散列表会渲染成多个列表；被空行切断的表格也会被切开。某行格子数不再匹配表头时，表格就地结束，不会吞掉后面的正文。
- 脚注与引用式链接只在单个块内解析，不跨文件。
- 完整字节读取受预览的 `maxFileBytes`（32 MiB）限制。
- 草稿存在浏览器内存里，生命周期为当前页面；刷新页面不保留。
- 写入是整篇替换加可选的版本护栏。读与写之间发生的改动会被**检测到**而不是合并，谁覆盖谁由用户决定。

## 测试

先抓取测试套件依赖的运行时包，再 `npm test`；见 [test/README.md](test/README.md)。161 条断言覆盖：宿主半经过**真实 Gateway 派发与真实文件写入**、正文经过**真实 React 渲染**、以及交互逻辑——其中最关键的一条是**把编辑面的标记剥掉后必须逐字节等于原 Markdown**。

## 许可

MIT —— 见 [LICENSE](LICENSE)。
