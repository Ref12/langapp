// Projects the word-form rules (curriculum/<language>/forms.yaml) into src/data/forms/<language>.json for the app (src/core/forms/).
// Usage: node scripts/generate-app-forms.mjs [--check] [--root DIR]
import { existsSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formsJsonFile, formsYamlFile, loadFormsRules } from './forms-data.mjs'
import { LANGUAGES, root as defaultRoot, writeAtomic } from './parallel-lessons-files.mjs'

export { formsJsonFile, formsYamlFile, loadFormsRules }

export const formsOutputs = (base = defaultRoot) => new Map(Object.keys(LANGUAGES).map(code => [formsJsonFile(code, base), JSON.stringify(loadFormsRules(code, base)) + '\n']))

export function main(argv = process.argv.slice(2)) {
  const check = argv.includes('--check')
  const at = argv.indexOf('--root')
  const base = at >= 0 ? resolve(argv[at + 1]) : defaultRoot
  const unknown = argv.filter((arg, index) => arg !== '--check' && arg !== '--root' && argv[index - 1] !== '--root')
  if (unknown.length) throw new Error('Usage: node scripts/generate-app-forms.mjs [--check] [--root DIR]')
  const stale = []
  for (const [file, text] of formsOutputs(base)) {
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue
    stale.push(file)
    if (!check) writeAtomic(file, text)
  }
  if (!(check && stale.length)) console.log('forms rules ' + (check ? 'current' : 'generated') + (stale.length ? ': ' + stale.map(file => relative(base, file)).join(', ') : ''))
  if (check && stale.length) { for (const file of stale) console.error('Stale forms rules: ' + relative(base, file)); throw new Error('Run "npm run forms:generate" to regenerate src/data/forms.') }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
