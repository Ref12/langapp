// The two language views share vocabulary state, not separate learning modes.
const readerWordIndex = { source: new Map(), target: new Map() }
for (const [id, forms] of Object.entries(readerWordForms)) {
  for (const language of ['source', 'target']) {
    for (const form of forms[language]) readerWordIndex[language].set(form.toLowerCase(), id)
  }
}
function tokenizeReaderPassage(paragraphs, language) {
  const segmenter = new Intl.Segmenter(language === 'source' ? 'en' : 'zh-Hans', { granularity: 'word' })
  return paragraphs.map((parts) => parts.flatMap((part) => {
    if (typeof part !== 'string') return [{ id: part.id, text: language === 'source' ? words[part.id].gloss : part.text || words[part.id].native }]
    return [...segmenter.segment(part)].map(({ segment, isWordLike }) => {
      if (!isWordLike) return { text: segment }
      const id = readerWordIndex[language].get(segment.toLowerCase())
      if (!id) throw new Error(`Reader vocabulary is missing "${segment}" in ${language}.`)
      return { id, text: segment }
    })
  }))
}
const readerPassages = {
  source: tokenizeReaderPassage(sourcePassage, 'source'),
  target: tokenizeReaderPassage(targetPassage, 'target'),
}
const readerPositions = { source: 0, target: 0 }

