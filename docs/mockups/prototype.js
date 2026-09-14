// All state is illustrative and memory-only. Never connect this mockup to app storage.
const one = (selector) => document.querySelector(selector)
const all = (selector) => [...document.querySelectorAll(selector)]
const mobileLayout = window.matchMedia('(max-width: 760px)')
const compactSidebarLayout = window.matchMedia('(max-width: 960px)')
let sidebarCollapsedPreference = null
const state = { mode: 'source', weaving: true, word: 'tea', readerPanel: true }
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
let toastTimer
function notify(message) {
  const toast = one('#toast')
  toast.textContent = message
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.hidden = true }, 4500)
}

function scrollWorkspaceToTop() {
  one('.workspace').scrollTo(0, 0)
  window.scrollTo(0, 0)
}

function syncSidebar() {
  const defaultCollapsed = compactSidebarLayout.matches && document.body.dataset.screen !== 'conversation'
  const collapsed = !mobileLayout.matches && (sidebarCollapsedPreference ?? defaultCollapsed)
  document.body.dataset.sidebarCollapsed = String(collapsed)
  const toggle = one('#sidebar-toggle')
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  toggle.setAttribute('aria-expanded', String(!collapsed))
  toggle.setAttribute('aria-label', label)
  toggle.title = label
  toggle.querySelector('use').setAttribute('href', collapsed ? '#i-sidebar-expand' : '#i-sidebar-collapse')
  one('#sidebar-conversation-search').setAttribute('aria-expanded', String(!collapsed))
}
function setSidebarCollapsed(collapsed) {
  sidebarCollapsedPreference = collapsed
  syncSidebar()
}
one('#sidebar-toggle').addEventListener('click', () => {
  setSidebarCollapsed(document.body.dataset.sidebarCollapsed !== 'true')
})
one('#sidebar-conversation-search').addEventListener('click', () => {
  setSidebarCollapsed(false)
  one('#conversation-search').focus({ preventScroll: true })
})
compactSidebarLayout.addEventListener('change', syncSidebar)

function syncWorkspaceNavigation() {
  const contextualAssistant = document.body.dataset.screen === 'conversation' && !mobileLayout.matches
  one('#assistant-sidebar').hidden = !contextualAssistant
  one('.sidebar').setAttribute('aria-label', contextualAssistant ? 'Assistant navigation' : 'Workspace navigation')
  for (const selector of ['#workspace-label', '#workspace-navigation', '#workspace-profile']) {
    one(selector).hidden = contextualAssistant
  }
  syncSidebar()
}
mobileLayout.addEventListener('change', syncWorkspaceNavigation)

const practiceRoutes = {
  practice: { panel: 'exercises', label: 'Exercises', badge: 'Choose an exercise' },
  review: { panel: 'review', label: 'Exercises / Review', badge: 'Sample review session' },
  games: { panel: 'games', label: 'Games', badge: 'Games / Concept' },
}

