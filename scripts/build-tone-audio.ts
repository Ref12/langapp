// Builds the tone trainer's audio: public/audio/tones/<voice>/<item-id>.mp3 and public/audio/tones/manifest.json.
// Needs the root dev server running (npx vite --port 5173): it synthesises through POST /__local/tts, so there is no second Edge client.
// Pairs: each tone-pair group is filled down the curriculum candidate list to 12 words that the pitch check has not dropped
// (the manifest's "dropped" list is never retried); each pair clip also records the word's start and end in the audio (t0, t1,
// from the endpoint's word timings), which scripts/check-tone-pitch.py uses to split the two syllables.
// Cycle: build, python scripts/check-tone-pitch.py check, build --regen <out>/flagged.json (singles), check, apply, build, check, apply ... until no gaps.
// Run: npx tsx scripts/build-tone-audio.ts [--server http://127.0.0.1:5173]
//      npx tsx scripts/build-tone-audio.ts --regen scripts/tone-audio-flagged.json   (re-make flagged single clips with the next character)
// Files that already exist are skipped, so a rerun only fills gaps. Singles come from scripts/tone-single-chars.json
// (python scripts/tone-single-chars.py): a character whose only reading is that syllable and tone. An item with no such
// character is dropped and listed in the manifest ("dropped"), as the local endpoint escapes its text and takes no SSML.
import fs from 'node:fs'
import path from 'node:path'
import { LOCAL_TTS_HEADER } from '../src/core/local-tts-contracts'
import { buildPairCandidates, buildSingles, PAIR_WORDS_PER_GROUP, type ToneItem } from '../src/core/tone-trainer/items'

// Eight singles have no character with only that reading: a common character whose other reading is rare (the check decides whether it stays).
export const FALLBACK_SINGLE_CHARS: Record<string, string[]> = {
  ba3: ['把', '靶'], da3: ['打'], fang4: ['放'], guo4: ['过'], qie3: ['且'], shao3: ['少'], tao4: ['套'], zhao2: ['着'],
}

export const TONE_VOICES = [
  { id: 'xiaoxiao', voice: 'zh-CN-XiaoxiaoNeural', gender: 'Female' },
  { id: 'xiaoyi', voice: 'zh-CN-XiaoyiNeural', gender: 'Female' },
  { id: 'yunxi', voice: 'zh-CN-YunxiNeural', gender: 'Male' },
  { id: 'yunjian', voice: 'zh-CN-YunjianNeural', gender: 'Male' },
] as const

const OUT = path.join('public', 'audio', 'tones')
// The local endpoint allows 4 active requests at once (scripts/local-tts.ts).
const CONCURRENCY = 4
const RETRIES = 8
const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const server = flag('--server') ?? 'http://127.0.0.1:5173'

interface Clip { file: string; chars: string; t0?: number; t1?: number }
interface ManifestItem extends ToneItem { clips: Record<string, Clip> }
interface Manifest { version: 1; voices: { id: string; voice: string; gender: string }[]; dropped: { id: string; reason: string }[]; items: ManifestItem[] }

const readJson = <T>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function synth(text: string, voice: string): Promise<{ audio: Buffer; t0?: number; t1?: number }> {
  let last: unknown
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      const response = await fetch(server + '/__local/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [LOCAL_TTS_HEADER]: '1' },
        body: JSON.stringify({ text, voice, rate: 1 }),
      })
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + (await response.text()).slice(0, 120))
      const body = await response.json() as { audio: { base64: string }; wordBoundaries?: { startTime: number; duration: number }[] }
      const audio = Buffer.from(body.audio.base64, 'base64')
      if (audio.length < 500) throw new Error('audio too short')
      const words = body.wordBoundaries ?? []
      if (!words.length) return { audio }
      return { audio, t0: Math.min(...words.map(w => w.startTime)), t1: Math.max(...words.map(w => w.startTime + w.duration)) }
    } catch (error) {
      last = error
      await sleep(Math.min(8000, 300 * 2 ** attempt))
    }
  }
  throw new Error('synthesis failed for ' + text + ' / ' + voice + ': ' + String(last))
}

async function pool<T>(jobs: T[], work: (job: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) { const job = jobs[next++]; await work(job) }
  }))
}

