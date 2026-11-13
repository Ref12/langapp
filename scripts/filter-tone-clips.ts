// Keeps only the tone trainer's clips whose pitch is a clear example of their tone (src/core/tone-trainer/clear.ts), measured with the app's own pitch code (pitch.ts) on decoded clips.
// Starts from the full build (every item, every voice): for each item and voice it tries the character at the normal rate, then at rate 0.85 (a slower take), then (singles) the other readings' characters,
// and keeps the first take that passes. A base keeps all four tones only when each has at least two voices; a pair group takes 12 words, preferring words with three or more voices including a male one.
// Needs ffmpeg on the PATH and the root dev server (npx vite --port 5173). Syntheses are cached in $TONE_CACHE (default .tone-cache outside git) so a rerun is quick.
// Run: npx tsx scripts/filter-tone-clips.ts [--ranges] [--server http://127.0.0.1:5173]    (--ranges only prints the pitch range of the voices that have none yet, from the unfiltered original clips)
// Writes: the manifest and clips under public/audio/tones, the clip-levels fixture, and a report on stdout.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LOCAL_TTS_HEADER } from '../src/core/local-tts-contracts'
import { isClearClip } from '../src/core/tone-trainer/clear'
import { buildPairCandidates, buildSingles, PAIR_WORDS_PER_GROUP, type ToneItem } from '../src/core/tone-trainer/items'
import { clipCurves, trackPitch, voiceBounds, VOICE_RANGE, type LevelCurve } from '../src/core/tone-trainer/pitch'

// The same voices and fallbacks as scripts/build-tone-audio.ts (not imported: that script runs when loaded).
const TONE_VOICES = [
  { id: 'xiaoxiao', voice: 'zh-CN-XiaoxiaoNeural', gender: 'Female' }, { id: 'xiaoyi', voice: 'zh-CN-XiaoyiNeural', gender: 'Female' },
  { id: 'yunxi', voice: 'zh-CN-YunxiNeural', gender: 'Male' }, { id: 'yunjian', voice: 'zh-CN-YunjianNeural', gender: 'Male' },
  { id: 'yunyang', voice: 'zh-CN-YunyangNeural', gender: 'Male' }, { id: 'yunxia', voice: 'zh-CN-YunxiaNeural', gender: 'Male' },
] as const
/** Which voices to keep first when more than MAX_VOICES pass (keeps the files down); a male voice is always kept when one passes. */
const PREFERENCE = ['xiaoxiao', 'yunxi', 'yunyang', 'xiaoyi', 'yunxia', 'yunjian']
const MAX_VOICES = 4
const SLOW_RATE = 0.85
const FALLBACK_SINGLE_CHARS: Record<string, string[]> = { ba3: ['把', '靶'], da3: ['打'], fang4: ['放'], guo4: ['过'], qie3: ['且'], shao3: ['少'], tao4: ['套'], zhao2: ['着'] }
const OUT = path.join('public', 'audio', 'tones')
const RATE = 24000
const args = process.argv.slice(2)
const rangesOnly = args.includes('--ranges')
const CACHE = process.env.TONE_CACHE ?? path.join('.tone-cache')
const server = args.includes('--server') ? args[args.indexOf('--server') + 1] : 'http://127.0.0.1:5173'
interface Clip { file: string; chars: string; t0?: number; t1?: number }
interface ManifestItem extends ToneItem { clips: Record<string, Clip> }
interface Manifest { version: 1; voices: unknown[]; dropped: { id: string; reason: string }[]; items: ManifestItem[] }
const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function decode(bytes: Buffer): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { input: bytes, maxBuffer: 1 << 26 })
  const pcm = new Float32Array(raw.length / 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = raw.readInt16LE(i * 2) / 32768
  return pcm
}
interface Measure { levels: (LevelCurve | null)[]; hz: number[]; track: PitchTrack }
/** The app's pipeline: trackPitch with the voice's bounds, then clipCurves on VOICE_RANGE. */
function measure(bytes: Buffer, voice: string, tones: number[]): Measure {
  const track = trackPitch(decode(bytes), RATE, voiceBounds(voice))
  return { levels: clipCurves(track, voice, tones.length === 2 ? 2 : 1), hz: Array.from(track.f0).filter(Boolean), track }
}

