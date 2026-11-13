// Deletes the tone trainer's clips that the app's own tone judge (classify.ts) hears as another tone than their own, then applies the filter's rules again:
// an item with fewer than two voices goes, a single base that cannot keep all four tones in two voices goes, and a pair group short of 12 words is refilled from the takes already in the cache
// of scripts/filter-tone-clips.ts ($TONE_CACHE; nothing is synthesised). A refill word must pass the clear test (clear.ts) and be heard right per syllable.
// The pitch is tracked as scripts/tone-clip-curves.ts does (the fixture the classifier test reads), so what is kept here is what that test sees.
// Needs ffmpeg on the PATH. Run: TONE_CACHE=<dir> npx tsx scripts/agree-tone-clips.ts [--dry]
// Writes: the manifest and clips under public/audio/tones and fixtures/clip-levels.json; run scripts/tone-clip-curves.ts afterwards for clip-curves.json.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { classifyTone, type SyllablePlace } from '../src/core/tone-trainer/classify'
import { isClearClip } from '../src/core/tone-trainer/clear'
import { buildPairCandidates, PAIR_WORDS_PER_GROUP, type ToneItem } from '../src/core/tone-trainer/items'
import { clipCurves, splitFrame, toLevel, trackPitch, voiceBounds, VOICE_RANGE, type LevelCurve, type PitchTrack } from '../src/core/tone-trainer/pitch'

const OUT = path.join('public', 'audio', 'tones')
const CACHE = process.env.TONE_CACHE ?? '.tone-cache'
const RATE = 24000
const dry = process.argv.includes('--dry')
const PREFERENCE = ['xiaoxiao', 'yunxi', 'yunyang', 'xiaoyi', 'yunxia', 'yunjian']
const MAX_VOICES = 4
interface Clip { file: string; chars: string; t0?: number; t1?: number }
interface ManifestItem extends ToneItem { clips: Record<string, Clip> }
interface Manifest { version: 1; voices: { id: string; voice: string; gender: string }[]; dropped: { id: string; reason: string }[]; items: ManifestItem[] }
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8')) as Manifest
const voiceName = Object.fromEntries(manifest.voices.map(v => [v.id, v.voice]))
const male = (voice: string) => manifest.voices.find(v => v.id === voice)?.gender === 'Male'

function decode(bytes: Buffer): Float32Array {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { input: bytes, maxBuffer: 1 << 26 })
  const pcm = new Float32Array(raw.length / 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = raw.readInt16LE(i * 2) / 32768
  return pcm
}
const POINTS = 20
/** The same Hz curve as tone-clip-curves.ts (the classifier's fixture). */
function hzCurve(track: PitchTrack, from: number, to: number): (number | null)[] {
  const frames: number[] = []
  for (let i = from; i < to; i++) if (track.f0[i]) frames.push(i)
  if (frames.length < 4) return []
  const start = frames[0], end = frames[frames.length - 1]
  return Array.from({ length: POINTS }, (_, p) => {
    const at = start + (end - start) * p / (POINTS - 1), a = Math.floor(at), b = Math.min(end, a + 1), fa = track.f0[a], fb = track.f0[b]
    if (!fa || !fb) return fa && at - a < 0.5 ? Math.round(fa * 10) / 10 : fb && at - a >= 0.5 ? Math.round(fb * 10) / 10 : null
    return Math.round(Math.exp(Math.log(fa) + (Math.log(fb) - Math.log(fa)) * (at - a)) * 10) / 10
  })
}
interface Verdict { clear: boolean; agrees: boolean; levels: (LevelCurve | null)[] }
function judge(bytes: Buffer, voice: string, tones: number[]): Verdict {
  const pcm = decode(bytes)
  const syllables = tones.length === 2 ? 2 : 1
  const clear = isClearClip(clipCurves(trackPitch(pcm, RATE, voiceBounds(voice)), voice, syllables), tones)
  const levels = clipCurves(trackPitch(pcm, RATE, voiceBounds(voice)), voice, syllables)
  const track = trackPitch(pcm, RATE, { ...voiceBounds(voice), threshold: 0.3 })
  const cut = syllables === 2 ? splitFrame(track) : undefined
  const hz = syllables === 1 ? [hzCurve(track, 0, track.f0.length)] : cut === undefined ? [[], []] : [hzCurve(track, 0, cut), hzCurve(track, cut, track.f0.length)]
  const agrees = tones.every((tone, i) => {
    const place: SyllablePlace = syllables === 1 ? 'single' : i === 0 ? 'first' : 'second'
    if (tone > 4) return true   // a neutral tone is not judged by the classifier
    return classifyTone(hz[i].map(v => (v ? toLevel(v, VOICE_RANGE[voice]) : null)), place)?.tone === tone
  })
  return { clear, agrees, levels }
}

