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
function showLessonCatalog(moveFocus = false) {
  one('#lesson-catalog').hidden = false
  one('#lesson-detail').hidden = true
  if (moveFocus) {
    one('#lessons-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
}
function addLessonPreview(id, lesson, label, description) {
  lessonPreviews[id] = lesson
  const card = importElement('article', '', 'lesson-card imported-lesson-card')
  card.append(importElement('span', label, 'eyebrow'), importElement('h2', lesson.title), importElement('p', description))
  const button = importElement('button', 'Open lesson', 'button secondary')
  button.type = 'button'
  button.dataset.openLesson = id
  button.setAttribute('aria-label', `Open lesson: ${lesson.title}`)
  card.append(button)
  one('.lesson-grid').append(card)
}
function showLesson(id) {
  if (!Object.hasOwn(lessonPreviews, id)) {
    notify('That lesson preview is not available.')
    return
  }
  const lesson = lessonPreviews[id]
  selectedLessonId = id
  one('#lesson-creation-context').hidden = !lesson.creationId
  if (lesson.creationId) renderCreationProvenance(one('#lesson-creation-context'), lesson.creationId)
  for (const field of ['title', 'objective', 'native', 'romanization', 'meaning', 'pattern', 'usage']) {
    one(field === 'title' ? '#lesson-detail-title' : `#lesson-${field}`).textContent = lesson[field]
  }
  one('#lesson-native').lang = lesson.nativeLanguage ?? 'zh-Hans'
  setSnippetActions(one('#lesson-native'), { lang: lesson.nativeLanguage ?? 'zh-Hans', meaning: lesson.meaning, romanization: lesson.romanization, source: `Lesson: ${lesson.title}` })
  setTargetSnippetActions(one('#lesson-pattern'), { source: `Lesson pattern: ${lesson.title}` })
  setTargetSnippetActions(one('#lesson-usage'), { source: `Lesson usage: ${lesson.title}` })
  one('#lesson-romanization').hidden = !lesson.romanization
  one('.lesson-vocabulary').hidden = Boolean(lesson.readingRequest)
  one('.lesson-study').classList.toggle('reading-preparation-lesson', Boolean(lesson.readingRequest))
  one('.lesson-explanation > .tag').textContent = lesson.readingRequest ? 'Reading preparation / Request preview' : 'Guided lesson preview'
  one('.lesson-example > .eyebrow').textContent = lesson.readingRequest ? 'ORIGINAL MATERIAL EXCERPT' : 'WORDS WORKING TOGETHER'
  one('.lesson-explanation > h3').textContent = lesson.readingRequest ? 'Teaching plan' : 'A pattern to keep'
  one('#lesson-assistant').dataset.lessonConversation = lesson.conversation
  one('#lesson-source').hidden = !lesson.source
  one('#lesson-import-notice').hidden = !lesson.importSource
  one('#lesson-import-source').hidden = !lesson.importSource
  one('#lesson-import-source').open = false
  if (lesson.importSource) {
    one('#lesson-import-reference').textContent = lesson.importSource.reference || 'Imported source preview'
    one('#lesson-import-files').textContent = lesson.importSource.files.length ? lesson.importSource.files.join(' / ') : 'Pasted source'
    one('#lesson-import-conversion').hidden = !lesson.importSource.simulated
    renderImportedSource(one('#lesson-import-text'), lesson.importSource.text)
  }
  const list = one('#lesson-word-list')
  list.replaceChildren()
  lesson.words.forEach(([native, romanization, meaning]) => {
    const item = document.createElement('div')
    item.className = 'lesson-word'
    const term = document.createElement('strong')
    term.lang = 'zh-Hans'
    term.textContent = native
    const reading = document.createElement('span')
    reading.textContent = romanization
    const gloss = document.createElement('p')
    gloss.textContent = meaning
    item.append(term, reading, gloss)
    setSnippetActions(term, { meaning, romanization, source: `Lesson vocabulary: ${lesson.title}` })
    list.append(item)
  })
  one('#lesson-catalog').hidden = true
  one('#lesson-detail').hidden = false
  one('#lesson-detail-title').focus({ preventScroll: true })
  scrollWorkspaceToTop()
}
one('#lessons').addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-lesson]')
  if (button) showLesson(button.dataset.openLesson)
})
one('#back-to-lessons').addEventListener('click', () => showLessonCatalog(true))
one('#restart-lesson').addEventListener('click', () => {
  showLesson(selectedLessonId)
  notify('Back at the beginning of this lesson. Your learning set and learned words are unchanged.')
})
one('[data-nav="lessons"]').addEventListener('click', (event) => {
  if (location.hash === '#lessons') event.preventDefault()
  showLessonCatalog(true)
})
