// Lookup and Assistant use this same authored lexicon and learning-set state.
Object.assign(words, {
  park: { native: '\u516c\u56ed', romanization: 'g\u014dngyu\u00e1n', gloss: 'park', kind: 'WORD / NOUN', example: '\u6211\u660e\u5929\u60f3\u53bb\u516c\u56ed\u3002', source: 'I would like to go to the park tomorrow.', tracked: false, learned: false },
  again: { native: '\u518d', romanization: 'z\u00e0i', gloss: 'again / once more', kind: 'WORD / ADVERB', example: '\u6211\u60f3\u518d\u559d\u4e00\u676f\u8336\u3002', source: 'I would like another cup of tea.', tracked: false, learned: false },
  want: { native: '\u60f3', romanization: 'xi\u01ceng', gloss: 'would like / want to / think', kind: 'WORD / VERB', example: '\u6211\u60f3\u559d\u8336\u3002', source: 'I would like to drink tea.', tracked: false, learned: false },
  tomorrow: { native: '\u660e\u5929', romanization: 'm\u00edngti\u0101n', gloss: 'tomorrow', kind: 'TIME EXPRESSION', example: '\u6211\u660e\u5929\u53bb\u516c\u56ed\u3002', source: 'I am going to the park tomorrow.', tracked: false, learned: false },
  station: { native: '\u8f66\u7ad9', romanization: 'ch\u0113zh\u00e0n', gloss: 'station', kind: 'WORD / NOUN', example: '\u8f66\u7ad9\u5728\u54ea\u91cc\uff1f', source: 'Where is the station?', tracked: false, learned: false },
})
function wordLearningStatus(word) {
  return word.learned ? 'Learned' : word.tracked ? 'Practicing' : 'Not studied'
}
function normalizePinyin(text) {
  return text.toLowerCase().normalize('NFD').replace(/u:|u\u0308/g, 'v')
    .replace(/\p{M}/gu, '').replace(/([a-z])[1-5]/g, '$1').replace(/[\s'-]+/g, '')
}
function findDictionaryWords(query) {
  const text = query.trim().normalize('NFKC').toLowerCase()
  if (!text) return []
  const pinyin = normalizePinyin(text)
  return Object.keys(words).filter((id) => {
    const word = words[id]
    return word.native.includes(text) || word.gloss.toLowerCase().includes(text)
      || (pinyin && normalizePinyin(word.romanization).includes(pinyin))
  })
}
function dictionaryElement(tag, className, text) {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = text
  return element
}
function addCharacterPracticeAction(actions, word) {
  const characters = Array.from(word.native).filter((character) => /\p{Script=Han}/u.test(character))
  if (!characters.length) return
  const button = dictionaryElement('button', 'snippet-action', '')
  button.type = 'button'
  button.dataset.writeWord = word.native
  button.setAttribute('aria-label', `Practice writing: ${word.native}`)
  const icon = one('[data-nav="dictionary"] svg').cloneNode(true)
  icon.setAttribute('aria-hidden', 'true')
  icon.querySelector('use').setAttribute('href', '#i-write')
  button.append(icon)
  if (characters.length > 1) button.setAttribute('aria-haspopup', 'dialog')
  button.addEventListener('click', () => {
    if (characters.length === 1) {
      openCharacterPractice(word, 0, button)
      return
    }
    const dialog = one('#writing-character-dialog')
    one('#writing-source-word').textContent = `${word.native} / ${word.gloss}`
    const choices = one('#writing-character-choices')
    choices.replaceChildren()
    characters.forEach((character, index) => {
      const choice = dictionaryElement('button', 'writing-character-choice', '')
      choice.type = 'button'
      choice.dataset.writeCharacter = character
      choice.setAttribute('aria-label', `Write ${character}, character ${index + 1} of ${characters.length}`)
      const glyph = dictionaryElement('span', '', character)
      glyph.lang = 'zh-Hans'
      choice.append(glyph, dictionaryElement('small', '', `${index + 1} of ${characters.length}`))
      choice.addEventListener('click', () => {
        dialog.close()
        openCharacterPractice(word, index, button)
      })
      choices.append(choice)
    })
    dialog.showModal()
  })
  actions.append(button)
}
function renderLookupCard(id, conversationId = null) {
  const word = words[id]
  const card = dictionaryElement('article', 'lookup-result', '')
  card.dataset.lookupWord = id
  const heading = dictionaryElement('div', 'lookup-word-heading', '')
  const native = dictionaryElement('h3', '', word.native)
  native.lang = word.nativeLanguage || 'zh-Hans'
  const reading = dictionaryElement('span', conversationId ? 'phrase-romanization' : 'dictionary-reading', word.romanization)
  if (conversationId) reading.hidden = !assistantPreferences.romanization
  const status = dictionaryElement('span', 'tag green', wordLearningStatus(word))
  status.dataset.wordStatus = id
  heading.append(native, reading, dictionaryElement('span', 'tag', word.kind), status)
  const textActions = setSnippetActions(native, wordSnippetOptions(word, 'Dictionary word'))
  if (!conversationId) addCharacterPracticeAction(textActions, word)
  const example = dictionaryElement('p', 'lookup-example', word.example)
  example.lang = word.nativeLanguage || 'zh-Hans'
  const actions = dictionaryElement('div', 'button-row', '')
  const add = dictionaryElement('button', 'button primary', word.tracked ? 'In learning set' : 'Add to learning set')
  add.type = 'button'
  add.dataset.addWord = id
  if (conversationId) add.dataset.sourceConversation = conversationId
  add.disabled = word.tracked
  actions.append(add)
  card.append(heading, dictionaryElement('p', 'lookup-meaning', word.gloss), example,
    dictionaryElement('p', 'small muted', word.source), actions)
  setSnippetActions(example, { lang: example.lang, meaning: word.source, source: `Dictionary example: ${word.gloss}` })
  return card
}
function addWordToLearningSet(id, source = 'lookup', conversationId = null) {
  if (!Object.hasOwn(words, id)) {
    notify('That word is not available in the sample dictionary.')
    return false
  }
  const word = words[id]
  if (word.tracked) {
    notify(`"${word.gloss}" is already in your learning set.`)
    return false
  }
  word.tracked = true
  word.addedFrom = source
  if (conversationId) word.sourceConversation = conversationId
  refreshWordState()
  notify(`Added "${word.gloss}" to your learning set. This does not mark it learned or change the demo review queue.`)
  return true
}
function refreshWordState() {
  renderDictionary()
  all('[data-add-word]').forEach((button) => {
    button.disabled = words[button.dataset.addWord].tracked
    button.textContent = button.disabled ? 'In learning set' : 'Add to learning set'
  })
  all('[data-word-status]').forEach((label) => { label.textContent = wordLearningStatus(words[label.dataset.wordStatus]) })
  document.dispatchEvent(new Event('mockup-words-changed'))
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-add-word]')
  if (button) addWordToLearningSet(button.dataset.addWord, button.dataset.sourceConversation ? 'assistant' : 'lookup', button.dataset.sourceConversation)
})
function renderLookupResults() {
  const query = one('#dictionary-lookup').value
  const ids = findDictionaryWords(query)
  one('#lookup-results').replaceChildren(...ids.map((id) => renderLookupCard(id)))
  one('#lookup-status').textContent = !query.trim() ? 'Look up a word to see its meaning, pronunciation, and example.'
    : ids.length ? `${ids.length} ${ids.length === 1 ? 'match' : 'matches'} in the sample dictionary.`
      : 'No sample entry found. A full dictionary service is not connected in this mockup.'
}
function showDictionaryView(view) {
  one('#dictionary-lookup-panel').hidden = view !== 'lookup'
  one('#dictionary-learning-panel').hidden = view !== 'learning'
  all('[data-dictionary-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.dictionaryView === view)))
}
function showDictionaryLookup(query) {
  one('#dictionary-lookup').value = query
  showDictionaryView('lookup')
  renderLookupResults()
  one('#dictionary-lookup').focus({ preventScroll: true })
}
all('[data-dictionary-view]').forEach((button) => button.addEventListener('click', () => showDictionaryView(button.dataset.dictionaryView)))
all('[data-lookup-example]').forEach((button) => button.addEventListener('click', () => showDictionaryLookup(button.dataset.lookupExample)))
one('#dictionary-lookup').addEventListener('input', renderLookupResults)
document.addEventListener('mockup-route-changed', (event) => {
  if (event.detail === 'dictionary') renderLookupResults()
})
renderDictionary()
renderLookupResults()
