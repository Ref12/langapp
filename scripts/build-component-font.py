#!/usr/bin/env python3
"""Builds the small parts font: src/fonts/lw-parts.woff2 (+ src/data/characters/part-glyphs.generated.json and src/components/characters/parts-font.generated.css).

 (a) A subset of Noto Sans CJK SC (SIL OFL 1.1) with only the glyphs phones are likely to lack: the CJK Radicals Supplement block and the
     other bound forms the component data uses (components outside the main CJK block, plus any component with no meaning source).
 (b) Normalised Private Use Area glyphs for parts that have no font character (Make Me a Hanzi writes them as ？). The shape is the
     character's own strokes that no sibling part claims (Make Me a Hanzi graphics.txt, Arphic Public Licence), cropped to its box and
     scaled to fill 80% of the em box so it reads as a standalone character.

Inputs (all pinned or installed): the Noto Sans CJK SC face of NotoSansCJK-Regular.ttc (Debian/Ubuntu package fonts-noto-cjk), Make Me a Hanzi
graphics.txt from node_modules/.cache/components-sources (node scripts/build-components.mjs downloads it, SHA-256 checked; this script also
downloads it when missing), and public/characters/chinese/components.generated.json.
Needs: pip install fonttools brotli.   Run from the repository root:  python3 scripts/build-component-font.py [--noto path.ttc] [--check]
"""
import hashlib, io, json, os, sys, urllib.request
from fontTools.ttLib import TTCollection, TTFont, newTable
from fontTools.subset import Subsetter, Options
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.svgLib.path import parse_path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGS = sys.argv[1:]
NOTO = ARGS[ARGS.index('--noto') + 1] if '--noto' in ARGS else '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
GRAPHICS_SHA = 'a28c478b5178e98f67f510b2d52fde08a69dc664654ef43498253b9b764d46ee'
GRAPHICS_URL = 'https://raw.githubusercontent.com/skishore/makemeahanzi/bddc96d41bef78427ed0e034e9f7e31d71fd1b92/graphics.txt'
CACHE = os.path.join(ROOT, 'node_modules/.cache/components-sources/graphics-' + GRAPHICS_SHA[:12])
OUT_FONT = os.path.join(ROOT, 'src/fonts/lw-parts.woff2')
OUT_MAP = os.path.join(ROOT, 'src/data/characters/part-glyphs.generated.json')
OUT_CSS = os.path.join(ROOT, 'src/components/characters/parts-font.generated.css')
PUA_START = 0xE000
FILL = 0.80

def graphics():
    if not os.path.exists(CACHE):
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        data = urllib.request.urlopen(GRAPHICS_URL, timeout=120).read()
        if hashlib.sha256(data).hexdigest() != GRAPHICS_SHA: sys.exit('graphics.txt does not match its pinned SHA-256')
        open(CACHE, 'wb').write(data)
    data = open(CACHE, 'rb').read()
    if hashlib.sha256(data).hexdigest() != GRAPHICS_SHA: sys.exit('cached graphics.txt does not match its pinned SHA-256')
    return {d['character']: d for d in map(json.loads, data.decode('utf8').splitlines())}

doc = json.load(open(os.path.join(ROOT, 'public/characters/chinese/components.generated.json'), encoding='utf8'))

# ---------- which parts have no font character, and which strokes are theirs ----------
def shape_text(node):
    """The node's IDS text expanded to its leaves; None when it holds a placeholder or an unnamed leaf (the key that lets identical shapes share one glyph)."""
    if node.get('u'): return None
    if node.get('k'):
        kids = [shape_text(k) for k in node['k']]
        return None if None in kids else node['d'] + ''.join(kids)
    return node.get('c') or None

def lacks_font(c, cmap):
    """A part character outside the main CJK block that Noto cannot show either: phones may not have it, so it is drawn."""
    cp = ord(c)
    return not (0x4E00 <= cp <= 0x9FFF) and cp not in cmap

def unencoded_parts(cmap):
    """({(character, (stroke indexes)): shape text or None}, missing chars): the parts drawn from strokes (placeholders, groups no character names,
    characters no font has), each with the strokes that are its own; mirrors describeParts in src/core/characters/components.ts."""
    found, missing = {}, set()
    for ch, c in doc['characters'].items():
        def walk(node, strokes):
            kids = node.get('k') or []
            claimed = {s for k in kids if not k.get('u') for s in k['s']}
            rest = [s for s in strokes if s not in claimed]
            loose = [k for k in kids if k.get('u') or (not k.get('c') and not k['s'])]
            for k in kids:
                lacking = not k.get('u') and bool(k.get('c')) and lacks_font(k['c'], cmap)
                own = k['s'] or (rest if k in loose and len(loose) == 1 else [])
                if (k.get('u') or not k.get('c') or lacking) and own:
                    found[(ch, tuple(own))] = None if k.get('u') else shape_text(k)
                    if lacking: missing.add(k['c'])
                if k.get('k'): walk(k, own)
        walk(c, list(range(c['n'])))
    return found, sorted(missing)

# ---------- (a) bound forms ----------
def bound_forms(cmap):
    wanted = {cp for cp in range(0x2E80, 0x2F00) if cp in cmap}
    for form, c in doc['components'].items():
        if c['block'] != 'URO' or c['status'] == 'unknown':
            if ord(form) in cmap: wanted.add(ord(form))
    return sorted(wanted)

