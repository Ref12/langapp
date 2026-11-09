// Prints the word-form report of the parallel lessons: tokens tagged, ambiguous, unmatched, irregular items per lesson and the phrases that stopped being strict.
// Usage: node scripts/report-parallel-forms.mjs [--root DIR]
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyseForms, loadReferences, readParallel, refreshReadability, root as defaultRoot } from './parallel-lessons-files.mjs'

export function report(code, base = defaultRoot) {
  const data = readParallel(code, base), lessons = data.lessons.lessons
  const taught = refreshReadability(lessons)
  const forms = analyseForms(code, lessons, taught, data, loadReferences(code, base), base)
  const ambiguousClass = [...forms.classes].filter(([, info]) => info.ambiguous).map(([id]) => id)
  const byLesson = {}
  for (const [id, item] of Object.entries(forms.items)) (byLesson[item.lesson] ??= []).push(id)
  return { code, counts: forms.counts, ambiguousLemmas: ambiguousClass, items: byLesson, unmatched: forms.result.unmatched.map(item => ({ lesson: item.lesson, phrase: item.phrase, lemma: item.lemma, text: item.text })), ambiguous: forms.result.ambiguous, lostStrict: forms.lostStrict }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--root')
  const base = at >= 0 ? resolve(process.argv[at + 1]) : defaultRoot
  for (const code of ['ja', 'ko']) console.log(JSON.stringify(report(code, base), null, 1))
}
