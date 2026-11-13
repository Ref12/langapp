# Pitch check for the tone trainer audio (a build-time tool, not part of the app or the test suite).
# Needs: pip install praat-parselmouth numpy matplotlib. Run from the repository root:
#   python scripts/check-tone-pitch.py check  [--out DIR]   measure every clip, write DIR/results.json, DIR/flagged.json, plots of flagged clips
#   python scripts/check-tone-pitch.py apply  [--out DIR]   drop clips flagged in DIR/results.json from the manifest (and items left with fewer than 2 voices)
# Each clip's F0 is measured with Praat (parselmouth), turned into semitones and normalised per voice (against the
# voice's median F0 over all clips). Tone 1 must be high and level, 2 must rise, 3 must be low or dip (not high, not
# a big rise), 4 must fall; neutral is loose (short, no strong contour). Two-syllable words are split on the voiced segments.
import json, os, sys
import numpy as np
import parselmouth

TONES = os.path.join('public', 'audio', 'tones')
args = sys.argv[1:]
mode = args[0] if args else 'check'
out_dir = args[args.index('--out') + 1] if '--out' in args else os.path.join(os.environ.get('TMPDIR', '/tmp'), 'tone-check')
os.makedirs(out_dir, exist_ok=True)
manifest = json.load(open(os.path.join(TONES, 'manifest.json'), encoding='utf-8'))

# Male voices sit near 100 Hz, female near 220 Hz: a per-voice range, with a high octave-jump cost, keeps Praat off octave errors.
RANGE = {'male': (60, 250), 'female': (100, 450)}
GENDER = {v['id']: v['gender'].lower() for v in manifest['voices']}

def contour(path, voice):
    snd = parselmouth.Sound(path)
    lo, hi = RANGE[GENDER[voice]]
    pitch = snd.to_pitch_ac(time_step=0.01, pitch_floor=lo, pitch_ceiling=hi, very_accurate=True, voicing_threshold=0.35, octave_cost=0.05, octave_jump_cost=0.8, voiced_unvoiced_cost=0.2)
    t = pitch.xs()
    f0 = pitch.selected_array['frequency']
    inten = snd.to_intensity(minimum_pitch=lo, time_step=0.01)
    return t, f0, inten

def segments(t, f0, want):
    # voiced runs of at least 30 ms; for two syllables cut at the largest gap between runs, each side is one syllable (fragments of a syllable stay together)
    voiced = f0 > 0
    runs, start = [], None
    for i, v in enumerate(voiced):
        if v and start is None: start = i
        if not v and start is not None: runs.append([start, i]); start = None
    if start is not None: runs.append([start, len(voiced)])
    runs = [r for r in runs if r[1] - r[0] >= 3]
    if want == 1 or len(runs) < 2:
        return [max(runs, key=lambda r: r[1] - r[0])] if (runs and want == 1) else runs
    gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
    cut = int(np.argmax(gaps))
    left, right = runs[:cut + 1], runs[cut + 1:]
    return [[left[0][0], left[-1][1]], [right[0][0], right[-1][1]]]

def split_continuous(t, f0, inten, seg):
    # one voiced run for two syllables: cut at the intensity minimum in the middle part
    a, b = seg
    lo, hi = a + int((b - a) * 0.3), a + int((b - a) * 0.7)
    best, bv = None, 1e9
    for i in range(lo, max(lo + 1, hi)):
        v = inten.get_value(t[i]) if t[i] >= inten.xmin and t[i] <= inten.xmax else None
        if v is not None and v < bv: bv, best = v, i
    cut = best if best is not None else (a + b) // 2
    return [[a, cut], [cut, b]]

