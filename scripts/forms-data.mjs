// Word-form rules and class decisions as files (curriculum/<language>/forms.yaml, forms-classes.yaml); shared by the generators.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIRS = { ja: 'japanese', ko: 'korean' }
export const formsYamlFile = (code, base = defaultRoot) => join(base, 'curriculum', DIRS[code], 'forms.yaml')
export const formsClassesFile = (code, base = defaultRoot) => join(base, 'curriculum', DIRS[code], 'forms-classes.yaml')
export const formsJsonFile = (code, base = defaultRoot) => join(base, 'src', 'data', 'forms', code + '.json')

/** The parsed and checked rules of a language. */
export function loadFormsRules(code, base = defaultRoot) {
  // a folder without its own rules (a test's temporary root) uses the repository's
  const file = existsSync(formsYamlFile(code, base)) ? formsYamlFile(code, base) : formsYamlFile(code, defaultRoot)
  const rules = parse(readFileSync(file, 'utf8'))
  if (rules?.language !== code) throw new Error(code + ' forms.yaml: language must be ' + code)
  if (!rules.classes || !rules.forms) throw new Error(code + ' forms.yaml: classes and forms are required')
  for (const [id, spec] of Object.entries(rules.forms)) {
    if (code === 'ja' && !Array.isArray(spec.group)) throw new Error('ja forms.yaml: form ' + id + ' needs a group list')
    if (code === 'ko' && !spec.join) throw new Error('ko forms.yaml: form ' + id + ' needs a join')
  }
  for (const [id, meta] of Object.entries(rules.classes)) {
    if (meta.baseline && !rules.classes[meta.baseline]) throw new Error(code + ' forms.yaml: class ' + id + ' has the unknown baseline ' + meta.baseline)
  }
  return rules
}

/** { "target|reading": class } decided outside the code (the batched model answer), checked against the class list. */
export function loadClassOverrides(code, base = defaultRoot) {
  const file = formsClassesFile(code, base)
  if (!existsSync(file)) return {}
  const overrides = parse(readFileSync(file, 'utf8'))?.overrides ?? {}
  const rules = loadFormsRules(code, base)
  for (const [key, cls] of Object.entries(overrides)) if (!rules.classes[cls]) throw new Error(code + ' forms-classes.yaml: ' + key + ' has the unknown class ' + cls)
  return overrides
}
