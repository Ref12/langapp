// Load harness for scripts/build-phrase-bank.mjs: the real main() against a fake endpoint with random latency, so the pipeline's own CPU cost shows.
//   node --cpu-prof --cpu-prof-dir=prof scripts/phrase-bank-load.mjs [--latency 8000] [--bands 2,3,4,5,6] [--concurrency 100] [--limit N] [--lookahead 0,2] [--stop-after-batches N]
// Prints batches per minute, calls in flight (average and peak) and the main-thread CPU time. Writes only to a temp folder.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './build-phrase-bank.mjs'

const arg = (name, fallback) => { const at = process.argv.indexOf('--' + name); return at < 0 ? fallback : process.argv[at + 1] }
const latency = Number(arg('latency', 8000)), bands = arg('bands', '2,3,4,5,6'), concurrency = arg('concurrency', '100'), lookahead = arg('lookahead', '0,2')
const limit = arg('limit'), stopAfter = Number(arg('stop-after-batches', 0))
const dir = arg('dir', mkdtempSync(join(tmpdir(), 'phrase-load-')))
const AFFIX = ['', '的', '了', '吗', '呢', '吧', '我', '你', '他', '不', '很', '也', '都', '和', '在', '有', '这', '那', '个', '是']
let seed = 12345
const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
let flying = 0, peak = 0, area = 0, last = Date.now(), began = Date.now(), calls = 0
const tick = () => { const now = Date.now(); area += flying * (now - last); last = now }
const reply = (content, chat) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => content, json: async () => ({ choices: [{ message: { content } }] }) })

const writePhrases = user => {
  const at = user.lastIndexOf('\n{"avoid"')
  const prompt = JSON.parse(user.slice(at + 1))
  const phrases = []
  for (const group of prompt.groups) for (const item of group.words) {
    if (item.construct || !item.form) continue
    const need = Math.max(1, item.specs?.length || 3)
    // distinct sentences made of the word and function characters; the Han-only key keeps them apart
    const picks = new Set()
    while (picks.size < need + 1) picks.add(Math.floor(random() * AFFIX.length * AFFIX.length))
    for (const pick of picks) {
      const a = AFFIX[Math.floor(pick / AFFIX.length)], b = AFFIX[pick % AFFIX.length]
      const zh = a + item.form + b
      if (zh === item.form) continue
      phrases.push({ ref: item.ref, zh: zh + '。', py: 'x', en: 'a sentence', grammar: [] })
    }
  }
  return { phrases }
}
const checkResults = user => ({ results: [...user.matchAll(/"id":"([^"]+)"/g)].map(match => ({ id: match[1], natural: true, matches: true, reason: '' })) })

const fetchImpl = async (_url, init) => {
  const body = JSON.parse(init.body)
  const text = body.messages.map(message => message.content).join('\n')
  calls++; flying++; peak = Math.max(peak, flying)
  tick()
  await new Promise(done => setTimeout(done, latency * (0.5 + random())))
  tick(); flying--
  return reply(JSON.stringify(body.model === 'writer' ? writePhrases(text) : checkResults(text)))
}

let merged = 0
const timer = setInterval(() => {
  const minutes = (Date.now() - began) / 60000
  console.error('t=' + Math.round(minutes * 60) + 's batches=' + merged + ' (' + (merged / minutes).toFixed(1) + '/min) in flight now=' + flying + ' peak=' + peak + ' avg=' + (area / (Date.now() - began)).toFixed(1) + ' rss=' + Math.round(process.memoryUsage().rss / 1048576) + 'MB')
}, 15000)
const log = line => {
  if (/saved$/.test(line)) { merged++; if (stopAfter && merged >= stopAfter) { clearInterval(timer); report(); process.exit(0) } }
  else if (!/skipped duplicate/.test(line)) console.error(line)
}
const report = () => {
  const minutes = (Date.now() - began) / 60000, cpu = process.cpuUsage()
  console.log(JSON.stringify({ batches: merged, minutes: +minutes.toFixed(2), batchesPerMin: +(merged / minutes).toFixed(1), calls, avgInFlight: +(area / (Date.now() - began)).toFixed(1), peakInFlight: peak, cpuSeconds: +((cpu.user + cpu.system) / 1e6).toFixed(1), rssMB: Math.round(process.memoryUsage().rss / 1048576) }))
}
await main(['--base-url', 'http://fake/v1', '--writer-model', 'writer', '--checker-model', 'checker', '--band', bands, '--concurrency', concurrency, '--lookahead', lookahead,
  '--out', join(dir, 'yaml'), '--json-out', join(dir, 'json'), '--state', join(dir, 'state.json'), ...(limit ? ['--limit', limit] : [])], { fetchImpl, log })
clearInterval(timer)
report()
