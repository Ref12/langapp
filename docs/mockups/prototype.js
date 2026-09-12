// All state is illustrative and memory-only. Never connect this mockup to app storage.
const one = (selector) => document.querySelector(selector)
const all = (selector) => [...document.querySelectorAll(selector)]
const mobileLayout = window.matchMedia('(max-width: 760px)')
const state = { mode: 'mixed', density: 50, word: 'tea', collection: 'saved', topic: 'all' }
const words = {
  tea: { native: '\u8336', romanization: 'ch\u00e1', gloss: 'tea', kind: 'WORD / NOUN', example: '\u6211\u60f3\u559d\u4e00\u676f\u8336\u3002', source: 'I would like a cup of tea.', tracked: true, learned: false },
  rain: { native: '\u96e8', romanization: 'y\u01d4', gloss: 'rain', kind: 'WORD / NOUN', example: '\u96e8\u505c\u4e86\u3002', source: 'The rain has stopped.', tracked: true, learned: false },
  cup: { native: '\u676f', romanization: 'b\u0113i', gloss: 'cup', kind: 'WORD / MEASURE WORD', example: '\u4e00\u676f\u8336', source: 'a cup of tea', tracked: true, learned: false },
  friend: { native: '\u670b\u53cb', romanization: 'p\u00e9ngyou', gloss: 'friend', kind: 'WORD / NOUN', example: '\u6211\u7684\u670b\u53cb\u6765\u4e86\u3002', source: 'My friend has arrived.', tracked: false, learned: false },
  window: { native: '\u7a97\u6237', romanization: 'chu\u0101nghu', gloss: 'window', kind: 'WORD / NOUN', example: '\u5979\u5750\u5728\u7a97\u6237\u65c1\u8fb9\u3002', source: 'She sits beside the window.', tracked: false, learned: false },
  slowly: { native: '\u6162\u6162\u5730', romanization: 'm\u00e0nman de', gloss: 'slowly', kind: 'EXPRESSION / MANNER', example: '\u5979\u6162\u6162\u5730\u559d\u8336\u3002', source: 'She drinks tea slowly.', tracked: false, learned: false },
}
const sourcePassage = [
  ['The ', { id: 'rain' }, ' has stopped, but the street is still shining. Lin walks into the little tea house on the corner. Her ', { id: 'friend' }, ' is already there, sitting beside the ', { id: 'window' }, '.'],
  ['The owner brings a pot of ', { id: 'tea' }, ' and two small cups. Outside, people hurry past with their umbrellas. Inside, there is no reason to hurry. Lin wraps her hands around a warm ', { id: 'cup' }, '.'],
  ['They talk about nothing important: the weather, a book, what to cook for dinner. Lin drinks ', { id: 'slowly' }, '. For a little while, the whole morning fits inside this room.'],
]
const targetPassage = [
  [{ id: 'rain' }, '\u505c\u4e86\uff0c\u4f46\u8857\u9053\u8fd8\u5728\u53d1\u4eae\u3002\u5c0f\u6797\u8d70\u8fdb\u8857\u89d2\u7684\u5c0f\u8336\u9986\u3002\u5979\u7684', { id: 'friend' }, '\u5df2\u7ecf\u5230\u4e86\uff0c\u6b63\u5750\u5728', { id: 'window' }, '\u65c1\u8fb9\u3002'],
  ['\u8001\u677f\u7aef\u6765\u4e00\u58f6', { id: 'tea' }, '\u548c\u4e24\u4e2a\u5c0f\u676f\u5b50\u3002\u5916\u9762\uff0c\u4eba\u4eec\u62ff\u7740\u96e8\u4f1e\u5306\u5306\u8d70\u8fc7\u3002\u5728\u8fd9\u91cc\uff0c\u4e0d\u7528\u7740\u6025\u3002\u5c0f\u6797\u53cc\u624b\u6367\u7740\u4e00\u4e2a\u6e29\u70ed\u7684', { id: 'cup', text: '\u676f\u5b50' }, '\u3002'],
  ['\u5979\u4eec\u804a\u7684\u90fd\u662f\u5c0f\u4e8b\uff1a\u5929\u6c14\u3001\u4e00\u672c\u4e66\u3001\u665a\u996d\u5403\u4ec0\u4e48\u3002\u5c0f\u6797', { id: 'slowly' }, '\u559d\u7740\u8336\u3002\u8fd9\u4e00\u523b\uff0c\u6574\u4e2a\u65e9\u6668\u4eff\u4f5b\u90fd\u5728\u8fd9\u95f4\u5c0f\u5c4b\u91cc\u3002'],
]
const modeHelp = {
  source: 'Keep the original text intact. Select an underlined word for Mandarin support.',
  mixed: 'Familiar words weave into the story. Select an underlined word to explore it.',
  tap: 'Read in Mandarin. Select an underlined word for its meaning and pronunciation.',
  target: 'Read with fewer visual hints. Any sample vocabulary word is still selectable for help.',
}
let toastTimer
function notify(message) {
  const toast = one('#toast')
  toast.textContent = message
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.hidden = true }, 4500)
}

