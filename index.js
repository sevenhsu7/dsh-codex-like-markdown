/**
 * Host half of the editable Markdown document preview.
 *
 * Exposes exactly one Remote method — `markdownDocs/write` — which writes the
 * text a user typed in the right Sidebar's document preview back to the file it
 * came from. The write goes through `ctx.fs.writeText`, so the deployment's
 * filesystem backend still owns target identity, atomicity, and the sandbox
 * fence: a `read-only` session is denied and a `workspace-write` session may
 * only write inside its workspace root.
 *
 * The file deliberately imports nothing from `@deepseek-ai/*`. A plugin that
 * the profile resolves as a plain dependency would otherwise resolve `cordis`
 * and friends from whichever node_modules tree happens to be reachable, and a
 * second copy of a runtime package is a real hazard. The Typert binding is
 * built by hand and the invocation descriptor is registered with
 * `ctx.typert.register`, which is the documented route for an owner outside the
 * generated-artifact pipeline.
 *
 * @module dsh-codex-like-markdown
 */

/** Package identity shared with the browser half and the wire descriptors. */
const PACKAGE = 'dsh-codex-like-markdown'
/** Cordis service key and wire namespace; the Gateway resolves both by name. */
const SERVICE = 'markdownDocs'
const NAMESPACE = 'markdownDocs'
const METHOD = 'write'

/**
 * Wire descriptor for the single Remote method.
 *
 * The codecs are `src-json`: the Gateway's source mode accepts JSON-safe fields
 * without a generated Zod schema, which keeps this file dependency-free. The
 * browser half declares the same endpoint with strict pass-through codecs,
 * because a Client contribution may not mount a non-strict field.
 */
const INVOCATION = {
  id: `${PACKAGE}#${NAMESPACE}/${METHOD}`,
  service: SERVICE,
  namespace: NAMESPACE,
  method: METHOD,
  invocation: { kind: 'direct' },
  parameters: [
    {
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: { mode: 'src-json' },
    },
  ],
  cancellation: { parameter: 'signal' },
  result: { mode: 'src-json' },
}

/** Stable Cordis plugin name for diagnostics. */
export const name = 'markdown-document-writer'
/** The Typert registry owns descriptor storage; nothing activates without it. */
export const inject = ['typert']

/**
 * Register the write endpoint for the owning plugin lifetime.
 * @param ctx - Host context carrying the Typert registry.
 */
export function apply(ctx) {
  /**
   * Turn a filesystem failure into a status the browser can act on.
   * @param error - thrown value from `ctx.fs`.
   * @param target - resolved target, when one was reached.
   * @returns a settled result envelope.
   */
  function failureOf(error, target) {
    const code = error && typeof error.code === 'string' ? error.code : undefined
    const status = STATUS_BY_FS_CODE[code] ?? 'error'
    return {
      status,
      ...(code === undefined ? {} : { code }),
      message: error instanceof Error ? error.message : String(error),
      ...(target === undefined ? {} : { absolutePath: target.displayPath }),
    }
  }

  /**
   * The workspace root one Session's relative paths resolve against.
   * @param sessionId - Session identity carried by the preview's address.
   * @returns the Session working directory, the deployment workspace root, or `undefined`.
   */
  function workspaceRoot(sessionId) {
    if (typeof sessionId === 'string' && sessionId !== '') {
      const header = ctx.get('sessions')?.get?.(sessionId)?.header
      if (header !== undefined && typeof header.cwd === 'string' && header.cwd !== '') return header.cwd
    }
    const policy = ctx.get('sandboxPolicy')
    return typeof policy?.workspaceRoot === 'string' ? policy.workspaceRoot : undefined
  }

  /**
   * Write the previewed file.
   *
   * The caller sends the whole document, so the operation is a replace rather
   * than a patch: `expectedVersion` turns it into a compare-and-write that fails
   * with `stale` when the file changed since the preview read it, and omitting
   * it is the user's deliberate overwrite.
   *
   * @param request - `{ sessionId?, path?, absolutePath?, content, expectedVersion? }`.
   * @param signal - Remote cancellation signal.
   * @returns `{ status: 'saved', absolutePath, version, operation, bytes }` or a failure envelope.
   */
  async function write(request, signal) {
    const input = request !== null && typeof request === 'object' ? request : {}
    if (typeof input.content !== 'string') {
      return { status: 'bad-request', message: 'write requires a string "content" field' }
    }
    const absolutePath = typeof input.absolutePath === 'string' && input.absolutePath !== '' ? input.absolutePath : undefined
    const path = absolutePath ?? input.path
    if (typeof path !== 'string' || path === '') {
      return { status: 'bad-request', message: 'write requires a file path' }
    }
    const fs = ctx.get('fs')
    if (fs === undefined || typeof fs.resolve !== 'function' || typeof fs.writeText !== 'function') {
      return { status: 'error', message: 'no filesystem service is available in this profile' }
    }
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : undefined
    let target
    try {
      target = await fs.resolve(path, { cwd: workspaceRoot(sessionId), signal })
    } catch (error) {
      return failureOf(error)
    }
    const expected = typeof input.expectedVersion === 'string' && input.expectedVersion !== ''
      ? { kind: 'replaceIfVersion', version: input.expectedVersion }
      : undefined
    try {
      const outcome = await fs.writeText(target, input.content, expected, signal)
      return {
        status: 'saved',
        absolutePath: target.displayPath,
        version: String(outcome.version),
        operation: outcome.operation,
        bytes: Buffer.byteLength(input.content, 'utf8'),
      }
    } catch (error) {
      return failureOf(error, target)
    }
  }

  // A provided service is what the Gateway resolves by name, and it must carry
  // the same binding a generated artifact would: `typertRemote` naming the
  // service object itself. Without it every call fails `gateway/binding-invalid`.
  const service = { write }
  service.typertRemote = Object.freeze({ service, serviceKey: SERVICE, namespace: NAMESPACE })
  ctx.provide(SERVICE, service)

  ctx.effect(() => ctx.typert.register({
    package: PACKAGE,
    face: 'host',
    schemas: [],
    invocations: [INVOCATION],
    model: { services: [], events: [], objects: [] },
  }), 'markdown-editor: remote descriptor')
}

/** Filesystem error codes the browser branches on, mapped to plugin statuses. */
const STATUS_BY_FS_CODE = {
  FS_STALE_VERSION: 'stale',
  FS_SANDBOX_DENIED: 'denied',
  FS_NOT_FOUND: 'missing',
  FS_NOT_REGULAR_FILE: 'not-a-file',
  FS_NOT_OBSERVED: 'unobserved',
  FS_IO_ERROR: 'error',
}
