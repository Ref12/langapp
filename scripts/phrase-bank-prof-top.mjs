// Summarises a --cpu-prof file: top functions by self time, and by inclusive time for the named ones. node scripts/phrase-bank-prof-top.mjs file.cpuprofile [N]
import { readFileSync } from 'node:fs'
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8')), top = Number(process.argv[3] ?? 25)
const nodes = new Map(profile.nodes.map(node => [node.id, node]))
const self = new Map()
const dt = profile.timeDeltas
profile.samples.forEach((id, at) => self.set(id, (self.get(id) ?? 0) + (dt[at] ?? 0)))
const total = [...self.values()].reduce((a, b) => a + b, 0)
const byFn = new Map()
for (const [id, time] of self) { const f = nodes.get(id).callFrame; const key = f.functionName + ' ' + f.url.split('/').slice(-2).join('/') + ':' + (f.lineNumber + 1); byFn.set(key, (byFn.get(key) ?? 0) + time) }
console.log('total ' + (total / 1e6).toFixed(1) + ' s sampled')
for (const [key, time] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log((time / 1e6).toFixed(2).padStart(7) + ' s ' + (100 * time / total).toFixed(1).padStart(5) + '%  ' + key)
// inclusive time per function (each function counted once per sample stack)
const parent = new Map(); for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
const incl = new Map()
for (const [id, time] of self) { const seen = new Set(); for (let at = id; at; at = parent.get(at)) { const f = nodes.get(at).callFrame; const key = f.functionName + ':' + (f.lineNumber + 1); if (seen.has(key)) continue; seen.add(key); incl.set(key, (incl.get(key) ?? 0) + time) } }
console.log('-- inclusive')
for (const [key, time] of [...incl].filter(([key]) => !key.startsWith(':') && !/^\(/.test(key)).sort((a, b) => b[1] - a[1]).slice(0, top)) console.log((time / 1e6).toFixed(2).padStart(7) + ' s ' + (100 * time / total).toFixed(1).padStart(5) + '%  ' + key)
