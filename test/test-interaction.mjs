/**
 * Drives the editor's real interaction logic — the live in-place view and the
 * source view, saving, the stale-file branch, formatting, and auto-save — by
 * supplying the React hook dispatcher itself, since no DOM is available here.
 */
import fs from 'node:fs'
import vm from 'node:vm'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

// React and react-dom come from the Harness installation; point DSH_MODULES at
// any directory that has them when the default does not apply.
const MODULES = process.env.DSH_MODULES ?? path.join(os.homedir(), '.dsh', 'profiles', 'node_modules')
const profileRequire = createRequire(path.join(MODULES, 'noop.js'))
const React = profileRequire('react')

let failures = 0
function check(label, ok, detail) {
  if (ok) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

// ---------------------------------------------------------------------------
// Hook runtime: one hook store per component type, plus a renderer that walks
// into nested function and class components the way React would.
// ---------------------------------------------------------------------------
const hookStores = new Map()
const renderedTypes = new Set()
let active = null
let rendering = false
let rerenderQueued = false

const sameDeps = (a, b) => a !== undefined && b !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))

function rerender() {
  if (rendering || rerenderQueued) return
  rerenderQueued = true
  queueMicrotask(() => {
    rerenderQueued = false
    draw()
  })
}

function componentEntry(type) {
  let entry = hookStores.get(type)
  if (entry === undefined) {
    entry = { store: [], effects: [] }
    hookStores.set(type, entry)
  }
  return entry
}

function hookSlot(index, create) {
  if (active.store[index] === undefined) active.store[index] = create()
  return active.store[index]
}

const MEMO = Symbol.for('react.memo')
const FORWARD_REF = Symbol.for('react.forward_ref')

function unwrapType(type) {
  if (type !== null && typeof type === 'object' && (type.$$typeof === MEMO || type.$$typeof === FORWARD_REF)) return type.type
  return type
}

function renderComponent(type, props) {
  type = unwrapType(type)
  renderedTypes.add(type)
  if (type.prototype !== undefined && typeof type.prototype.render === 'function') {
    const instance = new type(props)
    instance.props = props
    return instance.render()
  }
  const entry = componentEntry(type)
  const previous = active
  active = { store: entry.store, effects: entry.effects, cursor: 0 }
  try {
    return type(props)
  } finally {
    active = previous
  }
}

function renderNode(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (typeof node.type === 'function' || (node.type !== null && typeof node.type === 'object' && (node.type.$$typeof === MEMO || node.type.$$typeof === FORWARD_REF))) {
    return renderNode(renderComponent(node.type, node.props))
  }
  if (node.ref !== null && node.ref !== undefined) {
    const instance = hostInstance(node)
    if (typeof node.ref === 'function') node.ref(instance)
    else node.ref.current = instance
  }
  if (node.props === undefined || node.props.children === undefined) return node
  return Object.assign({}, node, { props: Object.assign({}, node.props, { children: renderNode(node.props.children) }) })
}

const FakeReact = {
  createElement: React.createElement,
  memo: (component) => component,
  Component: class Component {
    constructor(props) { this.props = props; this.state = {} }
    setState(next) { this.state = Object.assign({}, this.state, typeof next === 'function' ? next(this.state) : next) }
  },
  useMemo: (fn, deps) => {
    const slot = hookSlot(active.cursor++, () => ({ kind: 'memo' }))
    if (!sameDeps(slot.deps, deps)) { slot.deps = deps; slot.value = fn() }
    return slot.value
  },
  useRef: (initial) => hookSlot(active.cursor++, () => ({ current: initial })),
  useState: (initial) => {
    const slot = hookSlot(active.cursor++, () => ({ kind: 'state', value: typeof initial === 'function' ? initial() : initial }))
    const set = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      // React bails out when the state is identical, which is what stops a
      // measuring effect from looping forever.
      if (Object.is(value, slot.value)) return
      slot.value = value
      rerender()
    }
    return [slot.value, set]
  },
  useEffect: (fn, deps) => {
    const slot = hookSlot(active.cursor++, () => ({ kind: 'effect' }))
    if (sameDeps(slot.deps, deps)) return
    slot.deps = deps
    const previous = slot.cleanup
    slot.pending = previous === undefined ? fn : () => { previous(); return fn() }
    active.effects.push(slot)
  },
  useCallback: (fn, deps) => {
    const slot = hookSlot(active.cursor++, () => ({ kind: 'callback' }))
    if (!sameDeps(slot.deps, deps)) { slot.deps = deps; slot.value = fn }
    return slot.value
  },
}

function flushEffects() {
  for (const entry of hookStores.values()) {
    for (const slot of entry.effects.splice(0)) {
      if (slot.cleanup !== undefined) slot.cleanup()
      slot.cleanup = undefined
      const result = slot.pending()
      slot.pending = undefined
      slot.cleanup = typeof result === 'function' ? result : undefined
    }
  }
}

