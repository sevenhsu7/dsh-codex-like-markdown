/**
 * Exercises the plugin's host half against the real runtime packages extracted
 * from the shipped app: real Cordis, the real Typert registry that the Gateway
 * reads descriptors from, and the real local filesystem backend.
 *
 * The host half cannot be re-loaded without restarting the app, so this is the
 * safety net that has to pass before the bundle is installed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as plugin from '../index.js'

/** The manifest is the source of truth for every name the bundle registers. */
const NAME = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-md-editor-'))
const file = path.join(workspace, 'notes.md')
fs.writeFileSync(file, '# hello\n')

let failures = 0
function check(label, ok, detail) {
  if (ok) {
    console.log('  ok   ' + label)
    return
  }
  failures += 1
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' — ' + detail))
}

const root = new Context()
root.provide('sessions', {
  get: (id) => (id === 'sess-1' ? { header: { cwd: workspace } } : undefined),
})
root.provide('sandboxPolicy', { workspaceRoot: workspace })

await root.plugin(TypertRegistry)
await root.plugin(LocalFileSystem)
console.log('mounted:', typeof root.get('fs')?.writeText === 'function' ? 'ctx.fs' : 'NO ctx.fs', typeof root.get('typert')?.register === 'function' ? 'ctx.typert' : 'NO ctx.typert')

await root.plugin(plugin)

console.log('\nregistration')
const service = root.get('markdownDocs')
check('plugin provided the markdownDocs service', service !== undefined && typeof service.write === 'function')

// The Gateway reads this binding before dispatch: gateway/binding-invalid otherwise.
const original = service
const binding = original.typertRemote
check('service carries a typertRemote binding', binding !== undefined)
check('binding points at the service object', binding?.service === original, String(binding?.service))
check('binding serviceKey matches the Cordis service key', binding?.serviceKey === 'markdownDocs', String(binding?.serviceKey))
check('binding namespace matches the descriptor namespace', binding?.namespace === 'markdownDocs', String(binding?.namespace))
check('binding is frozen', binding !== undefined && Object.isFrozen(binding))

const descriptor = root.typert.local.get('markdownDocs/write')
check('descriptor is registered under markdownDocs/write', descriptor !== undefined)
check('descriptor service is markdownDocs', descriptor?.service === 'markdownDocs')
check('descriptor declares a strict-cancellation signal', descriptor?.cancellation?.parameter === 'signal')
check('descriptor argument wire is "request"', descriptor?.parameters?.[0]?.wire === 'request')

console.log('\nwrite')
const saved = await service.write({ sessionId: 'sess-1', absolutePath: file, content: '# hello\nworld\n' })
check('write reports saved', saved?.status === 'saved', JSON.stringify(saved))
check('file content replaced', fs.readFileSync(file, 'utf8') === '# hello\nworld\n')
check('result carries the new version', typeof saved?.version === 'string' && saved.version.length > 0, JSON.stringify(saved))
check('result carries the absolute path', saved?.absolutePath === file, String(saved?.absolutePath))
check('result carries the byte count', saved?.bytes === 14, String(saved?.bytes))

console.log('\nversion guard')
const stale = await service.write({ sessionId: 'sess-1', absolutePath: file, content: 'x', expectedVersion: 'not-the-version' })
check('stale version is refused', stale?.status === 'stale', JSON.stringify(stale))
check('refused write left the file alone', fs.readFileSync(file, 'utf8') === '# hello\nworld\n')

const fresh = await service.write({ sessionId: 'sess-1', absolutePath: file, content: 'guarded\n', expectedVersion: saved.version })
check('matching version is accepted', fresh?.status === 'saved', JSON.stringify(fresh))

console.log('\nrelative paths and failures')
const relative = await service.write({ sessionId: 'sess-1', path: 'notes.md', content: 'relative\n' })
check('workspace-relative path resolves through the session cwd', relative?.status === 'saved', JSON.stringify(relative))
check('relative write landed on the same file', fs.readFileSync(file, 'utf8') === 'relative\n')

const directoryTarget = await service.write({ sessionId: 'sess-1', absolutePath: workspace, content: 'x' })
check('a directory target is reported, not thrown', directoryTarget?.status !== 'saved', JSON.stringify(directoryTarget))

const bad = await service.write({ absolutePath: file })
check('a missing content field is a bad-request', bad?.status === 'bad-request', JSON.stringify(bad))
const noPath = await service.write({ content: 'x' })
check('a missing path is a bad-request', noPath?.status === 'bad-request', JSON.stringify(noPath))

console.log('\ngateway dispatch')
// The real Gateway resolves the descriptor, checks the binding, decodes the wire
// fields, and applies the method — the exact path a browser call takes.
const TypertGateway = (await import('@deepseek-ai/dsh-api-gateway')).default
await root.plugin(TypertGateway)
const gateway = root.get('typertGateway')
check('gateway mounted', gateway !== undefined && typeof gateway.invoke === 'function')

const dispatched = await gateway.invoke({
  namespace: 'markdownDocs',
  method: 'write',
  args: { request: { sessionId: 'sess-1', absolutePath: file, content: 'via gateway\n' } },
})
check('gateway dispatch writes the file', fs.readFileSync(file, 'utf8') === 'via gateway\n', JSON.stringify(dispatched))
check('gateway dispatch returns the saved envelope', dispatched?.status === 'saved', JSON.stringify(dispatched))

