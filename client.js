window.__ModuleLoader__.load({
	id: 'dsh-codex-like-markdown',
	factory: (require) => {
		const React = require('react')
		const h = React.createElement

		/**
		 * The renderer the shipped document preview uses for its own Markdown
		 * viewer. It ships in the browser's frozen baseline module table, so
		 * requiring it is free and gives this editor exactly the same output.
		 *
		 * It is a `React.memo` component, so the export is an exotic component
		 * OBJECT rather than a function — testing for `typeof === 'function'`
		 * would silently discard a perfectly good renderer.
		 *
		 * A deployment without it degrades to source-only editing.
		 */
		let MarkdownText = null
		try {
			const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
			const candidate = primitives === null || primitives === undefined ? undefined : primitives.MarkdownText
			if (typeof candidate === 'function' || (typeof candidate === 'object' && candidate !== null)) MarkdownText = candidate
		} catch (error) {
			console.warn('markdown-editor: markdown renderer unavailable, source mode only', error)
		}

		/** Package identity; shared with the host half and the wire descriptors. */
		const PACKAGE = 'dsh-codex-like-markdown'
		/** Registry id of this document implementation, and the body slot key it renders under. */
		const IMPLEMENTATION_ID = PACKAGE + '/markdown-editor'
		/** Wire namespace the host half provides. */
		const NAMESPACE = 'markdownDocs'
		/** Locale namespace owned by this plugin. */
		const LOCALE_NS = 'markdownEditor'
		/** Idle time before an auto-saving buffer is written. */
		const AUTO_SAVE_DELAY_MS = 1200
		/** Class prefix keeping every rule out of the host's namespace. */
		const P = 'dshMdEditor'

		/** English copy; the source of truth for keys. */
		const EN = {
			'viewer.label': 'Markdown (editable)',
			'editor.aria': 'Editable Markdown',
			'editor.placeholder': 'This document is empty. Start typing to write it.',
			'block.empty': 'Click to start writing…',
			'block.hint': 'Click a paragraph to edit it in place',
			'block.add': 'Add paragraph',
			'selection.add': 'Add to chat',
			'selection.source': 'From',
			'selection.added': 'Added to the composer',
			'selection.failed': 'Could not add to the composer',
			'status.ready': 'Ready',
			'status.dirty': 'Unsaved changes',
			'status.saving': 'Saving…',
			'status.saved': 'Saved',
			'status.stale': 'The file changed on disk',
			'save.unavailable': 'Not connected to the file writer yet',
			'action.save': 'Save',
			'action.revert': 'Revert',
			'action.overwrite': 'Overwrite',
			'action.reload': 'Load from disk',
			'action.autoSave': 'Auto-save',
			'mode.live': 'Live',
			'mode.source': 'Source',
			'mode.aria': 'Editing view',
			'format.bold': 'Bold',
			'format.italic': 'Italic',
			'format.code': 'Inline code',
			'format.link': 'Link',
			'format.linkText': 'text',
			'shortcut.save': '⌘S',
			'code.copy': 'Copy',
			'code.copied': 'Copied',
			'codeBlock.title': 'Code',
			'codeBlock.wrap': 'Wrap lines',
			'codeBlock.unwrap': 'Unwrap lines',
			'footnotes': 'Footnotes',
		}

		/** Chinese copy, keyed identically. */
		const ZH = {
			'viewer.label': 'Markdown（可编辑）',
			'editor.aria': '可编辑的 Markdown',
			'editor.placeholder': '这个文件是空的，直接输入即可写入。',
			'block.empty': '点击开始输入…',
			'block.hint': '点击任意段落即可就地修改',
			'block.add': '新增段落',
			'selection.add': '添加至会话',
			'selection.source': '摘自',
			'selection.added': '已添加至会话',
			'selection.failed': '无法添加至会话',
			'status.ready': '就绪',
			'status.dirty': '未保存的修改',
			'status.saving': '保存中…',
			'status.saved': '已保存',
			'status.stale': '文件已在磁盘上被修改',
			'save.unavailable': '尚未连接到文件写入通道',
			'action.save': '保存',
			'action.revert': '撤销修改',
			'action.overwrite': '仍然覆盖',
			'action.reload': '从磁盘重新载入',
			'action.autoSave': '自动保存',
			'mode.live': '实时预览',
			'mode.source': '源码',
			'mode.aria': '编辑视图',
			'format.bold': '加粗',
			'format.italic': '斜体',
			'format.code': '行内代码',
			'format.link': '链接',
			'format.linkText': '文字',
			'shortcut.save': '⌘S',
			'code.copy': '复制',
			'code.copied': '已复制',
			'codeBlock.title': '代码',
			'codeBlock.wrap': '自动换行',
			'codeBlock.unwrap': '取消换行',
			'footnotes': '脚注',
		}

		/**
		 * A placeholder codec factory. The Client never executes a parameter
		 * schema — it only asserts that the field declares a strict codec — so
		 * this module needs no schema library. The Host half validates the wire
		 * fields for real.
		 * @returns a permissive parser.
		 */
		const passthrough = () => ({ parse: (value) => value })

		/** The Client projection of the plugin's own Remote namespace. */
		const CONTRIBUTION = {
			package: PACKAGE,
			descriptors: [
				{
					id: PACKAGE + '#' + NAMESPACE + '/write',
					service: NAMESPACE,
					namespace: NAMESPACE,
					method: 'write',
					invocation: { kind: 'direct' },
					parameters: [
						{
							name: 'request',
							wire: 'request',
							source: 'json',
							codec: {
								mode: 'strict',
								typeSymbol: PACKAGE + '#' + NAMESPACE + '/write:request',
								create: passthrough,
							},
						},
					],
					cancellation: { parameter: 'signal' },
					result: {
						mode: 'strict',
						typeSymbol: PACKAGE + '#' + NAMESPACE + '/write:result',
						create: passthrough,
					},
				},
			],
		}

		/**
		 * Styles scoped to this plugin's prefix. Colors come only from theme
		 * tokens, so light and dark themes both keep working.
		 */
		const CSS = [
			'.' + P + '-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
			'.' + P + '-bar{display:flex;align-items:center;gap:8px;flex:0 0 auto;min-width:0;padding:5px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
			'.' + P + '-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsw-alias-state-idle-primary)}',
			'.' + P + '-dot[data-state="dirty"]{background:var(--dsw-alias-state-warn-primary)}',
			'.' + P + '-dot[data-state="saved"]{background:var(--dsw-alias-state-success-primary)}',
			'.' + P + '-dot[data-state="error"]{background:var(--dsw-alias-state-error-primary)}',
			'.' + P + '-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.' + P + '-spacer{flex:1 1 auto}',
			'.' + P + '-hint{opacity:.65;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.' + P + '-button{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;line-height:18px;padding:1px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
			'.' + P + '-button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
			'.' + P + '-button:disabled{opacity:.4;cursor:default}',
			'.' + P + '-button[aria-pressed="true"]{color:var(--dsw-alias-brand-primary)}',
			'.' + P + '-icon{font-weight:600;min-width:22px;text-align:center;padding:1px 4px}',
			'.' + P + '-primary{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
			'.' + P + '-blocks{position:relative;flex:1 1 auto;min-height:0;overflow:auto;padding:2px 6px 24px}',
			'.' + P + '-block{position:relative;border-radius:6px;padding:1px 6px;cursor:text}',
			'.' + P + '-block:hover{background:var(--dsw-alias-bg-layer-1)}',
			'.' + P + '-block[data-editing="true"]{background:transparent;padding:0}',
			'.' + P + '-rich{outline:none;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;cursor:text;font-family:var(--dsw-font,inherit);font-size:13px;line-height:1.6}',
			'.' + P + '-hidden{display:none}',
			'.' + P + '-cell{position:relative;text-align:left;cursor:text}',
			'.' + P + '-table{border-collapse:collapse;width:100%;margin:.2em 0}',
			'.' + P + '-table td,.' + P + '-table th{border:1px solid var(--dsw-alias-border-l1);padding:4px 8px;vertical-align:top;font-weight:inherit}',
			'.' + P + '-table th{font-weight:600;background:var(--dsw-alias-bg-layer-1)}',
			'.' + P + '-line{min-height:1.1em}',
			'.' + P + '-heading{font-weight:650}',
			'.' + P + '-strong{font-weight:600}',
			'.' + P + '-em{font-style:italic}',
			'.' + P + '-strike{text-decoration:line-through;color:var(--dsw-alias-label-secondary)}',
			'.' + P + '-code{background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent);border-radius:3px;padding:0 3px;font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:.92em}',
			'.' + P + '-link{color:var(--dsw-alias-brand-primary);text-decoration:underline}',
			'.' + P + '-headingline{font-weight:650;font-size:1.35em;line-height:1.4;margin:.3em 0 .15em}',
			'.' + P + '-quoteline{border-left:3px solid var(--dsw-alias-border-l2);padding-left:10px;color:var(--dsw-alias-label-secondary)}',
			'.' + P + '-listline{padding-left:16px;position:relative}',
			'.' + P + '-listline::before{content:"\\2022";position:absolute;left:4px;color:var(--dsw-alias-label-secondary)}',
			'.' + P + '-olnum{color:var(--dsw-alias-label-secondary)}',
			'.' + P + '-codeline{font-family:var(--dsw-font-mono,ui-monospace,monospace);background:var(--dsw-alias-bg-layer-2);background:color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);font-size:.94em}',
			'.' + P + '-fenceline{font-family:var(--dsw-font-mono,ui-monospace,monospace);color:var(--dsw-alias-state-idle-primary);font-size:.9em}',
			'.' + P + '-hrline{border-top:1px solid var(--dsw-alias-border-l1);height:.9em}',
			'.' + P + '-block[data-editing="true"]{background:transparent}',
			'.' + P + '-fallback{white-space:pre-wrap;font-family:inherit;font-size:13px;line-height:1.6;margin:0;padding:6px 10px}',
			'.' + P + '-empty{padding:22px 16px;color:var(--dsw-alias-state-idle-primary);cursor:text;font-size:13px}',
			'.' + P + '-addrow{padding:6px 6px 0}',
			'.' + P + '-input{flex:1 1 auto;min-height:0;width:100%;box-sizing:border-box;resize:none;border:0;outline:none;background:transparent;color:inherit;padding:12px 14px;font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:13px;line-height:1.6;tab-size:2;white-space:pre;overflow:auto}',
			'.' + P + '-input::placeholder{color:var(--dsw-alias-state-idle-primary)}',
			'.' + P + '-seltools{position:absolute;z-index:5;display:flex;gap:2px;padding:3px;border-radius:8px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);box-shadow:0 6px 20px rgba(0,0,0,.16);transform:translate(-50%,calc(-100% - 8px))}',
			'.' + P + '-selbutton{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:20px;padding:1px 8px;border-radius:6px;cursor:pointer;white-space:nowrap}',
			'.' + P + '-selbutton:hover{background:var(--dsw-alias-bg-layer-2)}',
			'.' + P + '-selnote{position:absolute;left:50%;top:6px;transform:translateX(-50%);z-index:6;padding:3px 10px;border-radius:6px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;pointer-events:none}',
		].join('')

		/**
		 * Split Markdown source into blank-line-separated blocks, keeping fenced
		 * code together. Each block records its exact range in the source, so an
		 * in-place edit splices that range and leaves every other byte alone.
		 * @param source - the whole document.
		 * @returns blocks in document order, each `{ start, end, text }`.
		 */
		function splitBlocks(source) {
			const blocks = []
			let start = -1
			let offset = 0
			let fenced = false
			const flush = (end) => {
				if (start < 0) return
				blocks.push({ start, end, text: source.slice(start, end) })
				start = -1
			}
			for (const line of source.split('\n')) {
				const lineStart = offset
				if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) fenced = !fenced
				if (!fenced && line.trim() === '') flush(lineStart > 0 ? lineStart - 1 : 0)
				else if (start < 0) start = lineStart
				offset += line.length + 1
			}
			flush(source.length > 0 && source.slice(-1) === '\n' ? source.length - 1 : source.length)
			return blocks
		}

		/**
		 * Decode the complete UTF-8 bytes the preview read.
		 * @param content - the body's content prop.
		 * @returns the source text, or `null` while bytes are unavailable.
		 */
		function decodeBytes(content) {
			if (content === undefined || content === null || content.kind !== 'bytes') return null
			try {
				return new TextDecoder('utf-8', { fatal: false }).decode(content.data)
			} catch (error) {
				return null
			}
		}

		/**
		 * Read a message from anything thrown or returned as a failure.
		 * @param value - error, RemoteError, or unknown value.
		 * @returns a printable message.
		 */
		function messageOf(value) {
			if (value === undefined || value === null) return 'unknown error'
			if (typeof value === 'string') return value
			if (typeof value.message === 'string' && value.message !== '') return value.message
			return String(value)
		}

		/**
		 * Resolve the previewed document's relative images through the same
		 * authenticated file route the shipped renderer uses.
		 * @param absolutePath - the file's host path, when the resource reported one.
		 * @returns the renderer's `pathImages` contract, or `undefined`.
		 */
		function createPathImages(absolutePath) {
			if (typeof absolutePath !== 'string' || absolutePath === '') return undefined
			let base = ''
			try {
				base = document.baseURI
			} catch (error) {
				return undefined
			}
			if (!/^https?:/u.test(base) && base.indexOf('dsh-app://app/') !== 0) return undefined
			return {
				resolve: (destination) => {
					try {
						const text = String(destination)
						const cut = text.search(/[?#]/u)
						let path = decodeURIComponent(cut === -1 ? text : text.slice(0, cut))
						if (path === '') return undefined
						if (!/^[a-z]:[/\\]/iu.test(path) && /^[a-z][a-z\d+.-]*:/iu.test(path)) return undefined
						if (path.charAt(0) !== '/') path = absolutePath.replace(/[^/\\]*$/, '') + path
						return new URL('api/file?path=' + encodeURIComponent(path), base).href
					} catch (error) {
						return undefined
					}
				},
			}
		}

		/**
		 * Replace a textarea's value through the native setter so React's
		 * `onChange` sees a real edit.
		 * @param element - the focused textarea.
		 * @param value - the next value.
		 */
		function setNativeValue(element, value) {
			const prototype = element.ownerDocument.defaultView.HTMLTextAreaElement.prototype
			const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set
			setter.call(element, value)
			element.dispatchEvent(new element.ownerDocument.defaultView.Event('input', { bubbles: true }))
		}

		/**
		 * Escape one run of plain text for an `innerHTML` layer.
		 * @param value - raw text.
		 * @returns the same characters, HTML-safe.
		 */
		function escapeHtml(value) {
			return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		}

		/**
		 * Split one line's inline Markdown into typed runs.
		 *
		 * The concatenated run texts equal the input exactly; syntax markers are
		 * their own runs so the editing surface can hide them while the Markdown
		 * stays the text model.
		 * @param text - inline Markdown.
		 * @param inherited - kind for unstyled runs inside an emphasis span.
		 * @returns typed runs in source order.
		 */
		function tokenizeInline(text, inherited) {
			const runs = []
			const push = (kind, value) => {
				if (value !== '') runs.push({ kind, text: value })
			}
			let index = 0
			while (index < text.length) {
				const rest = text.slice(index)
				let match
				if ((match = /^(`+)([\s\S]*?)\1/.exec(rest)) !== null) {
					push('marker', match[1])
					push('code', match[2])
					push('marker', match[1])
				} else if ((match = /^(\*\*|__)([\s\S]+?)\1/.exec(rest)) !== null) {
					push('marker', match[1])
					for (const inner of tokenizeInline(match[2], 'strong')) runs.push(inner)
					push('marker', match[1])
				} else if ((match = /^(~~)([\s\S]+?)~~/.exec(rest)) !== null) {
					push('marker', '~~')
					for (const inner of tokenizeInline(match[2], 'strike')) runs.push(inner)
					push('marker', '~~')
				} else if ((match = /^([*_])([^*_\n]+?)\1/.exec(rest)) !== null) {
					push('marker', match[1])
					for (const inner of tokenizeInline(match[2], 'em')) runs.push(inner)
					push('marker', match[1])
				} else if ((match = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest)) !== null) {
					push('marker', '[')
					for (const inner of tokenizeInline(match[1], 'link')) runs.push(inner)
					push('marker', '](' + match[2] + ')')
				} else if ((match = /^https?:\/\/[^\s<>()]+/.exec(rest)) !== null) {
					push('link', match[0])
				} else {
					push(inherited, text[index])
					index += 1
					continue
				}
				index += match[0].length
			}
			return runs
		}

		/**
		 * Split a block's Markdown into lines of typed runs.
		 *
		 * Every line keeps its block marker apart from its content, and
		 * `marker + runs` reproduces the source line exactly.
		 * @param source - the block's raw Markdown.
		 * @returns lines in document order, each `{ kind, marker, runs }`.
		 */
		function tokenizeLines(source) {
			const lines = []
			let fenced = false
			for (const line of String(source).split('\n')) {
				let match
				if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) {
					fenced = !fenced
					lines.push({ kind: 'fence', marker: line, runs: [] })
					continue
				}
				if (fenced) {
					lines.push({ kind: 'code', marker: '', runs: [{ kind: 'code', text: line }] })
					continue
				}
				if ((match = /^(\s{0,3})(#{1,6})(\s+)([\s\S]*)$/.exec(line)) !== null) {
					lines.push({ kind: 'heading', marker: match[1] + match[2] + match[3], runs: tokenizeInline(match[4], 'heading') })
					continue
				}
				if ((match = /^(\s{0,3})(>+)(\s?)([\s\S]*)$/.exec(line)) !== null) {
					lines.push({ kind: 'quote', marker: match[1] + match[2] + match[3], runs: tokenizeInline(match[4], 'plain') })
					continue
				}
				if ((match = /^(\s*)([-*+]|\d+[.)])(\s+)([\s\S]*)$/.exec(line)) !== null) {
					lines.push({ kind: 'list', marker: match[1] + match[2] + match[3], runs: tokenizeInline(match[4], 'plain') })
					continue
				}
				if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line) && line.trim() !== '') {
					lines.push({ kind: 'hr', marker: line, runs: [] })
					continue
				}
				lines.push({ kind: 'plain', marker: '', runs: tokenizeInline(line, 'plain') })
			}
			return lines
		}

		/**
		 * Split one table row into its cells and the pipe characters between them.
		 *
		 * Every character is accounted for exactly once, in order, which is what
		 * lets a table keep its shape while its text stays the Markdown.
		 * @param line - one source line.
		 * @returns `{ cells }` where each cell carries its padding and inline runs, plus whether the line looks like a row.
		 */
		function splitTableRow(line) {
			const parts = []
			let buffer = ''
			let at = 0
			while (at < line.length) {
				const character = line[at]
				if (character === '\\' && at + 1 < line.length) {
					buffer += character + line[at + 1]
					at += 2
					continue
				}
				if (character === '|') {
					parts.push({ kind: 'text', text: buffer, start: at - buffer.length })
					parts.push({ kind: 'pipe' })
					buffer = ''
					at += 1
					continue
				}
				buffer += character
				at += 1
			}
			parts.push({ kind: 'text', text: buffer, start: line.length - buffer.length })
			// A leading and trailing pipe delimit the row rather than carry cells.
			if (parts.length > 0 && parts[0].kind === 'text' && parts[0].text.trim() === '') parts.shift()
			if (parts.length > 0 && parts[parts.length - 1].kind === 'text' && parts[parts.length - 1].text.trim() === '') parts.pop()
			const rows = parts.filter((part) => part.kind === 'text')
			if (rows.length === 0) return undefined
			return {
				parts,
				cells: rows.map((part) => {
					const lead = /^\s*/.exec(part.text)[0]
					const trail = /\s*$/.exec(part.text)[0]
					const core = part.text.slice(lead.length, part.text.length - trail.length)
					// Absolute offsets inside the line, so one cell can be
					// rewritten without touching a byte around it.
					return { lead, core, trail, coreStart: part.start + lead.length, coreEnd: part.start + part.text.length - trail.length }
				}),
			}
		}

		/**
		 * Every table in a block, with the line it starts on.
		 * @param lines - the block's source lines.
		 * @returns `[{ startLine, table }]` in document order.
		 */
		function scanTables(lines) {
			const found = []
			let index = 0
			while (index < lines.length) {
				const table = parseTable(lines.slice(index))
				if (table === undefined) {
					index += 1
					continue
				}
				found.push({ startLine: index, table })
				index += table.consumed
			}
			return found
		}

		/**
		 * Rewrite one cell's text, leaving the rest of the line and the rest of
		 * the document untouched.
		 *
		 * The line is found again from the document itself rather than assumed,
		 * so a cell edit can never land in the wrong row.
		 * @param source - the whole document.
		 * @param lineIndex - 0-based line holding the cell.
		 * @param column - 0-based cell within its row.
		 * @param text - the cell's new text.
		 * @returns the new document, or the input when the cell cannot be found.
		 */
		function replaceCell(source, lineIndex, column, text) {
			const lines = String(source).split('\n')
			if (lineIndex < 0 || lineIndex >= lines.length) return source
			const owner = scanTables(lines).find((entry) => lineIndex >= entry.startLine && lineIndex < entry.startLine + entry.table.consumed)
			if (owner === undefined) return source
			const offset = lineIndex - owner.startLine
			const row = offset === 0
				? owner.table.header
				: offset === 1 ? undefined : owner.table.body[offset - 2]
			if (row === undefined) return source
			const cell = row.cells[column]
			if (cell === undefined) return source
			let start = 0
			for (let index = 0; index < lineIndex; index += 1) start += lines[index].length + 1
			return String(source).slice(0, start + cell.coreStart) + text + String(source).slice(start + cell.coreEnd)
		}

		/**
		 * Recognise a GitHub-style table at the head of a block.
		 * @param lines - the block's source lines.
		 * @returns the header, the delimiter row, the body rows, and per-column alignment, or `undefined`.
		 */
		function parseTable(lines) {
			if (lines.length < 2) return undefined
			const header = splitTableRow(lines[0])
			const delimiter = splitTableRow(lines[1])
			if (header === undefined || delimiter === undefined) return undefined
			if (header.cells.length !== delimiter.cells.length) return undefined
			if (!delimiter.cells.every((cell) => /^:?-+:?$/.test(cell.core))) return undefined
			const body = []
			for (let index = 2; index < lines.length; index += 1) {
				const row = splitTableRow(lines[index])
				// A row that no longer matches the header ends the table rather
				// than swallowing the prose after it.
				if (row === undefined || row.cells.length !== header.cells.length) break
				body.push(row)
			}
			return {
				consumed: 2 + body.length,
				header,
				delimiter,
				body,
				align: delimiter.cells.map((cell) => {
					const left = cell.core.indexOf(':') === 0
					const right = cell.core.lastIndexOf(':') === cell.core.length - 1
					if (left && right) return 'center'
					if (right) return 'right'
					return left ? 'left' : undefined
				}),
			}
		}

		/**
		 * Inline Markdown as markup, with markers hidden and everything else styled.
		 * @param text - one run of inline Markdown.
		 * @returns markup carrying the same text.
		 */
		function inlineHtml(text) {
			return tokenizeInline(text, 'plain').map((part) => (part.kind === 'plain'
				? escapeHtml(part.text)
				: '<span class="' + P + '-' + (part.kind === 'marker' ? 'hidden' : part.kind) + '">' + escapeHtml(part.text) + '</span>')).join('')
		}

		/**
		 * One table cell. The pipes that belong before and after it, and its own
		 * padding, stay in the text model but invisible, so a cell shows only its
		 * text while the row still reads back as authored Markdown.
		 * @param cell - a cell from {@link splitTableRow}.
		 * @param tag - `th` for the header row, `td` otherwise.
		 * @param align - the column's alignment, when the delimiter row declares one.
		 * @param prefix - pipe characters preceding this cell.
		 * @param suffix - pipe characters following it.
		 * @returns the cell element.
		 */
		function renderTableCell(cell, tag, align, prefix, suffix) {
			const style = align === undefined ? '' : ' style="text-align:' + align + '"'
			return '<' + tag + style + '>'
				+ run('hidden', escapeHtml(prefix))
				+ run('hidden', escapeHtml(cell.lead))
				+ inlineHtml(cell.core)
				+ run('hidden', escapeHtml(cell.trail))
				+ run('hidden', escapeHtml(suffix))
				+ '</' + tag + '>'
		}

		/**
		 * One table row as cells, with every pipe placed inside the cell it
		 * belongs to — a `<tr>` may not hold loose spans.
		 * @param row - a row from {@link splitTableRow}.
		 * @param tag - `th` for the header row, `td` otherwise.
		 * @param align - per-column alignment.
		 * @returns the row's cells.
		 */
		function renderTableRow(row, tag, align) {
			const entries = []
			let pending = ''
			for (const part of row.parts) {
				if (part.kind === 'pipe') {
					pending += '|'
					continue
				}
				entries.push({ cell: row.cells[entries.length], prefix: pending })
				pending = ''
			}
			if (entries.length === 0) return ''
			entries[entries.length - 1].suffix = pending
			return '<tr>' + entries.map((entry, column) => renderTableCell(
				entry.cell,
				tag,
				align === undefined ? undefined : align[column],
				entry.prefix,
				entry.suffix === undefined ? '' : entry.suffix,
			)).join('') + '</tr>'
		}

		/**
		 * A table as a real table, so editing a table does not turn it into a
		 * stack of pipe-delimited lines. The delimiter row stays in the document
		 * as a hidden row because it is part of the file.
		 * @param table - the result of {@link parseTable}.
		 * @param delimiterLine - the source line of the delimiter row.
		 * @returns the table element.
		 */
		function renderTableHtml(table, delimiterLine) {
			return '<table class="' + P + '-table">'
				+ '<thead>' + renderTableRow(table.header, 'th', table.align) + '</thead>'
				+ '<tbody>'
				+ '<tr class="' + P + '-hidden"><td>' + escapeHtml(delimiterLine) + '</td></tr>'
				+ table.body.map((row) => renderTableRow(row, 'td', table.align)).join('')
				+ '</tbody></table>'
		}

		/** Wrap one run in a class; `hidden` runs are the syntax the surface never shows. */
		function run(kind, body) {
			return body === '' ? '' : '<span class="' + P + '-' + kind + '">' + body + '</span>'
		}

		/**
		 * Markup for the rich editing surface: the document's own text with its
		 * block and inline syntax present in the DOM but hidden, so the editor
		 * looks like the rendered document and holds the Markdown as its text.
		 * @param source - the block's raw Markdown.
		 * @returns markup whose text content equals `source`.
		 */
		function renderEditableHtml(source) {
			const lines = String(source).split('\n')
			const tokens = tokenizeLines(source)
			const tables = new Map(scanTables(lines).map((entry) => [entry.startLine, entry.table]))
			const out = []
			let index = 0
			while (index < lines.length) {
				const table = tables.get(index)
				if (table !== undefined) {
					// The delimiter row is drawn from the block's own text rather
					// than re-derived, because it is part of the file.
					out.push(renderTableHtml(table, lines[index + 1]))
					index += table.consumed
					continue
				}
				out.push(renderLineHtml(tokens[index]))
				index += 1
			}
			return out.join('')
		}

		/**
		 * One non-table line of the editing surface.
		 * @param line - a tokenized line.
		 * @returns the line element.
		 */
		function renderLineHtml(line) {
			return (() => {
				const classes = line.kind === 'plain' ? P + '-line' : P + '-line ' + P + '-' + line.kind + 'line'
				let inner = ''
				const ordered = line.kind === 'list' ? /^(\s*)(\d+)([.)]\s*)$/.exec(line.marker) : null
				if (ordered !== null) {
					inner += '<span class="' + P + '-olnum">' + ordered[2] + '</span>'
						+ '<span class="' + P + '-hidden">' + escapeHtml(ordered[3]) + '</span>'
				} else if (line.marker !== '') {
					inner += '<span class="' + P + '-hidden">' + escapeHtml(line.marker) + '</span>'
				}
				// Inline syntax carries the same hidden class as a block marker, so
				// the surface shows the rendered document and nothing else.
				inner += inlineHtml(line.runs.map((part) => part.text).join(''))
				if (inner === '') inner = '<br>'
				return '<div class="' + classes + '">' + inner + '</div>'
			})()
		}

		/**
		 * The text one DOM node contributes.
		 * @param node - any node of the editing surface.
		 * @returns its text, with `<br>` as a line break.
		 */
		function textOfNode(node) {
			if (node.nodeType === 3) return node.data
			if (node.nodeName === 'BR') return '\n'
			let out = ''
			let seen = false
			const children = node.childNodes === undefined ? [] : node.childNodes
			for (const child of children) {
				const block = child.nodeType === 1 && BLOCK_ELEMENTS.test(child.nodeName)
				const text = textOfNode(child)
				if (block) {
					if (seen) out += '\n'
					out += text === '\n' ? '' : text
					seen = true
					continue
				}
				out += text
				seen = true
			}
			return out
		}

		/** Elements that start a new line of Markdown. */
		const BLOCK_ELEMENTS = /^(DIV|P|LI|PRE|BLOCKQUOTE|H[1-6]|TR|TABLE|THEAD|TBODY)$/

		/**
		 * The Markdown a contenteditable currently holds.
		 *
		 * The surface is built from the Markdown itself, so reading its text back
		 * is the whole serialization step: no styling is ever turned into syntax.
		 * Browser-created block elements count as line breaks, and the placeholder
		 * break of an empty line contributes nothing.
		 * @param root - the editing surface.
		 * @returns its text, exactly as Markdown.
		 */
		function domToText(root) {
			return textOfNode(root)
		}

		/**
		 * The typography of what an edit replaced, so the editing surface keeps
		 * the document's type instead of the plugin's own.
		 *
		 * A block's own element is a wrapper, so its child carries the type; a
		 * table cell is a leaf, and its first element child is the first
		 * emphasized run in it — reading the weight from there would bold the
		 * whole cell.
		 * @param element - the rendered element that was clicked.
		 * @param fromSelf - take the type from `element` itself.
		 * @returns a style object for the editing surface.
		 */
		function snapshotTypography(element, fromSelf) {
			const target = fromSelf === true || element.firstElementChild === null ? element : element.firstElementChild
			if (typeof window.getComputedStyle !== 'function') return undefined
			const styles = window.getComputedStyle(target)
			return {
				fontFamily: styles.fontFamily,
				fontSize: styles.fontSize,
				lineHeight: styles.lineHeight,
				fontWeight: styles.fontWeight,
				letterSpacing: styles.letterSpacing,
				color: styles.color,
				margin: styles.margin,
				padding: styles.padding,
			}
		}

		/**
		 * The Markdown a selection is handed to the composer as.
		 *
		 * A quote plus its source, so the model can tell quoted context from the
		 * request itself, and a blank line under it so typing a question after
		 * the quote needs no extra keystroke.
		 * @param text - the selected text.
		 * @param label - the file it was selected from.
		 * @param heading - the localised "From".
		 * @returns the Markdown to insert into the draft.
		 */
		function quoteSelection(text, label, heading) {
			const lines = String(text).replace(/[ \t]+$/, '').split('\n')
			// The file is named outside the quote, then the passage is quoted: the
			// source is about the passage rather than part of it, and a bare `>`
			// line would otherwise be needed to keep the two apart. The blank line
			// under it is where the caret lands, so a question needs no keystroke.
			return heading + ' `' + label + '`\n' + lines.map((line) => '> ' + line).join('\n') + '\n\n'
		}

		/**
		 * Put the caret where the user clicked, using the browser's own hit test
		 * on the editing surface the click just opened.
		 * @param element - the editing surface.
		 * @param point - viewport coordinates of the click, when there was one.
		 * @param cell - the table cell that was clicked, when there was one.
		 */
		function placeCaret(element, point) {
			const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
			if (selection === null) return
			if (point !== undefined && typeof document.caretRangeFromPoint === 'function') {
				const range = document.caretRangeFromPoint(point.x, point.y)
				if (range !== null && range !== undefined && typeof element.contains === 'function' && element.contains(range.startContainer)) {
					selection.removeAllRanges()
					selection.addRange(range)
					return
				}
			}
			const fallback = document.createRange()
			fallback.selectNodeContents(element)
			fallback.collapse(false)
			selection.removeAllRanges()
			selection.addRange(fallback)
		}

		/**
		 * Insert text at the current selection of the focused editing surface,
		 * going through the editing command so the browser's own input event and
		 * undo stack stay intact.
		 * @param value - text to insert.
		 */
		function insertText(value) {
			if (typeof document.execCommand === 'function') {
				document.execCommand('insertText', false, value)
				return
			}
			const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
			if (selection === null || selection.rangeCount === 0) return
			const range = selection.getRangeAt(0)
			range.deleteContents()
			const node = document.createTextNode(value)
			range.insertNode(node)
			range.setStartAfter(node)
			range.collapse(true)
			selection.removeAllRanges()
			selection.addRange(range)
			const active = document.activeElement
			if (active !== null && typeof active.dispatchEvent === 'function') {
				active.dispatchEvent(new window.Event('input', { bubbles: true }))
			}
		}

		/** Keeps one unrenderable block from blanking the whole preview. */
		class BlockBoundary extends React.Component {
			constructor(props) {
				super(props)
				this.state = { failed: false }
			}

			static getDerivedStateFromError() {
				return { failed: true }
			}

			componentDidCatch(error) {
				console.warn('markdown-editor: block render failed', error)
			}

			render() {
				if (this.state.failed) return h('pre', { className: P + '-fallback' }, this.props.text)
				return this.props.children
			}
		}

		/** One rendered block, memoized so typing only redraws the edited range. */
		const Block = React.memo(function Block(props) {
			return h(BlockBoundary, { text: props.text },
				h(MarkdownText, { text: props.text, streaming: false, labels: props.labels, pathImages: props.pathImages }))
		})

		/**
		 * The rendered document. Clicking a block swaps just that block for a
		 * textarea holding its raw Markdown; every edit is spliced straight into
		 * the document, so auto-save and the dirty state stay live.
		 * @param props - source, change sink, and translation.
		 * @returns the live document view.
		 */
		/**
		 * One editing surface: a contenteditable that holds Markdown itself while
		 * showing only its rendered characters.
		 *
		 * The DOM's text content IS the Markdown — nothing is serialized back
		 * from styling — so an edit can only ever change characters, never
		 * reconstruct syntax. Syntax markers stay in the DOM as hidden spans, so
		 * the caret, selection, and typing behave as in any rich editor while the
		 * file keeps its exact Markdown.
		 * @param props - initial markup, typography, position, click point, and handlers.
		 * @returns the editing surface.
		 */
		function RichBlock(props) {
			const { html, typography, style, point, singleLine, onText, onCommit, t } = props
			const ref = React.useRef(null)

			// React never owns this element's children: the surface is written
			// once per editing session so the browser keeps the caret, the
			// selection, and an in-flight IME composition undisturbed.
			React.useEffect(() => {
				const element = ref.current
				if (element === null) return
				element.innerHTML = html
				element.focus()
				placeCaret(element, point)
			}, [])

			return h('div', {
				ref,
				className: P + '-rich' + (singleLine === true ? ' ' + P + '-cell' : ''),
				style: style === undefined ? typography : Object.assign({}, typography, style),
				contentEditable: true,
				suppressContentEditableWarning: true,
				role: 'textbox',
				'aria-multiline': singleLine === true ? 'false' : 'true',
				'aria-label': t('editor.aria'),
				spellCheck: false,
				onInput: (event) => onText(domToText(event.currentTarget)),
				onBlur: () => onCommit(),
				onPaste: (event) => {
					event.preventDefault()
					const data = event.clipboardData
					const pasted = String(data === undefined || data === null ? '' : data.getData('text/plain'))
					// A cell holds one line: a pasted table row must not become one.
					insertText(singleLine === true ? pasted.replace(/\s*\n\s*/g, ' ') : pasted)
				},
				onKeyDown: (event) => {
					if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key === 'Enter')) {
						event.preventDefault()
						onCommit()
						return
					}
					if (singleLine === true && event.key === 'Enter') {
						event.preventDefault()
						onCommit()
						return
					}
					if (event.key === 'Tab') {
						event.preventDefault()
						insertText('  ')
					}
				},
			})
		}

		/**
		 * The rendered table cell a click landed in, with the indices needed to
		 * find the same cell in the block's source.
		 * @param target - the event target.
		 * @param base - the rendered block the click happened in.
		 * @returns `{ rowIndex, column, tableIndex, element }`, or `undefined`.
		 */
		function tableCellHit(target, base) {
			if (target === null || target === undefined || typeof target.closest !== 'function') return undefined
			const element = target.closest('td,th')
			if (element === null || element === undefined) return undefined
			const row = typeof element.closest === 'function' ? element.closest('tr') : null
			const table = typeof element.closest === 'function' ? element.closest('table') : null
			if (row === null || row === undefined || table === null || table === undefined) return undefined
			if (typeof table.querySelectorAll !== 'function' || typeof base.querySelectorAll !== 'function') return undefined
			const rowIndex = Array.prototype.indexOf.call(table.querySelectorAll('tr'), row)
			const column = Array.prototype.indexOf.call(row.children, element)
			const tableIndex = Array.prototype.indexOf.call(base.querySelectorAll('table'), table)
			if (rowIndex < 0 || column < 0) return undefined
			return { rowIndex, column, tableIndex: tableIndex < 0 ? 0 : tableIndex, element }
		}

		/**
		 * The rendered document.
		 *
		 * A paragraph, heading, list, or code block opens into an editing surface
		 * in place. A table keeps the renderer's own table and only the clicked
		 * cell becomes editable, floating over that cell, because a table is one
		 * block and replacing all of it to change one cell is not an edit.
		 * @param props - source, change sink, and translation.
		 * @returns the live document view.
		 */
		function LiveDocument(props) {
			const { source, onSourceChange, labels, pathImages, sourceLabel, inputActions, t } = props
			const blocks = React.useMemo(() => splitBlocks(source), [source])
			const [editing, setEditing] = React.useState(null)
			const [cell, setCell] = React.useState(null)
			const [rect, setRect] = React.useState(null)
			const [selected, setSelected] = React.useState(null)
			const [note, setNote] = React.useState(null)
			const editingRef = React.useRef(null)
			const cellRef = React.useRef(null)
			const closeCellRef = React.useRef(() => {})
			const bodyRef = React.useRef(null)
			const pressRef = React.useRef(null)
			const noteTimer = React.useRef(null)
			editingRef.current = editing
			cellRef.current = cell

			/**
			 * Measure the current selection when it is a non-empty one inside
			 * this document, so the action bar can sit where the user selected.
			 */
			const readSelection = () => {
				const container = bodyRef.current
				const view = typeof window.getSelection === 'function' ? window.getSelection() : null
				if (container === null || view === null || view.rangeCount === 0 || view.isCollapsed === true) {
					setSelected(null)
					return
				}
				const text = String(view).trim()
				if (text === '') {
					setSelected(null)
					return
				}
				try {
					const range = view.getRangeAt(0)
					if (typeof container.contains === 'function' && container.contains(range.commonAncestorContainer) !== true) {
						setSelected(null)
						return
					}
					const box = range.getBoundingClientRect()
					const base = container.getBoundingClientRect()
					setSelected({
						text,
						left: box.left - base.left + (container.scrollLeft === undefined ? 0 : container.scrollLeft) + box.width / 2,
						top: box.top - base.top + (container.scrollTop === undefined ? 0 : container.scrollTop),
					})
				} catch (error) {
					setSelected(null)
				}
			}

			React.useEffect(() => {
				if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
				document.addEventListener('selectionchange', readSelection)
				return () => document.removeEventListener('selectionchange', readSelection)
			}, [])

			/** Say something for a moment, then stop saying it. */
			const flash = (message) => {
				setNote(message)
				if (typeof setTimeout !== 'function') return
				if (noteTimer.current !== null) clearTimeout(noteTimer.current)
				noteTimer.current = setTimeout(() => {
					noteTimer.current = null
					setNote(null)
				}, 2400)
			}

			/**
			 * Hand the selection to the composer as a quoted reference.
			 *
			 * The composer's own insertion action is used, so the text joins the
			 * draft as one undoable edit at the caret instead of replacing what
			 * the user already wrote.
			 */
			const sendSelection = () => {
				const current = selected
				if (current === null) return
				const quote = quoteSelection(current.text, sourceLabel === undefined || sourceLabel === null ? 'Markdown' : sourceLabel, t('selection.source'))
				let sent = false
				if (inputActions !== undefined && inputActions !== null
					&& typeof inputActions.captureInsertion === 'function'
					&& typeof inputActions.insertText === 'function') {
					try {
						sent = inputActions.insertText(quote, inputActions.captureInsertion()) === true
					} catch (error) {
						console.warn('markdown-editor: could not hand the selection to the composer', error)
					}
				}
				setSelected(null)
				flash(sent ? t('selection.added') : t('selection.failed'))
			}

			/** Close the block editing surface; its text is already in the document. */
			const commit = () => {
				editingRef.current = null
				setEditing(null)
			}

			/** Close the cell surface; its text is already in the document. */
			const closeCell = () => {
				cellRef.current = null
				setCell(null)
				setRect(null)
			}
			closeCellRef.current = closeCell

			/**
			 * Start editing one block where the user clicked.
			 * @param block - the clicked block.
			 * @param event - the mouse event carrying the click point, when there was one.
			 */
			const beginEdit = (block, event) => {
				if (editing !== null && editing.start === block.start) return
				if (cell !== null) closeCell()
				const draft = source.slice(block.start, block.end)
				const element = event === undefined || event === null ? undefined : event.currentTarget
				const next = {
					start: block.start,
					end: block.end,
					base: source,
					draft,
					html: renderEditableHtml(draft),
					point: event !== undefined && event !== null && typeof event.clientX === 'number' ? { x: event.clientX, y: event.clientY } : undefined,
					typography: element === undefined || element === null ? undefined : snapshotTypography(element),
				}
				editingRef.current = next
				setEditing(next)
			}

			/**
			 * Open the surface for one rendered table cell.
			 * @param block - the block holding the table.
			 * @param event - the mouse event that selected the cell.
			 * @param hit - the rendered cell from {@link tableCellHit}.
			 */
			const openCell = (block, event, hit) => {
				const lines = source.slice(block.start, block.end).split('\n')
				const owner = scanTables(lines)[hit.tableIndex]
				if (owner === undefined) return
				// The rendered table has no delimiter row, so body rows shift by one.
				const offset = hit.rowIndex === 0 ? 0 : hit.rowIndex + 1
				const row = offset === 0 ? owner.table.header : owner.table.body[offset - 2]
				const entry = row === undefined ? undefined : row.cells[hit.column]
				if (entry === undefined) return
				const before = source.slice(0, block.start).split('\n').length - 1
				const anchors = { element: hit.element, base: event.currentTarget }
				cellRef.current = {
					lineIndex: before + owner.startLine + offset,
					column: hit.column,
					blockStart: block.start,
					anchors,
				}
				setRect(null)
				setCell(Object.assign({}, cellRef.current, {
					html: renderEditableHtml(entry.core),
					typography: snapshotTypography(hit.element, true),
					point: typeof event.clientX === 'number' ? { x: event.clientX, y: event.clientY } : undefined,
				}))
			}

			/**
			 * Write one cell back, leaving every other byte of the document alone.
			 * @param text - the surface's current Markdown.
			 */
			const updateCell = (text) => {
				const current = cellRef.current
				if (current === null) return
				onSourceChange(replaceCell(source, current.lineIndex, current.column, String(text).replace(/\s*\n\s*/g, ' ')))
			}

			/**
			 * Replace the edited block's text and splice it into the document.
			 * @param draft - the Markdown the editing surface now holds.
			 */
			const updateDraft = (draft) => {
				const current = editingRef.current
				if (current === null) return
				const next = Object.assign({}, current, { draft })
				editingRef.current = next
				setEditing(next)
				onSourceChange(current.base.slice(0, current.start) + draft + current.base.slice(current.end))
			}

			/** Append an empty paragraph and open it. */
			const appendBlock = () => {
				const next = source === '' ? '' : source.replace(/\n+$/, '') + '\n\n'
				onSourceChange(next)
				const opened = {
					start: next.length,
					end: next.length,
					base: next,
					draft: '',
					html: renderEditableHtml(''),
				}
				editingRef.current = opened
				setEditing(opened)
			}

			const children = []
			let placed = false
			blocks.forEach((block, index) => {
				const isEditing = editing !== null && editing.start === block.start
				const isCell = cell !== null && cell.blockStart === block.start
				// While a block is open, any further block the draft now contains
				// would otherwise render a second copy of text the surface holds.
				const insideDraft = editing !== null && !isEditing && block.start > editing.start
					&& block.start < editing.start + Math.max(editing.draft.length, 1)
				if (insideDraft) return
				if (isEditing) placed = true
				children.push(h('div', {
					key: index,
					className: P + '-block',
					'data-block': index,
					'data-editing': isEditing ? 'true' : isCell ? 'cell' : undefined,
					onMouseDown: (event) => {
						if (event.target !== null && typeof event.target.closest === 'function') {
							if (event.target.closest('a') !== null) return
							// Clicks inside the open cell surface belong to it.
							if (event.target.closest('.' + P + '-cell') !== null) return
						}
						if (isEditing) return
						// The press is not consumed here: it may be the start of a
						// selection, which has to stay available for quoting.
						pressRef.current = { x: event.clientX, y: event.clientY, target: event.target, block }
					},
					onMouseUp: (event) => {
						const press = pressRef.current
						pressRef.current = null
						if (press === null || press.block !== block) return
						// A drag selected text; a still press is a click to edit.
						if (Math.abs(event.clientX - press.x) > 4 || Math.abs(event.clientY - press.y) > 4) return
						const view = typeof window.getSelection === 'function' ? window.getSelection() : null
						if (view !== null && view.isCollapsed === false) return
						const hit = tableCellHit(press.target, event.currentTarget)
						if (hit !== undefined) {
							openCell(block, event, hit)
							return
						}
						beginEdit(block, event)
					},
				}, isEditing
					? h(RichBlock, {
						key: 'rich',
						html: editing.html,
						typography: editing.typography,
						point: editing.point,
						onText: updateDraft,
						onCommit: () => {
							const current = editingRef.current
							if (current !== null && current.start === block.start) commit()
						},
						t,
					})
					: [
						h(Block, { key: 'body', text: block.text, labels, pathImages }),
						isCell && cell !== null
							? h(RichBlock, {
								key: 'cell-' + cell.lineIndex + ':' + cell.column,
								singleLine: true,
								html: cell.html,
								typography: cell.typography,
								style: rect === null
									? { position: 'absolute', left: 0, top: 0, visibility: 'hidden' }
									: {
										position: 'absolute',
										left: rect.left,
										top: rect.top,
										width: rect.width,
										minHeight: rect.height,
										zIndex: 3,
										background: rect.background,
									},
								point: cell.point,
								onText: updateCell,
								onCommit: closeCell,
								t,
							})
							: null,
					]))
			})
			if (editing !== null && !placed) {
				children.push(h('div', { key: 'tail', className: P + '-block', 'data-editing': 'true' },
					h(RichBlock, {
						html: editing.html,
						typography: editing.typography,
						point: editing.point,
						onText: updateDraft,
						onCommit: commit,
						t,
					})))
			}

			if (blocks.length === 0 && editing === null) {
				return h('div', {
					className: P + '-blocks',
					'aria-label': t('block.hint'),
					onMouseDown: (event) => {
						if (event.target !== event.currentTarget) return
						event.preventDefault()
						beginEdit({ start: 0, end: source.length })
					},
				}, h('div', { className: P + '-empty', onClick: () => beginEdit({ start: 0, end: source.length }) }, t('block.empty')))
			}

			return h('div', {
				ref: bodyRef,
				className: P + '-blocks',
				'aria-label': t('block.hint'),
				onMouseDown: (event) => {
					if (event.target !== event.currentTarget) return
					commit()
					closeCell()
				},
			}, children.concat([
				// The bar for a selected passage: the text is context the model
				// should see, and sending it is one action from where it was read.
				selected === null ? null : h('div', {
					key: 'seltools',
					className: P + '-seltools',
					style: { left: selected.left, top: selected.top },
				}, [
					h('button', {
						key: 'add',
						type: 'button',
						className: P + '-selbutton',
						onMouseDown: (event) => {
							event.preventDefault()
							sendSelection()
						},
					}, t('selection.add')),
				]),
				note === null ? null : h('div', { key: 'selnote', className: P + '-selnote' }, note),
				h('div', { key: 'add', className: P + '-addrow' },
					h('button', {
						type: 'button',
						className: P + '-button',
						onMouseDown: (event) => {
							event.preventDefault()
							closeCell()
							appendBlock()
						},
					}, '+ ' + t('block.add'))),
			]))
		}

		/**
		 * Draft buffers kept per tab id, so switching tabs or renderers and
		 * coming back never discards unsaved text.
		 */
		const drafts = new Map()

		/**
		 * Build the editable body for one previewed document.
		 * @param ctx - the plugin's Client context.
		 * @param t - the plugin's bound translator.
		 * @returns the body component the document slot renders.
		 */
		function createBody(writer, t) {
			return function MarkdownEditorBody(props) {
				const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
				const tab = info !== undefined && info !== null ? info.tab : undefined
				// Remount per tab: a switched preview must not carry the previous
				// document's buffer, while the draft map keeps unsaved edits alive.
				return h(Editor, Object.assign({}, props, {
					key: tab !== undefined && tab !== null ? tab.id : 'markdown-editor',
					tabId: tab !== undefined && tab !== null ? tab.id : 'markdown-editor',
					writer,
					t,
					drafts,
				}))
			}
		}

		/**
		 * The editor: a rendered document that edits in place, a raw source
		 * view, and the save machinery both share.
		 * @param props - composed document body props.
		 * @returns the editor view.
		 */
		function Editor(props) {
			const { resourceAddress, content, scrollportRef, useResource, writer, t, drafts, tabId } = props
			const meta = typeof useResource === 'function' ? useResource(resourceAddress) : undefined
			const absolutePath = meta !== undefined && meta !== null && meta.value !== undefined ? meta.value.absolutePath : undefined
			const diskVersion = meta !== undefined && meta !== null && meta.value !== undefined ? meta.value.version : undefined
			const address = React.useMemo(() => splitAddress(resourceAddress), [resourceAddress])
			const incoming = React.useMemo(() => decodeBytes(content), [content])
			const pathImages = React.useMemo(() => createPathImages(absolutePath), [absolutePath])

			const [state, setState] = React.useState(() => {
				const kept = drafts.get(tabId)
				return kept === undefined
					? { text: '', savedText: '', baseVersion: undefined, autoSave: true, hold: false }
					: { text: kept.text, savedText: kept.savedText, baseVersion: kept.baseVersion, autoSave: true, hold: false }
			})
			const [mode, setMode] = React.useState(MarkdownText === null ? 'source' : 'live')
			const [saving, setSaving] = React.useState(false)
			const [notice, setNotice] = React.useState(null)

			// The latest render's values, read by handlers that outlive a render.
			const latest = React.useRef(null)
			latest.current = { state, saving, address, absolutePath }

			React.useEffect(() => {
				drafts.set(tabId, { text: state.text, savedText: state.savedText, baseVersion: state.baseVersion })
			}, [drafts, tabId, state.text, state.savedText, state.baseVersion])

			// Adopt what the preview read whenever this buffer holds no unsaved
			// work. A dirty buffer always wins; the file's newer state is then
			// offered as an explicit choice instead of silently overwriting it.
			React.useEffect(() => {
				if (incoming === null) return
				setState((prev) => {
					if (prev.text !== prev.savedText) return prev
					if (prev.savedText === incoming && prev.baseVersion === diskVersion) return prev
					return { text: incoming, savedText: incoming, baseVersion: diskVersion, autoSave: prev.autoSave, hold: false }
				})
			}, [incoming, diskVersion])

			/**
			 * Write the buffer back through the plugin's own Remote method.
			 * @param options - `force: true` drops the version guard (user's overwrite).
			 */
			const save = React.useCallback(async (options) => {
				const opts = options === undefined || options === null ? {} : options
				const current = latest.current
				if (current === null || current.saving) return
				const text = typeof opts.text === 'string' ? opts.text : current.state.text
				const expectedVersion = opts.force === true ? undefined : current.state.baseVersion
				if (writer === undefined || writer === null || typeof writer.write !== 'function') {
					setNotice({ kind: 'error', message: t('save.unavailable') })
					setState((prev) => Object.assign({}, prev, { hold: true }))
					return
				}
				setSaving(true)
				setNotice(null)
				let result
				try {
					result = await writer.write({
						sessionId: current.address.sessionId,
						path: current.address.path,
						absolutePath: current.absolutePath,
						content: text,
						expectedVersion,
					})
				} catch (error) {
					setSaving(false)
					setNotice({ kind: 'error', message: messageOf(error) })
					setState((prev) => Object.assign({}, prev, { hold: true }))
					return
				}
				setSaving(false)
				if (result === undefined || result === null || result.ok !== true) {
					setNotice({ kind: 'error', message: messageOf(result === undefined || result === null ? undefined : result.error) })
					setState((prev) => Object.assign({}, prev, { hold: true }))
					return
				}
				const value = result.value === undefined || result.value === null ? {} : result.value
				if (value.status === 'saved') {
					setState((prev) => Object.assign({}, prev, { savedText: text, baseVersion: value.version, hold: false }))
					setNotice({ kind: 'saved' })
					return
				}
				if (value.status === 'stale') {
					// Stop the auto-save timer from hammering a file someone else
					// changed; the user resolves it with Overwrite or Load from disk.
					setState((prev) => Object.assign({}, prev, { hold: true }))
					setNotice({ kind: 'stale', message: value.message })
					return
				}
				setState((prev) => Object.assign({}, prev, { hold: true }))
				setNotice({ kind: 'error', message: value.message !== undefined ? value.message : 'save failed (' + String(value.status) + ')' })
			}, [writer])

			// Auto-save: write the buffer once editing pauses. Off means the user
			// saves explicitly, with ⌘S or the toolbar.
			React.useEffect(() => {
				if (!state.autoSave) return undefined
				if (state.hold) return undefined
				if (state.text === state.savedText) return undefined
				if (saving) return undefined
				const timer = setTimeout(() => {
					void save({})
				}, AUTO_SAVE_DELAY_MS)
				return () => clearTimeout(timer)
			}, [save, saving, state.autoSave, state.hold, state.text, state.savedText])

			const inputRef = React.useRef(null)

			// ⌘S / Ctrl+S while this editor has focus. The capture phase keeps the
			// shell's own refresh shortcut out of the way.
			React.useEffect(() => {
				const onKeyDown = (event) => {
					if (!(event.metaKey || event.ctrlKey)) return
					if (String(event.key).toLowerCase() !== 's') return
					const active = document.activeElement
					if (active === null) return
					if (active !== inputRef.current && String(active.className).indexOf(P + '-') !== 0) return
					event.preventDefault()
					event.stopPropagation()
					void save({})
				}
				window.addEventListener('keydown', onKeyDown, true)
				return () => window.removeEventListener('keydown', onKeyDown, true)
			}, [save])

			// The raw document is still one keystroke away, but it no longer owns a
			// row: ⌥⌘E swaps the rendered view for the source and back, gated on
			// focus the way the save shortcut is.
			React.useEffect(() => {
				if (MarkdownText === null) return undefined
				const onKeyDown = (event) => {
					if (!(event.metaKey || event.ctrlKey) || !event.altKey) return
					if (String(event.key).toLowerCase() !== 'e') return
					const active = document.activeElement
					if (active === null) return
					if (active !== inputRef.current && String(active.className).indexOf(P + '-') !== 0) return
					event.preventDefault()
					event.stopPropagation()
					setMode((prev) => (prev === 'source' ? 'live' : 'source'))
				}
				window.addEventListener('keydown', onKeyDown, true)
				return () => window.removeEventListener('keydown', onKeyDown, true)
			}, [])

			const dirty = state.text !== state.savedText
			// The resource's version moving past the one this buffer is based on is
			// the only reliable sign of a foreign write: our own save is not yet
			// reflected in `incoming` when the notice would otherwise fire.
			const changedOnDisk = dirty
				&& typeof diskVersion === 'string'
				&& typeof state.baseVersion === 'string'
				&& diskVersion !== state.baseVersion

			/** Restore the buffer to the last text known to be on disk. */
			const revert = () => {
				setNotice(null)
				setState((prev) => Object.assign({}, prev, { text: prev.savedText, hold: false }))
			}

			/** Replace the buffer with the preview's current bytes. */
			const reloadFromDisk = () => {
				if (incoming === null) return
				setNotice(null)
				setState((prev) => Object.assign({}, prev, { text: incoming, savedText: incoming, baseVersion: diskVersion, hold: false }))
			}

			const setText = (text) => setState((prev) => Object.assign({}, prev, { text, hold: false }))

			/**
			 * Wrap the focused textarea's selection, the one formatting gesture
			 * that works the same in both views.
			 * @param prefix - text inserted before the selection.
			 * @param suffix - text inserted after it.
			 */
			const wrapSelection = (prefix, suffix) => {
				const active = document.activeElement
				if (active !== null && active.isContentEditable === true) {
					const selection = window.getSelection()
					const selected = selection === null ? '' : String(selection)
					insertText(prefix + selected + suffix)
					return
				}
				if (active === null || active.tagName !== 'TEXTAREA' || String(active.className) === '') return
				const start = active.selectionStart
				const end = active.selectionEnd
				const value = active.value
				const selected = value.slice(start, end)
				setNativeValue(active, value.slice(0, start) + prefix + selected + suffix + value.slice(end))
				const caret = start + prefix.length + selected.length
				window.requestAnimationFrame(() => {
					active.selectionStart = caret
					active.selectionEnd = caret
				})
			}

			const status = saving
				? { kind: 'saving', text: t('status.saving') }
				: notice !== null && notice.kind === 'error'
					? { kind: 'error', text: notice.message }
					: changedOnDisk
						? { kind: 'dirty', text: t('status.stale') }
						: dirty
							? { kind: 'dirty', text: t('status.dirty') }
							: notice !== null && notice.kind === 'saved'
								? { kind: 'saved', text: t('status.saved') }
								: { kind: 'idle', text: t('status.ready') }

			const onSourceKeyDown = (event) => {
				if (event.key !== 'Tab') return
				event.preventDefault()
				const input = event.currentTarget
				const start = input.selectionStart
				const end = input.selectionEnd
				setText(state.text.slice(0, start) + '  ' + state.text.slice(end))
				window.requestAnimationFrame(() => {
					input.selectionStart = start + 2
					input.selectionEnd = start + 2
				})
			}

			const bindInput = (node) => {
				inputRef.current = node
				if (typeof scrollportRef === 'function') scrollportRef(node)
			}

			const labels = React.useMemo(() => ({
				code: {
					copyLabel: t('code.copy'),
					copiedLabel: t('code.copied'),
					toolbarLabels: {
						codeLabel: t('codeBlock.title'),
						wrapLabel: t('codeBlock.wrap'),
						unwrapLabel: t('codeBlock.unwrap'),
					},
				},
				footnotes: t('footnotes'),
			}), [t])

			// mousedown rather than click: the gesture must not move focus out of
			// the textarea the formatting applies to.
			const icon = (key, label, text, action) => h('button', {
				key,
				type: 'button',
				className: P + '-button ' + P + '-icon',
				title: label,
				'aria-label': label,
				onMouseDown: (event) => {
					event.preventDefault()
					action()
				},
			}, text)

			const body = mode === 'source'
				? h('textarea', {
					key: 'source',
					ref: bindInput,
					className: P + '-input',
					value: state.text,
					placeholder: t('editor.placeholder'),
					'aria-label': t('editor.aria'),
					'data-markdown-editor-input': true,
					spellCheck: false,
					autoCapitalize: 'off',
					autoCorrect: 'off',
					wrap: 'off',
					onChange: (event) => setText(event.target.value),
					onKeyDown: onSourceKeyDown,
				})
				: h(LiveDocument, {
					key: 'live',
					source: state.text,
					onSourceChange: setText,
					labels,
					pathImages,
					sourceLabel: absolutePath === undefined || absolutePath === null ? address.path : absolutePath,
					inputActions: props.inputActions,
					t,
				})

			return h('div', { className: P + '-root', 'data-markdown-editor': true }, [
				h('style', { key: 'style' }, CSS),
				h('div', { className: P + '-bar', key: 'bar' }, [
					h('span', { className: P + '-dot', key: 'dot', 'data-state': status.kind }),
					h('span', { className: P + '-label', key: 'label', title: absolutePath === undefined ? undefined : absolutePath }, status.text),
					h('span', { className: P + '-spacer', key: 'spacer-before' }),
					// The formatting actions sit between the status and the saving
					// controls, so one row carries everything the pane needs.
					icon('bold', t('format.bold'), 'B', () => wrapSelection('**', '**')),
					icon('italic', t('format.italic'), 'I', () => wrapSelection('*', '*')),
					icon('code', t('format.code'), '</>', () => wrapSelection('`', '`')),
					icon('link', t('format.link'), '🔗', () => wrapSelection('[', '](url)')),
					h('span', { className: P + '-spacer', key: 'spacer-after' }),
					changedOnDisk
						? h('button', { key: 'overwrite', type: 'button', className: P + '-button', onClick: () => void save({ force: true }) }, t('action.overwrite'))
						: null,
					changedOnDisk
						? h('button', { key: 'reload', type: 'button', className: P + '-button', onClick: reloadFromDisk }, t('action.reload'))
						: null,
					h('button', {
						key: 'autosave',
						type: 'button',
						className: P + '-button',
						'aria-pressed': state.autoSave ? 'true' : 'false',
						title: t('action.autoSave'),
						onClick: () => setState((prev) => Object.assign({}, prev, { autoSave: !prev.autoSave })),
					}, t('action.autoSave')),
					h('button', {
						key: 'revert',
						type: 'button',
						className: P + '-button',
						disabled: !dirty,
						onClick: revert,
					}, t('action.revert')),
					h('span', { className: P + '-hint', key: 'hint' }, t('shortcut.save')),
					h('button', {
						key: 'save',
						type: 'button',
						className: P + '-button ' + P + '-primary',
						disabled: !dirty || saving,
						onClick: () => void save({}),
					}, t('action.save')),
				]),
				body,
			])
		}

		/**
		 * Split a document resource address into the Session and path it carries.
		 *
		 * The address grammar is `dsh-resource://file/session/<sessionId>/<path>`,
		 * where the path keeps any leading slash. A malformed or non-Session
		 * address yields an empty result and the body falls back to the absolute
		 * path the resource metadata reports.
		 * @param address - the resource address under preview.
		 * @returns `{ sessionId, path }`, each present only when parseable.
		 */
		function splitAddress(address) {
			const text = String(address === undefined || address === null ? '' : address)
			const marker = '/session/'
			const at = text.indexOf(marker)
			if (at < 0) return {}
			const rest = text.slice(at + marker.length)
			const slash = rest.indexOf('/')
			if (slash <= 0) return {}
			return {
				sessionId: decodePart(rest.slice(0, slash)),
				path: decodePart(rest.slice(slash)),
			}
		}

		/**
		 * Decode one address segment, tolerating an already-decoded value.
		 * @param value - raw address text.
		 * @returns the decoded text, or the input when decoding fails.
		 */
		function decodePart(value) {
			try {
				return decodeURIComponent(value)
			} catch (error) {
				return value
			}
		}

		/** Service keys the browser half needs before it can register anything. */
		const inject = ['slots', 'documentPreviews', 'remote', 'locale']

		/**
		 * Register the editable implementation, its body, and its Remote
		 * contribution.
		 * @param ctx - the plugin's Client Cordis context.
		 */
		async function apply(ctx) {
			let translate = (key) => (EN[key] !== undefined ? EN[key] : key)
			try {
				ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN }), 'markdown-editor: locale')
				const bound = ctx.locale.bind(LOCALE_NS)
				translate = (key) => bound(key)
			} catch (error) {
				// A missing or renamed locale service must not cost the editor.
				console.warn('markdown-editor: locale registration failed', error)
			}
			const t = translate

			ctx.effect(() => ctx.documentPreviews.register({
				id: IMPLEMENTATION_ID,
				extensions: ['md', 'markdown', 'mdx'],
				priority: 'extension',
				title: () => t('viewer.label'),
				loading: 'bytes-complete',
				wrap: false,
			}), 'markdown-editor: metadata')

			// The contribution is owned by the Remote service, so an HMR reload of
			// this bundle must not mount it twice; one process-wide promise keeps
			// the namespace alive across reloads.
			const mounts = globalThis
			if (mounts.__DSH_CODEX_LIKE_MARKDOWN_REMOTE__ === undefined) {
				mounts.__DSH_CODEX_LIKE_MARKDOWN_REMOTE__ = ctx.remote.$mount(CONTRIBUTION).catch((error) => {
					if (String(messageOf(error)).indexOf('already registered') >= 0) return undefined
					mounts.__DSH_CODEX_LIKE_MARKDOWN_REMOTE__ = undefined
					throw error
				})
			}
			await mounts.__DSH_CODEX_LIKE_MARKDOWN_REMOTE__

			// A namespace is a `remote.<namespace>` child Service, readable only
			// from a context that injects it. Mounting comes first and the body is
			// registered inside that injected context, which is how the shipped
			// client consumes its own namespaces; without the mount there is no
			// writer, so there is no body to offer an editing pane that cannot save.
			const registration = ctx.inject(['remote.' + NAMESPACE, 'slots', 'documentPreviews', 'locale'], (bodyCtx) => {
				bodyCtx.slots.inject('sidebar.right.tab.document', () => bodyCtx.slots.register({
					name: 'sidebar.right.tab.document',
					key: IMPLEMENTATION_ID,
					locale: LOCALE_NS,
				}, createBody(bodyCtx.remote[NAMESPACE], t)))
			})
			// The returned thenable resolves when the injected context is ready;
			// a failure there must be visible rather than an unhandled rejection.
			if (registration !== undefined && registration !== null && typeof registration.catch === 'function') {
				registration.catch((error) => {
					console.warn('markdown-editor: could not offer the editing pane', error)
				})
			}
		}

		return { inject, apply }
	},
})
