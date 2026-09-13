// App-wide tasks are authored previews. Only an explicit Add changes a collection.
const assistantTaskTypes = {
  story: { label: 'Story', destination: 'Library', request: 'Create a short story using tea, cup, and friend as familiar vocabulary. Help me learn "again" and the pattern "would like + action".' },
  lesson: { label: 'Lesson', destination: 'Lessons', request: 'Create a lesson on asking for another cup of tea, using familiar vocabulary and introducing "again".' },
  exercise: { label: 'Exercise', destination: 'Practice / Exercises', request: 'Create a custom exercise to practice adding "again" to a request for tea.' },
  game: { label: 'Level brief', destination: 'Practice / Games', request: 'Create a custom game level using tea-house vocabulary and the pattern for asking for something again.' },
  dictionary: { label: 'Word lookup', destination: 'Dictionary', request: 'Look up gong1yuan2' },
}
const assistantCreations = new Map()
let nextAssistantCreation = 1
let assistantMessageActionContext = null
let assistantMessageActionAnchor = null
const creationStory = '# Another cup with a friend\n\n\u6211\u548c\u670b\u53cb\u559d\u8336\u3002\n\nMy friend and I drink tea.\n\n\u670b\u53cb\u60f3\u559d\u4e00\u676f\u8336\u3002\n\nMy friend would like a cup of tea.\n\n\u6211\u60f3\u518d\u559d\u4e00\u676f\u8336\u3002\n\nI would like another cup of tea.'
function prepareAssistantTask(thread, kind, query = '', context = '') {
  if (thread.voiceStage === 'recording' || thread.draft.trim()) {
    notify('Send or clear the current draft before starting this task. Your draft is unchanged.')
    return
  }
  thread.creationKind = kind
  thread.creationSuppressed = false
  thread.creationContext = context
  thread.readingRequest = null
  thread.draft = query ? kind === 'dictionary' ? `Look up ${query}` : query : assistantTaskTypes[kind].request
  thread.voiceStage = 'idle'
  closeAssistantSettings()
  renderVoiceTurn()
  renderAssistantMode()
  renderConversationList()
  scrollConversationToEnd()
  one('#chat-input').focus({ preventScroll: true })
}
function startAssistantTask(kind, query = '', context = '', readingRequest = null) {
  const thread = beginConversation(kind === 'dictionary' ? 'Dictionary lookup' : `${assistantTaskTypes[kind].destination} creation`)
  prepareAssistantTask(thread, kind, query, context)
  thread.readingRequest = readingRequest
  openThreadOnNextRoute = location.hash !== '#conversation'
  location.hash = '#conversation'
}
all('[data-assistant-task]').forEach((button) => button.addEventListener('click', () => {
  const kind = button.dataset.assistantTask
  startAssistantTask(kind, kind === 'dictionary' ? one('#dictionary-lookup').value.trim() : '')
}))
function openCreationConversation(id) {
  if (!conversations.some((thread) => thread.id === id)) {
    notify('The source conversation is not available in this page visit.')
    return
  }
  openThreadOnNextRoute = location.hash !== '#conversation'
  selectConversation(id)
  location.hash = '#conversation'
}
function renderMessageActions(entry, thread) {
  const footer = chatElement('div', 'message-actions')
  const button = chatElement('button', 'icon-button message-actions-toggle')
  button.type = 'button'
  button.dataset.messageActions = ''
  button.setAttribute('aria-label', 'Actions for this Assistant response')
  button.title = 'Use this response to create content or look up words'
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-controls', 'assistant-message-actions')
  button.setAttribute('aria-expanded', 'false')
  const icon = one('#assistant-settings-toggle svg').cloneNode(true)
  icon.querySelector('use').setAttribute('href', '#i-more')
  button.append(icon)
  button.addEventListener('click', () => {
    const panel = one('#assistant-message-actions')
    if (panel.matches(':popover-open') && assistantMessageActionAnchor === button) {
      panel.hidePopover()
      return
    }
    if (panel.matches(':popover-open')) panel.hidePopover()
    assistantMessageActionAnchor = button
    assistantMessageActionContext = { threadId: thread.id, text: [entry.text, entry.phrase?.native, entry.phrase?.meaning].filter(Boolean).join('\n') }
    panel.showPopover()
    positionAssistantSettings()
    panel.querySelector('[data-message-task]').focus({ preventScroll: true })
  })
  footer.append(button)
  return footer
}
one('#assistant-message-actions').addEventListener('toggle', (event) => {
  all('[data-message-actions]').forEach((button) => button.setAttribute('aria-expanded', String(event.newState === 'open' && button === assistantMessageActionAnchor)))
  if (event.newState === 'open') positionAssistantSettings()
})
all('[data-message-task]').forEach((button) => button.addEventListener('click', () => {
  const context = assistantMessageActionContext
  if (!context || context.threadId !== currentConversation().id) {
    notify('Open the actions menu on a response in this conversation first.')
    return
  }
  const kind = button.dataset.messageTask
  const word = Object.values(words).find((item) => item.nativeLanguage !== 'en' && context.text.includes(item.native))
  prepareAssistantTask(currentConversation(), kind, kind === 'dictionary' ? word?.native || 'park' : '', context.text)
}))
function resolveAssistantTask(thread, text) {
  if (thread.creationKind) return { kind: thread.creationKind, query: lookupQuery(text) }
  if (thread.mode === 'shadow' || thread.creationSuppressed) return null
  if (/^(look\s*up|(?:add|save)\s.+\s(?:to|in)\s)/i.test(text)) {
    if (/^look\s*up\s/i.test(text) || /\b(?:dictionary|learning set)\b/i.test(text)) return { kind: 'dictionary', query: lookupQuery(text) }
  }
  const match = text.match(/^(?:please\s+)?(?:create|write|make|build|generate)\s+(?:me\s+)?(?:a[n]?\s+)?(?:short\s+|custom\s+)?(story|lesson|exercise|game(?:\s+level)?|level)\b/i)
  if (!match) return null
  return { kind: /^game|level/i.test(match[1]) ? 'game' : match[1].toLowerCase() }
}
function lookupQuery(text) {
  return text.replace(/^look\s*up\s+/i, '').replace(/^(?:add|save)\s+/i, '')
    .replace(/\s+(?:to|in)\s+(?:(?:my|the)\s+)?(?:dictionary|learning set)[.!?]*$/i, '')
    .replace(/^[\s"']+|[\s"'?.!]+$/g, '')
}
function addAssistantTaskReply(thread, task, request) {
  if (task.kind === 'dictionary') {
    const ids = findDictionaryWords(task.query)
    thread.messages.push(tutorMessage(ids.length ? `Sample dictionary lookup for "${task.query}". Review the entries and choose which to add to your learning set.`
      : `No entry for "${task.query}" in this mockup's sample dictionary. Try characters such as \u516c\u56ed, a meaning such as park, or pinyin such as gong1yuan2. No definition has been invented.`,
    undefined, { lookupWordIds: ids }))
    return
  }
  const titles = { story: 'Another cup with a friend', lesson: 'Asking for another cup', exercise: 'A request, one more time', game: 'Tea-house requests / Level brief' }
  const creation = {
    id: `creation-${nextAssistantCreation++}`, kind: task.kind, title: titles[task.kind],
    request, context: thread.creationContext || '', threadId: thread.id, status: 'preview',
    familiar: '\u8336 / tea, \u676f / cup, \u670b\u53cb / friend',
    targets: '\u518d / again; \u6211\u60f3 + action / I would like to...',
    answerShown: false, detailOpen: false,
    readingRequest: task.kind === 'lesson' ? thread.readingRequest : null,
  }
  if (creation.readingRequest) creation.title = `Prepare to read: ${creation.readingRequest.title}`
  assistantCreations.set(creation.id, creation)
  thread.messages.push(tutorMessage(creation.readingRequest ? 'I have kept the reading material, language, and scope with this preparation request. This preview does not run live teaching or infer what you know. Review the request before saving it to Lessons.'
    : 'Here is an authored sample showing the creation flow, not content generated from your request or learning profile. Review it before adding it to the app.', undefined, { creationId: creation.id }))
}
function renderCreationProvenance(container, id) {
  const creation = assistantCreations.get(id)
  container.replaceChildren()
  const details = chatElement('details', 'creation-provenance')
  details.append(chatElement('summary', '', 'Created with Assistant / Sample'))
  details.append(chatElement('p', 'small muted', 'Illustrative generation only. The request and context are retained, but this content is an authored fixture, not personalized AI output.'),
    chatElement('strong', '', 'Your request'), chatElement('p', 'creation-request-text', creation.request))
  if (creation.context) details.append(chatElement('strong', '', creation.readingRequest ? 'Reading material used as context' : 'Response used as context'), chatElement('p', 'creation-request-text', creation.context))
  const link = chatElement('a', 'text-link', 'Back to source conversation')
  link.href = '#conversation'
  link.addEventListener('click', () => openCreationConversation(creation.threadId))
  details.append(link)
  container.append(details)
}
function renderCreationMaterial(container, creation, practice = false) {
  if (creation.readingRequest) {
    renderReadingPreparationPreview(container, creation.readingRequest)
    return
  }
  const plan = chatElement('div', 'creation-plan')
  plan.append(chatElement('p', '', `Familiar vocabulary / sample plan: ${creation.familiar}`), chatElement('p', '', `Learning targets / sample plan: ${creation.targets}`))
  container.append(plan)
  if (creation.kind === 'story') {
    const preview = chatElement('details', 'creation-content-preview')
    preview.append(chatElement('summary', '', 'Read the sample story'))
    const text = chatElement('div', 'imported-source creation-story')
    renderImportedSource(text, creationStory)
    preview.append(text)
    container.append(preview)
  } else if (creation.kind === 'lesson') {
    const lesson = lessonPreviews.request
    container.append(chatElement('p', '', lesson.objective), renderChatPhrase(lesson), chatElement('p', '', lesson.pattern),
      chatElement('p', 'small muted', `${lesson.words.length} vocabulary items / 1 useful pattern`))
  } else if (creation.kind === 'exercise') {
    container.append(chatElement('p', '', 'Complete the request: I would like another cup of tea.'))
    const sentence = chatElement('p', 'creation-sentence', '\u6211\u60f3 ____ \u559d\u4e00\u676f\u8336\u3002')
    sentence.lang = 'zh-Hans'
    container.append(sentence)
    if (practice) {
      const answer = chatElement('p', 'import-notice', '\u518d / again. Put \u518d before \u559d to ask for another cup. This is an answer reveal, not a scored assessment.')
      answer.hidden = !creation.answerShown
      const reveal = chatElement('button', 'button secondary', creation.answerShown ? 'Hide answer' : 'Reveal sample answer')
      reveal.type = 'button'
      reveal.setAttribute('aria-expanded', String(creation.answerShown))
      reveal.addEventListener('click', () => {
        creation.answerShown = !creation.answerShown
        answer.hidden = !creation.answerShown
        reveal.textContent = creation.answerShown ? 'Hide answer' : 'Reveal sample answer'
        reveal.setAttribute('aria-expanded', String(creation.answerShown))
      })
      container.append(reveal, answer)
    } else container.append(chatElement('p', 'small muted', 'One authored practice prompt. Save it to Exercises to try the answer reveal.'))
  } else {
    container.append(chatElement('p', '', 'Content brief: use tea-house words and short requests to practice asking for something again.'),
      chatElement('p', 'import-notice', 'Level content preview only. Game type, rules, engine, scoring, and progression are intentionally unspecified. This is not a playable level.'))
  }
}
function renderCreationCard(id) {
  const creation = assistantCreations.get(id)
  const card = chatElement('section', 'creation-card')
  card.dataset.creationId = id
  card.append(chatElement('span', 'tag lavender', `${assistantTaskTypes[creation.kind].destination} / ${creation.status === 'saved' ? 'Added' : creation.status === 'discarded' ? 'Discarded' : 'Preview'}`),
    chatElement('h3', '', creation.title))
  if (creation.status !== 'discarded') {
    renderCreationMaterial(card, creation)
    const origin = chatElement('div', '')
    renderCreationProvenance(origin, id)
    card.append(origin)
  }
  const actions = chatElement('div', 'creation-actions')
  if (creation.status === 'preview') {
    const save = chatElement('button', 'button primary', `Add to ${assistantTaskTypes[creation.kind].destination.split(' / ').pop()}`)
    save.type = 'button'
    save.dataset.saveCreation = id
    save.addEventListener('click', () => {
      saveAssistantCreation(creation)
      const updated = renderCreationCard(id)
      card.replaceWith(updated)
      updated.querySelector('[data-open-creation]').focus({ preventScroll: true })
    })
    const discard = chatElement('button', 'button quiet', 'Discard preview')
    discard.type = 'button'
    discard.dataset.discardCreation = id
    discard.addEventListener('click', () => {
      creation.status = 'discarded'
      card.replaceWith(renderCreationCard(id))
      notify('Preview discarded. No collection was changed.')
      one('#chat-input').focus({ preventScroll: true })
    })
    actions.append(save, discard)
  } else if (creation.status === 'saved') {
    const open = chatElement('button', 'button secondary', `Open in ${assistantTaskTypes[creation.kind].destination}`)
    open.type = 'button'
    open.dataset.openCreation = id
    open.addEventListener('click', () => openAssistantCreation(creation))
    actions.append(open)
  } else card.append(chatElement('p', 'small muted', 'Nothing was added. You can ask for another preview.'))
  card.append(actions)
  return card
}
function saveAssistantCreation(creation) {
  if (creation.status !== 'preview') {
    notify('This preview has already been added or discarded.')
    return
  }
  if (creation.kind === 'story') {
    const document = addLibraryDocument({ title: creation.title, origin: 'assistant', creationId: creation.id,
      parts: [{ reference: 'Authored story preview', format: 'text', files: [], simulated: false, text: creationStory }] })
    creation.savedId = document.id
    renderImportedLibrary()
  } else if (creation.kind === 'lesson') {
    creation.savedId = `lesson-${creation.id}`
    const lesson = creation.readingRequest ? readingPreparationLesson(creation.readingRequest) : lessonPreviews.request
    addLessonPreview(creation.savedId, { ...lesson, title: creation.title, source: false, conversation: creation.threadId, creationId: creation.id },
      creation.readingRequest ? 'READING PREPARATION / REQUEST' : 'CREATED WITH ASSISTANT / SAMPLE',
      creation.readingRequest ? `${creation.readingRequest.language} / ${creation.readingRequest.scopeLabel}` : 'Familiar vocabulary with a new request pattern.')
  }
  creation.status = 'saved'
  if (creation.kind === 'exercise' || creation.kind === 'game') renderCreatedPractice()
  notify(`Added to ${assistantTaskTypes[creation.kind].destination}. This preview lasts until reload.`)
}
function renderCreatedPractice() {
  for (const kind of ['exercise', 'game']) {
    const list = one(`#created-${kind}-list`)
    list.replaceChildren()
    for (const creation of assistantCreations.values()) {
      if (creation.kind !== kind || creation.status !== 'saved') continue
      const details = chatElement('details', 'created-practice-item')
      details.dataset.practiceCreation = creation.id
      details.open = creation.detailOpen
      details.append(chatElement('summary', '', creation.title))
      const content = chatElement('div', 'created-practice-content')
      renderCreationMaterial(content, creation, true)
      const origin = chatElement('div', '')
      renderCreationProvenance(origin, creation.id)
      content.append(origin)
      details.append(content)
      details.addEventListener('toggle', () => { creation.detailOpen = details.open })
      list.append(details)
    }
    one(kind === 'exercise' ? '#created-exercises' : '#created-games').hidden = list.children.length === 0
  }
}
function openAssistantCreation(creation) {
  const target = { story: 'library', lesson: 'lessons', exercise: 'practice', game: 'games' }[creation.kind]
  const open = () => {
    if (creation.kind === 'story') showImportedDocument(creation.savedId)
    else if (creation.kind === 'lesson') showLesson(creation.savedId)
    else {
      const item = one(`[data-practice-creation="${creation.id}"]`)
      item.open = true
      item.scrollIntoView({ block: 'start' })
      item.querySelector('summary').focus({ preventScroll: true })
    }
  }
  if (location.hash === `#${target}`) open()
  else {
    window.addEventListener('hashchange', () => requestAnimationFrame(() => {
      if (location.hash === `#${target}`) open()
    }), { once: true })
    location.hash = target
  }
}
