// Path, goals, and the catalog share objective identities and memory-only progress.
let learningView = 'path'
let selectedLearningGoal = 'cafe'
let learningResultsPage = 0
let learningGoalLesson = null
let learningCheckpointAttempt = null
let lastLearningActivity = { lessonId: 'cafe-request', origin: 'goal', goalId: 'cafe' }
const learningCatalogNotes = new Map()
const expandedLearningUnits = new Set(['requests'])
const learningPageSize = 8

function learningButton(text, action, className = 'button secondary') {
  const button = importElement('button', text, className)
  button.type = 'button'
  button.addEventListener('click', action)
  return button
}
function learningProgressBar(value, max, label) {
  const progress = importElement('progress')
  progress.max = max || 1
  progress.value = value
  progress.setAttribute('aria-label', label)
  return progress
}
function lessonTargets(id) {
  return learningLessonTargets.get(id) ?? []
}
function lessonTargetsCovered(id) {
  const targets = lessonTargets(id)
  return targets.length > 0 && targets.every((target) => learningCovered.has(target))
}
function learningLessonStatus(id) {
  if (lessonPreviews[id].readingRequest) return 'Teaching request / no lesson content yet'
  if (learningCompletedLessons.has(id)) return 'Completed / redo anytime'
  if (lessonTargetsCovered(id)) return 'Targets covered elsewhere / still open to study'
  const targets = lessonTargets(id)
  return targets.length ? `${targets.filter((target) => learningCovered.has(target)).length} of ${targets.length} targets covered`
    : 'No mapped objectives in this sample tier'
}
function nextPathLesson() {
  return learningUnits.flatMap((unit) => unit.lessons).find((id) => !lessonTargetsCovered(id)) ?? null
}
function nextGoalLesson(goal) {
  return goal.lessonIds.find((id) => !learningCompletedLessons.has(id) && !lessonPreviews[id].readingRequest) ?? null
}
function learningResume() {
  const activity = lastLearningActivity
  const goal = activity.goalId ? learningGoals.get(activity.goalId) : null
  let lessonId = activity.lessonId
  if (!lessonId || learningCompletedLessons.has(lessonId)) {
    lessonId = activity.origin === 'goal' && goal ? nextGoalLesson(goal) : activity.origin === 'path' ? nextPathLesson() : null
  }
  return {
    lessonId, origin: activity.origin, goalId: goal?.id ?? null,
    title: lessonId ? lessonPreviews[lessonId].title : goal ? 'Your goal plan is ready to revisit' : 'Choose what to learn next',
    detail: goal ? `Goal / ${goal.title}` : activity.origin === 'path' ? 'Your curriculum path' : 'Your most recent lesson',
  }
}
function learningSnapshot() {
  const unit = learningUnits.find((item) => item.targets.some((id) => !learningCovered.has(id))) ?? learningUnits.at(-1)
  const checkpoint = learningCheckpoints.has(unit.id)
    ? learningUnits.find((item) => !learningCheckpoints.has(item.id)) ?? unit : unit
  return {
    tier: learningTier, total: learningObjectives.size, covered: learningCovered.size,
    percent: Math.round(100 * learningCovered.size / learningObjectives.size),
    demonstrated: learningDemonstrated.size, reviewCount: learningReview.size,
    completedLessonsCount: learningCompletedLessons.size,
    checkpointsCompleted: learningCheckpoints.size, checkpointCount: learningUnits.length,
    nextUnit: { id: unit.id, title: unit.title, index: learningUnits.indexOf(unit) + 1 },
    nextCheckpoint: { id: checkpoint.id, title: checkpoint.title, status: learningCheckpoints.has(checkpoint.id) ? 'Try again anytime' : 'Optional / no prerequisites' },
    resume: learningResume(),
    goals: [...learningGoals.values()].map((goal) => {
      const completed = goal.lessonIds.filter((id) => learningCompletedLessons.has(id)).length
      return { id: goal.id, title: goal.title, completed, total: goal.lessonIds.length,
        percent: goal.lessonIds.length ? Math.round(100 * completed / goal.lessonIds.length) : 0,
        summary: goal.lessonIds.length ? goal.request : 'No lesson content yet. Add existing lessons or bring your material.' }
    }),
  }
}
function updateLearningPanels() {
  all('[data-learning-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.learningView === learningView)))
  for (const view of ['path', 'goals', 'all']) one(`#learning-${view}`).hidden = view !== learningView
  one('#lesson-back-label').textContent = `Back to ${learningView === 'path' ? 'Path' : learningView === 'goals' ? 'Goals' : 'All lessons'}`
}
function openLearningView(view, goalId = null) {
  if (!['path', 'goals', 'all'].includes(view) || (goalId && !learningGoals.has(goalId))) {
    notify('That learning view or goal is not available.')
    return
  }
  learningView = view
  if (goalId) selectedLearningGoal = goalId
  renderLearningViews()
  showLessonCatalog()
  location.hash = '#lessons'
  requestAnimationFrame(() => {
    if (location.hash !== '#lessons') return
    one('#lessons-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  })
}
function resumeLearning() {
  const resume = learningResume()
  if (resume.lessonId) showLesson(resume.lessonId, resume)
  else openLearningView(resume.origin === 'goal' ? 'goals' : resume.origin, resume.goalId)
}
function noteLessonOpened(id, context) {
  const sameLesson = lastLearningActivity.lessonId === id
  const origin = context.origin ?? (sameLesson ? lastLearningActivity.origin : 'all')
  const goalId = origin === 'goal' ? context.goalId ?? (sameLesson ? lastLearningActivity.goalId : selectedLearningGoal) : null
  lastLearningActivity = { lessonId: id, origin, goalId }
  learningView = origin === 'goal' ? 'goals' : origin
  if (goalId) selectedLearningGoal = goalId
  updateLearningPanels()
  const goal = goalId ? learningGoals.get(goalId) : null
  one('#lesson-learning-context').textContent = `${goal ? `Goal / ${goal.title}` : origin === 'path' ? 'Curriculum path' : 'All lessons'} / ${learningLessonStatus(id)}`
  renderLearningOverview()
}
function renderLessonLearningSummary(container, id) {
  const lesson = lessonPreviews[id]
  if (lesson.readingRequest) {
    container.append(importElement('p', 'This is a retained teaching request, not a completed lesson. Ask Assistant to prepare teaching material; no progress is awarded for this request.', 'lesson-page-copy'))
    return
  }
  container.append(importElement('p', 'Finish to record that you have covered this lesson. Practice or try a checkpoint when you want to see what you remember.', 'lesson-page-copy'))
  const targets = lessonTargets(id)
  if (targets.length) {
    const list = importElement('ul', '', 'learning-targets')
    for (const target of targets) list.append(importElement('li', `${learningObjectives.get(target).label}${learningCovered.has(target) ? ' / already covered' : ''}`))
    container.append(list, importElement('p', 'Shared targets count once, whether you meet them in Path, Goals, or a checkpoint. Completion is not mastery.', 'small muted'))
  } else {
    container.append(importElement('p', 'This can advance a personal goal, but it has no mapped objectives in the sample HSK 2 tier. Its completion will not change that percentage.', 'small muted'))
  }
  if (learningCompletedLessons.has(id)) container.append(importElement('p', 'Already completed. Redoing keeps your completion history and does not add duplicate coverage.', 'tag'))
}
function finishLearningLesson(id) {
  const lesson = getLesson(id)
  if (!lesson) return
  if (lesson.readingRequest) {
    notify('This is a teaching request, not a lesson yet. Prepare its teaching material first.')
    return
  }
  const previous = learningCovered.size
  learningCompletedLessons.add(id)
  lessonTargets(id).forEach((target) => learningCovered.add(target))
  for (const target of lessonTargets(id)) recordReadingEvidence(objectiveKnowledgeOwner(learningObjectives.get(target)), 'Introduced', 'Completed a written sample lesson, not a mastery assessment.')
  for (const [native] of lesson.words) recordReadingEvidence(vocabularyKnowledgeOwner(native, lesson.nativeLanguage || 'zh-Hans'), 'Introduced', 'Vocabulary introduced in a written sample lesson.')
  refreshWordState()
  const added = learningCovered.size - previous
  if (lastLearningActivity.origin === 'path') expandedLearningUnits.add(learningSnapshot().nextUnit.id)
  renderLearningViews()
  showLessonCatalog(true)
  notify(`Lesson completed. ${added ? `${added} new shared ${added === 1 ? 'objective' : 'objectives'} covered.` : 'No duplicate tier coverage added.'} You can redo it anytime.`)
}
function learningLessonRow(id, origin, goalId = null, index = null) {
  const lesson = lessonPreviews[id]
  const row = importElement('article', '', 'learning-lesson-row')
  row.dataset.learningOrigin = origin
  if (goalId) row.dataset.learningGoal = goalId
  const marker = importElement('span', index === null ? '' : String(index + 1), 'learning-step-number')
  marker.setAttribute('aria-hidden', 'true')
  const copy = importElement('div', '', 'learning-lesson-copy')
  copy.append(importElement('h3', lesson.title), importElement('p', learningLessonStatus(id), 'small muted'))
  const open = importElement('button', 'Open lesson', 'button secondary')
  open.type = 'button'
  open.dataset.openLesson = id
  row.append(marker, copy, open)
  addLessonActions(row, id)
  return row
}
function renderLearningPath() {
  const root = one('#learning-path')
  root.replaceChildren()
  const snapshot = learningSnapshot()
  const hero = importElement('div', '', 'learning-path-header')
  const copy = importElement('div')
  copy.append(importElement('p', `${learningTier.language} / ${learningTier.label}`, 'eyebrow'),
    importElement('h2', `${snapshot.percent}% of the sample tier covered`),
    importElement('p', `${snapshot.covered} of ${snapshot.total} shared objectives / 6 ordered units`, 'small muted'),
    learningProgressBar(snapshot.covered, snapshot.total, 'Sample curriculum coverage'))
  const actions = importElement('div', '', 'learning-inline-actions')
  const next = nextPathLesson()
  actions.append(learningButton(next ? 'Continue path' : 'Revisit the path', () => showLesson(next ?? 'request', { origin: 'path' }), 'button primary'),
    learningButton('Progress details', showLearningProgress))
  hero.append(copy, actions)
  root.append(hero, importElement('p', 'A recommended order, not a set of locks. Jump ahead, redo any lesson, or try a checkpoint to show what you already recognize.', 'small muted'))
  const units = importElement('div', '', 'learning-unit-list')
  learningUnits.forEach((unit, index) => {
    const covered = unit.targets.filter((id) => learningCovered.has(id)).length
    const details = importElement('details', '', 'learning-unit')
    details.dataset.unit = unit.id
    details.open = expandedLearningUnits.has(unit.id)
    const summary = importElement('summary')
    summary.append(importElement('span', String(index + 1).padStart(2, '0'), 'learning-unit-number'))
    const label = importElement('span', '', 'learning-unit-label')
    label.append(importElement('strong', unit.title), importElement('span', `${unit.lessons.length} lessons / ${covered} of ${unit.targets.length} objectives covered`, 'small muted'))
    summary.append(label, importElement('span', covered === unit.targets.length ? 'Covered' : unit.id === snapshot.nextUnit.id ? 'Up next' : 'Open', `tag ${covered === unit.targets.length ? 'green' : ''}`))
    details.append(summary)
    const lessons = importElement('div', '', 'learning-unit-lessons')
    unit.lessons.forEach((id, position) => lessons.append(learningLessonRow(id, 'path', null, position)))
    const checkpoint = importElement('div', '', 'learning-unit-checkpoint')
    const result = learningCheckpoints.get(unit.id)
    checkpoint.append(importElement('p', result ? `Checkpoint / last result: ${result.correct.length} of ${result.total} recognized` : 'Optional checkpoint / recognize these four targets', 'small muted'),
      learningButton(result ? 'Try checkpoint again' : 'Try checkpoint', () => openLearningCheckpoint(unit.id)))
    details.append(lessons, checkpoint)
    details.addEventListener('toggle', () => {
      if (!details.isConnected) return
      if (details.open) expandedLearningUnits.add(unit.id)
      else expandedLearningUnits.delete(unit.id)
    })
    units.append(details)
  })
  root.append(units)
}
function startGoalAssistant(request = '') {
  startAssistantTask('goal', request, 'Plan a communicative goal. Reuse shared curriculum targets where appropriate; there are no locked prerequisites. This prototype only offers authored sample plans.')
}
function buildLearningGoalPlan(request) {
  let ids = []
  let sample = ''
  if (/\b(cafe|caf\u00e9|coffee|tea|drink|sugar)\b/i.test(request)) {
    ids = ['cafe-request', 'again', 'preferences']
    sample = 'Cafe requests'
  } else if (/\b(weekend|tomorrow|park|day out|day trip|station|directions)\b/i.test(request)) {
    ids = ['plans', 'directions']
    sample = 'A day out'
  }
  const title = Array.from(request.trim().replace(/\s+/g, ' ')).slice(0, 90).join('') || 'My learning goal'
  return { title, request, lessonIds: ids, sample }
}
function renderLearningGoalPreview(container, plan) {
  container.append(importElement('p', plan.lessonIds.length
    ? `${plan.sample} / authored plan preview. These existing sample lessons illustrate a sequence, not AI-personalized teaching.`
    : 'Your request is retained. There is no authored plan for this scenario and live generation is not connected. Save the goal, then add lessons or import your material.', 'import-notice'))
  const list = importElement('ol', '', 'learning-targets')
  for (const id of plan.lessonIds) list.append(importElement('li', `${lessonPreviews[id].title} / ${lessonTargets(id).length ? 'shared tier targets' : 'personal goal extension'}`))
  if (plan.lessonIds.length) container.append(list)
  container.append(importElement('p', 'Saving creates a goal and links its lessons. It does not complete lessons or change tier progress.', 'small muted'))
}
function saveLearningGoal(creation) {
  const id = `goal-${creation.id}`
  learningGoals.set(id, { ...creation.goalPlan, lessonIds: [...creation.goalPlan.lessonIds], id, creationId: creation.id })
  selectedLearningGoal = id
  renderLearningViews()
  return id
}
function renderLearningGoals() {
  const root = one('#learning-goals')
  root.replaceChildren()
  const heading = importElement('div', '', 'learning-section-heading')
  const copy = importElement('div')
  copy.append(importElement('h2', 'What would you like to be able to say?'), importElement('p', 'Start with a situation. Build a short plan with Assistant, then mix it with your path.', 'small muted'))
  heading.append(copy, learningButton('New goal with Assistant', () => startGoalAssistant(), 'button primary'))
  root.append(heading)
  const layout = importElement('div', '', 'learning-goal-layout')
  const list = importElement('nav', '', 'learning-goal-list')
  list.setAttribute('aria-label', 'Your learning goals')
  for (const goal of learningGoals.values()) {
    const done = goal.lessonIds.filter((id) => learningCompletedLessons.has(id)).length
    const select = learningButton('', () => {
      selectedLearningGoal = goal.id
      renderLearningGoals()
      one('#learning-goal-heading').focus({ preventScroll: true })
    }, 'learning-goal-select')
    select.setAttribute('aria-current', String(goal.id === selectedLearningGoal))
    select.append(importElement('strong', goal.title), importElement('span', `${done} of ${goal.lessonIds.length} lessons completed`, 'small muted'),
      learningProgressBar(done, goal.lessonIds.length, `Lesson completion for ${goal.title}`))
    list.append(select)
  }
  const goal = learningGoals.get(selectedLearningGoal)
  const detail = importElement('section', '', 'learning-goal-detail')
  const title = importElement('h3', goal.title)
  title.id = 'learning-goal-heading'
  title.tabIndex = -1
  detail.setAttribute('aria-labelledby', title.id)
  detail.append(importElement('span', 'YOUR COMMUNICATION GOAL', 'eyebrow'), title,
    importElement('p', goal.request, 'learning-goal-request'))
  const targets = new Set(goal.lessonIds.flatMap(lessonTargets))
  detail.append(importElement('p', targets.size
    ? `${[...targets].filter((id) => learningCovered.has(id)).length} of ${targets.size} linked tier objectives covered. Plan completion and real-world confidence are different things.`
    : 'This plan has no linked objectives in the sample tier. It can still support your personal goal.', 'small muted'))
  const actions = importElement('div', '', 'learning-inline-actions')
  const next = nextGoalLesson(goal)
  if (next) actions.append(learningButton('Continue goal', () => showLesson(next, { origin: 'goal', goalId: goal.id }), 'button primary'))
  actions.append(learningButton('Add existing lessons', () => openLearningView('all')))
  if (goal.creationId) actions.append(learningButton('Source conversation', () => openCreationConversation(assistantCreations.get(goal.creationId).threadId)))
  detail.append(actions)
  if (!goal.lessonIds.length) detail.append(importElement('p', 'No lessons yet. Your request is saved, but no content or tier mapping has been invented. Add existing lessons or import chapters to start a sequence.', 'import-notice'))
  goal.lessonIds.forEach((id, index) => detail.append(learningLessonRow(id, 'goal', goal.id, index)))
  if (goal.lessonIds.length > 1) {
    const order = importElement('details', '', 'learning-plan-order')
    order.append(importElement('summary', 'Arrange lesson order'))
    goal.lessonIds.forEach((id, index) => {
      const row = importElement('div', '', 'learning-order-row')
      row.append(importElement('span', lessonPreviews[id].title))
      for (const direction of [-1, 1]) {
        const label = direction < 0 ? 'Move earlier' : 'Move later'
        const button = learningButton(direction < 0 ? '\u2191' : '\u2193', () => {
          const target = index + direction
          ;[goal.lessonIds[index], goal.lessonIds[target]] = [goal.lessonIds[target], goal.lessonIds[index]]
          renderLearningGoals()
          renderLearningOverview()
          const reopened = one('.learning-plan-order')
          reopened.open = true
          reopened.querySelectorAll('.learning-order-row')[target].querySelector('button:not(:disabled)').focus({ preventScroll: true })
        }, 'icon-button')
        button.disabled = index + direction < 0 || index + direction >= goal.lessonIds.length
        button.setAttribute('aria-label', `${label}: ${lessonPreviews[id].title}`)
        row.append(button)
      }
      order.append(row)
    })
    detail.append(order)
  }
  layout.append(list, detail)
  root.append(layout, importElement('p', 'Examples cover cafe requests and a day out. Other requests create an empty goal to organize; live lesson generation is not connected.', 'small muted'))
}
function learningLessonSource(id) {
  const lesson = lessonPreviews[id]
  if (lesson.readingRequest) return 'preparation'
  if (lesson.importSource) return 'import'
  if (lesson.creationId) return 'assistant'
  return learningUnits.some((unit) => unit.lessons.includes(id)) ? 'path' : 'goal'
}
function renderLearningCatalog() {
  const query = one('#lesson-search').value.trim().toLocaleLowerCase()
  const source = one('#lesson-source-filter').value
  const status = one('#lesson-status-filter').value
  const ids = Object.keys(lessonPreviews).filter((id) => {
    const lesson = lessonPreviews[id]
    return (source === 'all' || learningLessonSource(id) === source)
      && (status === 'all' || status === 'done' && learningCompletedLessons.has(id) || status === 'new' && !learningCompletedLessons.has(id) || status === 'covered' && lessonTargetsCovered(id))
      && (!query || [lesson.title, lesson.objective, lesson.pattern, ...lesson.words.flat(), learningCatalogNotes.get(id)?.description].join(' ').toLocaleLowerCase().includes(query))
  })
  const pageCount = Math.max(1, Math.ceil(ids.length / learningPageSize))
  learningResultsPage = Math.min(learningResultsPage, pageCount - 1)
  const grid = one('#lesson-grid')
  grid.replaceChildren()
  for (const id of ids.slice(learningResultsPage * learningPageSize, (learningResultsPage + 1) * learningPageSize)) {
    const lesson = lessonPreviews[id]
    const card = importElement('article', '', 'lesson-card')
    card.dataset.learningOrigin = 'all'
    const sourceLabel = { path: 'CURRICULUM', goal: 'GOAL LESSON', assistant: 'ASSISTANT / SAMPLE', import: 'IMPORTED / SAMPLE', preparation: 'READING REQUEST' }[learningLessonSource(id)]
    card.append(importElement('span', sourceLabel, 'eyebrow'), importElement('h2', lesson.title),
      importElement('p', learningCatalogNotes.get(id)?.description || lesson.objective),
      importElement('div', learningLessonStatus(id), 'lesson-meta'))
    const open = importElement('button', 'Open lesson', 'button secondary')
    open.type = 'button'
    open.dataset.openLesson = id
    card.append(open)
    addLessonActions(card, id)
    const add = learningButton('+', () => openLessonGoalDialog(id), 'icon-button lesson-action button secondary')
    add.setAttribute('aria-label', `Add to a goal: ${lesson.title}`)
    add.dataset.addLessonGoal = id
    card.querySelector('.lesson-actions').append(add)
    grid.append(card)
  }
  if (!ids.length) grid.append(importElement('p', 'No matching lessons. Try another search or clear the filters.', 'learning-empty'))
  one('#lesson-catalog-count').textContent = `${ids.length} matching ${ids.length === 1 ? 'lesson' : 'lessons'}`
  one('#lesson-results-page').textContent = `${learningResultsPage + 1} of ${pageCount}`
  one('#lesson-results-previous').disabled = learningResultsPage === 0
  one('#lesson-results-next').disabled = learningResultsPage >= pageCount - 1
}
function openLessonGoalDialog(id) {
  learningGoalLesson = id
  one('#lesson-goal-name').textContent = lessonPreviews[id].title
  const select = one('#lesson-goal-select')
  select.replaceChildren()
  for (const goal of learningGoals.values()) {
    const option = importElement('option', goal.title)
    option.value = goal.id
    select.append(option)
  }
  select.value = selectedLearningGoal
  one('#lesson-goal-dialog').showModal()
}
function showLearningProgress() {
  const root = one('#learning-progress-content')
  root.replaceChildren()
  const snapshot = learningSnapshot()
  root.append(importElement('p', `${snapshot.percent}% covered / ${snapshot.covered} of ${snapshot.total} shared objectives`, 'learning-progress-total'),
    learningProgressBar(snapshot.covered, snapshot.total, 'Curriculum coverage'),
    importElement('p', 'Coverage records lesson exposure or a correct checkpoint response, once per objective. It is not fluency, mastery, or an official HSK assessment.', 'small muted'),
    importElement('p', `${snapshot.demonstrated} recognized at reading checkpoints / ${snapshot.reviewCount} reading objectives to revisit`, 'small'),
    importElement('p', 'Hearing, speaking, reading, and writing each have their own state for every word or construct. These checkpoints provide reading evidence only, never all-skill mastery.', 'small muted'),
    importElement('p', 'A later mistake adds a review need, but does not erase completion history. Delayed retention is not assessed here. Expand a target to inspect its four skill states.', 'small muted'))
  for (const unit of learningUnits) {
    const group = importElement('details', '', 'learning-progress-unit')
    const needsReview = unit.targets.some((id) => learningReview.has(id))
    group.open = needsReview
    group.append(importElement('summary', `${unit.title}${needsReview ? ' / needs review' : ''}`))
    const list = importElement('ul', '', 'learning-targets')
    for (const id of unit.targets) {
      const objective = learningObjectives.get(id)
      const status = [learningCovered.has(id) ? 'Covered' : 'Not covered', learningDemonstrated.has(id) ? 'Reading recognized at a checkpoint' : '', learningReview.has(id) ? 'Reading needs review' : ''].filter(Boolean).join(' / ')
      const item = importElement('li')
      const detail = importElement('details', '', 'knowledge-objective')
      detail.append(importElement('summary', `${objective.label} (${objective.kind}) / ${status}`))
      const text = importElement('p', objective.native)
      text.lang = 'zh-Hans'
      detail.append(text, createKnowledgeProfile(objectiveKnowledgeOwner(objective)))
      setSnippetActions(text, { meaning: objective.meaning, source: `Learning objective / ${objective.label}` })
      item.append(detail)
      list.append(item)
    }
    group.append(list, learningButton(needsReview ? 'Revisit with a checkpoint' : 'Try checkpoint', () => {
      one('#learning-progress-dialog').close()
      openLearningCheckpoint(unit.id)
    }))
    root.append(group)
  }
  one('#learning-progress-dialog').showModal()
}
function openLearningCheckpoint(unitId) {
  const unit = learningUnits.find((item) => item.id === unitId)
  if (!unit) {
    notify('That sample checkpoint is not available.')
    return
  }
  learningCheckpointAttempt = { unit, index: -1, answers: new Map() }
  one('#learning-checkpoint-title').textContent = unit.title
  renderLearningCheckpoint()
  one('#learning-checkpoint-dialog').showModal()
}
function renderLearningCheckpoint() {
  const { unit, index, answers } = learningCheckpointAttempt
  const root = one('#learning-checkpoint-content')
  const next = one('#checkpoint-next')
  root.replaceChildren()
  next.disabled = false
  if (index < 0) {
    root.append(importElement('p', 'Recognize four words or patterns from this unit. You can try this before taking its lessons.', 'learning-checkpoint-intro'),
      importElement('p', 'Correct responses can cover these sample targets. Results only change progress when you choose Save result. This is a reading-recognition exercise, not a hearing, speaking, writing, or mastery assessment.', 'small muted'))
    next.textContent = 'Start checkpoint'
  } else if (index < unit.targets.length) {
    const id = unit.targets[index]
    const target = learningObjectives.get(id)
    const heading = importElement('h3', `Which option means "${target.meaning}"?`)
    heading.id = 'checkpoint-question'
    const answered = answers.has(id)
    root.append(importElement('p', `Question ${index + 1} of ${unit.targets.length} / ${target.kind}`, 'eyebrow'), heading)
    const options = importElement('div', '', 'learning-checkpoint-choices')
    options.setAttribute('role', 'group')
    options.setAttribute('aria-labelledby', heading.id)
    const pool = [...learningObjectives.values()]
    const offset = pool.indexOf(target)
    const choices = [target, pool[(offset + 5) % pool.length], pool[(offset + 11) % pool.length]]
    for (let position = 0; position < choices.length; position++) {
      const choice = choices[(position + index) % choices.length]
      const row = importElement('div', '', 'learning-checkpoint-option')
      const button = learningButton('', () => {
        answers.set(id, choice.id === id)
        renderLearningCheckpoint()
        next.focus({ preventScroll: true })
      }, 'learning-checkpoint-answer')
      button.disabled = answered
      const text = importElement('span', choice.native)
      text.lang = 'zh-Hans'
      button.append(text)
      row.append(button, createSnippetActions(choice.native, { source: `Checkpoint / ${unit.title} / Visible choice` }))
      options.append(row)
    }
    root.append(options)
    if (answered) {
      const feedback = importElement('p', answers.get(id) ? 'Recognized correctly.' : `Revisit this target. The answer is: ${target.native}`, 'import-notice')
      feedback.setAttribute('role', 'status')
      root.append(feedback)
      if (!answers.get(id)) setTargetSnippetActions(feedback, { source: `Checkpoint / ${unit.title} / Revealed answer` })
    }
    next.disabled = !answered
    next.textContent = index === unit.targets.length - 1 ? 'See result' : 'Next question'
  } else {
    const correct = [...answers.values()].filter(Boolean).length
    const newCoverage = unit.targets.filter((id) => answers.get(id) && !learningCovered.has(id)).length
    root.append(importElement('p', `${correct} of ${unit.targets.length} recognized`, 'learning-progress-total'),
      importElement('p', `Saving will add ${newCoverage} newly covered ${newCoverage === 1 ? 'objective' : 'objectives'}. Incorrect responses become review needs; earlier coverage is kept.`, 'small muted'))
    const list = importElement('ul', '', 'learning-targets')
    for (const id of unit.targets) list.append(importElement('li', `${learningObjectives.get(id).label} / ${answers.get(id) ? 'Recognized' : 'Revisit'}`))
    root.append(list, importElement('p', 'No lesson locks or vocabulary mastery changes. You can leave without saving or try this checkpoint again later.', 'small muted'))
    next.textContent = 'Save result'
  }
  root.scrollTop = 0
}
function renderLearningViews() {
  updateLearningPanels()
  renderLearningPath()
  renderLearningGoals()
  renderLearningCatalog()
  renderLearningOverview()
}

all('[data-learning-view]').forEach((button) => button.addEventListener('click', () => {
  learningView = button.dataset.learningView
  updateLearningPanels()
}))
for (const id of ['lesson-search', 'lesson-source-filter', 'lesson-status-filter']) {
  one(`#${id}`).addEventListener(id === 'lesson-search' ? 'input' : 'change', () => {
    learningResultsPage = 0
    renderLearningCatalog()
  })
}
for (const [id, direction] of [['lesson-results-previous', -1], ['lesson-results-next', 1]]) {
  one(`#${id}`).addEventListener('click', () => {
    learningResultsPage += direction
    renderLearningCatalog()
    one('#lesson-grid').querySelector('button')?.focus({ preventScroll: true })
    one('#learning-all').scrollIntoView({ block: 'start' })
  })
}
one('#lesson-goal-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const goal = learningGoals.get(one('#lesson-goal-select').value)
  if (goal.lessonIds.includes(learningGoalLesson)) {
    notify('This lesson is already in that goal. No duplicate was added.')
    return
  }
  goal.lessonIds.push(learningGoalLesson)
  one('#lesson-goal-dialog').close()
  renderLearningViews()
  // Catalog rows are replaced after saving; restore focus to their equivalent control.
  one(`[data-add-lesson-goal="${learningGoalLesson}"]`)?.focus({ preventScroll: true })
  notify(`Lesson added to "${goal.title}". Arrange its order in Goals.`)
})
one('#checkpoint-next').addEventListener('click', () => {
  const attempt = learningCheckpointAttempt
  if (attempt.index >= attempt.unit.targets.length) {
    const correct = attempt.unit.targets.filter((id) => attempt.answers.get(id))
    for (const id of attempt.unit.targets) {
      if (attempt.answers.get(id)) {
        learningCovered.add(id)
        learningDemonstrated.add(id)
        recordReadingEvidence(objectiveKnowledgeOwner(learningObjectives.get(id)), 'Practicing', 'Correct reading-recognition response at a sample checkpoint.')
        learningReview.delete(id)
      } else learningReview.add(id)
    }
    learningCheckpoints.set(attempt.unit.id, { correct, total: attempt.unit.targets.length })
    refreshWordState()
    one('#learning-checkpoint-dialog').close()
    renderLearningViews()
    refreshWordState()
    one(document.body.dataset.screen === 'overview' ? '#overview-title' : '#lessons-title').focus({ preventScroll: true })
    notify('Checkpoint saved for this page visit. Coverage and review needs are updated separately.')
  } else {
    attempt.index++
    renderLearningCheckpoint()
    const root = one('#learning-checkpoint-content')
    root.tabIndex = -1
    root.focus({ preventScroll: true })
  }
})
document.addEventListener('mockup-lesson-added', (event) => {
  learningCatalogNotes.set(event.detail.id, event.detail)
  renderLearningViews()
})
renderLearningViews()
