// Builds the offline EN→DE dictionary from the Ding word list (TU Chemnitz, GPL v2+).
// Output: public/dict/en-de/<prefix>.json shards + public/dict/en-de/index.json
// Usage: node scripts/build-dictionary.mjs [path/to/de-en.txt.gz]
import { gunzipSync } from 'node:zlib'
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DING_URL = 'https://ftp.tu-chemnitz.de/pub/Local/urz/ding/de-en/de-en.txt.gz'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cacheFile = join(root, '.cache', 'de-en.txt.gz')
const outDir = join(root, 'public', 'dict', 'en-de')

const MAX_WORDS = 5
const MAX_KEY_LEN = 60
const MAX_DE_LEN = 140
const MAX_ENTRIES = 8

async function loadSource(arg) {
  if (arg) return readFileSync(arg)
  if (!existsSync(cacheFile)) {
    console.log(`Lade ${DING_URL} …`)
    const res = await fetch(DING_URL)
    if (!res.ok) throw new Error(`Download fehlgeschlagen: ${res.status}`)
    mkdirSync(dirname(cacheFile), { recursive: true })
    writeFileSync(cacheFile, Buffer.from(await res.arrayBuffer()))
  }
  return readFileSync(cacheFile)
}

const POS_FROM_DE = [
  [/\{v[a-z]*\}/, 'verb'],
  [/\{(m|f|n|pl)\}/, 'noun'],
  [/\{adj\}/, 'adj'],
  [/\{adv\}/, 'adv'],
  [/\{prp\}/, 'prep'],
  [/\{conj\}/, 'conj'],
  [/\{pron\}/, 'pron'],
  [/\{interj\}/, 'interj'],
  [/\{num\}/, 'num'],
]

export function posOf(dePart) {
  for (const [re, pos] of POS_FROM_DE) if (re.test(dePart)) return pos
  return ''
}

export function keyOf(enVariant, pos) {
  let s = enVariant
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\/[^/]*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?]+$/, '')
  if (pos === 'verb' && s.startsWith('to ')) s = s.slice(3)
  if (!s || s.length > MAX_KEY_LEN || s.split(' ').length > MAX_WORDS) return null
  return s
}

export function parseLine(line) {
  if (!line || line.startsWith('#')) return []
  const sep = line.indexOf(' :: ')
  if (sep < 0) return []
  const deParts = line.slice(0, sep).split(' | ')
  const enParts = line.slice(sep + 4).split(' | ')
  const n = Math.min(deParts.length, enParts.length)
  const out = []
  for (let i = 0; i < n; i++) {
    const de = deParts[i].trim()
    if (!de || de.length > MAX_DE_LEN) continue
    const pos = posOf(de)
    enParts[i].split(/;\s*/).forEach((variant, v) => {
      const key = keyOf(variant, pos)
      if (key) out.push({ key, de, pos, rank: (i === 0 ? 0 : 10) + Math.min(v, 5) })
    })
  }
  return out
}

export function shardOf(key) {
  const norm = c => (c && /[a-z0-9]/.test(c) ? c : '_')
  return norm(key[0]) + norm(key[1])
}

async function main() {
  const text = gunzipSync(await loadSource(process.argv[2])).toString('utf8')
  const map = new Map()
  for (const line of text.split('\n')) {
    for (const e of parseLine(line)) {
      let list = map.get(e.key)
      if (!list) map.set(e.key, (list = []))
      if (!list.some(x => x.de === e.de)) list.push(e)
    }
  }
  const shards = new Map()
  for (const [key, list] of map) {
    list.sort((a, b) => a.rank - b.rank || a.de.length - b.de.length)
    const shard = shardOf(key)
    if (!shards.has(shard)) shards.set(shard, {})
    shards.get(shard)[key] = list.slice(0, MAX_ENTRIES).map(e => (e.pos ? [e.de, e.pos] : [e.de]))
  }
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  let bytes = 0
  for (const [shard, obj] of shards) {
    const json = JSON.stringify(obj)
    bytes += json.length
    writeFileSync(join(outDir, `${shard}.json`), json)
  }
  const index = {
    source: 'Ding de-en 1.9, Frank Richter, TU Chemnitz — https://dict.tu-chemnitz.de/',
    license: 'GPL-2.0-or-later',
    entries: map.size,
    shards: [...shards.keys()].sort(),
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index))
  console.log(`${map.size} Stichwörter, ${shards.size} Shards, ${(bytes / 1e6).toFixed(1)} MB`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
