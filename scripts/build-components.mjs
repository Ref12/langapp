// Character-component data: decomposition, stroke -> component mapping, roles, component meanings and encoding.
// Usage: node scripts/build-components.mjs [--check] [--draft-variants=<file>] [--cache=<dir>]
// Downloads pinned sources (SHA-256 checked, cached in node_modules/.cache/components-sources), writes
//   public/characters/chinese/components.generated.json  (+ licence files next to it)
// and validates the reviewed tables curriculum/chinese/characters/component-variants.yaml and component-notes.yaml.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { parse as parseYaml } from 'yaml'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = join(root, 'public', 'characters', 'chinese')
const curriculumDir = join(root, 'curriculum', 'chinese', 'characters')
export const outputPath = join(publicDir, 'components.generated.json')

const MMAH = 'bddc96d41bef78427ed0e034e9f7e31d71fd1b92'
const mmahUrl = name => `https://raw.githubusercontent.com/skishore/makemeahanzi/${MMAH}/${name}`
const SOURCES = {
  dictionary: { url: mmahUrl('dictionary.txt'), sha256: '744bb05d5b0742e9ee35c37791f94d56a173349b3367569e7ca11e510364d203' },
  graphics: { url: mmahUrl('graphics.txt'), sha256: 'a28c478b5178e98f67f510b2d52fde08a69dc664654ef43498253b9b764d46ee' },
  copying: { url: mmahUrl('COPYING'), sha256: '26fa6b699b32401de4b75a4af574c2e0a99b3df6cb12df9313d257ee4634359c' },
  lgpl: { url: mmahUrl('LGPL'), sha256: 'eeb6fd06beac4a94a12ffb66876ecd6af68d5b6f38650d5f11aa90125933098b' },
  unihan: { url: 'https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip', sha256: '4c93ea9c1f636451729a840978f1667a53886af37ba854fdcce109721c63d43e' },
  cjkRadicals: { url: 'https://www.unicode.org/Public/18.0.0/ucd/CJKRadicals.txt', sha256: '689e2e5852699e7115823dc0b6d3e615eb767c7f477b615678f4f989d1f06105' },
  unicodeData: { url: 'https://www.unicode.org/Public/18.0.0/ucd/UnicodeData.txt', sha256: '0736451de439ae7baf1425136617da495e09ee5afbe6e394374db7009ea08950' },
}
const sha256 = value => createHash('sha256').update(value).digest('hex')

async function fetchPinned(name, cacheDir) {
  const { url, sha256: want } = SOURCES[name]
  const file = join(cacheDir, `${name}-${want.slice(0, 12)}`)
  let bytes
  if (existsSync(file)) bytes = readFileSync(file)
  else {
    const response = await fetch(url, { headers: { 'user-agent': 'linguaweave-components-build' } })
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status} for ${url}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (sha256(bytes) !== want) throw new Error(`${name} does not match its pinned SHA-256 (${url}).`)
  mkdirSync(cacheDir, { recursive: true })
  if (!existsSync(file)) writeFileSync(file, bytes)
  return bytes
}

// ---------- IDS ----------
const ARITY = { '⿰': 2, '⿱': 2, '⿲': 3, '⿳': 3, '⿴': 2, '⿵': 2, '⿶': 2, '⿷': 2, '⿸': 2, '⿹': 2, '⿺': 2, '⿻': 2 }
const UNKNOWN = '？'
/** Parses an IDS string into { op, kids } / { c }; null when it is not a well-formed single tree. */
export function parseIds(text) {
  const tokens = [...text]
  let at = 0
  const walk = () => {
    const token = tokens[at++]
    if (token === undefined) throw new Error('short')
    const arity = ARITY[token]
    if (!arity) return { c: token }
    return { op: token, kids: Array.from({ length: arity }, walk) }
  }
  try {
    const tree = walk()
    return at === tokens.length ? tree : null
  } catch { return null }
}