function syncWorkspaceNavigation() {
  const contextualAssistant = document.body.dataset.screen === 'conversation' && !mobileLayout.matches
  one('#assistant-sidebar').hidden = !contextualAssistant
  one('.sidebar').setAttribute('aria-label', contextualAssistant ? 'Assistant navigation' : 'Workspace navigation')
  for (const selector of ['#workspace-label', '#workspace-navigation', '#workspace-profile']) {
    one(selector).hidden = contextualAssistant
  }
}
mobileLayout.addEventListener('change', syncWorkspaceNavigation)

const practiceRoutes = {
  practice: { panel: 'exercises', label: 'Exercises', badge: 'Choose an exercise' },
  review: { panel: 'review', label: 'Exercises / Review', badge: 'Sample review session' },
  characters: { panel: 'characters', label: 'Exercises / Characters', badge: 'Handwriting preview' },
  games: { panel: 'games', label: 'Games', badge: 'Games / Concept' },
}

function route(moveFocus = true) {
  const hash = location.hash.slice(1)
  if (hash === 'main') {
    one('#main').focus()
    return
  }
  const practiceRoute = Object.hasOwn(practiceRoutes, hash) ? practiceRoutes[hash] : null
  const requestedScreen = practiceRoute ? 'practice' : hash
  const id = all('.screen').some((screen) => screen.id === requestedScreen) ? requestedScreen : 'overview'
  const routeId = practiceRoute ? hash : id
  const navigationId = id === 'reader' ? 'library' : id
  const assistant = id === 'conversation'
  document.body.dataset.screen = id
  syncWorkspaceNavigation()
  if (!assistant) one('#back-to-workspace').href = `#${routeId}`
  all('.screen').forEach((screen) => { screen.hidden = screen.id !== id })
  all('[data-practice-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.practicePanel !== (practiceRoute?.panel || 'exercises')
  })
  one('#practice-view-label').textContent = practiceRoute?.badge || 'Choose an exercise'
  all('[data-practice-view]').forEach((link) => {
    if (link.dataset.practiceView === (practiceRoute?.panel === 'games' ? 'games' : 'exercises')) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
  document.dispatchEvent(new CustomEvent('mockup-route-changed', { detail: id }))
  all('[data-nav]').forEach((link) => {
    if (link.dataset.nav === navigationId) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  })
  const label = one(`[data-nav="${navigationId}"] span`).textContent
  one('#page-label').textContent = label
  const detail = id === 'reader' ? 'Reading' : practiceRoute?.label || ''
  one('#page-detail').hidden = !detail
  one('#page-detail').textContent = detail ? `/ ${detail}` : ''
  document.title = `${label}${detail ? ` / ${detail}` : ''} / LinguaWeave UI concept`
  if (mobileLayout.matches) {
    one(`[data-nav="${navigationId}"]`).scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  if (moveFocus) {
    one('#main').focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }
  if (window.parent !== window) window.parent.postMessage({ type: 'mockup-route', screen: routeId }, '*')
}
window.addEventListener('hashchange', () => route())
window.addEventListener('message', (event) => {
  if (event.source !== window.parent || window.parent === window) return
  if (location.protocol !== 'file:' && event.origin !== location.origin) return
  if (event.data?.type !== 'mockup-navigate') return
  const screen = event.data.screen
  if (!Object.hasOwn(practiceRoutes, screen) && !all('.screen').some((item) => item.id === screen)) return
  if (location.hash !== `#${screen}`) location.hash = screen
  else window.parent.postMessage({ type: 'mockup-route', screen }, '*')
})

function filterLibrary() {
  const query = one('#library-search').value.trim().toLowerCase()
  let count = 0
  all('[data-collection-item]').forEach((card) => {
    const visible = card.dataset.collectionItem.split(' ').includes(state.collection)
      && (state.topic === 'all' || state.topic === card.dataset.topic)
      && card.dataset.title.toLowerCase().includes(query)
    card.hidden = !visible
    if (visible) count += 1
  })
  one('#library-empty').hidden = count !== 0
  one('#book-grid').hidden = count === 0
}
all('[data-collection]').forEach((button) => button.addEventListener('click', () => {
  state.collection = button.dataset.collection
  all('[data-collection]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
  one('#library-search').placeholder = state.collection === 'saved' ? 'Search your library' : 'Search sample stories'
  filterLibrary()
}))
all('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.topic = button.dataset.filter
  all('[data-filter]').forEach((item) => {
    item.classList.toggle('active', item === button)
    item.setAttribute('aria-pressed', String(item === button))
  })
  filterLibrary()
}))
one('#library-search').addEventListener('input', filterLibrary)
one('#reset-library').addEventListener('click', () => {
  one('#library-search').value = ''
  one('[data-filter="all"]').click()
})

all('[data-open-import]').forEach((button) => button.addEventListener('click', () => {
  one('#import-dialog').showModal()
}))
all('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()))
one('#import-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const title = one('#import-title-input')
  const passage = one('#import-text')
  title.setCustomValidity(title.value.trim() ? '' : 'Please enter a title.')
  passage.setCustomValidity(passage.value.trim() ? '' : 'Please enter a passage.')
  if (!event.currentTarget.reportValidity()) return
  const result = one('#import-result')
  const heading = document.createElement('h3')
  heading.textContent = title.value.trim()
  const note = document.createElement('p')
  note.className = 'small'
  note.textContent = 'Source preview only. Not saved, translated, or analyzed.'
  const text = document.createElement('p')
  text.textContent = passage.value.trim()
  result.replaceChildren(heading, note, text)
  result.hidden = false
  result.scrollIntoView({ block: 'nearest' })
})
all('#import-form input, #import-form textarea').forEach((input) => input.addEventListener('input', () => {
  input.setCustomValidity('')
  one('#import-result').hidden = true
}))
const samples = {
  rain: { title: 'After the rain', text: 'The park is quiet after the rain. A small bird shakes the water from its wings. I put my phone away and take the longer path home.' },
  city: { title: 'The city before nine', text: 'The bakery opens before the sun reaches our street. A woman unlocks her bicycle. Someone calls a greeting from an upstairs window, and the city begins another day.' },
}
all('[data-preview]').forEach((button) => button.addEventListener('click', () => {
  const sample = samples[button.dataset.preview]
  one('#sample-title').textContent = sample.title
  one('#sample-passage').textContent = sample.text
  one('#sample-dialog').showModal()
}))

function renderPassage() {
  const isTarget = state.mode === 'tap' || state.mode === 'target'
  const paragraphs = isTarget ? targetPassage : sourcePassage
  const container = one('#reading-passage')
  container.dataset.mode = state.mode
  container.lang = isTarget ? 'zh-Hans' : 'en'
  container.replaceChildren()
  const wovenIds = ['tea', 'rain', 'cup', 'friend', 'window', 'slowly'].slice(0, Math.round(state.density * 6 / 100))
  paragraphs.forEach((parts) => {
    const paragraph = document.createElement('p')
    parts.forEach((part) => {
      if (typeof part === 'string') paragraph.append(document.createTextNode(part))
      else {
        const word = words[part.id]
        const targetForm = isTarget || (state.mode === 'mixed' && wovenIds.includes(part.id))
        const button = document.createElement('button')
        button.className = 'reading-word'
        button.classList.toggle('selected', part.id === state.word)
        button.textContent = targetForm ? (part.text || word.native) : word.gloss
        button.lang = targetForm ? 'zh-Hans' : 'en'
        button.setAttribute('aria-label', `Explore ${word.gloss}`)
        button.addEventListener('click', () => {
          state.word = part.id
          setReaderPanel(true)
          renderWord()
          all('.reading-word').forEach((item) => item.classList.toggle('selected', item.getAttribute('aria-label') === `Explore ${word.gloss}`))
          if (window.matchMedia('(max-width: 760px)').matches) {
            one('#word-native').tabIndex = -1
            one('#word-native').focus()
            one('#reader-panel').scrollIntoView({ block: 'start' })
          }
        })
        paragraph.append(button)
      }
    })
    container.append(paragraph)
  })
  one('#reader-instruction').textContent = modeHelp[state.mode]
  one('#density-control').hidden = state.mode !== 'mixed'
}
function renderWord() {
  const word = words[state.word]
  one('#word-native').textContent = word.native
  one('#word-romanization').textContent = word.romanization
  one('#word-gloss').textContent = word.gloss
  one('#word-kind').textContent = word.kind
  one('#word-example-native').textContent = word.example
  one('#word-example-source').textContent = word.source
  one('#word-state').textContent = word.learned ? 'Learned' : word.tracked ? 'Practicing' : 'Unseen'
  one('#save-word').textContent = word.tracked ? 'In your review collection' : 'Add to review'
  one('#save-word').disabled = word.tracked
  one('#mark-known').textContent = word.learned ? 'Reset to practicing' : 'I already know this'
}
function setReaderPanel(visible) {
  one('#reader-panel').hidden = !visible
  one('.reader-layout').classList.toggle('panel-hidden', !visible)
  one('#toggle-reader-panel').setAttribute('aria-expanded', String(visible))
}
one('#toggle-reader-panel').addEventListener('click', () => setReaderPanel(one('#reader-panel').hidden))
all('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode
  all('[data-mode]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
  renderPassage()
}))
one('#density').addEventListener('input', (event) => {
  state.density = Number(event.target.value)
  one('#density-value').textContent = `${state.density}%`
  renderPassage()
})
one('#study-percent').addEventListener('input', (event) => {
  one('#study-value').textContent = `${event.target.value}%`
})
one('#save-word').addEventListener('click', () => {
  words[state.word].tracked = true
  renderWord()
  renderDictionary()
  notify(`Added "${words[state.word].gloss}" to the sample dictionary. The practice queue stays fixed at three demo items.`)
})
one('#mark-known').addEventListener('click', () => {
  const word = words[state.word]
  word.learned = !word.learned
  word.tracked = true
  renderWord()
  renderDictionary()
  notify(`"${word.gloss}" marked ${word.learned ? 'learned' : 'practicing'} in this preview only.`)
})

