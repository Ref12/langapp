# Pitch check for the tone trainer audio (a build-time tool, not part of the app or the test suite).
# Needs: pip install praat-parselmouth numpy matplotlib. Run from the repository root:
#   python scripts/check-tone-pitch.py check     [--out DIR]   measure every clip, write DIR/results.json and DIR/flagged.json (singles to re-make), print a table
#   python scripts/check-tone-pitch.py apply     [--out DIR]   drop clips flagged in DIR/results.json from the manifest (and items left with fewer than 2 voices), delete their files
#   python scripts/check-tone-pitch.py plot ID/VOICE ... [--out DIR]   a pitch plot per clip, written to DIR/plot-ID-VOICE.png
#   python scripts/check-tone-pitch.py calibrate CAL.json [--out DIR] [--voice xiaoxiao]   hit rates on known-good and deliberately mislabelled clips
#
# How a clip is judged
#  * Pitch: Praat autocorrelation (parselmouth) with a per-voice range (male 60-300 Hz, female 120-500 Hz), a 5 ms step and
#    octave-jump cost tuned for short clips; isolated frames and octave jumps are removed.
#  * Per voice: every voiced frame of all the voice's clips gives that voice's own range (5th to 95th percentile, in semitones);
#    a contour is turned into semitones and scaled to 0..1 inside that range, so male and female voices share one scale.
#  * Pairs: the word's start and end in the audio (t0, t1 in the manifest, from the endpoint's word timings) frame the word; the two
#    syllables are split in the middle third at the longest unvoiced gap, else at the intensity minimum, else in the middle.
#  * Each syllable becomes a 9-point contour. For each voice, and each position (single, first, second syllable), the median contour
#    of every tone 1-4 is its prototype (computed twice, the second time without clips that look like another tone). A syllable
#    passes when its labelled tone's prototype is the nearest of the four and it is not farther from it than the voice's own
#    spread for that tone. The neutral tone (second syllable only) passes when it is short or has no strong contour.
import json, os, sys
import numpy as np
import parselmouth

TONES = os.path.join('public', 'audio', 'tones')
RANGE = {'male': (60, 300), 'female': (120, 500)}
STEP = 0.005
MIN_FRAMES = 6   # voiced frames (30 ms) a syllable needs
POINTS = 9

def arg(name, default=None):
    a = sys.argv[1:]
    return a[a.index(name) + 1] if name in a else default

def pitch(path, gender):
    snd = parselmouth.Sound(path)
    lo, hi = RANGE[gender]
    p = snd.to_pitch_ac(time_step=STEP, pitch_floor=lo, pitch_ceiling=hi, very_accurate=False, silence_threshold=0.03,
                        voicing_threshold=0.45, octave_cost=0.01, octave_jump_cost=0.35, voiced_unvoiced_cost=0.14)
    inten = snd.to_intensity(minimum_pitch=lo, time_step=STEP)
    t = p.xs()
    f = clean(p.selected_array['frequency'])
    iv = np.array([inten.get_value(x) if inten.xmin <= x <= inten.xmax else np.nan for x in t])
    return t, f, iv

def clean(f):
    # drop a frame that jumps more than 5 semitones from both voiced neighbours (octave errors), then runs shorter than 3 frames
    f = f.copy()
    v = np.where(f > 0)[0]
    for i in range(1, len(v) - 1):
        a, b, c = f[v[i - 1]], f[v[i]], f[v[i + 1]]
        if abs(12 * np.log2(b / a)) > 5 and abs(12 * np.log2(b / c)) > 5: f[v[i]] = 0
    i = 0
    while i < len(f):
        if f[i] > 0:
            j = i
            while j < len(f) and f[j] > 0: j += 1
            if j - i < 3: f[i:j] = 0
            i = j
        else: i += 1
    return f

def runs(f):
    out, s = [], None
    for i, x in enumerate(f > 0):
        if x and s is None: s = i
        if not x and s is not None: out.append((s, i)); s = None
    if s is not None: out.append((s, len(f)))
    return out

