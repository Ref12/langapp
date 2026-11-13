# For each pinyin syllable+tone, lists characters whose only reading (per pypinyin heteronym data) is that syllable and tone,
# most familiar first: single-character curriculum words by HSK band, then characters used in curriculum words, then the
# writing-practice character set, then any other CJK ideograph. scripts/build-tone-audio.ts reads the committed JSON.
# Needs: pip install pypinyin. Run from the repository root: python scripts/tone-single-chars.py
import json
from pypinyin import pinyin, Style

chars = [e['character'] for e in json.load(open('src/data/characters/index.generated.json', encoding='utf-8'))['characters']]
rank = {}
for band in range(1, 7):
    for v in json.load(open('src/data/v2/hsk-%d.generated.json' % band, encoding='utf-8'))['vocabulary']:
        if len(v['ch']) == 1:
            rank.setdefault(v['ch'], band)
for band in range(1, 7):
    for v in json.load(open('src/data/v2/hsk-%d.generated.json' % band, encoding='utf-8'))['vocabulary']:
        for c in v['ch']:
            rank.setdefault(c, 7)
for c in chars:
    rank.setdefault(c, 8)
out = {}
for code in range(0x4E00, 0x9FA6):
    ch = chr(code)
    readings = set(pinyin(ch, style=Style.TONE3, heteronym=True, neutral_tone_with_five=True)[0])
    if len(readings) != 1:
        continue
    key = next(iter(readings))
    if not key[-1].isdigit():
        key += '5'
    out.setdefault(key, []).append(ch)
for key in out:
    out[key].sort(key=lambda c: (rank.get(c, 9), c))
    out[key] = out[key][:12]
json.dump(dict(sorted(out.items())), open('scripts/tone-single-chars.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