function route(moveFocus = true, redirectedFrom = null) {
  const hash = location.hash.slice(1)
  if (hash === 'main') {
    one('#main').focus()
    return
  }
  if (hash === 'characters' && !one('#characters').dataset.character) {
    history.replaceState(null, '', '#dictionary')
    notify('Choose a word in Dictionary, then use its writing button.')
    route(moveFocus, 'characters')
    return
  }
  const practiceRoute = Object.hasOwn(practiceRoutes, hash) ? practiceRoutes[hash] : null
  const requestedScreen = practiceRoute ? 'practice' : hash
  const id = all('.screen').some((screen) => screen.id === requestedScreen) ? requestedScreen : 'overview'
  const routeId = practiceRoute ? hash : id
  const navigationId = id === 'characters' ? 'dictionary' : id === 'reader' || id === 'discover' ? 'library' : id
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
  const detail = id === 'characters' ? 'Writing' : id === 'reader' ? 'Reading' : id === 'discover' ? 'Discover' : practiceRoute?.label || ''
  one('#page-detail').hidden = !detail
  one('#page-detail').textContent = detail ? `/ ${detail}` : ''
  document.title = `${label}${detail ? ` / ${detail}` : ''} / LinguaWeave UI concept`
  if (mobileLayout.matches && id !== 'characters') {
    one(`[data-nav="${navigationId}"]`).scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  if (moveFocus) {
    one(id === 'characters' ? '#characters-title' : '#main').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
  if (window.parent !== window) window.parent.postMessage({ type: 'mockup-route', screen: routeId, redirectedFrom }, '*')
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

all('[data-catalog-view-controls]').forEach((controls) => {
  const catalog = one(`#${controls.dataset.catalogViewControls}`)
  const buttons = [...controls.querySelectorAll('[data-catalog-layout]')]
  buttons.forEach((button) => button.addEventListener('click', () => {
    catalog.dataset.catalogView = button.dataset.catalogLayout
    buttons.forEach((item) => item.setAttribute('aria-pressed', String(item === button)))
  }))
})

all('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()))
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

function renderDictionary() {
  const query = one('#dictionary-search').value.trim().toLowerCase()
  const filter = one('#dictionary-filter').value
  const rows = one('#dictionary-rows')
  rows.replaceChildren()
  const tracked = Object.values(words).filter((word) => word.tracked)
  const matches = query ? new Set(findDictionaryWords(query).map((id) => words[id])) : null
  one('#dictionary-count').textContent = String(tracked.length)
  one('#learning-set-count').textContent = String(tracked.length)
  tracked.forEach((word) => {
    const status = word.learned ? 'Learned' : 'Practicing'
    if (filter !== 'all' && filter !== status) return
    if (matches && !matches.has(word)) return
    const row = document.createElement('tr')
    const term = document.createElement('td')
    const native = document.createElement('span')
    native.className = 'dictionary-native'
    native.lang = word.nativeLanguage || 'zh-Hans'
    native.textContent = word.native
    const romanization = document.createElement('span')
    romanization.className = 'dictionary-reading'
    romanization.textContent = word.romanization
    term.append(native, romanization)
    const textActions = setSnippetActions(native, wordSnippetOptions(word, 'Dictionary / My learning set'))
    addCharacterPracticeAction(textActions, word)
    const meaning = document.createElement('td')
    meaning.textContent = word.gloss
    const tier = document.createElement('td')
    const badge = document.createElement('span')
    badge.className = 'tag green'
    badge.textContent = status
    tier.append(badge)
    const source = document.createElement('td')
    source.className = 'dictionary-source'
    source.textContent = word.addedFrom === 'assistant' ? 'Assistant / Conversation' : word.addedFrom === 'lookup' ? 'Dictionary / Lookup' : 'Tea house / Reading'
    const action = document.createElement('td')
    const link = document.createElement('a')
    link.className = 'button secondary'
    link.href = word.addedFrom === 'assistant' ? '#conversation' : word.addedFrom === 'lookup' ? '#dictionary' : '#reader'
    link.textContent = 'See in context'
    link.setAttribute('aria-label', `See ${word.gloss} in context`)
    link.addEventListener('click', () => {
      if (word.addedFrom === 'assistant') {
        openCreationConversation(word.sourceConversation)
        return
      }
      if (word.addedFrom === 'lookup') {
        showDictionaryLookup(word.native)
        return
      }
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
  setSnippetActions(one('#quiz-sentence'), { meaning: question.source, source: 'Review / Visible prompt; blank is not filled' })
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
    const choice = document.createElement('div')
    choice.className = 'quiz-choice'
    choice.append(option, createSnippetActions(words[id].native, { romanization: words[id].romanization, source: 'Review / Answer option, not an answer key' }))
    one('#quiz-options').append(choice)
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

renderQuestion()
route(false)
