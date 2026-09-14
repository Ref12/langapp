// Lesson practice uses the displayed lesson, never the unrelated story review.
let practiceLessonId = null

function lessonAssistantContext(lesson) {
  const context = [
    `Lesson: ${lesson.title}`,
    `Objective: ${lesson.objective}`,
    `Example: ${lesson.native}`,
    lesson.romanization,
    `Meaning: ${lesson.meaning}`,
    `Pattern: ${lesson.pattern}`,
    `Usage: ${lesson.usage}`,
  ]
  if (lesson.words.length) context.push(`Vocabulary:\n${lesson.words.map((word) => word.join(' / ')).join('\n')}`)
  if (lesson.readingRequest) context.push(`Original material: ${lesson.readingRequest.title}\nLanguage: ${lesson.readingRequest.language}\nScope: ${lesson.readingRequest.scopeLabel}\n${lesson.readingRequest.text}`)
  if (lesson.importSource) context.push(`Imported source (lesson generation is simulated):\n${lesson.importSource.text}`)
  return context.filter(Boolean).join('\n\n')
}
function openLessonAssistant(id, owner) {
  const lesson = getLesson(id)
  if (!lesson) return
  askAboutSnippet({
    text: lesson.native, lang: lesson.nativeLanguage ?? 'zh-Hans',
    meaning: lesson.meaning, romanization: lesson.romanization, source: `Lesson: ${lesson.title}`,
  }, owner, `Help me understand and practice this lesson:\n\n${lessonAssistantContext(lesson)}`)
}
function clearLessonPractice(moveFocus = false) {
  practiceLessonId = null
  one('#lesson-practice').hidden = true
  one('#general-exercises').hidden = false
  one('#practice-exercises').setAttribute('aria-labelledby', 'exercises-title')
  if (moveFocus) {
    one('#exercises-title').tabIndex = -1
    one('#exercises-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
}
function openLessonPractice(id) {
  const lesson = getLesson(id)
  if (!lesson) return
  practiceLessonId = id
  one('#lesson-practice-title').textContent = lesson.title
  one('#lesson-practice-objective').textContent = lesson.objective
  setLessonActionIcon(one('#practice-back-to-lesson'), 'open', lesson.title)
  one('#practice-exercises').setAttribute('aria-labelledby', 'lesson-practice-title')
  one('#lesson-practice').hidden = false
  one('#general-exercises').hidden = true
  one('#lesson-exercise-chooser').hidden = false
  one('#lesson-review').hidden = true
  one('#open-lesson-review').disabled = lesson.words.length === 0
  const boundary = one('#lesson-practice-boundary')
  boundary.hidden = lesson.words.length > 0 && !lesson.importSource && !lesson.creationId
  boundary.textContent = lesson.words.length
    ? 'Review uses the displayed authored sample lesson, not vocabulary generated from your source or request.'
    : 'This preparation request has no authored vocabulary yet. Ask the Assistant to create an exercise from its retained material.'
  location.hash = '#practice'
  requestAnimationFrame(() => {
    if (practiceLessonId !== id) return
    one('#lesson-practice-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  })
}
one('#open-lesson-review').addEventListener('click', () => {
  const lesson = getLesson(practiceLessonId)
  if (!lesson) return
  const list = one('#lesson-review-items')
  list.replaceChildren()
  lesson.words.forEach(([native, romanization, meaning]) => {
    const card = importElement('article', '', 'lesson-review-card')
    card.append(importElement('p', meaning))
    const answer = importElement('details')
    answer.append(importElement('summary', 'Reveal answer'))
    const text = importElement('p', native, 'lesson-page-native')
    text.lang = lesson.nativeLanguage ?? 'zh-Hans'
    answer.append(text, importElement('p', romanization, 'small muted'))
    setSnippetActions(text, { lang: text.lang, romanization, meaning, source: `Lesson Review: ${lesson.title}` })
    card.append(answer)
    list.append(card)
  })
  one('#lesson-exercise-chooser').hidden = true
  one('#lesson-review').hidden = false
  one('#lesson-review-title').focus({ preventScroll: true })
})
one('#back-to-lesson-exercises').addEventListener('click', () => {
  one('#lesson-review').hidden = true
  one('#lesson-exercise-chooser').hidden = false
  one('#open-lesson-review').focus({ preventScroll: true })
})
one('#create-lesson-exercise').addEventListener('click', () => {
  const lesson = getLesson(practiceLessonId)
  if (!lesson) return
  startAssistantTask('exercise', `Create a custom exercise to practice the lesson "${lesson.title}". Use its vocabulary, patterns, and retained source material.`, lessonAssistantContext(lesson))
})
one('#practice-back-to-lesson').addEventListener('click', () => showLesson(practiceLessonId))
one('#practice-all-lessons').addEventListener('click', () => clearLessonPractice(true))
document.addEventListener('click', (event) => {
  if (event.target.closest('a[href="#practice"]')) clearLessonPractice()
})
document.addEventListener('mockup-route-changed', (event) => {
  if (event.detail !== 'practice' || location.hash !== '#practice') clearLessonPractice()
})
