/**
 * Renders the plugin's document body with the real React, so a render-time
 * crash (a missing prop, a bad element, a hook misuse) fails here instead of in
 * the user's slot entry. The Markdown renderer is stood in for, because the
 * shipped one is a browser bundle.
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
const ReactDOMServer = profileRequire('react-dom/server')

let failures = 0
function check(label, ok, detail) {
  if (ok) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

function loadBundle(withRenderer) {
  const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let registration
  const sandbox = {
    console, TextDecoder,
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    document: { activeElement: null, baseURI: 'http://127.0.0.1:19387/' },
    window: { __ModuleLoader__: { load: (definition) => { registration = definition } }, addEventListener: () => {}, removeEventListener: () => {}, requestAnimationFrame: (fn) => fn(), cancelAnimationFrame: () => {} },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  const MarkdownText = React.memo(function MarkdownText(props) {
    return React.createElement('div', { 'data-rendered-markdown': true }, props.text)
  })
  const pluginObject = registration.factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      if (!withRenderer) throw new Error('renderer unavailable')
      return { MarkdownText }
    }
    throw new Error('unexpected require: ' + specifier)
  })
  let Body
  let dictionaries
  const usedKeys = []
  const ctx = {
    effect: (fn) => { fn(); return () => {} },
    locale: {
      register: (ns, dicts) => { dictionaries = dicts; return () => {} },
      bind: () => (key) => { usedKeys.push(key); return key },
    },
    documentPreviews: { register: () => () => {} },
    slots: { inject: (key, callback) => callback(), register: (options, component) => { Body = component; return () => {} } },
    remote: { $mount: async () => () => {} },
  }
  pluginObject.apply(ctx)
  return { Body, dictionaries, usedKeys, pluginObject, sandbox }
}

const bytesOf = (text) => new TextEncoder().encode(text)
const baseProps = (overrides) => Object.assign({
  resourceAddress: 'dsh-resource://file/session/sess-1//work/notes.md',
  content: { kind: 'bytes', data: bytesOf('# Title\n\nfirst paragraph\n\n## Section\n\n- one\n- two\n') },
  wrap: false,
  scrollportRef: () => {},
  addResource: () => {},
  setResources: () => {},
  useResource: () => ({ status: 'ready', value: { absolutePath: '/work/notes.md', version: 'v1' } }),
  useTabInfo: () => ({ tab: { id: 'tab-1', title: 'notes.md' } }),
}, overrides)

const { Body, dictionaries, usedKeys } = loadBundle(true)
check('body component captured', typeof Body === 'function')

function render(props) {
  usedKeys.length = 0
  return ReactDOMServer.renderToStaticMarkup(React.createElement(Body, props))
}

console.log('\nlive view')
let html
try {
  html = render(baseProps())
  check('renders without throwing', true)
} catch (error) {
  check('renders without throwing', false, error.message)
}
// Server rendering runs no effects, so the buffer is still empty here: this
// asserts the empty state. Block rendering is covered by the interaction suite.
check('an unloaded buffer shows the empty state, not a raw textarea', html.includes('block.empty') && html.includes('<textarea') === false)
check('the empty state is labelled without a hover tooltip', html.includes('aria-label="block.hint"') && html.includes('title="block.hint"') === false)
check('offers the live and source views', html.includes('>mode.live<') && html.includes('>mode.source<'))
check('offers save / revert / auto-save', html.includes('action.save') && html.includes('action.revert') && html.includes('action.autoSave'))
check('offers formatting actions', html.includes('format.bold') && html.includes('format.italic') && html.includes('format.code') && html.includes('format.link'))
check('styles are scoped to the plugin prefix', html.includes('.dshMdEditor-root'))
check('styles use only theme tokens', !/#[0-9a-fA-F]{3,6}\b/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, '')))
check('the rendered surface is labelled without a hover tooltip', html.includes('aria-label="block.hint"') && html.includes('title="block.hint"') === false)
check('save is disabled until the buffer is dirty', /<button[^>]*disabled[^>]*>action\.save/.test(html))

console.log('\nmode fallback')
const fallback = loadBundle(false)
const fallbackHtml = ReactDOMServer.renderToStaticMarkup(React.createElement(fallback.Body, baseProps()))
check('without the renderer a source editor still renders', fallbackHtml.includes('<textarea') && fallbackHtml.includes('dshMdEditor-input'))
check('without the renderer the live view is not offered', fallbackHtml.includes('>mode.live<') === false)

console.log('\nprop shapes')
const shapes = [
  ['no metadata yet', baseProps({ useResource: () => undefined })],
  ['metadata without a value', baseProps({ useResource: () => ({ status: 'none' }) })],
  ['content still loading', baseProps({ content: undefined })],
  ['a non-bytes content kind', baseProps({ content: { kind: 'text', text: 'x', pages: [], eof: true } })],
  ['no tab hook', baseProps({ useTabInfo: undefined })],
  ['no scrollport ref', baseProps({ scrollportRef: undefined })],
  ['a non-session address', baseProps({ resourceAddress: 'dsh-resource://file/absolute//tmp/x.md' })],
  ['invalid UTF-8 bytes', baseProps({ content: { kind: 'bytes', data: Uint8Array.from([0xff, 0xfe, 0x41]) } })],
  ['an empty file', baseProps({ content: { kind: 'bytes', data: bytesOf('') } })],
  ['an unclosed code fence', baseProps({ content: { kind: 'bytes', data: bytesOf('```js\nlet a = 1\n\n\n') } })],
  ['windows line endings', baseProps({ content: { kind: 'bytes', data: bytesOf('# a\r\n\r\nb\r\n') } })],
]
for (const [label, props] of shapes) {
  try {
    const output = render(props)
    check(label, typeof output === 'string' && output.includes('dshMdEditor-root'))
  } catch (error) {
    check(label, false, error.message)
  }
}

console.log('\nlocale')
check('registers an en dictionary', dictionaries?.en !== undefined)
check('registers a zh dictionary', dictionaries?.zh !== undefined)
const enKeys = Object.keys(dictionaries?.en ?? {}).sort()
const zhKeys = Object.keys(dictionaries?.zh ?? {}).sort()
check('en and zh declare the same keys', JSON.stringify(enKeys) === JSON.stringify(zhKeys), JSON.stringify([enKeys, zhKeys]))
render(baseProps())
const missing = [...new Set(usedKeys)].filter((key) => dictionaries?.en?.[key] === undefined)
check('every rendered label resolves in the dictionary', missing.length === 0, missing.join(', '))
check('the renderer labels cover the markdown primitive contract', ['code.copy', 'code.copied', 'codeBlock.title', 'codeBlock.wrap', 'codeBlock.unwrap', 'footnotes'].every((key) => dictionaries.en[key] !== undefined))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