// ---------- Unicode ----------
export function blockOf(cp) {
  if (cp >= 0x4e00 && cp <= 0x9fff) return 'URO'
  if (cp >= 0x3400 && cp <= 0x4dbf) return 'Ext A'
  if (cp >= 0x20000 && cp <= 0x2a6df) return 'Ext B'
  if (cp >= 0x2a700 && cp <= 0x2ebef) return 'Ext C-F'
  if (cp >= 0x2ebf0 && cp <= 0x2ee5f) return 'Ext I'
  if (cp >= 0x30000 && cp <= 0x323af) return 'Ext G-H'
  if (cp >= 0x2e80 && cp <= 0x2eff) return 'CJK Radicals Supplement'
  if (cp >= 0x2f00 && cp <= 0x2fdf) return 'Kangxi Radicals'
  if (cp >= 0x2ff0 && cp <= 0x2fff) return 'IDC'
  if (cp >= 0x31c0 && cp <= 0x31ef) return 'CJK Strokes'
  if (cp >= 0x3000 && cp <= 0x303f) return 'CJK Symbols and Punctuation'
  if (cp >= 0xf900 && cp <= 0xfaff) return 'CJK Compatibility Ideographs'
  if (cp >= 0x2f800 && cp <= 0x2fa1f) return 'CJK Compatibility Ideographs Supplement'
  return 'Other'
}
const hex = cp => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

const shortMeaning = definition => definition.split(';').map(s => s.trim()).filter(Boolean).slice(0, 3).join('; ')
/** Unihan definition of a radical character without the trailing "KangXi radical N" note; '' when nothing usable is left. */
export const radicalMeaning = definition => (definition ?? '').replace(/\(same as [^)]*\)\s*/i, '').split(';').map(x => x.trim()).filter(x => x && !/\brad(ical|\.)\s*(no\.?|number)?\s*\d+/i.test(x)).slice(0, 3).join('; ')

