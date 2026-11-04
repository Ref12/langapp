// Draft generator for curriculum/chinese/characters/component-variants.yaml (run via build-components.mjs --draft-variants=<file>).
// The checked-in YAML is the reviewed table; this only proposes rows from the pinned sources and the usage data.
import { blockOf } from './build-components.mjs'

const BRIEF = [
  ['亻', '人'], ['氵', '水'], ['氺', '水'], ['忄', '心'], ['⺗', '心'], ['扌', '手'], ['灬', '火'], ['刂', '刀'],
  ['讠', '言'], ['钅', '金'], ['饣', '食'], ['衤', '衣'], ['礻', '示'], ['犭', '犬'], ['罒', '网'], ['爫', '爪'], ['月', '肉'], ['艹', '艸'], ['辶', '辵'],
]
const hex = ch => `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
const q = s => JSON.stringify(s)

export function draftVariants({ document, src, tally, usage, kangxiByForm, variantParent }, index) {
  const rows = []
  const radicalOf = ch => kangxiByForm.get(ch) ?? variantParent.get(ch)
  const seen = new Set()
  const add = (form, parent, origin, extra = {}) => {
    const key = `${form}|${parent}|${extra.only ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ form, parent, origin, ...extra })
  }
  for (const [form, parent] of BRIEF) add(form, parent, 'brief')
  add('阝', '阜', 'brief', { only: 'left' })
  add('阝', '邑', 'brief', { only: 'right' })
  for (const [form, radical] of variantParent) if (usage.has(form)) add(form, radical.form, 'unicode-data')
  const out = ['# Positional and variant forms of components. Generated as a draft by scripts/build-components.mjs --draft-variants, then reviewed by hand.', 'variants:']
  for (const row of rows) {
    const { form, parent } = row
    const parentRadical = radicalOf(parent) ?? radicalOf(form)
    const slots = [...tally].filter(([k]) => k.startsWith(`${form}\t`)).map(([k, v]) => [k.split('\t')[1], v]).sort((a, b) => b[1] - a[1])
    const useChars = [...(usage.get(form) ?? [])]
    const filtered = row.only ? slots.filter(([s]) => s === row.only) : slots.filter(([, n], i) => i === 0 || n >= 2)
    const total = filtered.reduce((n, [, v]) => n + v, 0)
    const city = c => src.dictionary.get(c)?.etymology?.hint === 'city'
    const examples = row.only
      ? useChars.filter(c => document.characters[c]?.d === '⿰' && document.characters[c].k[row.only === 'left' ? 0 : 1].c === form && (row.only === 'right') === city(c)).slice(0, 6)
      : useChars.slice(0, 6)
    out.push(`  - form: ${q(form)}`, `    cp: ${q(hex(form))}`, `    block: ${q(blockOf(form.codePointAt(0)))}`, `    parent: ${q(parent)}`, `    parent_cp: ${q(hex(parent))}`)
    if (parentRadical) out.push(`    kangxi_radical: ${parentRadical.number}`)
    out.push(`    positions:`)
    for (const [slot, n] of filtered.slice(0, 4)) out.push(`      - { slot: ${slot}, count: ${n} }`)
    if (!filtered.length) out.push('      []')
    out.push(`    uses: ${total || useChars.length}`)
    const brief = BRIEF.some(([f]) => f === form) || form === '阝' || form === '王'
    const positional = brief || !index.includes(form)
    out.push(`    kind: ${positional ? 'positional' : (parent !== form && /[\u4e00-\u9fff]/.test(parent) && src.unihan.get(parent)?.definition !== undefined && form !== parent ? 'simplified-or-variant' : 'variant')}`)
    out.push(`    positional: ${positional}`)
    out.push(`    examples: [${examples.map(q).join(', ')}]`)
    if (parentRadical) out.push(`    name_en: ${q(parentRadical.english)}`, `    name_pinyin: ${q(parentRadical.pinyin)}`)
    const un = src.names.get(form)
    if (un) out.push(`    unicode_name: ${q(un)}`)
    out.push(`    origin: ${q(row.origin)}`)
  }
  return `${out.join('\n')}\n`
}
