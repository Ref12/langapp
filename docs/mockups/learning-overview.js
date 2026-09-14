// The shared learning model owns state and calls this after initialization and updates.
function renderLearningOverview() {
  const overview = one('#overview')
  const snapshot = learningSnapshot()
  const resumeLabel = snapshot.resume.lessonId ? 'Continue learning'
    : snapshot.resume.origin === 'goal' ? 'View goal' : snapshot.resume.origin === 'path' ? 'View path' : 'Browse lessons'
  const focused = overview.contains(document.activeElement) ? document.activeElement : null
  const focusKey = focused?.dataset.learningOverviewFocus
  const element = (tag, text = '', className = '') => importElement(tag, text, className)
  const fragment = document.createDocumentFragment()

  function icon(symbol) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    use.setAttribute('href', `#${symbol}`)
    svg.append(use)
    return svg
  }

  function button(text, key, action, style = 'secondary', symbol = '') {
    const control = element('button', text, `button ${style}`)
    control.type = 'button'
    control.dataset.learningOverviewFocus = key
    control.addEventListener('click', action)
    if (symbol) control.append(icon(symbol))
    return control
  }

  function progress(percent, label, detail) {
    const meter = element('progress', `${percent}%`, 'learning-overview-progress')
    meter.max = 100
    meter.value = percent
    meter.setAttribute('aria-label', label)
    meter.setAttribute('aria-valuetext', detail)
    return meter
  }

  function summary(label, value, detail) {
    const item = element('div')
    item.append(element('dt', label))
    const amount = element('dd', value)
    amount.append(element('span', detail))
    item.append(amount)
    return item
  }

  function shortcut(href, key, heading, title, detail, symbol) {
    const link = element('a', '', 'learning-overview-shortcut')
    link.href = href
    link.dataset.learningOverviewFocus = key
    const copy = element('div', '', 'learning-overview-shortcut-copy')
    copy.append(
      element('h2', heading),
      element('p', title, 'learning-overview-shortcut-title'),
      element('p', detail, 'learning-overview-note'),
    )
    link.append(icon(symbol), copy, icon('i-arrow'))
    return link
  }

  const heading = element('header', '', 'learning-overview-heading')
  const title = element('h1', 'Your learning, coming together.')
  title.id = 'overview-title'
  title.tabIndex = -1
  title.dataset.learningOverviewFocus = 'title'
  heading.append(
    element('p', 'YOUR OVERVIEW', 'learning-overview-eyebrow'),
    title,
    element('p', 'Follow the Path in order, or explore your Goals. Your progress stays connected.'),
  )
  fragment.append(heading)

  const hero = element('section', '', 'learning-overview-hero')
  hero.setAttribute('aria-labelledby', 'learning-overview-coverage-title')
  const heroHeading = element('div', '', 'learning-overview-hero-heading')
  const coverageCopy = element('div')
  const coverageTitle = element('h2', 'Curriculum coverage')
  coverageTitle.id = 'learning-overview-coverage-title'
  coverageCopy.append(
    element('p', `${snapshot.tier.language} \u00b7 ${snapshot.tier.label}`, 'learning-overview-tier'),
    coverageTitle,
  )
  heroHeading.append(coverageCopy, element('p', `${snapshot.percent}%`, 'learning-overview-percentage'))
  const coverageDetail = `${snapshot.covered} of ${snapshot.total} curriculum objectives covered`
  hero.append(
    heroHeading,
    progress(snapshot.percent, `${snapshot.tier.language} ${snapshot.tier.label} curriculum coverage`, coverageDetail),
    element('p', 'Path and Goals contribute to the same coverage. Each objective counts once.', 'learning-overview-shared-note'),
  )
  const heroResume = button(
    resumeLabel,
    'hero-resume',
    () => resumeLearning(),
    'primary',
    'i-arrow',
  )
  heroResume.classList.add('learning-overview-hero-resume')
  if (snapshot.resume.lessonId) heroResume.setAttribute('aria-label', `Continue learning: ${snapshot.resume.title}`)
  hero.append(heroResume)
  const summaries = element('dl', '', 'learning-overview-summaries')
  summaries.append(
    summary('Coverage', `${snapshot.covered} / ${snapshot.total}`, 'objectives covered'),
    summary('Checkpoints', `${snapshot.checkpointsCompleted} / ${snapshot.checkpointCount}`, 'reading recognition checks completed'),
    summary('Needs review', String(snapshot.reviewCount), snapshot.reviewCount === 1 ? 'reading objective' : 'reading objectives'),
  )
  const heroFooter = element('div', '', 'learning-overview-hero-footer')
  heroFooter.append(
    element('p', 'Sample curriculum, not a full HSK assessment or a proficiency score.', 'learning-overview-note'),
    button('View progress details', 'progress', () => showLearningProgress(), 'quiet', 'i-arrow'),
  )
  hero.append(summaries, heroFooter)
  fragment.append(hero)

  const nextSteps = element('div', '', 'learning-overview-next-steps')
  const resume = snapshot.resume
  const continueCard = element('section', '', 'learning-overview-continue')
  continueCard.setAttribute('aria-labelledby', 'learning-overview-continue-title')
  const continueTitle = element('h2', 'Continue learning')
  continueTitle.id = 'learning-overview-continue-title'
  const origin = resume.lessonId
    ? { path: 'FROM YOUR PATH', goal: 'FROM YOUR GOAL', all: 'FROM ALL LESSONS' }[resume.origin]
    : 'YOUR NEXT STEP'
  const continueButton = button(
    resumeLabel,
    'resume',
    () => resumeLearning(),
    'primary',
    'i-arrow',
  )
  if (resume.lessonId) continueButton.setAttribute('aria-label', `Continue learning: ${resume.title}`)
  continueCard.append(
    element('p', origin, 'learning-overview-eyebrow'),
    continueTitle,
    element('h3', resume.title, 'learning-overview-resume-title'),
    element('p', resume.detail, 'learning-overview-resume-detail'),
    continueButton,
  )
  const alternatives = element('div', '', 'learning-overview-alternatives')
  alternatives.append(
    button('View path', 'path', () => openLearningView('path'), 'secondary', 'i-list'),
    button('Choose a goal', 'goals', () => openLearningView('goals'), 'quiet'),
  )
  continueCard.append(alternatives)
  nextSteps.append(continueCard)

  if (snapshot.nextCheckpoint) {
    const checkpoint = snapshot.nextCheckpoint
    const checkpointCard = element('section', '', 'learning-overview-checkpoint')
    checkpointCard.setAttribute('aria-labelledby', 'learning-overview-checkpoint-title')
    const checkpointTitle = element('h2', checkpoint.title)
    checkpointTitle.id = 'learning-overview-checkpoint-title'
    checkpointCard.append(
      element('p', 'NEXT CHECKPOINT \u00b7 OPTIONAL', 'learning-overview-eyebrow'),
      checkpointTitle,
      element('p', 'Try a sample reading recognition check for this unit. Keep learning whether or not you try it.'),
      element('p', checkpoint.status, 'learning-overview-note'),
      button('Open checkpoint', 'checkpoint', () => openLearningCheckpoint(checkpoint.id), 'secondary', 'i-check'),
    )
    nextSteps.append(checkpointCard)
  } else {
    nextSteps.classList.add('learning-overview-next-steps-single')
  }
  fragment.append(nextSteps)

  const goalsSection = element('section', '', 'learning-overview-goals')
  goalsSection.setAttribute('aria-labelledby', 'learning-overview-goals-title')
  const goalsHeading = element('div', '', 'learning-overview-section-heading')
  const goalsTitle = element('h2', 'Your goals')
  goalsTitle.id = 'learning-overview-goals-title'
  const goalsActions = element('div', '', 'learning-overview-goals-actions')
  goalsActions.append(
    button('View all goals', 'all-goals', () => openLearningView('goals'), 'quiet'),
    button('Create a goal', 'create-goal', () => startGoalAssistant(), 'secondary', 'i-plus'),
  )
  goalsHeading.append(goalsTitle, goalsActions)
  goalsSection.append(goalsHeading)
  const activeGoals = snapshot.goals.filter((goal) => goal.total === 0 || goal.completed < goal.total).slice(0, 2)
  if (activeGoals.length) {
    const goalsList = element('ul', '', 'learning-overview-goal-list')
    activeGoals.forEach((goal) => {
      const row = element('li', '', 'learning-overview-goal')
      const copy = element('div', '', 'learning-overview-goal-copy')
      const completion = goal.total ? `${goal.completed} of ${goal.total} lessons completed` : 'No lessons yet'
      copy.append(
        element('h3', goal.title),
        element('p', goal.summary, 'learning-overview-goal-summary'),
        element('p', completion, 'learning-overview-note'),
      )
      if (goal.total) copy.append(progress(goal.percent, `${goal.title}: lesson completion`, completion))
      const canResume = resume.lessonId && resume.origin === 'goal' && resume.goalId === goal.id
      const goalButton = button(
        canResume ? 'Continue goal' : 'View goal',
        `goal:${goal.id}`,
        () => canResume ? resumeLearning() : openLearningView('goals', goal.id),
        'secondary',
        'i-arrow',
      )
      goalButton.setAttribute('aria-label', `${canResume ? 'Continue goal' : 'View goal'}: ${goal.title}`)
      row.append(copy, goalButton)
      goalsList.append(row)
    })
    goalsSection.append(goalsList)
  } else {
    goalsSection.append(element(
      'p',
      snapshot.goals.length
        ? 'All lessons in your current goals are complete. Choose a new goal, or keep exploring the Path.'
        : 'What would you like to do in the language? Create a goal, or choose one to get started.',
      'learning-overview-empty',
    ))
  }
  fragment.append(goalsSection)

  const shortcuts = element('div', '', 'learning-overview-shortcuts')
  shortcuts.append(
    shortcut('#reader', 'reading', 'Continue reading', 'A morning at the tea house', 'Sample reading position: passage 2 of 5', 'i-book'),
    shortcut('#review', 'review', 'Review', '3-word sample review', 'Tea-house words, separate from curriculum review.', 'i-practice'),
  )
  fragment.append(shortcuts)

  overview.classList.add('learning-overview-screen')
  overview.setAttribute('aria-labelledby', 'overview-title')
  overview.replaceChildren(fragment)
  // Stable action keys preserve keyboard focus without moving focus from another screen or dialog.
  if (focused && !overview.hidden) {
    const replacement = [...overview.querySelectorAll('[data-learning-overview-focus]')]
      .find((control) => control.dataset.learningOverviewFocus === focusKey)
    const focusTarget = replacement || title
    focusTarget.focus({ preventScroll: true })
  }
}