function selectReaderWord(id) {
  state.word = id
  all('.reading-word').forEach((item) => item.classList.toggle('selected', item.dataset.word === id))
  renderWord()
  one('#reader-panel').scrollTop = 0
  const word = words[id]
  one('#reader-selection-status').textContent = `${word.native}. ${word.gloss}. ${wordLearningStatus(word)}.`
}
function renderPassage() {
  const container = one('#reading-passage')
  const scroller = one('#reading-scroll')
  const focused = container.contains(document.activeElement) ? document.activeElement.dataset.tokenKey : null
  const scrollTop = scroller.scrollTop
  const target = state.mode === 'target'
  container.dataset.mode = state.mode
  container.lang = target ? 'zh-Hans' : 'en'
  container.replaceChildren()
  readerPassages[state.mode].forEach((tokens, paragraphIndex) => {
    const paragraph = document.createElement('p')
    tokens.forEach((token, tokenIndex) => {
      if (!token.id) {
        paragraph.append(document.createTextNode(token.text))
        return
      }
      const word = words[token.id]
      const woven = !target && state.weaving && word.tracked && word.weave !== false
      const annotated = target && state.weaving && !wordReadingLearned(word)
      const element = document.createElement(state.readerPanel ? 'button' : 'span')
      element.className = 'reading-word'
      if (state.readerPanel) {
        element.type = 'button'
        element.setAttribute('aria-label', `Explore ${word.gloss}`)
      }
      element.classList.toggle('woven', woven)
      element.classList.toggle('annotated', annotated)
      element.classList.toggle('selected', state.readerPanel && token.id === state.word)
      element.dataset.word = token.id
      element.dataset.originalText = token.text
      element.dataset.tokenKey = `${state.mode}-${paragraphIndex}-${tokenIndex}`
      const native = document.createElement('span')
      native.className = 'reading-token-text'
      native.lang = target || woven ? word.nativeLanguage || 'zh-Hans' : 'en'
      native.textContent = woven ? word.native : token.text
      element.append(native)
      if (annotated) {
        const annotation = document.createElement('span')
        annotation.className = 'reader-annotation'
        annotation.lang = 'en'
        const pronunciation = document.createElement('span')
        pronunciation.textContent = word.romanization
        const meaning = document.createElement('span')
        meaning.textContent = word.annotation || word.gloss
        annotation.append(pronunciation, meaning)
        element.append(annotation)
      }
      if (state.readerPanel) element.addEventListener('click', () => {
        if (!window.getSelection()?.isCollapsed) return
        selectReaderWord(token.id)
      })
      paragraph.append(element)
    })
    container.append(paragraph)
  })
  one('#reader-instruction').textContent = `${target ? 'Mandarin text. Weaving adds English meaning and pronunciation below words not yet learned for reading.' : 'English text. Weaving uses words in your learning set where a target-language counterpart is available.'} ${state.readerPanel ? 'Select any word for help in the learning panel.' : 'Learning panel is off. Read or select text without opening word help.'}`
  if (focused) all('.reading-word').find((element) => element.dataset.tokenKey === focused)?.focus({ preventScroll: true })
  scroller.scrollTop = scrollTop
}
function renderWord() {
  const word = words[state.word]
  one('#word-native').textContent = word.native
  one('#word-native').lang = word.nativeLanguage || 'zh-Hans'
  one('#word-romanization').textContent = word.romanization
  one('#word-romanization').hidden = !word.romanization
  one('#word-gloss').textContent = word.gloss
  one('#word-kind').textContent = word.kind
  one('#word-example-native').textContent = word.example
  one('#word-example-native').lang = word.nativeLanguage || 'zh-Hans'
  one('#word-example-source').textContent = word.source
  one('#word-state').textContent = wordLearningStatus(word)
  one('#save-word').textContent = word.tracked ? 'In learning set' : 'Add to learning set'
  one('#save-word').disabled = word.tracked
  renderKnowledgeProfile(one('#word-skill-profile'), word)
  one('#mark-known').textContent = wordReadingLearned(word) ? 'Reading needs practice' : 'I can read this'
  one('#word-lookup-note').hidden = word.weave !== false
  one('#word-lookup-note').textContent = word.weave === false ? 'This English word has no isolated Mandarin equivalent, so Source weaving leaves it in place.' : ''
  setSnippetActions(one('#word-native'), wordSnippetOptions(word, 'Library / A morning at the tea house'))
  setSnippetActions(one('#word-example-native'), { meaning: word.source, source: `Library word-help example: ${word.gloss}` })
  positionReaderSnippetActions()
}
function positionReaderSnippetActions() {
  const actions = snippetAttachments.get(one('#word-native'))
  if (actions) {
    if (mobileLayout.matches) one('#reader-panel .panel-heading').insertBefore(actions, one('#close-reader-panel'))
    else one('#word-native').after(actions)
  }
}
function setReaderPanel(visible) {
  state.readerPanel = visible
  one('#reader-panel').hidden = !visible
  one('.reader-layout').classList.toggle('panel-hidden', !visible)
  one('#toggle-reader-panel').setAttribute('aria-expanded', String(visible))
  renderPassage()
}
one('#toggle-reader-panel').addEventListener('click', () => setReaderPanel(!state.readerPanel))
one('#close-reader-panel').addEventListener('click', () => {
  setReaderPanel(false)
  one('#toggle-reader-panel').focus({ preventScroll: true })
})
all('.reading-modes [data-mode]').forEach((button) => button.addEventListener('click', () => {
  readerPositions[state.mode] = one('#reading-scroll').scrollTop
  state.mode = button.dataset.mode
  all('.reading-modes [data-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
  renderPassage()
  one('#reading-scroll').scrollTop = readerPositions[state.mode]
}))
one('#reader-weaving').addEventListener('click', (event) => {
  state.weaving = !state.weaving
  event.currentTarget.setAttribute('aria-pressed', String(state.weaving))
  renderPassage()
})
one('#reader-text-size').addEventListener('change', (event) => {
  one('#reading-passage').style.setProperty('--reading-scale', event.target.value)
})
one('#save-word').addEventListener('click', () => addWordToLearningSet(state.word, 'reading'))
one('#mark-known').addEventListener('click', () => {
  const word = words[state.word]
  const reading = knowledgeFor(word).reading
  reading.state = wordReadingLearned(word) ? 'Practicing' : 'Learned'
  reading.evidence = 'Self-reported reading state; not an assessment of other skills.'
  refreshWordState()
  notify(`Reading "${word.gloss}": ${reading.state}. Hearing, speaking, writing, and learning-set membership are unchanged.`)
})
document.addEventListener('mockup-words-changed', () => {
  renderWord()
  renderPassage()
})
function syncReaderDetails() {
  one('#reader-word-details').open = !mobileLayout.matches
  positionReaderSnippetActions()
}
mobileLayout.addEventListener('change', syncReaderDetails)
syncReaderDetails()
renderPassage()
renderWord()