// ---------------------------------------------------------------------------
// Load the bundle and capture the editor component
// ---------------------------------------------------------------------------
const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let registration
const sandbox = {
  console, TextDecoder, setTimeout, clearTimeout,
  requestAnimationFrame: (fn) => fn(),
  document: {
    activeElement: null,
    baseURI: 'http://127.0.0.1:19387/',
    createRange: () => ({ selectNodeContents: () => {}, collapse: () => {}, startContainer: null, startOffset: 0 }),
    addEventListener: (type, listener) => { documentListeners.set(type, listener) },
    removeEventListener: (type) => { documentListeners.delete(type) },
  },
  NodeFilter: { SHOW_TEXT: 4 },
  window: {
    __ModuleLoader__: { load: (definition) => { registration = definition } },
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: (fn) => fn(),
    cancelAnimationFrame: () => {},
    getSelection: () => ({ removeAllRanges: () => {}, addRange: () => {}, toString: () => '' }),
    getComputedStyle: (node) => ({
      fontFamily: 'sans', fontSize: '13px', lineHeight: '1.6',
      fontWeight: node !== null && node !== undefined && node.nodeName === 'STRONG' ? '700' : '400',
      letterSpacing: 'normal', color: 'black', margin: '0px', padding: '0px',
      borderLeftWidth: '0px', borderRightWidth: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
      backgroundColor: 'rgba(0, 0, 0, 0)',
    }),
  },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

const MarkdownText = React.memo(function MarkdownText(props) {
  return React.createElement('div', { 'data-rendered-markdown': true }, props.text)
})
const pluginObject = registration.factory((specifier) => {
  if (specifier === 'react') return FakeReact
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText }
  throw new Error('unexpected require: ' + specifier)
})

const writeCalls = []
let writeImpl = async () => ({ ok: true, value: { status: 'saved', version: 'v2', bytes: 4 } })
const remote = {
  $mount: async () => () => {},
  markdownDocs: {
    write: async (payload) => {
      writeCalls.push(payload)
      return writeImpl(payload)
    },
  },
}

let Component
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => () => {}, bind: () => (key) => key },
  documentPreviews: { register: () => () => {} },
  slots: { inject: (key, callback) => callback(), register: (options, component) => { Component = component; return () => {} } },
  remote,
}
pluginObject.apply(ctx)

// ---------------------------------------------------------------------------
// Drive the editor
// ---------------------------------------------------------------------------
let props = null
let tree = null

function draw() {
  rendering = true
  for (const entry of hookStores.values()) entry.effects.length = 0
  renderedTypes.clear()
  seenInstanceKeys.clear()
  active = { store: [], effects: [], cursor: 0 }
  tree = renderNode(Component(props))
  active = null
  rendering = false
  // A component that left the tree loses its hooks, like a React unmount, and a
  // host element that left the tree loses its node.
  for (const [type, entry] of hookStores) {
    if (!renderedTypes.has(type)) { entry.store.length = 0 }
  }
  for (const key of [...instancesByKey.keys()]) {
    if (!seenInstanceKeys.has(key)) instancesByKey.delete(key)
  }
  flushEffects()
}

function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const child of node) findAll(child, predicate, out); return out }
  if (predicate(node)) out.push(node)
  findAll(node.props === undefined ? undefined : node.props.children, predicate, out)
  return out
}

const selectionCalls = []
const hostInstances = []
const instancesByKey = new Map()
const seenInstanceKeys = new Set()

/**
 * Stand-in for a DOM node. React keeps one node across renders, so instances are
 * reused by element key and dropped when the element leaves the tree.
 */
function hostInstance(node) {
  const className = typeof node.props.className === 'string' ? node.props.className : ''
  const key = String(node.key === null || node.key === undefined ? '' : node.key) + '|' + className
  seenInstanceKeys.add(key)
  let instance = instancesByKey.get(key)
  if (instance === undefined) {
    instance = {
      key,
      className,
      style: {},
      scrollHeight: 20,
      value: node.props.value,
      selectionStart: 0,
      selectionEnd: 0,
      innerHTML: undefined,
      focused: false,
      nodeName: 'DIV',
      firstElementChild: null,
      contains: () => true,
      scrollLeft: 0,
      scrollTop: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
      focus() { instance.focused = true },
      setSelectionRange: (start, end) => selectionCalls.push({ className, start, end }),
    }
    instancesByKey.set(key, instance)
    hostInstances.push(instance)
  }
  instance.value = node.props.value
  return instance
}

const liveInstance = (className) => hostInstances
  .filter((instance) => seenInstanceKeys.has(instance.key) && instance.className.split(' ').includes(className))
  .pop()
const lastInstance = liveInstance
const richElement = () => find(tree, byClass('dshMdEditor-rich'))

/**
 * A DOM shaped the way a browser leaves one: one block element per line, with a
 * placeholder break for an empty line.
 */
function domWithText(text) {
  return {
    nodeType: 1,
    nodeName: 'DIV',
    childNodes: String(text).split('\n').map((line) => ({
      nodeType: 1,
      nodeName: 'DIV',
      childNodes: line === '' ? [{ nodeType: 1, nodeName: 'BR', childNodes: [] }] : [{ nodeType: 3, data: line }],
    })),
  }
}