const sizeOf = (items: ManifestItem[]) => items.flatMap(i => Object.values(i.clips)).reduce((sum, c) => sum + fs.statSync(path.join(OUT, c.file)).size, 0)
const table = (items: ManifestItem[]) => {
  const perVoice: Record<string, [number, number]> = {}
  for (const item of items) for (const voice of Object.keys(item.clips)) (perVoice[voice] ??= [0, 0])[item.kind === 'single' ? 0 : 1]++
  const groups: Record<string, number> = {}
  for (const item of items) if (item.kind === 'pair') groups[item.tones.join('')] = (groups[item.tones.join('')] ?? 0) + 1
  const bases = new Set(items.filter(i => i.kind === 'single').map(i => i.id.slice(2, -1)))
  return { perVoice, groups, bases: bases.size, items: items.length, clips: Object.values(perVoice).reduce((s, [a, b]) => s + a + b, 0) }
}
const before = { ...table(manifest.items), bytes: sizeOf(manifest.items) }

// ---- Judge every kept clip; remove the ones heard as another tone.
const removed: { id: string; voice: string }[] = []
const files = new Set<string>()
let items = manifest.items
for (const item of items) for (const [voice, clip] of Object.entries(item.clips)) {
  if (!judge(fs.readFileSync(path.join(OUT, clip.file)), voice, item.tones).agrees) { removed.push({ id: item.id, voice }); files.add(clip.file); delete item.clips[voice] }
}
const lost = items.filter(i => Object.keys(i.clips).length < 2)
for (const item of lost) for (const clip of Object.values(item.clips)) files.add(clip.file)
items = items.filter(i => Object.keys(i.clips).length >= 2)
// A single base keeps all four tones in two voices or goes.
const baseOf = (id: string) => id.slice(2).replace(/\d$/, '')
const droppedBases: string[] = []
for (const base of [...new Set(manifest.items.filter(i => i.kind === 'single').map(i => baseOf(i.id)))]) {
  const mine = items.filter(i => i.kind === 'single' && baseOf(i.id) === base)
  if (mine.length === 4) continue
  droppedBases.push(base)
  for (const item of mine) for (const clip of Object.values(item.clips)) files.add(clip.file)
  items = items.filter(i => !mine.includes(i))
  manifest.dropped.push({ id: 'base-' + base, reason: 'a tone has no clip the tone judge hears right in two voices' })
}