def split(t, f, iv, t0, t1, n):
    """Voiced frame indices of each of n syllables, and the cut time (None for one syllable)."""
    lo = 0 if t0 is None else int(np.searchsorted(t, t0 - 0.03))
    hi = len(t) if t1 is None else int(np.searchsorted(t, t1 + 0.03))
    g = np.zeros_like(f); g[lo:hi] = f[lo:hi]
    rs = runs(g)
    if not rs: return [[] for _ in range(n)], None
    if n == 1:
        # merge runs closer than 60 ms, keep the longest group
        groups = [[rs[0]]]
        for r in rs[1:]:
            if (r[0] - groups[-1][-1][1]) * STEP < 0.06: groups[-1].append(r)
            else: groups.append([r])
        best = max(groups, key=lambda gr: sum(b - a for a, b in gr))
        return [[i for a, b in best for i in range(a, b)]], None
    first, last = rs[0][0], rs[-1][1]
    a, b = first + int((last - first) * 0.25), first + int((last - first) * 0.75)
    cut = None
    gaps = [(rs[i + 1][0] - rs[i][1], (rs[i][1] + rs[i + 1][0]) // 2) for i in range(len(rs) - 1)]
    gaps = [(w, c) for w, c in gaps if w >= 4 and a <= c <= b]
    if gaps: cut = max(gaps)[1]
    else:
        a2, b2 = first + int((last - first) * 0.3), first + int((last - first) * 0.7)
        seg = iv[a2:max(a2 + 1, b2)]
        cut = a2 + int(np.nanargmin(seg)) if len(seg) and not np.all(np.isnan(seg)) else (first + last) // 2
    idx = np.where(g > 0)[0]
    return [[int(i) for i in idx if i < cut], [int(i) for i in idx if i >= cut]], float(t[cut])

def contour(f, idx, lo, hi):
    """POINTS-point contour in 0..1 voice-range units from voiced frames idx; None when too short."""
    if len(idx) < MIN_FRAMES: return None
    st = (12 * np.log2(f[idx]) - lo) / (hi - lo)
    # the first 30 ms after a consonant release is perturbed: skip it when the syllable is long enough
    core = st[6:] if len(st) >= 20 else st
    return np.interp(np.linspace(0, len(core) - 1, POINTS), np.arange(len(core)), core)

def load_manifest():
    return json.load(open(os.path.join(TONES, 'manifest.json'), encoding='utf-8'))

def measure(manifest, extra=(), only=None):
    """Pitch of every clip in the manifest (plus extra (key, path, gender, t0, t1, ntones) tuples)."""
    G = {v['id']: v['gender'].lower() for v in manifest['voices']}
    recs = []
    for item in manifest['items']:
        for voice, clip in item['clips'].items():
            if only and voice != only: continue
            recs.append(dict(key=item['id'] + '/' + voice, id=item['id'], kind=item['kind'], voice=voice, gender=G[voice], tones=item['tones'], chars=clip['chars'],
                             file=clip['file'], path=os.path.join(TONES, clip['file']), t0=clip.get('t0'), t1=clip.get('t1')))
    for key, path, gender, t0, t1, tones in extra:
        recs.append(dict(key=key, id=key, kind='extra', voice='extra', gender=gender, tones=tones, chars='', file=path, path=path, t0=t0, t1=t1))
    for r in recs:
        r['t'], r['f'], r['iv'] = pitch(r['path'], r['gender'])
    return recs

def voice_ranges(recs):
    out = {}
    for voice in {r['voice'] for r in recs}:
        st = np.concatenate([12 * np.log2(r['f'][r['f'] > 0]) for r in recs if r['voice'] == voice and (r['f'] > 0).any()])
        out[voice] = tuple(float(x) for x in np.percentile(st, [5, 95]))
    return out

def syllables(r, rng):
    lo, hi = rng
    idxs, cut = split(r['t'], r['f'], r['iv'], r['t0'], r['t1'], len(r['tones']))
    r['cut'] = cut
    r['idx'] = idxs
    r['con'] = [contour(r['f'], ix, lo, hi) for ix in idxs]
    r['dur'] = [len(ix) * STEP for ix in idxs]

def position(r, i):
    return 'single' if len(r['tones']) == 1 else ('first' if i == 0 else 'second')

TRAIN = os.path.join('scripts', 'tone-pitch-train.json')
THRESHOLD = 0.4   # the labelled tone needs at least this probability from the classifier

def features(r, i):
    """Feature vector of syllable i of clip r: the contour, its shape numbers, position and the other syllable's tone."""
    c = r['con'][i]; n = len(r['tones'])
    shape = [c[:2].mean(), c[-2:].mean(), c.min(), c.max(), c.mean(), c.argmin() / (POINTS - 1), c.argmax() / (POINTS - 1), c[-2:].mean() - c.min(), c.max() - c[-2:].mean(), min(r['dur'][i], 0.5)]
    pos = [n == 1, n == 2 and i == 0, n == 2 and i == 1]
    other = [(n == 2 and r['tones'][1 - i] == k) for k in (1, 2, 3, 4, 5)]
    return [round(float(x), 4) for x in list(c) + shape] + [float(x) for x in pos + other]

def train_rows(recs):
    xs, ys = [], []
    for r in recs:
        for i, tone in enumerate(r['tones']):
            if tone in (1, 2, 3, 4) and r['con'][i] is not None: xs.append(features(r, i)); ys.append(tone)
    return xs, ys

def classifier():
    """Random forest trained on the Xiaoyi clips' syllables (their intended tones), a female voice that is not the calibration voice."""
    from sklearn.ensemble import RandomForestClassifier
    t = json.load(open(TRAIN, encoding='utf-8'))
    return RandomForestClassifier(500, min_samples_leaf=2, random_state=0, n_jobs=1).fit(np.array(t['x']), np.array(t['y']))

def judge_syllable(r, i, tone, model):
    """(ok, reason) for syllable i of clip r being labelled tone."""
    con = r['con'][i]
    if tone == 5:
        if con is None: return False, 'neutral: no voiced frames'
        first = r['dur'][0] if r['dur'][0] else 0.25
        ok = r['dur'][i] <= max(first, 0.25) * 1.15 or abs(con[-1] - con[0]) < 0.25
        return ok, 'neutral should be short with no strong contour'
    if con is None: return False, 'syllable %d: only %d voiced frames' % (i + 1, len(r['idx'][i]))
    lab = list(r['tones']); lab[i] = tone
    probe = dict(r); probe['tones'] = lab
    p = model.predict_proba([features(probe, i)])[0]
    cls = [int(x) for x in model.classes_]
    pt = float(p[cls.index(tone)])
    if pt < THRESHOLD:
        near = cls[int(np.argmax(p))]
        return False, 'syllable %d looks like tone %d (tone %d scores %.2f)' % (i + 1, near, tone, pt)
    return True, ''

def judge(r, model, labels=None):
    labels = labels or r['tones']
    res = [judge_syllable(r, i, t, model) for i, t in enumerate(labels)]
    bad = [x[1] for x in res if not x[0]]
    return not bad, '; '.join(bad)

def summarise(rows):
    summary = {}
    for r in rows:
        s = summary.setdefault((r['voice'], r['kind']), [0, 0]); s[0] += 1; s[1] += 0 if r['ok'] else 1
    for (voice, kind), (n, bad) in sorted(summary.items()): print('%-8s %-6s clips %4d flagged %3d' % (voice, kind, n, bad))

def run_check(manifest):
    recs = measure(manifest)
    ranges = voice_ranges(recs)
    for r in recs: syllables(r, ranges[r['voice']])
    model = classifier()
    for r in recs: r['ok'], r['reason'] = judge(r, model)
    return recs, ranges, model

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    out = arg('--out', os.path.join(os.environ.get('TMPDIR', '/tmp'), 'tone-check'))
    os.makedirs(out, exist_ok=True)
    manifest = load_manifest()
    if mode == 'check' or mode == 'apply':
        if mode == 'apply' and os.path.exists(os.path.join(out, 'results.json')): rows = json.load(open(os.path.join(out, 'results.json'), encoding='utf-8'))
        else:
            recs, _, _ = run_check(manifest)
            rows = [{k: r[k] for k in ('key', 'id', 'kind', 'voice', 'chars', 'file', 'ok', 'reason')} for r in recs]
            json.dump(rows, open(os.path.join(out, 'results.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            json.dump([{'id': r['id'], 'voice': r['voice']} for r in rows if not r['ok'] and r['kind'] == 'single'], open(os.path.join(out, 'flagged.json'), 'w'))
        if mode == 'check': summarise(rows); return
        bad = {r['key'] for r in rows if not r['ok']}
        dropped = manifest.setdefault('dropped', [])
        keep = []
        for item in manifest['items']:
            for voice in list(item['clips']):
                if item['id'] + '/' + voice in bad:
                    dropped.append({'id': item['id'] + '/' + voice, 'reason': 'pitch check'})
                    f = os.path.join(TONES, item['clips'][voice]['file'])
                    if os.path.exists(f): os.remove(f)
                    del item['clips'][voice]
            if len(item['clips']) < 2:
                for clip in item['clips'].values():
                    f = os.path.join(TONES, clip['file'])
                    if os.path.exists(f): os.remove(f)
                dropped.append({'id': item['id'], 'reason': 'fewer than 2 voices after the pitch check'})
            else: keep.append(item)
        # a group that has more than 12 words after a build with spare candidates keeps its first 12 (curriculum order); the rest are removed without being marked as failed
        seen, trimmed = {}, []
        for it in keep:
            if it['kind'] == 'pair':
                g = '-'.join(map(str, it['tones'])); seen[g] = seen.get(g, 0) + 1
                if seen[g] > 12:
                    for clip in it['clips'].values():
                        f = os.path.join(TONES, clip['file'])
                        if os.path.exists(f): os.remove(f)
                    continue
            trimmed.append(it)
        keep = trimmed
        manifest['items'] = keep
        json.dump(manifest, open(os.path.join(TONES, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        open(os.path.join(TONES, 'manifest.json'), 'a').write('\n')
        counts = {}
        for it in keep:
            if it['kind'] == 'pair': counts['-'.join(map(str, it['tones']))] = counts.get('-'.join(map(str, it['tones'])), 0) + 1
        print('items left', len(keep), 'pair groups', dict(sorted(counts.items())))
    elif mode == 'train':
        recs = measure(manifest, only='xiaoyi'); ranges = voice_ranges(recs)
        for r in recs: syllables(r, ranges['xiaoyi'])
        xs, ys = train_rows(recs)
        json.dump({'note': 'syllable features of the xiaoyi clips (python scripts/check-tone-pitch.py train)', 'x': xs, 'y': ys}, open(TRAIN, 'w'), separators=(',', ':'))
        print('trained on', len(ys), 'syllables')
    elif mode == 'plot': plot(manifest, out)
    elif mode == 'calibrate': calibrate(manifest, out)

def calibrate(manifest, out):
    cal = json.load(open(sys.argv[2], encoding='utf-8'))
    voice = arg('--voice', 'xiaoxiao')
    recs, ranges, model = run_check(manifest)
    by = {r['key']: r for r in recs}
    res = {}
    for name in ('good', 'bad'):
        hits, detail = 0, []
        for c in cal[name]:
            r = by.get(c['id'] + '/' + voice)
            if r is None: detail.append((c['id'], 'missing')); continue
            ok, why = judge(r, model, c['label'])
            right = ok if name == 'good' else (not ok)
            hits += right
            detail.append((c['id'], c['label'], 'pass' if ok else 'fail', 'right' if right else 'WRONG', why))
        res[name] = (hits, len(cal[name]), detail)
        print('%s: %d of %d right (%s)' % (name, hits, len(cal[name]), 'passed by the check' if name == 'good' else 'rejected by the check'))
        for d in detail:
            if 'WRONG' in d or 'missing' in d: print('   ', d)
    json.dump({k: [v[0], v[1], [list(map(str, d)) for d in v[2]]] for k, v in res.items()}, open(os.path.join(out, 'calibration.json'), 'w'), ensure_ascii=False, indent=1)

def plot(manifest, out):
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    keys = [a for a in sys.argv[2:] if '/' in a and not a.startswith('--') and a != out]
    recs, ranges, model = run_check(manifest)
    by = {r['key']: r for r in recs}
    for key in keys:
        r = by[key]; lo, hi = ranges[r['voice']]
        fig, ax = plt.subplots(figsize=(7, 3.6))
        voiced = r['f'] > 0
        ax.plot(r['t'][voiced], (12 * np.log2(r['f'][voiced]) - lo) / (hi - lo), '.', color='#bbbbbb', label='pitch (Praat), voice range 0..1')
        cols = ['#d62728', '#1f77b4']
        for i, ix in enumerate(r['idx']):
            if ix: ax.plot(r['t'][ix], (12 * np.log2(r['f'][ix]) - lo) / (hi - lo), '.', color=cols[i], label='syllable %d (tone %d)' % (i + 1, r['tones'][i]))
        if r['cut']: ax.axvline(r['cut'], color='k', ls=':', label='syllable split')
        if r['t0'] is not None: ax.axvspan(r['t0'], r['t1'], color='#fff2b3', alpha=.5, label='word timing')
        ax.set_xlabel('seconds'); ax.set_ylabel('semitones in the voice range (0 low, 1 high)')
        ax.set_title('%s  %s  %s  tones %s  ->  %s' % (r['voice'], r['id'], r['chars'], '-'.join(map(str, r['tones'])), 'PASS' if r['ok'] else 'FAIL: ' + r['reason'][:60]), fontsize=9)
        ax.legend(fontsize=7, loc='best'); fig.tight_layout()
        p = os.path.join(out, 'plot-%s.png' % key.replace('/', '-')); fig.savefig(p, dpi=110); plt.close(fig); print(p)

if __name__ == '__main__': main()