def to_ranges(codes):
    out, start, prev = [], None, None
    for c in codes:
        if start is None: start = prev = c
        elif c == prev + 1: prev = c
        else: out.append((start, prev)); start = prev = c
    if start is not None: out.append((start, prev))
    return ', '.join('U+%X' % a if a == b else 'U+%X-%X' % (a, b) for a, b in out)

def otf_to_ttf(f):
    gs = f.getGlyphSet(); order = f.getGlyphOrder(); glyphs = {}
    for n in order:
        pen = TTGlyphPen(gs); gs[n].draw(Cu2QuPen(pen, 1.0, reverse_direction=True)); glyphs[n] = pen.glyph()
    f['loca'] = newTable('loca'); f['glyf'] = g = newTable('glyf'); g.glyphOrder = order; g.glyphs = glyphs
    del f['CFF ']
    if 'VORG' in f: del f['VORG']
    g.compile(f)
    f['maxp'] = m = newTable('maxp'); m.tableVersion = 0x00010000
    for a in 'numGlyphs maxZones maxTwilightPoints maxStorage maxFunctionDefs maxInstructionDefs maxStackElements maxSizeOfInstructions maxComponentElements'.split(): setattr(m, a, 0)
    m.numGlyphs = len(order); m.maxZones = 1; m.maxPoints = m.maxContours = m.maxCompositePoints = m.maxCompositeContours = m.maxComponentDepth = 0
    f['post'].formatType = 2.0; f['post'].extraNames = []; f['post'].mapping = {}; f['post'].glyphOrder = order
    f.sfntVersion = '\0\1\0\0'

def main():
    face = TTCollection(NOTO).fonts[[i for i, f in enumerate(TTCollection(NOTO).fonts) if f['name'].getDebugName(1) == 'Noto Sans CJK SC'][0]]
    cmap = face.getBestCmap()
    bound = bound_forms(cmap)
    opts = Options(); opts.layout_features = []; opts.hinting = False; opts.notdef_outline = False; opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.drop_tables += ['GSUB', 'GPOS', 'GDEF', 'vhea', 'vmtx', 'BASE', 'VORG', 'DSIG', 'MATH']
    sub = Subsetter(opts); sub.populate(unicodes=bound); sub.subset(face)
    otf_to_ttf(face)
    upem = face['head'].unitsPerEm
    G = graphics()
    found, missing = unencoded_parts(cmap)
    parts = sorted(found)
    mapping, by_shape, drawn = {}, {}, 0
    for (ch, strokes) in parts:
        shape = found[(ch, strokes)]
        key = '%s:%s' % (ch, ','.join(map(str, strokes)))
        if shape is not None and shape in by_shape:
            mapping[key] = by_shape[shape]; continue  # the same shape drawn once
        code = PUA_START + drawn; drawn += 1; name = 'lw_part_%04X' % code
        if shape is not None: by_shape[shape] = code
        paths = [G[ch]['strokes'][s] for s in strokes]
        bp = BoundsPen(None)
        for p in paths: parse_path(p, bp)
        x0, y0, x1, y1 = bp.bounds; w, h = x1 - x0, y1 - y0
        sc = min(FILL * upem / w, FILL * upem / h); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        tf = (sc, 0, 0, sc, upem / 2 - cx * sc, 0.38 * upem - cy * sc)
        pen0 = TTGlyphPen(None); pen = Cu2QuPen(pen0, 1.0, reverse_direction=False)
        for p in paths: parse_path(p, TransformPen(pen, tf))
        g = pen0.glyph(); order = face.getGlyphOrder() + [name]
        face['glyf'].glyphs[name] = g; face['glyf'].glyphOrder = order; face.setGlyphOrder(order)
        g.recalcBounds(face['glyf']); face['hmtx'][name] = (upem, g.xMin)
        for t in face['cmap'].tables:
            if t.isUnicode() and t.format in (4, 12) : t.cmap[code] = name
        mapping[key] = code
    face['maxp'].numGlyphs = len(face.getGlyphOrder()); face['post'].extraNames = []; face['post'].mapping = {}
    face.flavor = 'woff2'
    buf = io.BytesIO(); face.save(buf); data = buf.getvalue()
    css = ('/* Generated by scripts/build-component-font.py. Do not edit. */\n'
           '@font-face { font-family: "LW Parts"; src: url("../../fonts/lw-parts.woff2") format("woff2"); font-weight: 400; font-style: normal; font-display: swap;\n'
           '  unicode-range: %s, U+%X-%X; }\n' % (to_ranges(bound), PUA_START, PUA_START + max(drawn - 1, 0)))
    mp = json.dumps({'font': 'LW Parts', 'missing': missing, 'glyphs': mapping}, ensure_ascii=False, indent=0) + '\n'
    if '--check' in ARGS:
        same = os.path.exists(OUT_FONT) and open(OUT_FONT, 'rb').read() == data and open(OUT_MAP, encoding='utf8').read() == mp and open(OUT_CSS, encoding='utf8').read() == css
        print('font up to date' if same else 'font is stale: run python3 scripts/build-component-font.py'); sys.exit(0 if same else 1)
    for p in (OUT_FONT, OUT_MAP, OUT_CSS): os.makedirs(os.path.dirname(p), exist_ok=True)
    open(OUT_FONT, 'wb').write(data); open(OUT_MAP, 'w', encoding='utf8').write(mp); open(OUT_CSS, 'w', encoding='utf8').write(css)
    print('lw-parts.woff2: %d bytes; %d bound-form glyphs, %d drawn glyphs for %d parts (PUA U+%X-U+%X)' % (len(data), len(bound), drawn, len(parts), PUA_START, PUA_START + drawn - 1))

main()