// ---- Refill short pair groups from the cache (rate 1 then 0.85, per voice), words in curriculum order.
const bands = [1, 2, 3, 4, 5, 6].map(n => JSON.parse(fs.readFileSync(path.join('src', 'data', 'v2', 'hsk-' + n + '.generated.json'), 'utf8')).vocabulary as { ch: string; lb: string }[])
const candidates = buildPairCandidates(bands)
const refilled: Record<string, number> = {}
const cached = (text: string, voice: string, rate: number) => {
  const key = path.join(CACHE, crypto.createHash('sha1').update([text, voice, rate].join('|')).digest('hex'))
  if (!fs.existsSync(key + '.mp3')) return undefined
  return { audio: fs.readFileSync(key + '.mp3'), meta: fs.existsSync(key + '.json') ? JSON.parse(fs.readFileSync(key + '.json', 'utf8')) as { t0?: number; t1?: number } : {} }
}
for (const key of [...candidates.keys()].sort()) {
  const have = () => items.filter(i => i.kind === 'pair' && i.tones.join('') === key)
  if (have().length >= PAIR_WORDS_PER_GROUP) continue
  const known = new Set([...items.map(i => i.id), ...manifest.items.map(i => i.id)])
  const found: { spec: ToneItem; clips: Record<string, { audio: Buffer; t0?: number; t1?: number }> }[] = []
  for (const spec of candidates.get(key)!.filter(c => !known.has(c.id))) {
    const clips: Record<string, { audio: Buffer; t0?: number; t1?: number }> = {}
    for (const voice of PREFERENCE) for (const rate of [1, 0.85]) {
      const c = cached(spec.chars, voiceName[voice], rate)
      if (!c) continue
      const v = judge(c.audio, voice, spec.tones)
      if (v.clear && v.agrees) { clips[voice] = { audio: c.audio, ...c.meta }; break }
    }
    if (Object.keys(clips).length >= 2) found.push({ spec, clips })
  }
  const strict = (f: (typeof found)[number]) => Object.keys(f.clips).length >= 3 && Object.keys(f.clips).some(male)
  const pick = [...found.filter(strict), ...found.filter(f => !strict(f))].slice(0, PAIR_WORDS_PER_GROUP - have().length)
  for (const f of pick) {
    const voices = PREFERENCE.filter(v => f.clips[v]).slice(0, MAX_VOICES)
    if (!voices.some(male)) { const m = PREFERENCE.find(v => f.clips[v] && male(v)); if (m) voices[voices.length - 1] = m }
    const clips: Record<string, Clip> = {}
    for (const voice of voices) {
      const file = voice + '/' + f.spec.id + '.mp3', c = f.clips[voice]
      if (!dry) { fs.mkdirSync(path.join(OUT, voice), { recursive: true }); fs.writeFileSync(path.join(OUT, file), c.audio) }
      clips[voice] = { file, chars: f.spec.chars, ...(c.t0 !== undefined ? { t0: Math.round(c.t0 * 1000) / 1000, t1: Math.round(c.t1! * 1000) / 1000 } : {}) }
    }
    items.push({ ...f.spec, clips }); refilled[key] = (refilled[key] ?? 0) + 1
  }
}

// ---- Write the manifest in the build script's order, delete the clips that went, write the levels fixture, report.
const order = (item: ManifestItem) => item.kind === 'single' ? [0, item.id] : [1, item.tones.join('')]
const index = new Map<string, number>(); for (const list of candidates.values()) list.forEach((c, i) => index.set(c.id, i))
items.sort((a, b) => { const [ka, sa] = order(a), [kb, sb] = order(b); return ka !== kb ? (ka as number) - (kb as number) : ka === 0 ? 0 : String(sa) < String(sb) ? -1 : String(sa) > String(sb) ? 1 : (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0) })
manifest.items = items
if (dry) { console.log(JSON.stringify({ removed: removed.length, lost: lost.length, droppedBases, refilled, before, after: table(items) })); process.exit(0) }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
const listed = new Set(items.flatMap(i => Object.values(i.clips).map(c => c.file)))
for (const f of fs.readdirSync(OUT, { recursive: true }) as string[]) { const name = f.replace(/\\/g, '/'); if (name.endsWith('.mp3') && !listed.has(name)) fs.rmSync(path.join(OUT, f)) }
const rows: string[] = []
let disagree = 0, unclear = 0
for (const item of items) for (const [voice, clip] of Object.entries(item.clips)) {
  const v = judge(fs.readFileSync(path.join(OUT, clip.file)), voice, item.tones)
  if (!v.agrees) disagree++
  if (!v.clear) unclear++
  rows.push(JSON.stringify({ id: item.id, voice, tones: item.tones, levels: v.levels.map(c => c ?? []) }))
}
fs.writeFileSync('src/core/tone-trainer/fixtures/clip-levels.json', '[\n' + rows.join(',\n') + '\n]\n')
console.log(JSON.stringify({ removed: removed.length, lost: lost.length, droppedBases, refilled, disagree, unclear, before, after: { ...table(items), bytes: sizeOf(items) } }))
