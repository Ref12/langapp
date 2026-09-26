// Offline projection of prepared Chinese artwork. Never runs source importers.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import JSZip from 'jszip'
import { parse } from 'yaml'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicPath = join('public', 'characters', 'chinese')
const indexPath = join('src', 'data', 'characters', 'index.generated.json')
const sourceId = 'zh-writing-hanzi-writer'
const reviewedKeys = ['一', '人', '杯', '茶', '雨']
const archivePath = 'upstream/writing/hanzi-writer-selected.zip'
const recipePath = 'characters/recipes/reviewed-prototype.yaml'
const licensePath = 'licenses/hanzi-writer-ARPHICPL.TXT'
const sourceLockPath = 'upstream/writing/source-lock.yaml'
const sha256 = value => createHash('sha256').update(value).digest('hex')
const json = value => `${JSON.stringify(value)}\n`
const same = isDeepStrictEqual
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const scalar = value => typeof value === 'string' && [...value].length === 1 && !/[\uD800-\uDFFF]/u.test(value)
const pageFor = character => `u${(character.codePointAt(0) >>> 8).toString(16).padStart(4, '0')}`
const projectedNotice = 'MODIFIED 2026-09-25: Projected prepared Chinese YAML default variants into lazy Unicode-page JSON, retaining exact ordered path strings, inherited review evidence and source provenance. No new artwork review, candidate selection, coordinate transform or stroke reordering. Source and derived artwork remain freely available under the ARPHIC PUBLIC LICENSE, AS IS, without warranty; retain the unaltered license and modification notices. Independent implementation code is separate.'

/** Same explicit-command, bounded single-pen-down contract as character_geometry.py. */
export function validateCharacterPath(path, context = 'path') {
  assert(typeof path === 'string' && path.length > 0 && path.length <= 100_000, `${context}: expected a nonempty path of at most 100000 characters`)
  const token = /[MLQC]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g
  assert(!path.replace(token, '').replace(/[ \t\r\n,]/g, ''), `${context}: unsupported SVG syntax; only explicit M/L/Q/C are allowed`)
  const parts = path.match(token) ?? []
  const arity = { M: 2, L: 2, Q: 4, C: 6 }
  let current, length = 0, commands = 0
  for (let offset = 0; offset < parts.length;) {
    const op = parts[offset++], count = arity[op]
    assert(count && (commands === 0 ? op === 'M' : op !== 'M'), `${context}: requires one initial M and continuous explicit L/Q/C segments`)
    const values = parts.slice(offset, offset + count).map(Number)
    assert(values.length === count && values.every(Number.isFinite), `${context}: incorrect coordinate count or nonfinite geometry`)
    assert(values.every(value => value >= 0 && value <= 100), `${context}: coordinates/control points must be within 0..100`)
    offset += count
    const controls = []
    for (let i = 0; i < count; i += 2) controls.push([values[i], values[i + 1]])
    if (op === 'M') current = controls[0]
    else {
      const start = current
      const steps = op === 'L' ? 1 : 32
      for (let step = 1; step <= steps; step++) {
        const t = step / steps
        let work = [start, ...controls]
        while (work.length > 1) work = work.slice(1).map((end, i) => [
          work[i][0] * (1 - t) + end[0] * t, work[i][1] * (1 - t) + end[1] * t,
        ])
        length += Math.hypot(work[0][0] - current[0], work[0][1] - current[1])
        current = work[0]
      }
    }
    commands++
  }
  assert(commands >= 2 && length >= 0.000001, `${context}: path must have a drawable segment with nonzero length`)
}

