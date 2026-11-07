// Retags shipped bank phrases that name a weekday as one word (星期三, 周二) with the app-authored compound entry,
// instead of 星期 + a number. Run after the compounds exist in the v2 catalog: node scripts/retag-phrase-compounds.mjs [--check]
// Rewrites curriculum/chinese/authoring/phrases/hsk-N.yaml and src/data/phrases/*.json through the phrase-bank writers.
import { readPhraseBands, writePhraseBands, defaultPhraseAuthoringDir, defaultPhraseJsonDir } from './phrase-bank-files.mjs'
import { buildCurriculum, readCatalog, readyAtOf } from './build-phrase-bank.mjs'
import { pathToFileURL } from 'node:url'

// Months are not retagged: a date such as 二零二六年三月八号 is the date pattern (number + 月, g061), which the learner knows from 月 and the numbers alone.
const COMPOUND = /^(?:星期|周)[一二三四五六日]$/u

/** The compound weekday entries of the catalog (星期三, 周二), as { ch, lb }. */
export function weekdayCompounds(curriculum) {
  const byChar = new Map()
  for (const word of curriculum.ordered) if (!byChar.has(word.ch)) byChar.set(word.ch, word)
  return [...byChar.values()].filter(word => COMPOUND.test(word.ch)).map(word => ({ ch: word.ch, lb: word.lb }))
    .sort((a, b) => b.ch.length - a.ch.length)
}

/**
 * The phrase's words with each weekday named in its Chinese tagged as the compound entry. The words it was split into (星期, 周 and the
 * numbers) are dropped unless their characters still occur in the phrase outside the compounds (the 十 of 十号, the 三 of 三日).
 */
export function retagWords(phrase, compounds, curriculum) {
  const present = compounds.filter(compound => phrase.zh.includes(compound.ch))
  if (!present.length) return phrase.words
  const residual = present.reduce((text, compound) => text.split(compound.ch).join('|'), phrase.zh)
  const partChars = new Set(present.flatMap(compound => [...compound.ch]).concat(['星期']))
  const parts = lb => { const ch = curriculum.words.get(lb)?.ch; return ch !== undefined && (partChars.has(ch) || ch === '星期' || ch === '周') }
  const kept = phrase.words.filter(lb => !parts(lb) || residual.includes(curriculum.words.get(lb).ch))
  const at = phrase.words.findIndex(lb => parts(lb))
  const added = present.map(compound => compound.lb).filter(lb => !kept.includes(lb))
  if (at < 0) return [...kept, ...added]
  const before = phrase.words.slice(0, at).filter(lb => kept.includes(lb))
  return [...before, ...added, ...kept.filter(lb => !before.includes(lb))]
}

export function retagFiles(files, curriculum) {
  const compounds = weekdayCompounds(curriculum)
  const changed = []
  const next = files.map(file => ({
    ...file,
    phrases: file.phrases.map(phrase => {
      const words = retagWords(phrase, compounds, curriculum)
      if (words.join() === phrase.words.join()) return phrase
      changed.push(phrase.zh)
      return { ...phrase, words, readyAt: readyAtOf(curriculum, words, phrase.grammar ?? []) }
    }),
  }))
  return { files: next, changed }
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const curriculum = buildCurriculum(readCatalog())
  const { files, changed } = retagFiles(readPhraseBands(defaultPhraseAuthoringDir), curriculum)
  if (argv.includes('--check')) {
    if (changed.length) { log('phrases to retag: ' + changed.join(' ')); process.exitCode = 1 } else log('phrase weekday tags are current')
    return changed
  }
  writePhraseBands(files, { authoringDir: defaultPhraseAuthoringDir, jsonDir: defaultPhraseJsonDir })
  log('retagged ' + changed.length + ' phrases: ' + changed.join(' '))
  return changed
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