function renderDictionary() {
  const query = one('#dictionary-search').value.trim().toLowerCase()
  const filter = one('#dictionary-filter').value
  const rows = one('#dictionary-rows')
  rows.replaceChildren()
  const tracked = Object.values(words).filter((word) => word.tracked)
  one('#dictionary-count').textContent = String(tracked.length)
  tracked.forEach((word) => {
    const status = word.learned ? 'Learned' : 'Practicing'
    if (filter !== 'all' && filter !== status) return
    if (!`${word.native} ${word.gloss} ${word.romanization}`.toLowerCase().includes(query)) return
    const row = document.createElement('tr')
    const term = document.createElement('td')
    const native = document.createElement('span')
    native.className = 'dictionary-native'
    native.lang = 'zh-Hans'
    native.textContent = word.native
    const romanization = document.createElement('span')
    romanization.className = 'dictionary-reading'
    romanization.textContent = word.romanization
    term.append(native, romanization)
    const meaning = document.createElement('td')
    meaning.textContent = word.gloss
    const tier = document.createElement('td')
    const badge = document.createElement('span')
    badge.className = 'tag green'
    badge.textContent = status
    tier.append(badge)
    const source = document.createElement('td')
    source.className = 'dictionary-source'
    source.textContent = 'Tea house / Reading'
    const action = document.createElement('td')
    const link = document.createElement('a')
    link.className = 'button secondary'
    link.href = '#reader'
    link.textContent = 'See in context'
    link.setAttribute('aria-label', `See ${word.gloss} in context`)
    link.addEventListener('click', () => {
      state.word = Object.keys(words).find((key) => words[key] === word)
      setReaderPanel(true)
      renderPassage()
      renderWord()
    })
    action.append(link)
    row.append(term, meaning, tier, source, action)
    rows.append(row)
  })
  one('#dictionary-empty').hidden = rows.children.length !== 0
  one('.dictionary-table-wrap').hidden = rows.children.length === 0
}
one('#dictionary-search').addEventListener('input', renderDictionary)
one('#dictionary-filter').addEventListener('change', renderDictionary)