export function projectCharacterPage(page, records, context) {
  assert(/^u[0-9a-f]{4}$/.test(page) && object(records), `${page}: invalid Unicode page`)
  return Object.keys(records).sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).map(character => {
    const label = `${page}/${character}`
    assert(scalar(character) && pageFor(character) === page, `${label}: key must be an exact Unicode scalar in its page`)
    const record = records[character]
    assert(object(record) && record.kind === 'character' && record.script === 'Han', `${label}: expected prepared Han character`)
    assert(Array.isArray(record.variants) && record.variants.length > 0, `${label}: missing variants`)
    const variants = record.variants
    assert(variants.every(variant => object(variant) && typeof variant.id === 'string') && new Set(variants.map(variant => variant.id)).size === variants.length, `${label}: invalid or duplicate variant IDs`)
    const expectedVariant = reviewedKeys.includes(character) ? 'reviewed-monoline' : 'source-median'
    assert(record.default_variant === expectedVariant, `${label}: unsupported default ${record.default_variant}; candidates must never be silently selected`)
    const selected = variants.find(variant => variant.id === record.default_variant)
    assert(selected, `${label}: declared default variant is missing`)
    assert(selected.locale === 'zh-Hans-CN', `${label}: unsupported locale`)
    assert(object(selected.status) && selected.status.generated === true && selected.status.validated === true && selected.status.reviewed === reviewedKeys.includes(character), `${label}: invalid generated/validated/reviewed status`)
    assert(same(selected.transform, context.transform), `${label}: unexpected source frame/transform; prepared paths must not be transformed again`)
    assert(Array.isArray(selected.strokes) && selected.strokes.length > 0, `${label}: missing ordered strokes`)
    const paths = selected.strokes.map((stroke, index) => {
      assert(object(stroke), `${label}: invalid stroke ${index + 1}`)
      validateCharacterPath(stroke.path, `${label} stroke ${index + 1}`)
      return stroke.path
    })
    assert(Array.isArray(selected.provenance) && selected.provenance.length === 1, `${label}: missing or ambiguous source provenance`)
    const source = selected.provenance[0]
    const member = `data/${character}.json`
    assert(object(source) && source.source_id === sourceId && source.input === archivePath && source.member === member &&
      source.sha256 === context.lock.archive_sha256 && source.member_sha256 === context.lock.members[member]?.sha256 &&
      source.source_entry === `https://raw.githubusercontent.com/chanind/hanzi-writer-data/${context.lock.revision}/${member}`, `${label}: source provenance does not match the pinned original member`)
    assert(paths.length === context.strokeCounts.get(character), `${label}: ordered stroke count differs from source`)
    let review
    if (selected.status.reviewed) {
      const recipe = context.recipes.characters[character]
      assert(object(recipe) && same(paths, recipe.paths) && recipe.source_member_sha256 === source.member_sha256, `${label}: reviewed paths/order must exactly match inherited recipe evidence`)
      assert(object(selected.recipe) && selected.recipe.input === recipePath && selected.recipe.sha256 === context.recipeHash &&
        selected.recipe.id === `zh-prototype-u${character.codePointAt(0).toString(16)}` &&
        selected.recipe.version === context.recipes.version, `${label}: reviewed recipe provenance mismatch`)
      assert(same(selected.review, context.recipes.review), `${label}: inherited review attestation mismatch`)
      review = { ...selected.review, recipe: selected.recipe }
    }
    return {
      character, strokeCount: paths.length, reviewed: selected.status.reviewed, variant: selected.id, paths,
      provenance: {
        sourceId, sourceEntry: source.source_entry, sourceArchive: source.input, sourceArchiveSha256: source.sha256,
        member, memberSha256: source.member_sha256, generated: true, validated: true,
        ...(review ? { review } : {}),
      },
    }
  })
}