async function synthRaw(text: string, voice: string, rate: number): Promise<{ audio: Buffer; t0?: number; t1?: number }> {
  let last: unknown
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const response = await fetch(server + '/__local/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', [LOCAL_TTS_HEADER]: '1' }, body: JSON.stringify({ text, voice, rate }) })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const body = await response.json() as { audio: { base64: string }; wordBoundaries?: { startTime: number; duration: number }[] }
      const audio = Buffer.from(body.audio.base64, 'base64')
      if (audio.length < 500) throw new Error('audio too short')
      const words = body.wordBoundaries ?? []
      return words.length ? { audio, t0: Math.min(...words.map(w => w.startTime)), t1: Math.max(...words.map(w => w.startTime + w.duration)) } : { audio }
    } catch (error) { last = error; await sleep(Math.min(8000, 300 * 2 ** attempt)) }
  }
  throw new Error('synthesis failed for ' + text + ': ' + String(last))
}
const synthCount = { fresh: 0, cached: 0 }
async function synth(text: string, voice: string, rate: number): Promise<{ audio: Buffer; t0?: number; t1?: number }> {
  const key = path.join(CACHE, crypto.createHash('sha1').update([text, voice, rate].join('|')).digest('hex'))
  if (fs.existsSync(key + '.mp3')) { synthCount.cached++; const meta = fs.existsSync(key + '.json') ? readJson<{ t0?: number; t1?: number }>(key + '.json') : {}; return { audio: fs.readFileSync(key + '.mp3'), ...meta } }
  const made = await synthRaw(text, voice, rate)
  synthCount.fresh++
  fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(key + '.json', JSON.stringify({ t0: made.t0, t1: made.t1 })); fs.writeFileSync(key + '.mp3', made.audio)
  return made
}
async function pool<T>(jobs: T[], work: (job: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < jobs.length) await work(jobs[next++]) }))
}

const manifest = readJson<Manifest>(path.join(OUT, 'manifest.json'))
const bands = [1, 2, 3, 4, 5, 6].map(n => readJson<{ vocabulary: { ch: string; lb: string }[] }>(path.join('src', 'data', 'v2', 'hsk-' + n + '.generated.json')).vocabulary)
const singleChars = readJson<Record<string, string[]>>(path.join('scripts', 'tone-single-chars.json'))
for (const [key, chars] of Object.entries(FALLBACK_SINGLE_CHARS)) if (!(singleChars[key]?.length)) singleChars[key] = chars
const rangeOf = (hz: number[]): [number, number] => { const s = [...hz].sort((a, b) => a - b); return [Math.round(s[Math.floor(0.05 * (s.length - 1))]), Math.round(s[Math.floor(0.95 * (s.length - 1))])] }

if (rangesOnly) {
  // The range of a voice with none: the 5th to 95th percentile of its pitch over the original (unfiltered) items at the normal rate.
  const out: Record<string, [number, number]> = {}
  for (const voice of TONE_VOICES.filter(v => !VOICE_RANGE[v.id])) {
    const hz: number[] = []
    const jobs = manifest.items
    await pool(jobs, async item => { const made = await synth(item.chars, voice.voice, 1); hz.push(...measure(made.audio, voice.id, item.tones).hz) })
    out[voice.id] = rangeOf(hz)
  }
  console.log(JSON.stringify(out)); process.exit(0)
}

