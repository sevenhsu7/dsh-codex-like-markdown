# dsh-codex-like-markdown

English | [中文](README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that
makes the right Sidebar's Markdown preview **editable in place** — the document
keeps its rendered look, and clicking a paragraph, a table cell, or a heading
puts the caret exactly there and lets you type into it.

The shipped preview states the gap in its own README — *"Preview, not editing.
The viewers provide no file editing."* — and no shipped client-callable API
writes workspace file content. This plugin supplies the missing write path
itself, as its own Remote namespace, and adds a renderer that uses it.

## What you get

| | |
|---|---|
| Opening a `.md` file | Opens in **Markdown (editable)**, rendered exactly like the built-in viewer |
| Editing | Click a paragraph, heading, list, or code fence → it becomes editable in place: no border box, the document's own font, and no Markdown syntax on screen |
| Caret | Clicking lands the caret on the character you clicked, like a plain text editor |
| Typing | The edit is spliced into the document immediately, so the dirty state and auto-save stay live (auto-save after ~1.2 s idle); `Esc` or `⌘Enter` closes the block |
| Tables | The table keeps the renderer's own table; clicking a cell opens an editor over **just that cell**, and only that cell is written back |
| Adding | **+ Add paragraph** appends a paragraph and opens it |
| Formatting | **B** / *I* / `</>` / 🔗 insert the Markdown around the selection |
| `⌘S` / `Ctrl+S` | Saves immediately |
| Source view | The **Source** toggle switches the whole pane to the raw document |
| File changed elsewhere | The dirty buffer is **kept**, and the toolbar offers *Overwrite* or *Load from disk*; auto-save pauses until you edit again |
| Read-only rendered view | Still available: the preview's renderer dropdown lists the built-in **Markdown** viewer |

## Design

**Identical rendering.** The body renders through `MarkdownText` from
`@deepseek-ai/dsh-client-ui-primitives` — the very component the shipped Markdown
viewer uses — so headings, lists, tables, code blocks, math, and footnotes look
the same, including its link sanitization. That module ships in the browser's
frozen baseline module table, so requiring it adds no build step; if a deployment
ever lacks it, the plugin falls back to source-only editing.

**The Markdown is the text, never a reconstruction.** Editing uses a
`contenteditable` whose text content *is* the block's Markdown: syntax markers
are present in the DOM but hidden with CSS, and emphasis, code, links, headings,
list bullets, quotes, and fences are styled around them. Nothing is ever
serialized back from styling into syntax, so an edit can only change characters —
there is no rich-text-to-Markdown step that could mangle a file. Reading the
surface back is a walk over its text nodes, with browser-created block elements
as line breaks.

**It looks like the document, because it is measured from it.** When a block is
opened, the plugin snapshots the rendered block's computed typography — family,
size, line height, padding — and applies it to the editing surface, so switching
into editing does not change the document's type. The caret is placed by the
browser's own hit test (`caretRangeFromPoint`) at the coordinates that were
clicked.

**A table cell edits as a cell.** A table is one block, and replacing all of it
to change one cell is not an edit — so a table keeps the renderer's own table on
screen, and clicking a cell floats a single-cell editing surface over exactly
that cell. The cell's text is rewritten through its own byte range in the line,
so nothing else in the row, the table, or the document moves. The surface is
re-measured from the cell on every render, so it follows the row as it grows, and
it is single-line: Enter commits, a pasted newline becomes a space, and a cell
edit can never add a row.

**Blocks, not a second document model.** The source is split into
blank-line-separated blocks, with fenced code kept whole. Each block records its
exact `[start, end)` range, so an edit splices that range and leaves every other
byte — spacing, list markers, trailing newline — untouched. Blocks are memoized,
so a keystroke redraws the edited range rather than the document. A per-block
error boundary falls back to the raw text instead of blanking the pane.

**One small Remote namespace.** `markdownDocs/write` takes
`{ sessionId, path, absolutePath, content, expectedVersion? }` and answers with a
status envelope (`saved` / `stale` / `denied` / `missing` / `error`). The host
half writes through `ctx.fs.writeText`, so target identity, atomicity, and the
sandbox fence stay with the filesystem backend: a `read-only` session is denied
and `workspace-write` may only write inside its workspace root. Passing
`expectedVersion` makes the write compare-and-set; the editor sends it unless the
user explicitly chose *Overwrite*.

`index.js` imports nothing from `@deepseek-ai/*`. The Typert binding is assembled
by hand (`ctx.provide` plus a frozen `typertRemote`) and the invocation
descriptor is registered with `ctx.typert.register`, which is the documented
route for an owner outside the generated-artifact pipeline. Avoiding those
imports keeps the plugin independent of how the profile resolves the runtime
packages. `client.js` is a plain module-loader bundle with no build step.

## Install

This is a profile bundle: it declares `dsh.bundle.patch`, so installing it
enables it too.

**From a Harness session** — ask the agent to install it, which runs
`plugin_manager` with `action: install_bundle` and this directory as `target`.

**From a shell** — with the app quit:

```sh
# the CLI bundled with the macOS app
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add /absolute/path/to/dsh-codex-like-markdown
```

Installing needs approval or Full access, because a profile bundle runs host code
in-process. The package has no install scripts and no dependencies. Remove it
with `remove_bundle`.

Editing `client.js` afterwards is picked up live — the client module registry
watches the bundle — while a change to `index.js` needs an app restart to load a
fresh module generation.

## Requirements

The Harness version this was developed against (0.2.0-rc.2 era) mounts
`@deepseek-ai/dsh-client-ui-sidebar-documentpreview` and the API Gateway in the
Web composition. On a profile without them the client half stays inactive rather
than failing: it waits on `slots`, `documentPreviews`, `remote`, and `locale`.

## Limitations

- Markdown syntax you type **during** an edit appears literally until the block is
  closed, because the surface is not re-rendered while it holds your caret and
  your in-flight IME composition. `Esc` renders it.
- Hiding a marker means it cannot be edited by hand; deleting text next to one can
  drop it, which loses that formatting on the next render rather than changing
  your words.
- Tables are edited cell by cell; adding or removing a row or column is a
  structural change and belongs in the **Source** view.
- Blocks are split on blank lines. A loose list separated by blank lines renders
  as several lists, and a table split by a blank line would split too. A row that
  stops matching the header ends the table rather than swallowing the prose after
  it.
- Footnotes and reference links resolve within one block, not across the file.
- Complete-bytes loading is bounded by the preview's `maxFileBytes` (32 MiB).
- Drafts live in browser memory for the page's lifetime; they are not persisted
  across a page reload.
- Writes are whole-document replaces with an optional version guard. A change made
  between the read and the write is detected, not merged, and the choice of what
  wins stays with the user.

## Tests

`npm test` after fetching the runtime packages the suites import; see
[test/README.md](test/README.md). 161 checks cover the host half through a real
Gateway dispatch and real filesystem writes, the body through a real React
render, and the interaction logic — including the invariant that stripping the
editing surface's markup returns the Markdown byte for byte.

## License

MIT — see [LICENSE](LICENSE).
