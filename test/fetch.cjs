/**
 * Extract a package and its transitive bare-import closure out of the shipped
 * app.asar into ./node_modules, so the plugin's host half can be exercised
 * against the real runtime packages before it is installed.
 */
const fs = require('node:fs')
const path = require('node:path')
const { isBuiltin } = require('node:module')

const ASAR = process.env.ASAR || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
const ROOT = path.join(__dirname, 'node_modules')

const fd = fs.openSync(ASAR, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
// Layout: [u32 4][u32 dataStart-8][u32 ...][u32 jsonLength] then the JSON.
// Reading `8 + head[4]` as the data start is what the shipped reader uses; the
// naive `16 + head[12]` starts 2 bytes early and shifts every file.
const jsonLength = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(jsonLength)
fs.readSync(fd, jsonBuf, 0, jsonLength, 16)
const header = JSON.parse(jsonBuf.toString('utf8'))
const DATA_START = 8 + head.readUInt32LE(4)

function nodeAt(parts) {
  let node = header
  for (const part of parts) {
    node = node.files?.[part]
    if (node === undefined) return undefined
  }
  return node
}

function readNode(node) {
  const buffer = Buffer.alloc(node.size)
  const start = DATA_START + Number(node.offset)
  let read = 0
  while (read < node.size) read += fs.readSync(fd, buffer, read, node.size - read, start + read)
  return buffer
}

function writeTree(node, dir) {
  if (node.files !== undefined) {
    fs.mkdirSync(dir, { recursive: true })
    for (const key of Object.keys(node.files)) writeTree(node.files[key], path.join(dir, key))
    return
  }
  // Unpacked entries (native binaries) carry no archive offset; skip them.
  if (node.unpacked === true || node.offset === undefined) return
  fs.mkdirSync(path.dirname(dir), { recursive: true })
  fs.writeFileSync(dir, readNode(node))
}

const fetched = new Set()

function packageNameOf(specifier) {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

function fetchPackage(name) {
  if (fetched.has(name)) return
  fetched.add(name)
  const parts = name.split('/')
  // Harvested packages live under `dsh/node_modules`; the Electron app's own
  // runtime deps live under `node_modules`.
  const node = nodeAt(['dsh', 'node_modules', ...parts]) ?? nodeAt(['node_modules', ...parts])
  if (node === undefined) return
  const dir = path.join(ROOT, ...parts)
  writeTree(node, dir)
  const specifiers = new Set()
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) continue
      const text = fs.readFileSync(full, 'utf8')
      for (const match of text.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"'.][^"']*)["']/g)) {
        const specifier = match[1]
        if (specifier.startsWith('node:') || specifier.startsWith('.') || isBuiltin(specifier)) continue
        specifiers.add(specifier)
      }
    }
  }
  walk(dir)
  for (const specifier of specifiers) fetchPackage(packageNameOf(specifier))
}

for (const name of process.argv.slice(2)) fetchPackage(name)
console.log('fetched', fetched.size, 'packages')