def features(t, f0, seg, ref):
    a, b = seg
    st = 12 * np.log2(f0[a:b] / ref)
    ok = f0[a:b] > 0
    st = st[ok]
    n = len(st)
    trim = max(1, int(n * 0.1))
    core = st[trim:n - trim] if n > 2 * trim + 2 else st
    q = max(1, len(core) // 4)
    start, end = float(np.median(core[:q])), float(np.median(core[-q:]))
    return {'start': start, 'end': end, 'delta': end - start, 'mean': float(np.mean(core)), 'min': float(np.min(core)),
            'dur': float((b - a) * 0.01), 'curve': [float(x) for x in core]}

def judge(tone, f, first_dur, final):
    d, m = f['delta'], f['mean']
    if tone == 1: return (abs(d) < 3.0 and m > -1.5), 'high and level'
    if tone == 2: return (f['end'] - f['min'] >= 1.5 and d > -4.0), 'rising'
    if tone == 3: return (m <= 1.0 and d < 4.5 and f['min'] <= f['start'] + 0.5), 'low or dipping'
    if tone == 4: return d <= (-3.0 if final else -2.0), 'falling'
    return (f['dur'] <= max(first_dur, 0.25) * 1.0 or abs(d) < 3.5), 'short, no strong contour'

clips = []
for item in manifest['items']:
    for voice, clip in item['clips'].items():
        clips.append((item, voice, clip))

# per-voice reference: median F0 over every voiced frame of that voice
refs = {}
cache = {}
for voice in {v for _, v, _ in clips}:
    allf = []
    for item, v, clip in clips:
        if v != voice: continue
        t, f0, inten = contour(os.path.join(TONES, clip['file']), voice)
        cache[(item['id'], voice)] = (t, f0, inten)
        allf.extend(f0[f0 > 0])
    refs[voice] = float(np.median(allf))

results = []
for item, voice, clip in clips:
    t, f0, inten = cache[(item['id'], voice)]
    want = len(item['tones'])
    segs = segments(t, f0, want)
    reason = None
    if len(segs) < want:
        if want == 2 and len(segs) == 1: segs = split_continuous(t, f0, inten, segs[0])
        else: reason = 'no voiced segment' if not segs else 'segments missing'
    if want == 1 and len(segs) > 1:  # the longest voiced run
        segs = [max(segs, key=lambda s: s[1] - s[0])]
    verdicts = []
    if reason is None:
        feats = [features(t, f0, s, refs[voice]) for s in segs[:want]]
        for i, (tone, f) in enumerate(zip(item['tones'], feats)):
            ok, expect = judge(tone, f, feats[0]['dur'], i == want - 1)
            verdicts.append({'tone': tone, 'ok': bool(ok), 'expect': expect, 'delta': round(f['delta'], 1), 'mean': round(f['mean'], 1), 'dur': round(f['dur'], 2)})
        ok = all(v['ok'] for v in verdicts)
        if not ok: reason = 'tone ' + ','.join(str(v['tone']) for v in verdicts if not v['ok']) + ' not ' + ' / '.join(v['expect'] for v in verdicts if not v['ok'])
    else:
        ok = False
    results.append({'id': item['id'], 'kind': item['kind'], 'voice': voice, 'chars': clip['chars'], 'file': clip['file'], 'ok': ok, 'reason': reason, 'verdicts': verdicts})

json.dump(results, open(os.path.join(out_dir, 'results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if mode == 'check':
    flagged = [r for r in results if not r['ok']]
    json.dump([{'id': r['id'], 'voice': r['voice']} for r in flagged if r['kind'] == 'single'], open(os.path.join(out_dir, 'flagged.json'), 'w'))
    summary = {}
    for r in results:
        k = (r['voice'], r['kind']); s = summary.setdefault(k, [0, 0]); s[0] += 1; s[1] += 0 if r['ok'] else 1
    for (voice, kind), (n, bad) in sorted(summary.items()): print('%-8s %-6s clips %4d flagged %3d' % (voice, kind, n, bad))
elif mode == 'apply':
    bad = {(r['id'], r['voice']) for r in results if not r['ok']}
    dropped = manifest.setdefault('dropped', [])
    keep = []
    for item in manifest['items']:
        for voice in list(item['clips']):
            if (item['id'], voice) in bad:
                dropped.append({'id': item['id'] + '/' + voice, 'reason': 'pitch check: still flagged'})
                f = os.path.join(TONES, item['clips'][voice]['file'])
                if os.path.exists(f): os.remove(f)
                del item['clips'][voice]
        if len(item['clips']) < 2:
            for voice, clip in item['clips'].items():
                f = os.path.join(TONES, clip['file'])
                if os.path.exists(f): os.remove(f)
            dropped.append({'id': item['id'], 'reason': 'fewer than 2 voices after the pitch check'})
        else:
            keep.append(item)
    manifest['items'] = keep
    json.dump(manifest, open(os.path.join(TONES, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('items left', len(keep))