async function main() {
  const bands = [1, 2, 3, 4, 5, 6].map(n => readJson<{ vocabulary: { ch: string; lb: string }[] }>(path.join('src', 'data', 'v2', 'hsk-' + n + '.generated.json')).vocabulary)
  const singleChars = readJson<Record<string, string[]>>(path.join('scripts', 'tone-single-chars.json'))
  for (const [key, chars] of Object.entries(FALLBACK_SINGLE_CHARS)) if (!(singleChars[key]?.length)) singleChars[key] = chars
  const singles = buildSingles(bands, singleChars)
  const manifestPath = path.join(OUT, 'manifest.json')
  const previous = fs.existsSync(manifestPath) ? readJson<Manifest>(manifestPath) : undefined
  const regen = flag('--regen') ? readJson<{ id: string; voice: string }[]>(flag('--regen')!) : []

  const dropped: Manifest['dropped'] = [...(previous?.dropped ?? [])]
  const isDropped = (key: string) => dropped.some(d => d.id === key)
  // Pairs: the first 12 candidates of each group that have not been dropped.
  const pairs: ToneItem[] = []
  const candidates = buildPairCandidates(bands)
  // A group that is short of 12 words gets --spare more candidates at once (default 6) so that a hard group (4-4) fills in fewer rounds; the check's apply step trims a full group back to 12.
  const spare = Number(flag('--spare') ?? 6)
  for (const key of [...candidates.keys()].sort()) {
    const live = candidates.get(key)!.filter(c => !isDropped(c.id))
    const kept = live.filter(c => previous?.items.some(p => p.id === c.id)).length
    pairs.push(...live.slice(0, kept >= PAIR_WORDS_PER_GROUP ? PAIR_WORDS_PER_GROUP : PAIR_WORDS_PER_GROUP + spare))
  }
  const items: ManifestItem[] = []
  for (const item of [...singles, ...pairs]) {
    if (isDropped(item.id)) continue
    if (!item.chars) { dropped.push({ id: item.id, reason: 'no character to speak' }); continue }
    const before = previous?.items.find(p => p.id === item.id)
    items.push({ ...item, clips: before?.clips ?? {} })
  }
  // Regeneration: the next unused alternate character for that voice's clip of a single.
  const jobs: { item: ManifestItem; voice: (typeof TONE_VOICES)[number]; chars: string; force: boolean }[] = []
  for (const r of regen) {
    const item = items.find(i => i.id === r.id)
    const voice = TONE_VOICES.find(v => v.id === r.voice)
    if (!item || !voice || item.kind !== 'single') continue
    const tried = new Set([item.chars, ...Object.values(item.clips).map(c => c.chars)])
    const used = item.clips[voice.id]?.chars
    const options = [item.chars, ...(item.alternates ?? [])]
    const next = options.find(c => !tried.has(c) || (c !== used && !(previous?.items.find(p => p.id === item.id)?.tried ?? []).includes(c)))
    if (!next) { dropped.push({ id: item.id + '/' + voice.id, reason: 'no further character to try' }); delete item.clips[voice.id]; continue }
    jobs.push({ item, voice, chars: next, force: true })
  }
  const regenerating = new Set(jobs.map(j => j.item.id + '/' + j.voice.id))
  for (const item of items) for (const voice of TONE_VOICES) {
    if (regenerating.has(item.id + '/' + voice.id) || isDropped(item.id + '/' + voice.id)) continue
    jobs.push({ item, voice, chars: item.clips[voice.id]?.chars ?? item.chars, force: false })
  }
  for (const voice of TONE_VOICES) fs.mkdirSync(path.join(OUT, voice.id), { recursive: true })
  let made = 0, skipped = 0
  await pool(jobs, async ({ item, voice, chars, force }) => {
    const file = voice.id + '/' + item.id + '.mp3'
    const full = path.join(OUT, file)
    const known = previous?.items.find(p => p.id === item.id)?.clips[voice.id]
    if (!force && fs.existsSync(full) && (item.kind === 'single' || known?.t0 !== undefined)) { item.clips[voice.id] = { ...known, file, chars }; skipped++; return }
    const made1 = await synth(chars, voice.voice)
    fs.writeFileSync(full, made1.audio)
    item.clips[voice.id] = { file, chars, ...(made1.t0 !== undefined ? { t0: Math.round(made1.t0 * 1000) / 1000, t1: Math.round(made1.t1! * 1000) / 1000 } : {}) }
    made++
    if (made % 100 === 0) console.log('made', made)
  })
  const tried = (id: string) => [...new Set([...(previous?.items.find(p => p.id === id)?.tried ?? []), ...Object.values(items.find(i => i.id === id)!.clips).map(c => c.chars)])]
  const manifest: Manifest = {
    version: 1,
    voices: TONE_VOICES.map(v => ({ ...v })),
    dropped,
    items: items.map(i => ({ ...i, ...(i.kind === 'single' ? { tried: tried(i.id) } : {}) })) as ManifestItem[],
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n')
  console.log('made', made, 'skipped', skipped, 'items', items.length, 'dropped', dropped.length)
}

void main()
