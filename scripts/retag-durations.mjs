// Retags the shipped phrase bank and practice dataset with the duration grammar points, by code (scripts/duration-grammar.mjs), and recomputes readyAt.
// A phrase whose Chinese has a verb + length of time gets num-nian2-or-tian1-or-fen1--duration (and v-le5-duration-obj--duration with 了), so it is only used once
// the learner has met that point. Phrases with a stale duration tag lose it. Practice items follow their phrase; no model is called.
// By default only sentences whose duration tags change are touched. --all also recomputes every readyAt from the current lesson order (the shipped values of HSK 2-6 are a few lessons behind it).
// Usage: node scripts/retag-durations.mjs [--dry-run] [--all]   (writes curriculum/chinese/authoring/phrases, src/data/phrases and src/data/practice)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BANDS, buildCurriculum, phraseKey, readCatalog, readyAtOf } from './build-phrase-bank.mjs'
import { DURATION_REFS, withDurationGrammar } from './duration-grammar.mjs'
import { defaultPhraseAuthoringDir, defaultPhraseJsonDir, readPhraseBands, writeAtomic, writePhraseBands } from './phrase-bank-files.mjs'

const same = (a, b) => a.length === b.length && a.every((item, at) => item === b[at])

/** Retags the band files in place; returns the changed phrases { band, id, zh, from, to, grammar, tagged }. tagged: the duration tags changed; otherwise only readyAt moved (the lesson order changed). */
export function retagPhrases(curriculum, files, { all = false } = {}) {
  const changed = []
  for (const file of files) for (const phrase of file.phrases) {
    const before = phrase.readyAt ?? readyAtOf(curriculum, phrase.words, phrase.grammar ?? [])
    const grammar = withDurationGrammar(curriculum, phrase.zh, phrase.grammar ?? [])
    const tagged = !same(grammar.filter(ref => DURATION_REFS.includes(ref)), (phrase.grammar ?? []).filter(ref => DURATION_REFS.includes(ref)))
    const after = readyAtOf(curriculum, phrase.words, grammar)
    if (same(grammar, phrase.grammar ?? []) && (after === before || !all)) continue
    if (!tagged && !all) continue
    changed.push({ band: file.band, id: phrase.id, zh: phrase.zh, from: before, to: after, grammar: grammar.filter(ref => DURATION_REFS.includes(ref)), tagged, plain: readyAtOf(curriculum, phrase.words, grammar.filter(ref => !DURATION_REFS.includes(ref))) })
    phrase.grammar = grammar; phrase.readyAt = after
  }
  return changed
}

/** Retags the practice items of one kind in place; returns how many changed readyAt: { kind, band, id, from, to }. phraseReady maps a phrase key to its (new) readyAt. */
export function retagPractice(curriculum, kind, items, phraseReady, { all = false } = {}) {
  const changedKeys = new Set(phraseReady.keys())
  const changed = []
  const set = (item, readyAt, id) => { if (item.readyAt !== readyAt) { changed.push({ id, from: item.readyAt, to: readyAt }); item.readyAt = readyAt } }
  for (const item of items) {
    if (kind === 'accepted') {
      const own = phraseReady.get(item.key)
      const alts = (item.zhAlt ?? []).map(zh => readyAtOf(curriculum, [], withDurationGrammar(curriculum, zh).filter(ref => DURATION_REFS.includes(ref))))
      if (own !== undefined && (all || changedKeys.has(item.key) || alts.some(alt => alt > 0))) set(item, Math.max(own, ...alts), item.key)
    } else if (kind === 'exchanges' || kind === 'conversations') {
      const zh = kind === 'exchanges' ? item.q.zh + item.a.zh : item.lines.map(line => line.zh).join('，')
      const grammar = withDurationGrammar(curriculum, zh, item.grammar ?? [])
      const tagged = !same(grammar.filter(ref => DURATION_REFS.includes(ref)), (item.grammar ?? []).filter(ref => DURATION_REFS.includes(ref)))
      if (!tagged && !all) continue
      item.grammar = grammar
      set(item, readyAtOf(curriculum, item.words ?? [], item.grammar), item.id)
    } else if (kind === 'grammar') {
      for (const near of item.items ?? []) { const ready = phraseReady.get(near.phrase); if (ready !== undefined) set(near, ready, near.id) }
      if (!all && !(item.items ?? []).some(near => phraseReady.has(near.phrase))) continue
      const top = Math.max(curriculum.grammar.get(item.ref)?.index ?? 0, ...(item.items ?? []).map(near => near.readyAt))
      set(item, top, item.ref)
    }
  }
  return changed
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const dry = argv.includes('--dry-run'), all = argv.includes('--all')
  const curriculum = buildCurriculum(readCatalog())
  const files = readPhraseBands(defaultPhraseAuthoringDir)
  const changed = retagPhrases(curriculum, files, { all })
  const tagged = changed.filter(row => row.tagged)
  log('phrases changed: ' + changed.length + ' of ' + files.reduce((sum, file) => sum + file.phrases.length, 0) + ' (' + tagged.length + ' by a duration tag, ' + (changed.length - tagged.length) + ' only because the lesson order changed)')
  for (const row of tagged) log('  hsk-' + row.band + ' #' + row.id + ' ' + row.zh + '  readyAt ' + row.from + ' -> ' + row.to + ' (without the duration tag ' + row.plain + ')  ' + row.grammar.map(ref => ref.slice(0, 8)).join(','))
  const changedZh = new Set(changed.map(row => row.zh))
  const phraseReady = new Map(files.flatMap(file => file.phrases.filter(phrase => all || changedZh.has(phrase.zh)).map(phrase => [phraseKey(phrase.zh), phrase.readyAt])))
  const practiceDir = join(defaultPhraseJsonDir, '..', 'practice')
  const written = []
  for (const band of BANDS) for (const kind of ['accepted', 'exchanges', 'conversations', 'grammar']) {
    const file = join(practiceDir, kind + '-hsk-' + band + '.json')
    if (!existsSync(file)) continue
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const rows = retagPractice(curriculum, kind, data.items ?? [], phraseReady, { all })
    if (!rows.length) continue
    log(kind + ' hsk-' + band + ': ' + rows.length + ' readyAt changed' + rows.slice(0, 6).map(row => '  ' + row.id + ' ' + row.from + '->' + row.to).join(''))
    written.push([file, '{"schemaVersion":' + data.schemaVersion + ',"kind":"' + data.kind + '","band":"' + data.band + '","items":[' + (data.items.length ? '\n' : '') + data.items.map(item => JSON.stringify(item)).join(',\n') + (data.items.length ? '\n' : '') + ']}\n'])
  }
  if (!dry) {
    writePhraseBands(files.filter(file => changed.some(row => row.band === file.band)), { authoringDir: defaultPhraseAuthoringDir, jsonDir: defaultPhraseJsonDir })
    for (const [file, text] of written) writeAtomic(file, text)
  }
  log(dry ? 'dry run: nothing written' : 'written')
  return { changed, practice: written.length }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