let extraField
try {
  await gateway.invoke({ namespace: 'markdownDocs', method: 'write', args: { request: { content: 'x' }, extra: 1 } })
} catch (error) {
  extraField = error
}
check('an unexpected wire field is rejected', extraField?.code === 'gateway/arguments-invalid', String(extraField?.code))

let unknownMethod
try {
  await gateway.invoke({ namespace: 'markdownDocs', method: 'nope', args: {} })
} catch (error) {
  unknownMethod = error
}
check('an unknown endpoint is rejected', unknownMethod !== undefined && String(unknownMethod.code).startsWith('gateway/'), String(unknownMethod?.code))

console.log('\nteardown')
await root.fiber.dispose()
check('service withdrawn after dispose', root.get('markdownDocs') === undefined)

// ---------------------------------------------------------------------------
// Client half: load the real bundle the way the module loader does, run apply
// against a recording context, and validate the contribution with the real
// Typert registry the browser uses.
// ---------------------------------------------------------------------------

console.log('\nclient bundle')
const vm = await import('node:vm')
const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
let registration
const sandbox = {
  console,
  TextDecoder,
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (fn) => fn(),
  document: { activeElement: null },
  window: { __ModuleLoader__: { load: (definition) => { registration = definition } } },
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

check('bundle registers itself with the module loader', registration !== undefined)
check('module id equals the package name', registration?.id === NAME, String(registration?.id))

const ReactStub = {
  createElement: () => null,
  memo: (component) => component,
  Component: class Component { constructor(props) { this.props = props; this.state = {} } },
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}
const pluginObject = registration.factory((specifier) => {
  if (specifier === 'react') return ReactStub
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null }
  throw new Error('unexpected require: ' + specifier)
})
check('client half exports apply', typeof pluginObject?.apply === 'function')
check('client half declares its service injections', Array.isArray(pluginObject?.inject) && pluginObject.inject.includes('remote'))

let definition
let slotRegistration
let contribution
let styleCount = 0
const fakeCtx = {
  effect: (fn) => { const disposer = fn(); return typeof disposer === 'function' ? disposer : () => {} },
  locale: { register: () => () => {}, bind: () => (key) => key },
  documentPreviews: { register: (value) => { definition = value; return () => {} } },
  slots: {
    inject: (key, callback) => { callback() },
    register: (options, component) => { slotRegistration = { options, component }; styleCount += 1; return () => {} },
  },
  // The plugin also mounts probe contributions while a mount failure is being
  // diagnosed; those are not what this suite asserts.
  remote: {
    $mount: async (value) => {
      const namespaces = (value?.descriptors ?? []).map((descriptor) => descriptor.namespace)
      if (namespaces.includes('markdownDocs')) contribution = value
      return () => {}
    },
  },
}
pluginObject.apply(fakeCtx)

check('registers a document implementation', definition !== undefined)
check('implementation id is package-scoped', definition?.id === NAME + '/markdown-editor', String(definition?.id))
check('claims md/markdown/mdx', JSON.stringify(definition?.extensions) === JSON.stringify(['md', 'markdown', 'mdx']), JSON.stringify(definition?.extensions))
check('ranks above the builtin markdown renderer', definition?.priority !== 'builtin', String(definition?.priority))
check('loads complete bytes so edits are never partial', definition?.loading === 'bytes-complete', String(definition?.loading))
check('body slot key equals the implementation id', slotRegistration?.options?.key === definition?.id, String(slotRegistration?.options?.key))
check('body is registered under the document body slot', slotRegistration?.options?.name === 'sidebar.right.tab.document', String(slotRegistration?.options?.name))
check('body is a component', typeof slotRegistration?.component === 'function')

console.log('\nclient contribution')
check('a contribution was mounted', contribution !== undefined)
check('contribution package is unique to this plugin', contribution?.package === NAME, String(contribution?.package))
const clientDescriptor = contribution?.descriptors?.[0]
check('contribution declares exactly one method', contribution?.descriptors?.length === 1)
check('client endpoint matches the host descriptor', clientDescriptor?.namespace === descriptor?.namespace && clientDescriptor?.method === descriptor?.method, clientDescriptor?.namespace + '/' + clientDescriptor?.method)
check('client argument wire matches the host wire', clientDescriptor?.parameters?.[0]?.wire === descriptor?.parameters?.[0]?.wire)
// The Gateway refuses a Client field that is not a strict codec.
const strictFields = [
  ...(clientDescriptor?.parameters ?? []).map((parameter) => parameter.codec),
  ...(clientDescriptor?.uplink === undefined ? [] : [clientDescriptor.uplink.codec]),
  ...(clientDescriptor?.invocation?.kind === 'context' ? [clientDescriptor.invocation.codec] : []),
]
check('every client field is a strict codec', strictFields.length > 0 && strictFields.every((codec) => codec?.mode === 'strict'))
check('every strict codec has a type symbol and a factory', strictFields.every((codec) => typeof codec.typeSymbol === 'string' && codec.typeSymbol.length > 0 && typeof codec.create === 'function'))

// The real Client registry validates the contribution before any method mounts.
const clientRoot = new Context()
await clientRoot.plugin(TypertRegistry)
let registered = true
try {
  clientRoot.typert.remotes.register(contribution)
} catch (error) {
  registered = false
  console.log('  registry rejected the contribution: ' + error.message)
}
check('the real client registry accepts the contribution', registered)
check('the endpoint resolves in the client registry', clientRoot.typert.remotes.get('markdownDocs/write') !== undefined)
await clientRoot.fiber.dispose()

fs.rmSync(workspace, { recursive: true, force: true })
console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