const questions = [
  { source: 'I would like a cup of tea.', sentence: '\u6211\u60f3\u559d\u4e00\u676f ____\u3002', options: ['rain', 'tea', 'friend'], answer: 'tea', hint: 'A drink made by steeping leaves. Its pronunciation is ch\u00e1.' },
  { source: 'The rain has stopped.', sentence: '____ \u505c\u4e86\u3002', options: ['tea', 'cup', 'rain'], answer: 'rain', hint: 'Water falling from the sky. Its pronunciation is y\u01d4.' },
  { source: 'A cup of tea.', sentence: '\u4e00 ____ \u8336\u3002', options: ['cup', 'window', 'friend'], answer: 'cup', hint: 'The measure word for a cupful. Its pronunciation is b\u0113i.' },
]
let questionIndex = 0
let chosen = null
let checked = false
let hinted = false
let quizResults = []
function renderQuestion() {
  const question = questions[questionIndex]
  chosen = null
  checked = false
  hinted = false
  one('#quiz-card').hidden = false
  one('#quiz-complete').hidden = true
  one('#question-count').textContent = `0${questionIndex + 1} / 03`
  one('#quiz-progress').value = questionIndex
  one('#quiz-source').textContent = question.source
  one('#quiz-sentence').textContent = question.sentence
  one('#quiz-feedback').textContent = ''
  one('#quiz-feedback').classList.remove('incorrect')
  one('#quiz-hint').disabled = false
  one('#quiz-check').disabled = true
  one('#quiz-check').textContent = 'Check answer'
  one('#quiz-options').replaceChildren()
  question.options.forEach((id) => {
    const option = document.createElement('button')
    option.className = 'quiz-option'
    option.setAttribute('aria-pressed', 'false')
    const native = document.createElement('span')
    native.lang = 'zh-Hans'
    native.textContent = words[id].native
    const romanization = document.createElement('span')
    romanization.textContent = words[id].romanization
    option.append(native, romanization)
    option.addEventListener('click', () => {
      chosen = id
      all('.quiz-option').forEach((item) => item.setAttribute('aria-pressed', String(item === option)))
      one('#quiz-check').disabled = false
    })
    one('#quiz-options').append(option)
  })
}
one('#quiz-hint').addEventListener('click', () => {
  hinted = true
  one('#quiz-feedback').textContent = questions[questionIndex].hint
  one('#quiz-hint').disabled = true
})
one('#quiz-check').addEventListener('click', () => {
  if (!checked) {
    const question = questions[questionIndex]
    const correct = chosen === question.answer
    quizResults.push({ correct, hinted })
    one('#quiz-feedback').textContent = correct
      ? `That's right. ${words[question.answer].native} means "${words[question.answer].gloss}". ${hinted ? 'Recalled with a hint.' : 'Recalled without a hint.'}`
      : `Not quite. ${words[question.answer].native} (${words[question.answer].romanization}) is "${words[question.answer].gloss}". This item would return for another review.`
    one('#quiz-feedback').classList.toggle('incorrect', !correct)
    checked = true
    all('.quiz-option').forEach((button) => { button.disabled = true })
    one('#quiz-hint').disabled = true
    one('#quiz-check').textContent = questionIndex === questions.length - 1 ? 'Finish review' : 'Next item'
    one('#quiz-progress').value = questionIndex + 1
  } else if (questionIndex < questions.length - 1) {
    questionIndex += 1
    renderQuestion()
    one('#quiz-options button').focus()
  } else {
    one('#quiz-card').hidden = true
    one('#quiz-complete').hidden = false
    const unaided = quizResults.filter((result) => result.correct && !result.hinted).length
    const assisted = quizResults.filter((result) => result.correct && result.hinted).length
    one('#quiz-summary').textContent = `3 items revisited. ${unaided} recalled without help, ${assisted} with a hint, and ${3 - unaided - assisted} to revisit.`
    one('#quiz-complete h2').tabIndex = -1
    one('#quiz-complete h2').focus()
  }
})
one('#restart-quiz').addEventListener('click', () => {
  questionIndex = 0
  quizResults = []
  renderQuestion()
  one('#quiz-options button').focus()
})

renderPassage()
renderWord()
renderDictionary()
renderQuestion()
route(false)