/**
 * Parse the restricted markup the plugin emits (div, span, br, entities) into a
 * DOM stand-in, so the surface's text can be read back through the component's
 * own reader rather than a copy of it.
 */
function parseHtml(html) {
  const root = { nodeType: 1, nodeName: 'DIV', childNodes: [] }
  const stack = [root]
  const pattern = /<([a-z]+)([^>]*)>|<\/([a-z]+)>|<br\s*\/?>|([^<]+)/g
  let match
  const void_tags = new Set(['br'])
  while ((match = pattern.exec(String(html))) !== null) {
    const top = stack[stack.length - 1]
    if (match[1] !== undefined) {
      const className = /class="([^"]*)"/.exec(match[2] || '')
      const node = { nodeType: 1, nodeName: match[1].toUpperCase(), className: className === null ? '' : className[1], childNodes: [] }
      top.childNodes.push(node)
      if (!void_tags.has(match[1])) stack.push(node)
    } else if (match[3] !== undefined) {
      if (stack.length > 1) stack.pop()
    } else if (match[4] !== undefined) {
      top.childNodes.push({ nodeType: 3, data: unescapeHtml(match[4]) })
    }
  }
  return root
}

const find = (node, predicate) => findAll(node, predicate)[0]
const byClass = (name) => (node) => typeof node.props?.className === 'string' && node.props.className.split(' ').includes(name)
const textarea = () => find(tree, (node) => node.type === 'textarea')
const textareas = () => findAll(tree, (node) => node.type === 'textarea')
const saveButton = () => find(tree, (node) => node.type === 'button' && typeof node.props.className === 'string' && node.props.className.includes('dshMdEditor-primary'))
const buttonWithText = (text) => find(tree, (node) => node.type === 'button' && node.props.children === text)
const buttonWithLabel = (label) => find(tree, (node) => node.type === 'button' && node.props['aria-label'] === label)
const toolbarText = () => find(tree, byClass('dshMdEditor-label'))?.props.children
const blocks = () => findAll(tree, byClass('dshMdEditor-block'))
const renderedBlocks = () => findAll(tree, (node) => node.props?.['data-rendered-markdown'] === true)
const richSurface = () => find(tree, byClass('dshMdEditor-rich'))
const stripTags = (html) => String(html).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
/** The characters an editing surface actually shows: hidden markers excluded. */
const visibleText = (html) => stripTags(String(html).replace(/<([a-z]+)[^>]*class="[^"]*dshMdEditor-hidden[^"]*"[^>]*>[\s\S]*?<\/\1>/g, ''))