function attribution(notice, lock, derivedHash) {
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chinese writing artwork: attribution and source</title>
<style>body{font:1rem/1.6 system-ui;max-width:70ch;margin:2rem auto;padding:0 1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{overflow-wrap:anywhere}</style></head><body>
<h1>Chinese writing artwork: attribution and source</h1>
<p>Copyright (C) 1999 Arphic Technology Co., Ltd. Derived through Make Me a Hanzi by Shaunak Kishore and contributors and Hanzi Writer Data by David Chanin.</p>
<p>These source-derived guides are not professionally reviewed handwriting instruction. Only five default variants retain pre-existing user-review evidence (一、人、杯、茶、雨); the 2026-09-15 date is a carry-forward attestation, not the unknown original review date. All other defaults are unreviewed. No recognition or mastery claim is made.</p>
<p>Source and derived artwork are freely available under the <a href="hanzi-writer-ARPHICPL.TXT">unaltered ARPHIC PUBLIC LICENSE</a>, AS IS, without warranty. You may copy, modify and redistribute under its conditions; preserve its copyright, license, and prominent dated modification notices and make modifications freely available. Independent application/implementation code and vocabulary have separate licensing; the artwork license is not replaced by a code license.</p>
<h2>Modification notices</h2><pre>${escape(notice)}</pre>
<h2>Exact downloadable source and reproducibility</h2><ul>
<li><a href="hanzi-writer-selected.zip">Original selected upstream ZIP</a> (unaltered; original data, README, license and selection notice). SHA-256: <code>${lock.archive_sha256}</code>.</li>
<li><a href="source-lock.yaml">Original source/member hash lock</a> and <a href="sources.yaml">retained source catalog</a>.</li>
<li><a href="derived-source.generated.zip">Prepared YAML and projection source bundle</a> (not an unrelated upstream library). SHA-256: <code>${derivedHash}</code>. Includes exact prepared pages, manifest/coverage, reviewed recipes, notices, projection script and pinned package metadata. The default paths in downloadable JSON are also the complete projected artwork modifications.</li>
<li><a href="https://github.com/chanind/hanzi-writer-data/tree/${lock.revision}">Pinned upstream revision ${lock.revision}</a>.</li>
</ul><p>Extract the derived source bundle, place the original selected ZIP at <code>curriculum/chinese/upstream/writing/hanzi-writer-selected.zip</code>, then use Node.js with the locked dependencies (<code>npm ci</code>) and run <code>node scripts/generate-app-characters.mjs</code>. With dependencies available, projection and <code>--check</code> are offline. No source importer, network fetch, candidate refinement or geometry regeneration is performed. The bundle includes the exact YAML input and script, not font fitting or new review evidence.</p>
<p>Paths are already normalized to a 100-unit y-down frame; retain width 5.5 and round caps/joins. Each ordered path is one continuous pen-down. No per-glyph fitting or additional transform is appropriate.</p>
</body></html>\n`
}

export async function buildAppCharacters(root = repositoryRoot) {
  const chinese = join(root, 'curriculum', 'chinese')
  const inputFiles = new Map()
  function read(path, expectedHash) {
    const bytes = readFileSync(join(chinese, ...path.split('/')))
    assert(!expectedHash || sha256(bytes) === expectedHash, `${path}: prepared input SHA-256 mismatch`)
    inputFiles.set(`curriculum/chinese/${path}`, bytes)
    return bytes
  }
  const manifest = parse(read('characters/manifest.yaml').toString('utf8'))
  assert(manifest.schema_version === 1 && manifest.language === 'chinese' && manifest.identity === 'exact-unicode-scalar-no-normalization', 'Unsupported Chinese character manifest')
  assert(same(manifest.style, { id: 'source-em-box-monoline', version: 1, view_box: [0, 0, 100, 100], width: 5.5, linecap: 'round', linejoin: 'round', axis: 'y-down' }), 'Unsupported prepared artwork style')
  assert(typeof manifest.notice === 'string' && manifest.notice.includes('ARPHIC PUBLIC LICENSE') && manifest.notice.includes('MODIFIED '), 'Missing original modification/license notice')
  assert(/^[a-f0-9]{64}$/.test(manifest.sources_sha256) && /^[a-f0-9]{64}$/.test(manifest.coverage_sha256), 'Missing prepared source catalog/coverage hashes')
  const pins = new Map()
  assert(Array.isArray(manifest.inputs), 'Missing pinned source inputs')
  for (const input of manifest.inputs) {
    assert([archivePath, recipePath, licensePath, sourceLockPath].includes(input.path) && !pins.has(input.path), 'Unsupported/duplicate pinned input')
    assert(input.source_id === sourceId && /^[a-f0-9]{64}$/.test(input.sha256), `${input.path}: invalid source pin`)
    pins.set(input.path, read(input.path, input.sha256))
  }
  assert(pins.size === 4, 'Missing required source, recipe, lock or license pin')
  const lock = parse(pins.get(sourceLockPath).toString('utf8'))
  const recipes = parse(pins.get(recipePath).toString('utf8'))
  assert(lock.schema_version === 1 && /^[a-f0-9]{40}$/.test(lock.revision) && object(lock.members), 'Invalid original source lock')
  assert(lock.archive === archivePath && lock.archive_sha256 === sha256(pins.get(archivePath)) &&
    lock.license === licensePath && lock.license_sha256 === sha256(pins.get(licensePath)), 'Source lock archive/license mismatch')
  assert(object(recipes.characters) && same(Object.keys(recipes.characters).sort(), reviewedKeys) &&
    recipes.source_revision === lock.revision && object(recipes.review) && typeof recipes.review.reviewer === 'string' &&
    recipes.review.date === '2026-09-15' && typeof recipes.review.note === 'string', 'Missing exact five inherited review attestations')
  const sourcesBytes = read('sources.yaml', manifest.sources_sha256)
  const sources = parse(sourcesBytes.toString('utf8'))
  const source = Array.isArray(sources) && sources.find(record => record.id === sourceId)
  assert(source?.revision === lock.revision && source.local_source_archive === archivePath && source.local_source_lock === sourceLockPath &&
    source.license.includes('ARPHIC PUBLIC LICENSE'), 'Source catalog does not match artwork provenance')
  read('characters/coverage.yaml', manifest.coverage_sha256)
  const original = await JSZip.loadAsync(pins.get(archivePath))
  const strokeCounts = new Map()
  for (const [member, pin] of Object.entries(lock.members)) {
    assert(!member.includes('..') && original.file(member), `Original selected ZIP missing ${member}`)
    const bytes = await original.file(member).async('nodebuffer')
    assert(bytes.length === pin.bytes && sha256(bytes) === pin.sha256, `Original selected ZIP member mismatch: ${member}`)
    if (member.startsWith('data/')) {
      const character = member.slice(5, -5)
      const data = JSON.parse(bytes.toString('utf8'))
      assert(scalar(character) && member.endsWith('.json') && Array.isArray(data.strokes) && Array.isArray(data.medians) &&
        data.strokes.length === data.medians.length && data.strokes.length > 0, `${member}: missing consistent ordered source strokes`)
      strokeCounts.set(character, data.strokes.length)
    }
  }
  const context = {
    lock, recipes, recipeHash: sha256(pins.get(recipePath)), strokeCounts,
    transform: { id: 'hanzi-prototype-padded-em-box', matrix: [0.087890625, 0, 0, -0.087890625, 5, 84.1015625], source_frame: [0, -124, 1024, 1024], version: '1' },
  }
  assert(Array.isArray(manifest.chunks) && manifest.chunks.length > 0, 'Missing manifest chunks')
  const expectedPages = manifest.chunks.map(chunk => chunk.file).sort()
  const actualPages = readdirSync(join(chinese, 'characters')).filter(file => /^u[0-9a-f]{4}\.yaml$/i.test(file)).sort()
  assert(same(expectedPages, actualPages) && new Set(expectedPages).size === expectedPages.length, 'Prepared page files do not exactly match manifest; missing, duplicate or extra page')
  const notice = `${projectedNotice}\n\n${manifest.notice}`
  const outputs = new Map()
  const characters = []
  for (const chunk of [...manifest.chunks].sort((a, b) => a.file.localeCompare(b.file, 'en'))) {
    assert(/^u[0-9a-f]{4}\.yaml$/.test(chunk.file) && /^[a-f0-9]{64}$/.test(chunk.sha256), 'Invalid manifest page/hash')
    const page = chunk.file.slice(0, -5)
    const records = parse(read(`characters/${chunk.file}`, chunk.sha256).toString('utf8'))
    const projected = projectCharacterPage(page, records, context)
    assert(projected.length === chunk.characters, `${page}: manifest character count mismatch`)
    characters.push(...projected)
    outputs.set(join(publicPath, `${page}.generated.json`), Buffer.from(json({ schemaVersion: 1, language: 'chinese', page, notice, characters: projected })))
  }
  assert(same(characters.filter(character => character.reviewed).map(character => character.character).sort(), reviewedKeys), 'Projection must retain exactly five inherited reviewed defaults')
  assert(strokeCounts.size === characters.length && characters.every(character => strokeCounts.has(character.character)), 'Prepared defaults do not cover the exact selected source inventory')
  const index = {
    schemaVersion: 1, language: 'chinese', sourceIds: [sourceId],
    sourcePins: { [sourceId]: { revision: lock.revision, archive: lock.archive, archiveSha256: lock.archive_sha256 } },
    characters: characters.map(({ character, strokeCount, reviewed, variant }) => ({ character, strokeCount, reviewed, variant })),
  }
  outputs.set(indexPath, Buffer.from(json(index)))
  const derived = new JSZip()
  // The original ZIP is served once, separately; include only the projection's inputs.
  inputFiles.delete(`curriculum/chinese/${archivePath}`)
  for (const path of ['scripts/generate-app-characters.mjs', 'package.json', 'package-lock.json']) {
    // Git checkouts may use CRLF for code/package files; source artwork stays byte-exact.
    inputFiles.set(path, Buffer.from(readFileSync(join(root, ...path.split('/')), 'utf8').replace(/\r\n/g, '\n')))
  }
  inputFiles.set('MODIFICATIONS.txt', Buffer.from(`${notice}\n`))
  for (const [path, bytes] of [...inputFiles.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    derived.file(path, bytes, { date: new Date('2000-01-01T00:00:00.000Z'), createFolders: false, unixPermissions: 0o100644 })
  }
  const sourceBundle = await derived.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' })
  outputs.set(join(publicPath, 'derived-source.generated.zip'), sourceBundle)
  outputs.set(join(publicPath, 'hanzi-writer-selected.zip'), pins.get(archivePath))
  outputs.set(join(publicPath, 'hanzi-writer-ARPHICPL.TXT'), pins.get(licensePath))
  outputs.set(join(publicPath, 'source-lock.yaml'), pins.get(sourceLockPath))
  outputs.set(join(publicPath, 'sources.yaml'), sourcesBytes)
  outputs.set(join(publicPath, 'ATTRIBUTION.html'), Buffer.from(attribution(notice, lock, sha256(sourceBundle))))
  return { outputs, index, characters, pages: manifest.chunks.length }
}

const ownedPublic = name => /^u[0-9a-f]{4}\.generated\.json$/i.test(name) ||
  ['derived-source.generated.zip', 'hanzi-writer-selected.zip', 'hanzi-writer-ARPHICPL.TXT', 'source-lock.yaml', 'sources.yaml', 'ATTRIBUTION.html'].includes(name)

/** Check is strictly no-write; stale cleanup is limited to the owned filenames. */
export function synchronizeCharacterOutputs(outputs, root = repositoryRoot, check = false) {
  const stale = []
  const publicRoot = join(root, publicPath)
  const existing = existsSync(publicRoot) ? readdirSync(publicRoot).filter(ownedPublic).map(file => join(publicPath, file)) : []
  for (const path of existing) {
    if (outputs.has(path)) continue
    stale.push(path)
    if (!check) unlinkSync(join(root, path))
  }
  for (const [path, bytes] of outputs) {
    const full = join(root, path)
    if (existsSync(full) && readFileSync(full).equals(bytes)) continue
    stale.push(path)
    if (!check) {
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, bytes)
    }
  }
  return stale
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.slice(2).every(arg => arg === '--check'), 'Usage: node scripts/generate-app-characters.mjs [--check]')
    const check = process.argv.includes('--check')
    const data = await buildAppCharacters()
    const stale = synchronizeCharacterOutputs(data.outputs, repositoryRoot, check)
    if (check && stale.length) {
      for (const path of stale) console.error(`Stale character asset: ${relative(repositoryRoot, join(repositoryRoot, path))}`)
      throw new Error('Run "npm run characters:generate" to regenerate character assets.')
    }
    const bytes = [...data.outputs.values()].reduce((sum, value) => sum + value.length, 0)
    console.log(`Chinese character assets ${check ? 'current' : 'generated'}: ${data.characters.length} characters, ${data.pages} lazy pages, ${data.characters.filter(record => record.reviewed).length} inherited reviewed defaults, ${bytes} bytes (${stale.length} ${check ? 'stale' : 'updated'} files).`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
