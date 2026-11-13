// Writes src/core/tone-trainer/fixtures/clip-curves.json: the pitch curve (Hz, 20 points per syllable) of every shipped tone clip, tracked as the browser does (pitch.ts).
// The speaking practice's classifier is tuned and tested on these (classify.test.ts), so the test needs no mp3 decoder.
// Needs ffmpeg on the PATH. Run: npx tsx scripts/tone-clip-curves.ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { trackPitch, voiceBounds, splitFrame, type PitchTrack } from '../src/core/tone-trainer/pitch'
import type { ToneManifest } from '../src/core/tone-trainer/manifest'

const RATE = 24000
const dir = 'public/audio/tones/'
const manifest = JSON.parse(fs.readFileSync(dir + 'manifest.json', 'utf8')) as ToneManifest
const POINTS = 20
/** A syllable's voiced frames in [from, to) resampled to POINTS points in Hz (a point beside a gap is null), the way pitch.ts makes its level curves. */
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
const out: { id: string; voice: string; tones: number[]; hz: (number | null)[][] }[] = []
for (const item of manifest.items) for (const [voice, clip] of Object.entries(item.clips)) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', dir + clip.file, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-'], { maxBuffer: 1 << 26 })
  const pcm = new Float32Array(raw.length / 2)
  for (let i = 0; i < pcm.length; i++) pcm[i] = raw.readInt16LE(i * 2) / 32768
  const syllables = item.tones.length === 2 ? 2 : 1
  const track = trackPitch(pcm, RATE, { ...voiceBounds(voice), threshold: Number(process.env.THRESH ?? 0.3) })
  const cut = syllables === 2 ? splitFrame(track) : undefined
  const hz = syllables === 1 ? [hzCurve(track, 0, track.f0.length)] : cut === undefined ? [[], []] : [hzCurve(track, 0, cut), hzCurve(track, cut, track.f0.length)]
  out.push({ id: item.id, voice, tones: item.tones, hz })
}
// One line per clip keeps the file readable in a diff.
fs.writeFileSync('src/core/tone-trainer/fixtures/clip-curves.json', '[\n' + out.map(row => JSON.stringify(row)).join(',\n') + '\n]\n')
console.log(out.length + ' clips')