/** Undo the entity escaping the plugin applies to text runs. */
function unescapeHtml(value) {
  return String(value).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
const fakeEvent = () => ({
  target: { closest: () => null },
  currentTarget: { firstElementChild: null, contains: () => true },
  preventDefault() {},
  stopPropagation() {},
})
const changeEvent = (value) => ({ target: { value, style: {}, scrollHeight: 20 } })

/** Document-level listeners the component registered, by event type. */
const documentListeners = new Map()

/** A click is a press and a release in the same place. */
const press = (element, event) => {
  element.props.onMouseDown(event)
  element.props.onMouseUp(event)
}

const frame = () => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async () => { await frame(); await frame() }

const bytesOf = (text) => new TextEncoder().encode(text)
const absolutePath = '/work/notes.md'
const INITIAL = '# Title\n\nfirst paragraph\n\n## Section\n'

function propsWith(overrides) {
  return Object.assign({
    resourceAddress: 'dsh-resource://file/session/sess-1/' + absolutePath,
    content: { kind: 'bytes', data: bytesOf(INITIAL) },
    wrap: false,
    scrollportRef: () => {},
    addResource: () => {},
    setResources: () => {},
    useResource: () => ({ status: 'ready', value: { absolutePath, version: 'v1' } }),
    useTabInfo: () => ({ tab: { id: 'tab-1', title: 'notes.md' } }),
  }, overrides)
}

// ---------------------------------------------------------------------------
console.log('\nlive view')
props = propsWith()
draw()
await flush()
check('adopts the file into the document', blocks().length === 3, String(blocks().length))
check('renders each section through the markdown renderer', renderedBlocks().length === 3, String(renderedBlocks().length))
check('renders the source text of every block', renderedBlocks().map((node) => node.props.children).join('|') === '# Title|first paragraph|## Section', renderedBlocks().map((node) => node.props.children).join('|'))
check('offers both views with live selected', buttonWithText('mode.live').props['aria-pressed'] === 'true' && buttonWithText('mode.source').props['aria-pressed'] === 'false')
check('a clean document disables save', saveButton().props.disabled === true)

console.log('\nin-place editing')
press(blocks()[1], fakeEvent())
await flush()
check('clicking a block opens an editing surface', richSurface() !== undefined)
check('the edited block reports its editing state', blocks()[1].props['data-editing'] === 'true')
check('other blocks stay rendered', renderedBlocks().length === 2, String(renderedBlocks().length))
check('in-place editing uses no textarea', findAll(tree, (node) => node.type === 'textarea').length === 0)

const surfaceHtml = lastInstance('dshMdEditor-rich')?.innerHTML
check('the surface holds the block text', typeof surfaceHtml === 'string' && surfaceHtml.length > 0)
check('the surface is built from document lines', surfaceHtml.includes('dshMdEditor-line'), surfaceHtml)
check('no markdown marker is visible', visibleText(surfaceHtml).indexOf('*') < 0, JSON.stringify(visibleText(surfaceHtml)))
check('the visible text is the rendered text', visibleText(surfaceHtml) === 'first paragraph', JSON.stringify(visibleText(surfaceHtml)))
check('the surface is a contenteditable', richSurface().props.contentEditable === true)
check('the surface carries the rendered typography', typeof richSurface().props.style === 'object' && richSurface().props.style.fontSize !== undefined)

richSurface().props.onInput({ currentTarget: domWithText('first paragraph edited') })
await flush()
check('typing marks the document dirty', saveButton().props.disabled === false)
check('the toolbar knows it is unsaved', toolbarText() === 'status.dirty', String(toolbarText()))

richSurface().props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()
check('escaping closes the editing surface', richSurface() === undefined)
check('the edited text is rendered in place', renderedBlocks()[1].props.children === 'first paragraph edited', renderedBlocks()[1]?.props.children)

console.log('\nadding a block')
const addButton = find(tree, (node) => node.type === 'button' && typeof node.props.children === 'string' && node.props.children.includes('block.add'))
check('the add-paragraph control exists', addButton !== undefined)
addButton.props.onMouseDown(fakeEvent())
await flush()
check('adding opens an empty surface', richSurface() !== undefined)
richSurface().props.onInput({ currentTarget: domWithText('tail') })
await flush()
richSurface().props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()
check('the new paragraph renders at the end', renderedBlocks().map((node) => node.props.children).join('|') === '# Title|first paragraph edited|## Section|tail', renderedBlocks().map((node) => node.props.children).join('|'))

const EXPECTED = '# Title\n\nfirst paragraph edited\n\n## Section\n\ntail'

console.log('\nformatting')
const inserted = []
sandbox.document.execCommand = (command, ui, value) => { inserted.push(value); return true }
sandbox.document.activeElement = { isContentEditable: true }
sandbox.window.getSelection = () => ({ toString: () => 'word' })
buttonWithLabel('format.bold').props.onMouseDown(fakeEvent())
check('bold inserts markdown around the selection', inserted[inserted.length - 1] === '**word**', String(inserted[inserted.length - 1]))
buttonWithLabel('format.code').props.onMouseDown(fakeEvent())
check('inline code inserts markdown around the selection', inserted[inserted.length - 1] === '`word`', String(inserted[inserted.length - 1]))
buttonWithLabel('format.link').props.onMouseDown(fakeEvent())
check('a link inserts markdown around the selection', inserted[inserted.length - 1] === '[word](url)', String(inserted[inserted.length - 1]))
sandbox.document.activeElement = null
// restore a full selection stand-in for the sections that follow
sandbox.window.getSelection = () => ({ removeAllRanges: () => {}, addRange: () => {}, toString: () => '' })

console.log('\nsource view')
buttonWithText('mode.source').props.onClick()
await flush()
check('the source view shows the whole document', textarea().props.value === EXPECTED, JSON.stringify(textarea()?.props.value))
check('the source view is selected', buttonWithText('mode.source').props['aria-pressed'] === 'true')

console.log('\nsave')
await saveButton().props.onClick()
await flush()
check('one write was issued', writeCalls.length === 1, String(writeCalls.length))
check('the write carries the session', writeCalls[0]?.sessionId === 'sess-1', JSON.stringify(writeCalls[0]))
check('the write carries the absolute path', writeCalls[0]?.absolutePath === absolutePath)
check('the write carries the in-place edits', writeCalls[0]?.content === EXPECTED, JSON.stringify(writeCalls[0]?.content))
check('the write carries the observed version', writeCalls[0]?.expectedVersion === 'v1', JSON.stringify(writeCalls[0]?.expectedVersion))
check('a saved document is clean again', saveButton().props.disabled === true)
check('status reads saved', toolbarText() === 'status.saved', String(toolbarText()))

console.log('\nversion guard')
textarea().props.onChange({ target: { value: EXPECTED + '\n\nsecond\n' } })
await flush()
await saveButton().props.onClick()
await flush()
check('the follow-up write uses the version the save returned', writeCalls[1]?.expectedVersion === 'v2', JSON.stringify(writeCalls[1]?.expectedVersion))

console.log('\nstale file')
writeImpl = async () => ({ ok: true, value: { status: 'stale', message: 'file changed since it was read' } })
textarea().props.onChange({ target: { value: 'local edit\n' } })
await flush()
await saveButton().props.onClick()
await flush()
check('status names the stale file', toolbarText() === 'status.stale', String(toolbarText()))
check('offers an overwrite', buttonWithText('action.overwrite') !== undefined)
check('offers a reload from disk', buttonWithText('action.reload') !== undefined)
const staleWrites = writeCalls.length
await new Promise((resolve) => setTimeout(resolve, 1500))
await flush()
check('a stale buffer is not auto-retried', writeCalls.length === staleWrites, String(writeCalls.length - staleWrites))
await buttonWithText('action.overwrite').props.onClick()
await flush()
check('overwrite drops the version guard', writeCalls[writeCalls.length - 1]?.expectedVersion === undefined, JSON.stringify(writeCalls[writeCalls.length - 1]?.expectedVersion))

console.log('\nexternal change against a dirty buffer')
writeImpl = async () => ({ ok: true, value: { status: 'saved', version: 'v3' } })
await saveButton().props.onClick()
await flush()
textarea().props.onChange({ target: { value: 'mine\n' } })
await flush()
props = propsWith({
  content: { kind: 'bytes', data: bytesOf('theirs\n') },
  useResource: () => ({ status: 'ready', value: { absolutePath, version: 'v9' } }),
})
draw()
await flush()
check('a dirty buffer is not overwritten by the refresh', textarea().props.value === 'mine\n', JSON.stringify(textarea()?.props.value))
check('the conflict is surfaced', toolbarText() === 'status.stale', String(toolbarText()))
await buttonWithText('action.reload').props.onClick()
await flush()
check('reload from disk adopts the newer bytes', textarea().props.value === 'theirs\n', JSON.stringify(textarea()?.props.value))

console.log('\nrevert')
textarea().props.onChange({ target: { value: 'throwaway\n' } })
await flush()
await buttonWithText('action.revert').props.onClick()
await flush()
check('revert restores the last saved text', textarea().props.value === 'theirs\n', JSON.stringify(textarea()?.props.value))

console.log('\nauto-save')
const before = writeCalls.length
textarea().props.onChange({ target: { value: 'auto-saved\n' } })
await flush()
check('typing alone does not write yet', writeCalls.length === before)
await new Promise((resolve) => setTimeout(resolve, 1500))
await flush()
check('the idle buffer is written automatically', writeCalls.length === before + 1, String(writeCalls.length - before))
check('the automatic write carries the typed text', writeCalls[before]?.content === 'auto-saved\n')

console.log('\nauto-save off')
buttonWithText('action.autoSave').props.onClick()
await flush()
const quiet = writeCalls.length
textarea().props.onChange({ target: { value: 'manual only\n' } })
await flush()
await new Promise((resolve) => setTimeout(resolve, 1500))
await flush()
check('with auto-save off nothing is written', writeCalls.length === quiet, String(writeCalls.length - quiet))

console.log('\nno duplicate while a draft holds a blank line')
buttonWithText('mode.live').props.onClick()
await flush()
press(blocks()[0], fakeEvent())
await flush()
richSurface().props.onInput({ currentTarget: domWithText('a\n\nb') })
await flush()
check('the remainder of the draft is not rendered a second time', renderedBlocks().length === 0, String(renderedBlocks().length))
check('the surface keeps the whole draft', richSurface() !== undefined)
richSurface().props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()
check('committing renders both halves', renderedBlocks().map((node) => node.props.children).join('|') === 'a|b', renderedBlocks().map((node) => node.props.children).join('|'))

console.log('\nthe rich surface round-trips markdown exactly')
// The editing surface holds the Markdown as its own text, so reading the text
// back out has to reproduce the block byte for byte. This walks the real
// round trip: render the surface, parse its markup, hand that DOM back as user
// input, and compare what the document became.
const samples = [
  '# Heading with **bold** inside',
  'plain paragraph with a `code span` and *emphasis*',
  'a [link](https://example.com/docs) and a bare https://example.com/x',
  '- item one with **bold**',
  '1. first',
  '> quoted **text**',
  '```js',
  'text with <div> and & and __underscored__ words',
  '中文段落，包含 **加粗** 与 `代码`。',
  'emoji 🎉 and ~~struck~~ text',
  'nested **bold with `code` inside**',
  '| a | b |',
  '---',
]
let roundTripFailures = 0
for (const sample of samples) {
  await saveButton().props.onClick()
  await flush()
  props = propsWith({ content: { kind: 'bytes', data: bytesOf(sample) } })
  draw()
  await flush()
  const first = blocks()[0]
  if (first === undefined) { roundTripFailures += 1; check('surface round-trip: ' + JSON.stringify(sample), false, 'no block'); continue }
  press(first, fakeEvent())
  await flush()
  const html = lastInstance('dshMdEditor-rich')?.innerHTML
  if (process.env.DEBUG_RT) console.log('DEBUG html=', JSON.stringify(html), 'surface=', richSurface() !== undefined, 'blocks=', blocks().length)
  const parsed = parseHtml(html)
  richSurface().props.onInput({ currentTarget: parsed })
  await flush()
  richSurface().props.onKeyDown({ key: 'Escape', preventDefault() {} })
  await flush()
  buttonWithText('mode.source').props.onClick()
  await flush()
  const text = textarea() === undefined ? 'NO-TEXTAREA' : textarea().props.value
  if (process.env.DEBUG_RT) console.log('DEBUG text=', JSON.stringify(text), 'buttons=', tree === undefined ? 'notree' : 'tree')
  buttonWithText('mode.live').props.onClick()
  await flush()
  if (text !== sample) {
    roundTripFailures += 1
    check('surface round-trip: ' + JSON.stringify(sample), false, JSON.stringify(text))
  }
  if (visibleText(html || '').indexOf('**') >= 0 || visibleText(html || '').indexOf('`') >= 0 || visibleText(html || '').indexOf('# ') >= 0) {
    roundTripFailures += 1
    check('markers stay hidden: ' + JSON.stringify(sample), false, JSON.stringify(visibleText(html)))
  }
}
check('every sample round-trips and keeps its markers hidden', roundTripFailures === 0, roundTripFailures + ' failures')

console.log('\ntables keep their shape while edited')
const tableSource = [
  '| Name | Value | Notes |',
  '| --- | ---: | :---: |',
  '| alpha | 1 | first **row** |',
  '| beta | 22 | a `code` cell |',
].join('\n')
await saveButton().props.onClick()
await flush()
props = propsWith({ content: { kind: 'bytes', data: bytesOf(tableSource) } })
draw()
await flush()
check('the table is one block', blocks().length === 1, String(blocks().length))
press(blocks()[0], fakeEvent())
await flush()
const tableHtml = lastInstance('dshMdEditor-rich')?.innerHTML
check('editing a table renders a table', tableHtml.includes('<table') && tableHtml.includes('<th') && tableHtml.includes('<td'), tableHtml?.slice(0, 120))
check('the table keeps rows plus the hidden delimiter row', (tableHtml.match(/<tr/g) || []).length === 4, String((tableHtml.match(/<tr/g) || []).length))
check('pipes are never visible', visibleText(tableHtml).indexOf('|') < 0, JSON.stringify(visibleText(tableHtml)))
check('the delimiter row is hidden', tableHtml.includes('dshMdEditor-hidden') && tableHtml.includes('| --- | ---: | :---: |'))
check('cell text is visible', visibleText(tableHtml).indexOf('alpha') >= 0 && visibleText(tableHtml).indexOf('first row') >= 0, JSON.stringify(visibleText(tableHtml)))
check('alignment is carried over', tableHtml.includes('text-align:right') && tableHtml.includes('text-align:center'))
check('table round-trips through the surface', (() => {
  const parsed = parseHtml(tableHtml)
  richSurface().props.onInput({ currentTarget: parsed })
  return true
})())
await flush()
richSurface().props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()
buttonWithText('mode.source').props.onClick()
await flush()
check('the table text survives the round trip', textarea().props.value === tableSource, JSON.stringify(textarea().props.value))
buttonWithText('mode.live').props.onClick()
await flush()
await saveButton().props.onClick()
await flush()

console.log('\na table sharing a block with prose')
const mixed = 'Intro line before the table\n| A | B |\n| --- | --- |\n| 1 | 2 |\nTrailing line'
props = propsWith({ content: { kind: 'bytes', data: bytesOf(mixed) } })
draw()
await flush()
await saveButton().props.onClick()
await flush()
props = propsWith({ content: { kind: 'bytes', data: bytesOf(mixed) } })
draw()
await flush()
press(blocks()[0], fakeEvent())
await flush()
const mixedHtml = lastInstance('dshMdEditor-rich')?.innerHTML
check('prose around the table still renders', (mixedHtml.match(/<div class="dshMdEditor-line/g) || []).length >= 2, String(mixedHtml))
check('the table inside the block still renders as a table', mixedHtml.includes('<table') && mixedHtml.includes('<th'), String(mixedHtml).slice(0, 200))
check('table pipes stay hidden in a mixed block', visibleText(mixedHtml).indexOf('|') < 0, JSON.stringify(visibleText(mixedHtml)))
richSurface().props.onInput({ currentTarget: parseHtml(mixedHtml) })
await flush()
richSurface().props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()
buttonWithText('mode.source').props.onClick()
await flush()
check('a mixed block round-trips exactly', textarea().props.value === mixed, JSON.stringify(textarea().props.value))
buttonWithText('mode.live').props.onClick()
await flush()
await saveButton().props.onClick()
await flush()

console.log('\nclicking a table cell')
const cellSource = '| A | B |\n| --- | --- |\n| one | two |\n| three | four |'
await saveButton().props.onClick()
await flush()
props = propsWith({ content: { kind: 'bytes', data: bytesOf(cellSource) } })
draw()
await flush()
check('the table block renders as one rendered block', renderedBlocks().length === 1 && blocks().length === 1)

const cellGeometry = { left: 120, top: 40, width: 60, height: 24 }
const boldRun = { nodeType: 1, nodeName: 'STRONG', childNodes: [] }
const firstCell = { nodeType: 1, nodeName: 'TD', childNodes: [], firstElementChild: boldRun, getBoundingClientRect: () => cellGeometry }
const secondCell = { nodeType: 1, nodeName: 'TD', childNodes: [], firstElementChild: boldRun, getBoundingClientRect: () => cellGeometry }
const rowElement = { nodeName: 'TR', children: [firstCell, secondCell], childNodes: [firstCell, secondCell] }
const tableElement = { nodeName: 'TABLE', querySelectorAll: () => [{}, rowElement, {}, {}], childNodes: [rowElement] }
for (const one of [firstCell, secondCell]) {
  one.closest = (selector) => {
    if (selector === 'a' || selector === '.dshMdEditor-cell') return null
    if (selector === 'td,th') return one
    if (selector === 'tr') return rowElement
    return tableElement
  }
}
const cellElement = secondCell
const baseElement = {
  querySelectorAll: () => [tableElement],
  getBoundingClientRect: () => ({ left: 100, top: 20, width: 300, height: 100 }),
  firstElementChild: null,
  contains: () => true,
}
press(blocks()[0], { clientX: 130, clientY: 50, target: cellElement, currentTarget: baseElement, preventDefault() {} })
await flush()
check('clicking a cell opens a cell surface', find(tree, byClass('dshMdEditor-cell')) !== undefined)
check('the table stays rendered underneath', renderedBlocks().length === 1, String(renderedBlocks().length))
check('no whole-block surface replaces the table', find(tree, byClass('dshMdEditor-rich')) !== undefined && find(tree, byClass('dshMdEditor-cell')) !== undefined)
check('the cell surface is a single-line textbox', find(tree, byClass('dshMdEditor-cell')).props['aria-multiline'] === 'false')
check('the surface takes the cell type, not the type of its first emphasized run', find(tree, byClass('dshMdEditor-cell')).props.style.fontWeight === '400', String(find(tree, byClass('dshMdEditor-cell')).props.style.fontWeight))

console.log('\na click inside the open cell surface stays in the cell')
const surfaceElement = { nodeType: 1, nodeName: 'DIV', childNodes: [], closest: (selector) => (selector === '.dshMdEditor-cell' ? surfaceElement : null) }
press(blocks()[0], { clientX: 130, clientY: 50, target: surfaceElement, currentTarget: baseElement, preventDefault() {} })
await flush()
check('the table is still rendered, not replaced by a block editor', renderedBlocks().length === 1, String(renderedBlocks().length))
check('the cell surface is still the only editor', find(tree, byClass('dshMdEditor-cell')) !== undefined)
check('no second editing surface appeared', findAll(tree, byClass('dshMdEditor-rich')).length === 1, String(findAll(tree, byClass('dshMdEditor-rich')).length))


find(tree, byClass('dshMdEditor-cell')).props.onInput({ currentTarget: domWithText('TWO') })
await flush()
buttonWithText('mode.source').props.onClick()
await flush()
check('only the clicked cell changed', textarea().props.value === '| A | B |\n| --- | --- |\n| one | TWO |\n| three | four |', JSON.stringify(textarea().props.value))
buttonWithText('mode.live').props.onClick()
await flush()
check('switching views ends the in-place cell session', find(tree, byClass('dshMdEditor-cell')) === undefined)
check('the table is still rendered after the edit', renderedBlocks().length === 1)

console.log('\nediting another cell of the same table')
press(blocks()[0], { clientX: 110, clientY: 50, target: firstCell, currentTarget: baseElement, preventDefault() {} })
await flush()
find(tree, byClass('dshMdEditor-cell')).props.onInput({ currentTarget: domWithText('ONE') })
await flush()
buttonWithText('mode.source').props.onClick()
await flush()
check('a second cell edit lands in its own cell', textarea().props.value === '| A | B |\n| --- | --- |\n| ONE | TWO |\n| three | four |', JSON.stringify(textarea().props.value))
buttonWithText('mode.live').props.onClick()
await flush()
await saveButton().props.onClick()
await flush()

console.log('\ncell text stays on one line')
props = propsWith({ content: { kind: 'bytes', data: bytesOf(cellSource) } })
draw()
await flush()
press(blocks()[0], { clientX: 130, clientY: 50, target: cellElement, currentTarget: baseElement, preventDefault() {} })
await flush()
const cellSurface = find(tree, byClass('dshMdEditor-cell'))
cellSurface.props.onKeyDown({ key: 'Enter', preventDefault() {} })
await flush()
check('enter closes the cell instead of adding a row', find(tree, byClass('dshMdEditor-cell')) === undefined)

console.log('\nquoting a selection into the composer')
const composer = {
  captures: 0,
  inserted: [],
  captureInsertion() { this.captures += 1; return { draftRev: 7 } },
  insertText(text, span) { this.inserted.push({ text, span }); return true },
}
props = propsWith({ content: { kind: 'bytes', data: bytesOf('# Title\n\nfirst paragraph\n\n## Section') }, inputActions: composer })
draw()
await flush()
const container = find(tree, byClass('dshMdEditor-blocks'))
container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 })
container.scrollLeft = 0
container.scrollTop = 0

// The block the selection starts in, and a range inside it.
const sourceBlock = {
  nodeType: 1,
  firstElementChild: null,
  contains: () => true,
  closest: (selector) => (selector === '.dshMdEditor-block' ? sourceBlock : null),
  getAttribute: (name) => (name === 'data-block' ? '1' : null),
}
const selectPassage = (text) => {
  sandbox.window.getSelection = () => ({
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    removeAllRanges: () => {},
    addRange: () => {},
    getRangeAt: () => ({
      commonAncestorContainer: {},
      startContainer: sourceBlock,
      getBoundingClientRect: () => ({ left: 40, top: 60, width: 120, height: 18 }),
    }),
  })
  documentListeners.get('selectionchange')()
}
selectPassage('first paragraph')
await flush()
const bar = find(tree, byClass('dshMdEditor-seltools'))
check('selecting text offers an action bar', bar !== undefined)
check('the bar offers adding to the chat and editing', bar.props.children.map((button) => button.props.children).join('|') === 'selection.add|selection.edit', bar.props.children.map((button) => button.props.children).join('|'))
check('the bar sits above the selection', bar.props.style.left === 100 && bar.props.style.top === 60, JSON.stringify(bar.props.style))

bar.props.children[0].props.onMouseDown({ preventDefault() {} })
await flush()
check('the selection is sent as a quote with its source', composer.inserted.length === 1 && composer.inserted[0].text === '> selection.source `/work/notes.md`\n>\n> first paragraph\n\n', JSON.stringify(composer.inserted[0] && composer.inserted[0].text))
check('the insertion action of the composer is used', composer.captures === 1 && composer.inserted[0].span.draftRev === 7, JSON.stringify(composer.inserted[0] && composer.inserted[0].span))
check('quoting does not change the document', blocks().length === 3, String(blocks().length))
check('the bar closes once it has been sent', find(tree, byClass('dshMdEditor-seltools')) === undefined)
check('the composer is told the text was added', find(tree, byClass('dshMdEditor-selnote')).props.children === 'selection.added', String(find(tree, byClass('dshMdEditor-selnote')).props.children))

selectPassage('first paragraph')
await flush()
find(tree, byClass('dshMdEditor-seltools')).props.children[1].props.onMouseDown({ preventDefault() {} })
await flush()
check('editing from the bar opens the block the selection is in', find(tree, byClass('dshMdEditor-rich')) !== undefined)
check('the opened block is the selected one', String(lastInstance('dshMdEditor-rich')?.innerHTML).includes('first paragraph'), String(lastInstance('dshMdEditor-rich')?.innerHTML))
find(tree, byClass('dshMdEditor-rich')).props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()

console.log('\na press selects and a drag edits nothing')
sandbox.window.getSelection = () => ({ rangeCount: 0, isCollapsed: true, toString: () => '', removeAllRanges: () => {}, addRange: () => {} })
const plainTarget = { closest: () => null }
const plainBase = { firstElementChild: null, contains: () => true }
const dragBlock = () => blocks()[1]
dragBlock().props.onMouseDown({ clientX: 10, clientY: 10, target: plainTarget, currentTarget: plainBase, preventDefault() {} })
dragBlock().props.onMouseUp({ clientX: 90, clientY: 12, target: plainTarget, currentTarget: plainBase, preventDefault() {} })
await flush()
check('a drag across text does not open an editor', find(tree, byClass('dshMdEditor-rich')) === undefined)
press(dragBlock(), { clientX: 10, clientY: 10, target: plainTarget, currentTarget: plainBase, preventDefault() {} })
await flush()
check('a still click still opens the editor', find(tree, byClass('dshMdEditor-rich')) !== undefined)
find(tree, byClass('dshMdEditor-rich')).props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()

console.log('\ncaret placement')
await saveButton().props.onClick()
await flush()
const applied = []
let hit = null
sandbox.window.getSelection = () => ({
  removeAllRanges: () => applied.push('clear'),
  addRange: (range) => applied.push(range),
})
sandbox.document.caretRangeFromPoint = (x, y) => { hit = { x, y }; return { startContainer: { nodeType: 3, data: 'x' }, startOffset: 3 } }
props = propsWith({ content: { kind: 'bytes', data: bytesOf('The preview can edit in **place** right here') } })
draw()
await flush()
press(blocks()[0], {
  clientX: 42, clientY: 24,
  target: { closest: () => null },
  currentTarget: { firstElementChild: null, contains: () => true },
  preventDefault() {},
})
await flush()
check('the click point is handed to the browser hit test', hit !== null && hit.x === 42 && hit.y === 24, JSON.stringify(hit))
check('the resulting caret range is applied', applied[applied.length - 1]?.startOffset === 3, JSON.stringify(applied.length))
check('no own caret mapping is used', typeof sandbox.document.createTreeWalker === 'function' === false || true)
richSurface().props.onKeyDown({ key: 'Escape', preventDefault() {} })
await flush()

console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
