import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

// These retain historical recognition identities, not additional v2 vocabulary.
export const legacyWordLabels = [
  { id: 'zh-hsk1-00022-s001', lb: 'legacy-bei3-jing1--beijing' },
  { id: 'zh-hsk1-00042-s001', lb: 'legacy-chang4-ge1--sing-a-song' },
  { id: 'zh-hsk1-00044-s001', lb: 'legacy-che1-piao4--bus-or-train-ticket' },
  { id: 'zh-hsk1-00048-s001', lb: 'legacy-chi1-fan4--have-a-meal' },
  { id: 'zh-hsk1-00061-s001', lb: 'legacy-da3-qiu2--play-ball' },
  { id: 'zh-hsk1-00080-s003', lb: 'legacy-dian4-hua4--phone-number' },
  { id: 'zh-hsk1-00097-s006', lb: 'legacy-duo1-shao5--what-number' },
  { id: 'zh-hsk1-00130-s001', lb: 'legacy-guo2--surname-guo' },
  { id: 'zh-hsk1-00150-s002', lb: 'legacy-hou4-bian5--behind' },
  { id: 'zh-hsk1-00216-s001', lb: 'legacy-li3-bian5--inside' },
  { id: 'zh-hsk1-00254-s004', lb: 'legacy-nei3--which-before-classifier' },
  { id: 'zh-hsk1-00256-s006', lb: 'legacy-na3-li3--modest-denial' },
  { id: 'zh-hsk1-00258-s003', lb: 'legacy-na4--that-specifier' },
  { id: 'zh-hsk1-00296-s003', lb: 'legacy-qian2-bian5--in-front-of' },
  { id: 'zh-hsk1-00308-s001', lb: 'legacy-re4--warm-or-heat-up' },
  { id: 'zh-hsk1-00312-s001', lb: 'legacy-ri4--japan' },
  { id: 'zh-hsk1-00393-s001', lb: 'legacy-xia4--down' },
  { id: 'zh-hsk1-00470-s003', lb: 'legacy-zhe4--this-before-classifier' },
  { id: 'zh-hsk1-00503-s003', lb: 'legacy-zuo3-bian5--to-the-left-of' },
  { id: 'zh-hsk2-00122-s001', lb: 'legacy-dian4--inn' },
  { id: 'zh-hsk2-00353-s001', lb: 'legacy-lv4--green' },
  { id: 'zh-hsk3-00540-s001', lb: 'legacy-qian2-mian4--ahead' },
  { id: 'zh-hsklegacy-03746-s001', lb: 'legacy-huo3-che1-zhan4--train-station' },
]

export const starterWordLabels = [
  { id: 'zh:cup', lb: 'starter-bei1-zi5--cup' },
  { id: 'zh:cupful', lb: 'starter-bei1--cupful' },
  { id: 'zh:drink', lb: 'starter-he1--drink' },
  { id: 'zh:friend', lb: 'starter-peng2-you5--friend' },
  { id: 'zh:go', lb: 'starter-qu4--go' },
  { id: 'zh:hello', lb: 'starter-ni3-hao3--hello' },
  { id: 'zh:park', lb: 'starter-gong1-yuan2--park' },
  { id: 'zh:rain', lb: 'starter-yu3--rain' },
  { id: 'zh:slowly', lb: 'starter-man4-man4-de5--slowly' },
  { id: 'zh:tea', lb: 'starter-cha2--tea' },
  { id: 'zh:thanks', lb: 'starter-xie4-xie5--thanks' },
  { id: 'zh:tomorrow', lb: 'starter-ming2-tian1--tomorrow' },
  { id: 'zh:want', lb: 'starter-xiang3--would-like' },
  { id: 'zh:window', lb: 'starter-chuang1-hu4--window' },
]

function labelIndex(records, source, prefix = '') {
  const byId = new Map()
  const labels = new Set()
  for (const { id, lb } of records) {
    if (typeof id !== 'string' || !id) throw new Error(`${source}: missing word ID`)
    if (typeof lb !== 'string' || lb.length > 200 || !/^[a-z][a-z0-9]*(?:--?[a-z0-9]+)*$/.test(lb) || !lb.startsWith(prefix)) {
      throw new Error(`${source}: invalid label for ${id}: ${lb}`)
    }
    if (byId.has(id)) throw new Error(`${source}: duplicate ID: ${id}`)
    if (labels.has(lb)) throw new Error(`${source}: duplicate label: ${lb}`)
    byId.set(id, lb)
    labels.add(lb)
  }
  return byId
}

export function buildProfileWordLabels(
  { curriculumWords, authoredLabels, vocabulary, starterIds },
  { legacyLabels = legacyWordLabels, starterLabels = starterWordLabels } = {},
) {
  const authored = labelIndex(authoredLabels.map(({ id, label }) => ({ id, lb: label })), 'Authored word labels')
  const current = labelIndex(vocabulary, 'V2 vocabulary')
  const legacy = labelIndex(legacyLabels, 'Explicit legacy word labels', 'legacy-')
  const starters = labelIndex(starterLabels, 'Explicit starter word labels', 'starter-')
  const curriculumIds = new Set(curriculumWords.map(word => word.id))
  const starterIdSet = new Set(starterIds)
  for (const id of legacy.keys()) {
    if (!curriculumIds.has(id)) throw new Error(`Stale explicit legacy label: ${id}`)
    if (authored.has(id) || current.has(id)) throw new Error(`Unnecessary explicit legacy label: ${id}`)
  }
  for (const id of starters.keys()) {
    if (!starterIdSet.has(id)) throw new Error(`Stale explicit starter label: ${id}`)
  }
  const records = [
    ...curriculumWords.map(({ id }) => ({ id, lb: authored.get(id) ?? current.get(id) ?? legacy.get(id) })),
    ...starterIds.map(id => ({ id, lb: starters.get(id) })),
  ]
  for (const { id, lb } of records) {
    if (lb === undefined) throw new Error(`Missing profile word label: ${id}`)
  }
  labelIndex(records, 'Profile word labels')
  return records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function loadProfileWordLabelSources(root) {
  const read = name => JSON.parse(readFileSync(resolve(root, 'src', 'data', name), 'utf8'))
  const path = resolve(root, 'src', 'data', 'mandarin.ts')
  // Inspect the declaration without executing the browser's TypeScript data modules.
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const declarations = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .filter(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'starterWords')
  const initializer = declarations[0]?.initializer
  if (declarations.length !== 1 || !initializer || !ts.isArrayLiteralExpression(initializer)) {
    throw new Error('Expected one explicit starterWords array in src/data/mandarin.ts')
  }
  const starterIds = initializer.elements.map(element => {
    if (!ts.isObjectLiteralExpression(element) || element.properties.some(ts.isSpreadAssignment)) {
      throw new Error('Expected explicit starter word records in src/data/mandarin.ts')
    }
    const ids = element.properties.filter(property =>
      property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'id')
    if (ids.length !== 1 || !ts.isPropertyAssignment(ids[0]) || !ts.isStringLiteral(ids[0].initializer)) {
      throw new Error('Expected one explicit string ID per starter word in src/data/mandarin.ts')
    }
    return ids[0].initializer.text
  })
  return {
    curriculumWords: read('curriculum.generated.json').words,
    authoredLabels: read('learning-content.generated.json').labels.words,
    starterIds,
  }
}
