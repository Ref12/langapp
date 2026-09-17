// Label pronunciations follow citation pinyin, not connected-speech tone changes.
export function numberedPinyin(pinyin) {
  if (typeof pinyin !== 'string' || !pinyin.trim()) throw new Error('A word label needs canonical pinyin')
  const tones = new Map([['\u0304', 1], ['\u0301', 2], ['\u030c', 3], ['\u0300', 4]])
  return pinyin.toLowerCase().trim().split(/\s+/).map(syllable => {
    let letters = ''
    let tone = 5
    let toneFound = false
    for (const char of syllable.normalize('NFD')) {
      if (tones.has(char)) {
        if (toneFound) throw new Error(`Multiple tones in pinyin segment: ${syllable}`)
        tone = tones.get(char)
        toneFound = true
      } else if (char === '\u0308' && letters.endsWith('u')) {
        letters = `${letters.slice(0, -1)}v`
      } else if (/^[a-z]$/.test(char)) {
        letters += char
      } else {
        throw new Error(`Unsupported canonical pinyin segment: ${syllable}`)
      }
    }
    if (!letters) throw new Error(`Empty pinyin segment: ${syllable}`)
    return `${letters}${tone}`
  }).join('-')
}

export function validateLabelRegistry(input, curriculum) {
  const words = new Map(curriculum.words.map(word => [word.id, word]))
  const grammar = new Set(curriculum.grammar.map(item => item.id))
  for (const [kind, entries] of [['words', input.words], ['grammar', input.grammar]]) {
    const labels = new Set()
    const ids = new Set()
    for (const entry of entries) {
      if (labels.has(entry.label) || ids.has(entry.id)) throw new Error(`Duplicate ${kind} label or canonical ID: ${entry.label}`)
      labels.add(entry.label)
      ids.add(entry.id)
      if (kind === 'words') {
        const word = words.get(entry.id)
        if (!word) throw new Error(`Unknown canonical vocabulary for label ${entry.label}`)
        if (entry.label.split('--')[0] !== numberedPinyin(word.pr)) {
          throw new Error(`Label ${entry.label} does not match canonical pinyin ${word.pr}`)
        }
      } else if (!grammar.has(entry.id)) {
        throw new Error(`Unknown canonical grammar for label ${entry.label}`)
      }
    }
  }
  return input
}