export async function loadSources(cacheDir) {
  const names = Object.keys(SOURCES)
  const files = Object.fromEntries(await Promise.all(names.map(async name => [name, await fetchPinned(name, cacheDir)])))
  const dictionary = new Map()
  for (const line of files.dictionary.toString('utf8').split('\n')) if (line.trim()) { const e = JSON.parse(line); dictionary.set(e.character, e) }
  const graphics = new Map()
  for (const line of files.graphics.toString('utf8').split('\n')) if (line.trim()) { const e = JSON.parse(line); graphics.set(e.character, e.strokes) }
  const unihanZip = await JSZip.loadAsync(files.unihan)
  const unihan = new Map()
  for (const line of (await unihanZip.file('Unihan_Readings.txt').async('string')).split('\n')) {
    const m = /^U\+([0-9A-F]+)\t(kMandarin|kDefinition)\t(.+)$/.exec(line)
    if (!m) continue
    const ch = String.fromCodePoint(parseInt(m[1], 16))
    const e = unihan.get(ch) ?? {}
    if (m[2] === 'kMandarin') e.pinyin = m[3].trim().split(/\s+/)[0]
    else e.definition = shortMeaning(m[3])
    unihan.set(ch, e)
  }
  // Kangxi block / radical supplement -> unified ideograph (CJKRadicals.txt: "number; radical; unified").
  const kangxiToUnified = new Map()
  const radicalSupplement = []
  for (const line of files.cjkRadicals.toString('utf8').split('\n')) {
    const m = /^(\d+)('{0,2});\s*([0-9A-F]+)(?:;\s*([0-9A-F]+))?/.exec(line)
    if (!m) continue
    const radical = String.fromCodePoint(parseInt(m[3], 16))
    const unified = m[4] ? String.fromCodePoint(parseInt(m[4], 16)) : undefined
    radicalSupplement.push({ number: Number(m[1]), primes: m[2].length, radical, unified })
    if (unified) kangxiToUnified.set(radical, unified)
  }
  const names2 = new Map()
  for (const line of files.unicodeData.toString('utf8').split('\n')) {
    const f = line.split(';')
    if (!f[0]) continue
    const cp = parseInt(f[0], 16)
    if (cp >= 0x2e80 && cp <= 0x2fdf) names2.set(String.fromCodePoint(cp), f[1])
  }
  return { files, dictionary, graphics, unihan, kangxiToUnified, radicalSupplement, names: names2, radicals: radicalTable({ radicalSupplement, unihan }), supplementVariants: supplementVariants({ radicalSupplement, unihan, names: names2, kangxiToUnified }) }
}

/** The 214 Kangxi radicals: number, ordinary ideograph (CJKRadicals.txt), Unihan meaning and pinyin of that ideograph. */
export function radicalTable({ radicalSupplement, unihan }) {
  const table = new Map()
  for (const row of radicalSupplement) {
    if (row.primes || !row.unified) continue
    const u = unihan.get(row.unified)
    table.set(row.number, { number: row.number, form: row.unified, english: radicalMeaning(u?.definition), pinyin: u?.pinyin ?? '' })
  }
  return table
}
/** Forms tied to a Kangxi radical by Unicode data: simplified radicals (CJKRadicals.txt primed rows) and Radicals Supplement characters whose Unicode name is a sense of one radical's Unihan meaning. */
export function supplementVariants({ radicalSupplement, unihan, names, kangxiToUnified }) {
  const radicals = radicalTable({ radicalSupplement, unihan })
  const found = new Map()
  for (const row of radicalSupplement) {
    if (!row.primes) continue
    for (const form of [row.radical, row.unified]) if (form) found.set(form, { number: row.number, via: "CJKRadicals.txt simplified row" })
  }
  for (const [ch, name] of names) {
    const cp = ch.codePointAt(0)
    if (cp < 0x2e80 || cp > 0x2eff || found.has(ch)) continue
    const base = name.replace(/^CJK RADICAL /, '').replace(/ (ONE|TWO|THREE|FOUR|FIVE|SIX|SIMPLIFIED|C-SIMPLIFIED|J-SIMPLIFIED|REPEAT)$/, '').toLowerCase()
    const senses = r => r.english.split(/[;,]/).map(x => x.trim().toLowerCase())
    const all = [...radicals.values()]
    const hit = all.find(r => senses(r)[0] === base) ?? all.find(r => senses(r).includes(base))
    if (hit) found.set(ch, { number: hit.number, via: 'Unicode character name' })
  }
  void kangxiToUnified
  return found
}

const canon = (ch, src) => {
  const cp = ch.codePointAt(0)
  if (cp >= 0x2f00 && cp <= 0x2fd5) return src.kangxiToUnified.get(ch) ?? ch.normalize('NFKC')
  return ch
}

// ---------- tree building ----------
const POSITIONS = {
  '⿰': ['left', 'right'], '⿱': ['top', 'bottom'], '⿲': ['left', 'middle', 'right'], '⿳': ['top', 'middle', 'bottom'],
  '⿴': ['enclosing', 'inside'], '⿵': ['enclosing-top', 'inside'], '⿶': ['enclosing-bottom', 'inside'], '⿷': ['enclosing-left', 'inside'],
  '⿸': ['enclosing-top-left', 'inside'], '⿹': ['enclosing-top-right', 'inside'], '⿺': ['enclosing-bottom-left', 'inside'], '⿻': ['overlay-a', 'overlay-b'],
}
export const positionName = (op, index) => POSITIONS[op]?.[index] ?? `${op}[${index}]`

function makeBuilder(src) {
  const { dictionary } = src
  /** Tree of one dictionary entry. `map` sends the entry's own stroke indexes to the output stroke indexes. */
  const build = (char, map, chain) => {
    const entry = dictionary.get(char)
    const ids = entry && entry.decomposition !== UNKNOWN ? parseIds(entry.decomposition) : null
    const root = { c: canon(char, src), s: map.slice() }
    if (!entry || !ids || !ids.op) return { node: root, entry, ok: false }
    const toNode = (tree, path) => {
      if (!tree.op) return { c: canon(tree.c, src), s: [] }
      return { c: '', d: tree.op, s: [], k: tree.kids.map((kid, i) => toNode(kid, [...path, i])) }
    }
    root.d = ids.op
    root.k = ids.kids.map(kid => toNode(kid, []))
    entry.matches.forEach((path, i) => {
      if (!path) return
      let node = root
      for (const step of path) {
        node = node.k?.[step]
        if (!node) break
        node.s.push(map[i])
      }
    })
    // Roles from this entry's own etymology; deeper expansion through each component's own entry.
    const e = entry.etymology
    const expand = (node, depth) => {
      if (!node.k) {
        if (node.c === UNKNOWN) node.u = 1
        else if (depth > 0 && !chain.includes(node.c)) {
          const own = dictionary.get(node.c)
          if (own && own.decomposition !== UNKNOWN && own.matches.length === node.s.length && own.matches.every(Boolean)) {
            const sub = build(node.c, node.s, [...chain, char])
            if (sub.ok) { Object.assign(node, sub.node); if (sub.entry.etymology) node.e = etymologyOf(sub.entry.etymology) }
          }
        }
        return
      }
      node.k.forEach(kid => expand(kid, depth + 1))
    }
    root.k.forEach(kid => expand(kid, 1))
    if (e?.type === 'pictophonetic') {
      for (const kid of root.k) {
        if (kid.c && kid.c === canon(e.semantic ?? '', src)) kid.r = 'semantic'
        else if (kid.c && kid.c === canon(e.phonetic ?? '', src)) kid.r = 'phonetic'
        else kid.r = 'other'
      }
    } else if (e) {
      for (const kid of root.k) {
        if (e.semantic && kid.c === canon(e.semantic, src)) kid.r = 'semantic'
        else if (e.phonetic && kid.c === canon(e.phonetic, src)) kid.r = 'phonetic'
      }
    }
    return { node: root, entry, ok: true }
  }
  return build
}
const etymologyOf = e => ({ ...(e.type ? { t: e.type } : {}), ...(e.hint ? { h: e.hint.replace(/\u00a0/g, ' ') } : {}) })

function walk(node, visit, parent = null, index = 0) {
  visit(node, parent, index)
  node.k?.forEach((kid, i) => walk(kid, visit, node, i))
}

// ---------- main build ----------
export async function buildComponents({ cacheDir, index, hanziWriter, variantsDoc, notesDoc }) {
  const src = await loadSources(cacheDir)
  const build = makeBuilder(src)
  const characters = {}
  const report = { strokeCountMismatches: [], strokeOrderMismatches: [], missingFromMmah: [], missingFromHanziWriter: [], ambiguousStrokes: [] }
  const usage = new Map()
  const tally = new Map()
  const note = (form, char) => { const s = usage.get(form) ?? new Set(); s.add(char); usage.set(form, s) }
  const cov = { characters: index.length, decomposition: 0, fullMapping: 0, roles: 0, deeper: 0, strokeCountMatches: 0, strokeOrderMatches: 0 }
  const unencodedUses = []
  const pas = []
  const drift = { pictophoneticWithPhonetic: 0, unknownPinyin: 0, sameSyllableSameTone: 0, sameSyllableOtherTone: 0, sameInitialOnly: 0, sameFinalOnly: 0, different: 0, examples: { sameSyllable: [], sameInitialOnly: [], sameFinalOnly: [], different: [] } }
  for (const char of index) {
    const entry = src.dictionary.get(char)
    const hw = hanziWriter.get(char)
    if (!entry) { report.missingFromMmah.push(char); continue }
    if (!hw) report.missingFromHanziWriter.push(char)
    const shipped = hw?.length
    if (shipped !== undefined && shipped !== entry.matches.length) report.strokeCountMismatches.push({ char, shipped, mmah: entry.matches.length })
    else if (shipped !== undefined) cov.strokeCountMatches++
    const gfx = src.graphics.get(char)
    if (hw && gfx) {
      const same = hw.length === gfx.length && hw.every((p, i) => p === gfx[i])
      if (same) cov.strokeOrderMatches++
      else if (hw.length === gfx.length) report.strokeOrderMismatches.push(char)
    }
    const map = entry.matches.map((_, i) => i)
    const { node, ok } = build(char, map, [])
    const out = { n: entry.matches.length }
    if (entry.radical) out.rad = canon(entry.radical, src)
    if (entry.etymology) {
      const e = entry.etymology
      if (e.type) out.t = e.type
      if (e.hint) out.h = e.hint.replace(/\u00a0/g, ' ')
    }
    const alsoSound = /(\S) also provides the pronunc/u.exec(entry.etymology?.hint ?? '')?.[1]
    if (ok) {
      out.d = node.d
      out.k = node.k
      cov.decomposition++
      if (alsoSound) {
        const comp = canon(alsoSound, src)
        let found = false
        walk(node, (n, p) => { if (p && n.c === comp) found = true })
        if (found) { out.phoneticAlsoSemantic = comp; pas.push({ char, comp, type: entry.etymology.type ?? '' }) }
      }
      if (entry.matches.every(Boolean)) {
        const lengthOne = node.k.every(kid => kid.s.length > 0)
        if (lengthOne) cov.fullMapping++
        else report.ambiguousStrokes.push(char)
      }
      if (node.k.some(kid => kid.r === 'semantic' || kid.r === 'phonetic')) cov.roles++
      let deep = false
      walk(node, (n, p) => { if (p && p !== node && n !== node) deep = true })
      if (deep) cov.deeper++
      walk(node, (n, parent, i) => {
        if (!parent) return
        if (n.c) {
          if (n.u) unencodedUses.push({ char, position: positionName(parent.d, i) })
          else {
            note(n.c, char)
            const key = `${n.c}\t${positionName(parent.d, i)}`
            tally.set(key, (tally.get(key) ?? 0) + 1)
          }
        }
      })
    }
    characters[char] = out
  }

  // ----- sound drift: pictophonetic characters whose phonetic part is known -----
  const plain = p => p.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ü/g, 'v').toLowerCase()
  const split = p => { const m = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(.*)$/.exec(plain(p)); return [m[1] ?? '', m[2]] }
  const pinyinOf = ch => src.dictionary.get(ch)?.pinyin?.[0] ?? src.unihan.get(ch)?.pinyin
  for (const char of index) {
    const e = src.dictionary.get(char)?.etymology
    if (e?.type !== 'pictophonetic' || !e.phonetic) continue
    drift.pictophoneticWithPhonetic++
    const a = pinyinOf(char), b = pinyinOf(e.phonetic)
    if (!a || !b) { drift.unknownPinyin++; continue }
    const [ai, af] = split(a), [bi, bf] = split(b)
    const label = `${char} ${a} / ${e.phonetic} ${b}`
    const keep = (k, v) => { if (drift.examples[k].length < 6) drift.examples[k].push(v) }
    if (plain(a) === plain(b)) { if (a.normalize('NFC') === b.normalize('NFC')) drift.sameSyllableSameTone++; else drift.sameSyllableOtherTone++; keep('sameSyllable', label) }
    else if (ai === bi) { drift.sameInitialOnly++; keep('sameInitialOnly', label) }
    else if (af === bf) { drift.sameFinalOnly++; keep('sameFinalOnly', label) }
    else { drift.different++; keep('different', label) }
  }

  // ----- components table -----
  const notes = new Map((notesDoc?.components ?? []).map(n => [n.form, n]))
  const variantRows = variantsDoc?.variants ?? []
  const kangxiByForm = new Map()
  const variantParent = new Map()
  const variantVia = new Map()
  for (const r of src.radicals.values()) kangxiByForm.set(r.form, r)
  for (const [form, { number, via }] of src.supplementVariants) {
    const radical = src.radicals.get(number)
    if (radical && !kangxiByForm.has(form)) { variantParent.set(form, radical); variantVia.set(form, via) }
  }
  for (const row of variantRows) {
    const radical = src.radicals.get(row.kangxi_radical)
    if (radical && !variantParent.has(row.form) && !kangxiByForm.has(row.form)) { variantParent.set(row.form, radical); variantVia.set(row.form, 'reviewed variants table') }
  }
  const components = {}
  const counts = { meaning: 0, none: 0, unknown: 0, bmp: 0, extB: 0, other: 0 }
  const positionsOf = form => [...tally].filter(([k]) => k.startsWith(`${form}\t`)).map(([k, v]) => [k.split('\t')[1], v]).sort((a, b) => b[1] - a[1])
  for (const form of [...usage.keys()].sort((a, b) => a.codePointAt(0) - b.codePointAt(0))) {
    const cp = form.codePointAt(0)
    const info = { cp: hex(cp), block: blockOf(cp), uses: usage.get(form).size }
    if (cp > 0xffff) info.plane = cp >> 16
    const positions = positionsOf(form)
    if (positions.length) info.pos = Object.fromEntries(positions.slice(0, 4))
    const radical = kangxiByForm.get(form)
    const variantOf = variantParent.get(form)
    const note2 = notes.get(form)
    const hasChar = index.includes(form)
    if (hasChar) info.standalone = true
    const uni = src.unihan.get(form)
    const own = src.dictionary.get(form)
    if (radical?.english) info.meaning = { en: radical.english, source: 'unihan-radical', radical: radical.number }
    else if (variantOf?.english) info.meaning = { en: variantOf.english, source: 'radical-variant', of: variantOf.form, radical: variantOf.number }
    else if (uni?.definition) info.meaning = { en: uni.definition, source: 'unihan' }
    else if (own?.definition) info.meaning = { en: own.definition, source: 'mmah' }
    if (note2) { info.none = note2.kind; if (!info.meaning && note2.meaning) info.meaning = { en: note2.meaning, source: 'notes' } }
    let status
    if (note2) status = 'none'
    else if (info.meaning) status = 'meaning'
    else if (info.uses <= 1) { info.none = 'unique-shape'; status = 'none' }
    else status = 'unknown'
    if (status === 'unknown' && src.names.has(form)) { info.meaning = { en: src.names.get(form).replace(/^CJK RADICAL /, '').replace(/ (ONE|TWO|THREE|FOUR|FIVE|SIX|SIMPLIFIED)$/, '').toLowerCase(), source: 'unicode-name' }; status = 'meaning' }
    const rowsFor = variantRows.filter(r => r.form === form)
    if (new Set(rowsFor.map(r => r.parent)).size > 1) {
      info.byPosition = Object.fromEntries(rowsFor.flatMap(r => r.positions.map(p => [p.slot, { of: r.parent, en: r.name_en }])))
      info.meaning = { en: rowsFor.map(r => `${r.name_en} (${r.positions.map(p => p.slot).join('/')})`).join(' / '), source: 'variants-table' }
      status = 'meaning'
    }
    info.status = status
    counts[status]++
    if (info.block === 'CJK Radicals Supplement' || cp <= 0xffff) counts.bmp++
    else counts.extB++
    if (src.names.has(form)) info.unicodeName = src.names.get(form).toLowerCase()
    components[form] = info
  }

  // ----- variants validation + bound-form guides -----
  const problems = []
  for (const n of notesDoc?.components ?? []) for (const ex of n.examples ?? []) if (!usage.get(n.form)?.has(ex)) problems.push(`${n.form}: notes example ${ex} does not contain it`)
  const boundGuides = {}
  for (const row of variantRows) {
    const c = components[row.form]
    if (!c) problems.push(`${row.form}: not used as a component in any character of our set`)
    for (const ex of row.examples ?? []) if (!usage.get(row.form)?.has(ex)) problems.push(`${row.form}: example ${ex} does not contain it`)
    const gfx = src.graphics.get(row.form)
    const dic = src.dictionary.get(row.form)
    boundGuides[row.form] = {
      makeMeAHanziGraphics: gfx ? gfx.length : 0,
      makeMeAHanziStrokeMap: dic && dic.matches ? dic.matches.length : 0,
      shippedHanziWriter: hanziWriter.has(row.form) ? hanziWriter.get(row.form).length : 0,
      inOurCharacterSet: index.includes(row.form),
    }
  }
  const notShipped = Object.keys(components).filter(f => !hanziWriter.has(f))
  const componentGuides = { components: Object.keys(components).length, shippedGuide: Object.keys(components).length - notShipped.length, notShipped: notShipped.length, notShippedButInMmahGraphics: notShipped.filter(f => src.graphics.has(f)).length, notShippedAndNoGraphics: notShipped.filter(f => !src.graphics.has(f)) }
  const radicalGaps = [...src.radicals.values()].filter(r => !r.english).map(r => ({ number: r.number, form: r.form }))
  const uniqueUnencodedChars = new Set(unencodedUses.map(u => u.char))
  const coverage = {
    ...cov,
    etymologyTypes: Object.entries(Object.values(characters).reduce((a, c) => (a[c.t ?? 'none'] = (a[c.t ?? 'none'] ?? 0) + 1, a), {})).sort(([x], [y]) => x.localeCompare(y)),
    phoneticAlsoSemantic: { characters: pas.length, byEtymologyType: Object.fromEntries(Object.entries(pas.reduce((a, p) => (a[p.type || 'none'] = (a[p.type || 'none'] ?? 0) + 1, a), {}))) },
    soundDrift: drift,
    components: Object.keys(components).length,
    componentMeaning: { withMeaning: counts.meaning, withoutMeaning: counts.none, unknown: counts.unknown },
    componentEncoding: {
      bmp: Object.values(components).filter(c => !c.plane).length,
      extBPlus: Object.values(components).filter(c => c.plane).length,
      unencodedPlaceholderUses: unencodedUses.length,
      charactersWithUnencodedComponent: uniqueUnencodedChars.size,
      byBlock: Object.entries(Object.values(components).reduce((a, c) => (a[c.block] = (a[c.block] ?? 0) + 1, a), {})).sort(([x], [y]) => x.localeCompare(y)),
    },
  }
  return {
    src,
    problems,
    document: {
      schemaVersion: 1,
      language: 'chinese',
      format: 'characters[c]: n strokes, phoneticAlsoSemantic (component that Make Me a Hanzi hints as also giving the pronunciation of an ideographic compound, i.e. sound and meaning both), rad radical, t/h etymology type/hint, d IDS operator, k children. Node: c component, s stroke indexes (our Hanzi Writer order), d/k nested split, r role (semantic|phonetic|other), e etymology of an expanded component, u=1 no code point (source placeholder ？). components[c]: cp, block, uses, pos {operator-slot: count}, meaning, none, status.',
      license: 'LGPL-3.0-or-later (Make Me a Hanzi dictionary.txt, derived from Unihan and CJKlib); Unihan meanings and Unicode data under the Unicode License v3. See components-ATTRIBUTION.txt.',
      sources: {
        makeMeAHanzi: { commit: MMAH, dictionary: SOURCES.dictionary.sha256, graphics: SOURCES.graphics.sha256 },
        unihan: { version: '18.0.0', sha256: SOURCES.unihan.sha256 },
        cjkRadicals: { version: '18.0.0', sha256: SOURCES.cjkRadicals.sha256 },
        unicodeData: { version: '18.0.0', sha256: SOURCES.unicodeData.sha256 },
      },
      coverage,
      report: { ...report, radicalMeaningGaps: radicalGaps, unmappedVariantRows: variantRows.filter(r => !variantVia.has(r.form) || variantVia.get(r.form) === 'reviewed variants table').map(r => r.form), componentGuides, boundFormGuides: boundGuides },
      characters,
      components,
    },
    tally,
    usage,
    kangxiByForm,
    variantParent,
  }
}

