# Tests

These exercise the plugin against the **real** runtime packages taken from an
installed Harness, rather than against mocks. That is deliberate: the host half
cannot be reloaded without restarting the app, so it has to be right the first
time, and the client half is a plain-JavaScript bundle with no type checker.

| Suite | What it proves |
|---|---|
| `test-host.mjs` | The host half against real Cordis, the real Typert registry, the real local filesystem backend and the real API Gateway: registration, the binding, the version guard, relative paths, failure mapping, **and a full gateway dispatch that writes a real file**. It also loads `client.js` the way the browser module loader does and validates the Remote contribution with the real client-side registry. |
| `test-client-render.mjs` | The body renders with the real React across many prop shapes, the marker-hiding markup, and the fallback to source-only editing when the renderer is unavailable. |
| `test-interaction.mjs` | The interaction logic through a hand-written hook runtime: adoption, in-place editing, table cell editing, formatting, save/version/stale handling, auto-save — plus the property that matters most, that **stripping the editing surface's markup gives the Markdown back byte for byte**. |

## Running them

The suites import Harness packages, so fetch the closure you need out of the
installed app first. `fetch.cjs` reads the app's `app.asar` directly:

```sh
# macOS default; set ASAR to your own app.asar elsewhere
node test/fetch.cjs @deepseek-ai/cordis @deepseek-ai/dsh-typert-registry @deepseek-ai/dsh-fs-local @deepseek-ai/dsh-api-gateway
# or: npm run fetch-harness

npm test
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `ASAR` | `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` | The archive the runtime packages are read from |
| `DSH_MODULES` | `~/.dsh/profiles/node_modules` | A directory holding `react` and `react-dom` for the render suites |

The fetcher writes into `test/node_modules` (git-ignored), and needs nothing but
Node: it parses the archive header itself.

## Why a hand-written hook runtime

There is no DOM in Node, so `test-interaction.mjs` supplies the React hook
dispatcher directly and walks into nested function and class components the way
React would — including reusing host nodes across renders, bailing out when a
state setter is given an identical value, and resetting hooks when a component
leaves the tree. Each of those was needed to reproduce a real bug at some point:
the bail-out caught an effect that re-rendered forever, and the node reuse caught
a stale DOM reference.