// ---- Evaluate every item in every voice.
interface Found { audio: Buffer; chars: string; rate: number; t0?: number; t1?: number }
const found = new Map<string, Map<string, Found>>()
const attempts = (spec: ToneItem): { chars: string; rate: number }[] => {
  if (spec.kind === 'pair') return [{ chars: spec.chars, rate: 1 }, { chars: spec.chars, rate: SLOW_RATE }]
  const alternates = [...new Set(spec.alternates ?? [])].filter(c => c !== spec.chars)
  return [{ chars: spec.chars, rate: 1 }, { chars: spec.chars, rate: SLOW_RATE }, ...alternates.map(chars => ({ chars, rate: 1 })), ...alternates.map(chars => ({ chars, rate: SLOW_RATE }))]
}
async function evaluate(specs: ToneItem[]): Promise<void> {
  const todo = specs.filter(s => !found.has(s.id))
  for (const s of todo) found.set(s.id, new Map())
  await pool(todo.flatMap(spec => TONE_VOICES.map(voice => ({ spec, voice }))), async ({ spec, voice }) => {
    for (const a of attempts(spec)) {
      const made = await synth(a.chars, voice.voice, a.rate)
      if (isClearClip(measure(made.audio, voice.id, spec.tones).levels, spec.tones)) { found.get(spec.id)!.set(voice.id, { ...made, chars: a.chars, rate: a.rate }); return }
    }
  })
}
const passing = (id: string) => [...found.get(id)!.keys()]
const hasMale = (voices: string[]) => voices.some(v => TONE_VOICES.find(t => t.id === v)?.gender === 'Male')
const strict = (id: string) => passing(id).length >= 3 && hasMale(passing(id))
/** Up to MAX_VOICES of the voices that passed: the preferred ones, with a male voice swapped in when none made the cut. */
function chooseVoices(id: string): string[] {
  const ok = PREFERENCE.filter(v => found.get(id)!.has(v))
  const picked = ok.slice(0, MAX_VOICES)
  if (!hasMale(picked)) { const male = ok.find(v => hasMale([v])); if (male) picked[picked.length - 1] = male }
  return picked
}

const items: ManifestItem[] = []
const dropped = manifest.dropped
const droppedBases: string[] = []
const baseOf = (id: string) => id.slice(2).replace(/\d$/, '')
const bases = [...new Set(manifest.items.filter(i => i.kind === 'single').map(i => baseOf(i.id)))]
const allSingles = buildSingles(bands, singleChars)
const chosenItem = (spec: ToneItem): ManifestItem => {
  const clips: Record<string, Clip> = {}
  for (const voice of chooseVoices(spec.id)) {
    const f = found.get(spec.id)!.get(voice)!, file = voice + '/' + spec.id + '.mp3'
    fs.mkdirSync(path.join(OUT, voice), { recursive: true }); fs.writeFileSync(path.join(OUT, file), f.audio)
    clips[voice] = { file, chars: f.chars, ...(spec.kind === 'pair' && f.t0 !== undefined ? { t0: Math.round(f.t0 * 1000) / 1000, t1: Math.round(f.t1! * 1000) / 1000 } : {}) }
  }
  return { ...spec, clips }
}

// ---- Singles: a base keeps all four tones, each in at least two voices, or it is dropped.
const singleSpecs = bases.flatMap(base => allSingles.filter(s => [1, 2, 3, 4].some(t => s.id === 's-' + base + t)))
await evaluate(singleSpecs)
for (const base of bases) {
  const specs = singleSpecs.filter(s => baseOf(s.id) === base)
  if (specs.length === 4 && specs.every(s => passing(s.id).length >= 2)) for (const spec of specs) items.push(chosenItem(spec))
  else { droppedBases.push(base); dropped.push({ id: 'base-' + base, reason: 'a tone has no clear clip in two voices' }) }
}