export function readIndexAndGuides(rootDir = root) {
  const index = JSON.parse(readFileSync(join(rootDir, 'src', 'data', 'characters', 'index.generated.json'), 'utf8')).characters.map(e => e.character)
  return index
}

export async function readHanziWriter(index, rootDir = root) {
  const zip = await JSZip.loadAsync(readFileSync(join(rootDir, 'public', 'characters', 'chinese', 'hanzi-writer-selected.zip')))
  const all = new Map()
  for (const name of Object.keys(zip.files)) {
    const m = /^data\/(.+)\.json$/u.exec(name)
    if (m) all.set(m[1], JSON.parse(await zip.file(name).async('string')).strokes)
  }
  return all
}

async function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const cacheDir = args.find(a => a.startsWith('--cache='))?.slice(8) ?? join(root, 'node_modules', '.cache', 'components-sources')
  const draftArg = args.find(a => a.startsWith('--draft-variants='))?.slice(17)
  const index = readIndexAndGuides()
  const hanziWriter = await readHanziWriter(index)
  const readYaml = name => existsSync(join(curriculumDir, name)) ? parseYaml(readFileSync(join(curriculumDir, name), 'utf8')) : undefined
  const result = await buildComponents({ cacheDir, index, hanziWriter, variantsDoc: readYaml('component-variants.yaml'), notesDoc: readYaml('component-notes.yaml') })
  if (draftArg) {
    const { draftVariants } = await import('./build-components-draft.mjs')
    writeFileSync(draftArg, draftVariants(result, index))
    console.log(`Draft variants written to ${draftArg}`)
    return
  }
  if (result.problems.length) throw new Error(`Variant table problems:\n${result.problems.join('\n')}`)
  const body = `${JSON.stringify(result.document)}\n`
  const licences = new Map([
    [join(publicDir, 'components-LGPL.txt'), result.src.files.lgpl],
    [join(publicDir, 'components-COPYING.txt'), result.src.files.copying],
    [join(publicDir, 'components-ATTRIBUTION.txt'), Buffer.from(ATTRIBUTION)],
  ])
  if (check) {
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== body) throw new Error('Run "node scripts/build-components.mjs" to regenerate components.generated.json.')
    for (const [path, bytes] of licences) if (!existsSync(path) || !readFileSync(path).equals(bytes)) throw new Error(`Stale ${path}`)
    console.log('Component data current.')
  } else {
    writeFileSync(outputPath, body)
    for (const [path, bytes] of licences) writeFileSync(path, bytes)
    console.log(`Wrote ${outputPath} (${(body.length / 1024).toFixed(0)} KiB)`)
    console.log(JSON.stringify(result.document.coverage, null, 1))
  }
}

const ATTRIBUTION = `Character component data (components.generated.json)

Decompositions, stroke-to-component matches, etymology and roles: Make Me a Hanzi dictionary.txt by Shaunak Kishore and contributors, derived from Unihan and CJKlib, redistributed under the GNU Lesser General Public License v3 or later (components-LGPL.txt; notice components-COPYING.txt). This generated file is a modified (restructured) derivative and is offered under the same LGPL terms.
Component meanings: Unicode Unihan 18.0.0 kDefinition (Unicode License v3, https://www.unicode.org/license.txt), Unicode CJKRadicals.txt and UnicodeData.txt 18.0.0. Radical meanings are the Unihan kDefinition of the radical characters.
Stroke artwork is not part of this file; it stays under the ARPHIC PUBLIC LICENSE (ATTRIBUTION.html).
`

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
