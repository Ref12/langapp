// Authored previews introduce vocabulary and grammar without assigning mastery.
const lessonPreviews = {
  request: {
    title: 'Build a simple request',
    objective: 'Say what you would like, then add a little more detail.',
    native: '\u6211\u60f3\u559d\u4e00\u676f\u8336\u3002',
    romanization: 'W\u01d2 xi\u01ceng h\u0113 y\u00ec b\u0113i ch\u00e1.',
    meaning: 'I would like to drink a cup of tea.',
    pattern: '\u6211\u60f3 + action: say what you would like to do.',
    usage: '\u676f is a measure word for a cupful. Add \u518d before the action to ask for another cup. This lesson is a companion to the tea-house story, not an extracted quotation.',
    conversation: 'tea',
    source: true,
    words: [
      ['\u60f3', 'xi\u01ceng', 'would like / want to'],
      ['\u8336', 'ch\u00e1', 'tea'],
      ['\u676f', 'b\u0113i', 'cup / measure word'],
      ['\u518d', 'z\u00e0i', 'again'],
    ],
  },
  plans: {
    title: 'Talk about tomorrow',
    objective: 'Combine a time, an intention, and a place into one useful sentence.',
    native: '\u6211\u660e\u5929\u60f3\u53bb\u516c\u56ed\u3002',
    romanization: 'W\u01d2 m\u00edngti\u0101n xi\u01ceng q\u00f9 g\u014dngyu\u00e1n.',
    meaning: 'I would like to go to the park tomorrow.',
    pattern: 'Person + time + action: put the plan in context before describing what you will do.',
    usage: 'Time expressions commonly go before the main verb. \u60f3\u53bb combines "would like" with "go." Explore the same example in the weekend-plans conversation.',
    conversation: 'weekend',
    source: false,
    words: [
      ['\u660e\u5929', 'm\u00edngti\u0101n', 'tomorrow'],
      ['\u53bb', 'q\u00f9', 'go'],
      ['\u516c\u56ed', 'g\u014dngyu\u00e1n', 'park'],
    ],
  },
  directions: {
    title: 'Ask where something is',
    objective: 'Ask for a location using a pattern you can reuse with different places.',
    native: '\u8f66\u7ad9\u5728\u54ea\u91cc\uff1f',
    romanization: 'Ch\u0113zh\u00e0n z\u00e0i n\u01celi?',
    meaning: 'Where is the station?',
    pattern: 'Place + \u5728\u54ea\u91cc: ask where a place is located.',
    usage: 'Start with the place you are asking about. \u5728 connects it to a location, and \u54ea\u91cc asks "where." Try the question in the train-station roleplay.',
    conversation: 'station',
    source: false,
    words: [
      ['\u8f66\u7ad9', 'ch\u0113zh\u00e0n', 'station'],
      ['\u5728', 'z\u00e0i', 'at / located at'],
      ['\u54ea\u91cc', 'n\u01celi', 'where'],
    ],
  },
}
let selectedLessonId = null
let lessonPages = []
let lessonPageIndex = 0
const lessonPagePositions = new Map()
function getLesson(id) {
  if (Object.hasOwn(lessonPreviews, id)) return lessonPreviews[id]
  notify('That lesson preview is not available.')
  return null
}
function showLessonCatalog(moveFocus = false) {
  document.body.dataset.lessonView = 'catalog'
  one('#lessons').setAttribute('aria-labelledby', 'lessons-title')
  one('#lesson-catalog').hidden = false
  one('#lesson-detail').hidden = true
  if (moveFocus) {
    one('#lessons-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
}
function setLessonActionIcon(button, action, title) {
  const [label, symbol] = {
    open: ['Open lesson', 'i-book'],
    practice: ['Practice', 'i-practice'],
    assistant: ['Assistant', 'i-chat'],
  }[action]
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  icon.setAttribute('aria-hidden', 'true')
  use.setAttribute('href', `#${symbol}`)
  icon.append(use)
  button.replaceChildren(icon)
  button.classList.add('icon-button', 'lesson-action')
  button.setAttribute('aria-label', `${label}: ${title}`)
}
function addLessonActions(card, id) {
  const actions = document.createElement('div')
  actions.className = 'lesson-actions'
  actions.setAttribute('role', 'group')
  actions.setAttribute('aria-label', `Actions for ${lessonPreviews[id].title}`)
  const open = card.querySelector('[data-open-lesson]')
  setLessonActionIcon(open, 'open', lessonPreviews[id].title)
  actions.append(open)
  for (const [action, label] of [['practiceLesson', 'Practice'], ['assistantLesson', 'Assistant']]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button secondary'
    button.dataset[action] = id
    setLessonActionIcon(button, label.toLowerCase(), lessonPreviews[id].title)
    actions.append(button)
  }
  card.append(actions)
}
function addLessonPreview(id, lesson, label, description) {
  lessonPreviews[id] = lesson
  document.dispatchEvent(new CustomEvent('mockup-lesson-added', { detail: { id, label, description } }))
}
function splitLessonText(text, limit = /\p{Script=Han}/u.test(text) ? 70 : 180) {
  const characters = Array.from(text)
  const parts = []
  for (let start = 0; start < characters.length;) {
    const boundary = Math.min(start + limit, characters.length)
    let end = boundary
    if (end < characters.length) {
      while (end > start + limit / 2 && !/[\s.!?\u3002\uff01\uff1f]/u.test(characters[end - 1])) end--
      if (end <= start + limit / 2) end = boundary
    }
    parts.push(characters.slice(start, end).join(''))
    start = end
  }
  return parts
}
function buildLessonPages(lesson) {
  const pages = [{ kind: 'intro', title: 'Your next useful idea', text: lesson.objective }]
  for (const text of splitLessonText(lesson.native)) pages.push({ kind: 'example', title: lesson.readingRequest ? 'Reading material' : 'Words working together', text })
  lesson.words.forEach((word) => pages.push({ kind: 'word', title: `Vocabulary / ${word[2]}`, word }))
  for (const text of splitLessonText(lesson.pattern)) pages.push({ kind: 'pattern', title: lesson.readingRequest ? 'Teaching plan' : 'A pattern to keep', text })
  for (const text of splitLessonText(lesson.usage)) pages.push({ kind: 'usage', title: 'How to use it', text })
  const source = lesson.readingRequest?.text ?? lesson.importSource?.text
  if (source) for (const text of splitLessonText(source)) pages.push({ kind: 'source', title: 'Original source', text })
  if (lesson.creationId) {
    const creation = assistantCreations.get(lesson.creationId)
    for (const text of splitLessonText([creation.request, creation.context].filter(Boolean).join('\n\n'))) {
      pages.push({ kind: 'provenance', title: 'Assistant request and context', text })
    }
  }
  pages.push({ kind: 'finish', title: 'Make it your own' })
  return pages
}
function renderLessonPage(moveFocus = true) {
  const lesson = lessonPreviews[selectedLessonId]
  const page = lessonPages[lessonPageIndex]
  const container = one('#lesson-page')
  container.dataset.kind = page.kind
  container.replaceChildren()
  const heading = importElement('h3', page.title)
  heading.id = 'lesson-page-title'
  heading.tabIndex = -1
  container.append(heading)
  if (page.kind === 'intro') {
    container.append(importElement('span', lesson.readingRequest ? 'Reading preparation / Request preview' : 'Guided lesson preview', 'tag lavender'),
      importElement('p', page.text, 'lesson-page-copy'))
    if (lesson.importSource || lesson.creationId) container.append(importElement('p', lesson.readingRequest
      ? 'Source and scope are retained. Personalized teaching is not connected.'
      : 'This is an authored sample lesson. AI generation is simulated, not based on your material.', 'small muted'))
    container.append(importElement('p', 'Explore one page at a time. You can go back, jump to any page, or restart whenever you like.', 'small muted'))
  } else if (page.kind === 'example' || page.kind === 'word') {
    const [native, romanization, meaning] = page.kind === 'word' ? page.word : [page.text, lesson.romanization, lesson.meaning]
    const example = importElement('div', '', 'lesson-page-example')
    const term = importElement('p', native, lesson.readingRequest ? 'lesson-page-copy' : 'lesson-page-native')
    term.lang = lesson.nativeLanguage ?? 'zh-Hans'
    example.append(term)
    if (romanization) example.append(importElement('p', romanization, 'small muted'))
    example.append(importElement('p', meaning))
    setSnippetActions(term, { lang: term.lang, romanization, meaning, source: `Lesson: ${lesson.title}` })
    container.append(example)
    if (page.kind === 'word') container.append(createKnowledgeProfile(vocabularyKnowledgeOwner(native, term.lang)))
  } else if (page.kind === 'finish') {
    renderLessonLearningSummary(container, selectedLessonId)
    const actions = importElement('div', '', 'lesson-links')
    for (const [action, label] of [['practiceLesson', 'Practice'], ['assistantLesson', 'Assistant']]) {
      const button = importElement('button', label, `button ${action === 'practiceLesson' ? 'primary' : 'secondary'}`)
      button.type = 'button'
      button.dataset[action] = selectedLessonId
      setLessonActionIcon(button, label.toLowerCase(), lesson.title)
      actions.append(button)
    }
    if (lesson.source) {
      const link = importElement('a', 'Read the related story', 'button secondary')
      link.href = '#reader'
      actions.append(link)
    }
    if (lesson.creationId) {
      const link = importElement('button', 'Source conversation', 'button secondary')
      link.type = 'button'
      link.addEventListener('click', () => openCreationConversation(assistantCreations.get(lesson.creationId).threadId))
      actions.append(link)
    }
    container.append(actions)
  } else {
    const text = importElement('p', page.text, 'lesson-page-copy')
    container.append(text)
    if (page.kind === 'source') {
      container.append(importElement('p', lesson.readingRequest
        ? `${lesson.readingRequest.language} / ${lesson.readingRequest.scopeLabel}`
        : [lesson.importSource.reference, ...lesson.importSource.files].filter(Boolean).join(' / ') || 'Pasted source', 'small muted'))
      if (lesson.importSource?.simulated) container.append(importElement('p', 'Image extraction was simulated; this source includes your review edits.', 'small muted'))
    }
    setTargetSnippetActions(text, { source: `Lesson: ${lesson.title} / ${page.title}` })
  }
  one('#lesson-previous').disabled = lessonPageIndex === 0
  one('#lesson-next').textContent = lessonPageIndex === lessonPages.length - 1
    ? lesson.readingRequest ? 'Ask Assistant' : 'Finish lesson' : 'Next'
  lessonPagePositions.set(selectedLessonId, lessonPageIndex)
  one('#lesson-page-select').value = String(lessonPageIndex)
  one('#lesson-page-count').textContent = `${lessonPageIndex + 1} of ${lessonPages.length}`
  container.scrollTop = 0
  if (moveFocus) heading.focus({ preventScroll: true })
}
function showLesson(id, context = {}) {
  const lesson = getLesson(id)
  if (!lesson) return
  selectedLessonId = id
  lessonPages = buildLessonPages(lesson)
  lessonPageIndex = context.restart ? 0 : Math.min(lessonPagePositions.get(id) ?? 0, lessonPages.length - 1)
  noteLessonOpened(id, context)
  document.body.dataset.lessonView = 'detail'
  one('#lessons').setAttribute('aria-labelledby', 'lesson-detail-title')
  one('#lesson-detail-title').textContent = lesson.title
  const select = one('#lesson-page-select')
  select.replaceChildren()
  lessonPages.forEach((page, index) => {
    const option = importElement('option', `${index + 1}. ${page.title}`)
    option.value = String(index)
    select.append(option)
  })
  one('#lesson-catalog').hidden = true
  one('#lesson-detail').hidden = false
  renderLessonPage()
  if (location.hash !== '#lessons') {
    location.hash = '#lessons'
    requestAnimationFrame(() => {
      if (selectedLessonId === id && document.body.dataset.screen === 'lessons') one('#lesson-page-title').focus({ preventScroll: true })
    })
  }
  scrollWorkspaceToTop()
}
all('#lesson-grid [data-open-lesson]').forEach((button) => addLessonActions(button.closest('.lesson-card'), button.dataset.openLesson))
one('#lessons').addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-lesson], [data-practice-lesson], [data-assistant-lesson]')
  if (!button) return
  const context = button.closest('[data-learning-origin]')
  const learningContext = context ? { origin: context.dataset.learningOrigin, goalId: context.dataset.learningGoal || null } : {}
  if (button.dataset.openLesson) showLesson(button.dataset.openLesson, learningContext)
  else {
    noteLessonOpened(button.dataset.practiceLesson || button.dataset.assistantLesson, learningContext)
    if (button.dataset.practiceLesson) openLessonPractice(button.dataset.practiceLesson)
    else openLessonAssistant(button.dataset.assistantLesson, button)
  }
})
one('#lesson-previous').addEventListener('click', () => {
  if (lessonPageIndex > 0) {
    lessonPageIndex--
    renderLessonPage()
  }
})
one('#lesson-next').addEventListener('click', () => {
  if (lessonPageIndex === lessonPages.length - 1) {
    if (lessonPreviews[selectedLessonId].readingRequest) openLessonAssistant(selectedLessonId, one('#lesson-next'))
    else finishLearningLesson(selectedLessonId)
  }
  else {
    lessonPageIndex++
    renderLessonPage()
  }
})
one('#lesson-page-select').addEventListener('change', (event) => {
  lessonPageIndex = Number(event.target.value)
  renderLessonPage()
})
one('#back-to-lessons').addEventListener('click', () => showLessonCatalog(true))
one('#restart-lesson').addEventListener('click', () => {
  showLesson(selectedLessonId, { restart: true })
  notify('Back at the beginning. Completed coverage and your learning set are unchanged.')
})
one('[data-nav="lessons"]').addEventListener('click', (event) => {
  if (location.hash === '#lessons') event.preventDefault()
  showLessonCatalog(true)
})