// ---- Pairs: 12 a group, from the curriculum candidates in order, preferring words with three or more voices including a male one.
const candidates = buildPairCandidates(bands)
const groupCounts: Record<string, number> = {}
for (const key of [...candidates.keys()].sort()) {
  const queue = candidates.get(key)!, seenSpecs: ToneItem[] = []
  let next = 0
  while (next < queue.length && seenSpecs.filter(s => strict(s.id)).length < PAIR_WORDS_PER_GROUP) {
    const batch = queue.slice(next, next + 8); next += batch.length
    await evaluate(batch); seenSpecs.push(...batch)
  }
  const chosen = [...seenSpecs.filter(s => strict(s.id)), ...seenSpecs.filter(s => !strict(s.id) && passing(s.id).length >= 2)].slice(0, PAIR_WORDS_PER_GROUP)
  for (const spec of chosen) items.push(chosenItem(spec))
  groupCounts[key] = chosen.length
}

// ---- Write the manifest in the build script's order, the fixture and the report.
const order = (item: ManifestItem) => item.kind === 'single' ? [0, item.id] : [1, item.tones.join('')]
const candidateIndex = new Map<string, number>(); for (const list of candidates.values()) list.forEach((c, i) => candidateIndex.set(c.id, i))
items.sort((a, b) => { const [ka, sa] = order(a), [kb, sb] = order(b); return ka !== kb ? (ka as number) - (kb as number) : ka === 0 ? 0 : String(sa) < String(sb) ? -1 : String(sa) > String(sb) ? 1 : (candidateIndex.get(a.id) ?? 0) - (candidateIndex.get(b.id) ?? 0) })
manifest.items = items
manifest.voices = TONE_VOICES.map(v => ({ ...v }))
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
// Clip files that no item lists go.
const listed = new Set(items.flatMap(item => Object.values(item.clips).map(clip => clip.file)))
for (const file of fs.readdirSync(OUT, { recursive: true }) as string[]) { const name = file.replace(/\\/g, '/'); if (name.endsWith('.mp3') && !listed.has(name)) fs.rmSync(path.join(OUT, file)) }
interface Row { item: ManifestItem; voice: string; clear: boolean; hz: number[]; levels: (LevelCurve | null)[] }
const finalRows: Row[] = []
for (const item of items) for (const [voice, clip] of Object.entries(item.clips)) {
  const m = measure(fs.readFileSync(path.join(OUT, clip.file)), voice, item.tones)
  finalRows.push({ item, voice, clear: isClearClip(m.levels, item.tones), hz: m.hz, levels: m.levels })
}
fs.writeFileSync('src/core/tone-trainer/fixtures/clip-levels.json', '[\n' + finalRows.map(r => JSON.stringify({ id: r.item.id, voice: r.voice, tones: r.item.tones, levels: r.levels.map(c => c ?? []) })).join(',\n') + '\n]\n')
let bytes = 0
for (const file of fs.readdirSync(OUT, { recursive: true }) as string[]) { const full = path.join(OUT, file); if (fs.statSync(full).isFile()) bytes += fs.statSync(full).size }
const perVoice: Record<string, Record<string, number>> = {}
for (const r of finalRows) { const t = perVoice[r.voice] ??= { single: 0, pair: 0, slow: 0, altChar: 0 }; t[r.item.kind]++; const f = found.get(r.item.id)!.get(r.voice)!; if (f.rate !== 1) t.slow++; if (f.chars !== r.item.chars) t.altChar++ }
const voicesPerItem: Record<string, number> = {}
for (const item of items) { const k = item.kind + ':' + Object.keys(item.clips).length + (hasMale(Object.keys(item.clips)) ? 'm' : 'f'); voicesPerItem[k] = (voicesPerItem[k] ?? 0) + 1 }
console.log(JSON.stringify({ perVoice, basesKept: bases.length - droppedBases.length, basesOf: bases.length, droppedBases, groupCounts, voicesPerItem, clips: finalRows.length, allClear: finalRows.every(r => r.clear), items: items.length, rangesKept: Object.fromEntries(TONE_VOICES.map(v => [v.id, rangeOf(finalRows.filter(r => r.voice === v.id).flatMap(r => r.hz))])), voiceRange: VOICE_RANGE, synth: synthCount, audioBytes: bytes }, null, 1))
