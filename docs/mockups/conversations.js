// Each conversation has one continuous transcript and its own memory-only draft.
const teaPhrase = {
  native: '\u6211\u60f3\u518d\u559d\u4e00\u676f\u8336\u3002',
  romanization: 'W\u01d2 xi\u01ceng z\u00e0i h\u0113 y\u00ec b\u0113i ch\u00e1.',
  meaning: 'I would like another cup of tea.',
  explanation: '\u518d means "again" and comes before the verb. Here, \u518d\u559d\u4e00\u676f means to drink another cup. You are building on the request pattern \u6211\u60f3... from earlier in this conversation.',
}
const weekendPhrase = {
  native: '\u6211\u660e\u5929\u60f3\u53bb\u516c\u56ed\u3002',
  romanization: 'W\u01d2 m\u00edngti\u0101n xi\u01ceng q\u00f9 g\u014dngyu\u00e1n.',
  meaning: 'I would like to go to the park tomorrow.',
  explanation: '\u660e\u5929 means "tomorrow." Time expressions commonly go before the main verb. \u60f3\u53bb means "would like to go."',
}
const trainPhrase = {
  native: '\u8f66\u7ad9\u5728\u54ea\u91cc\uff1f',
  romanization: 'Ch\u0113zh\u00e0n z\u00e0i n\u01celi?',
  meaning: 'Where is the station?',
  explanation: '\u8f66\u7ad9 is "station." \u5728\u54ea\u91cc asks where something is located. You can reuse this pattern with other places.',
}
const shadowSamples = [
  {
    id: 'tea', input: "I'd like another cup of tea.",
    phrase: { ...teaPhrase, explanation: '\u6211\u60f3 introduces what you would like to do. \u518d goes before \u559d ("drink") to express doing it again. \u4e00\u676f\u8336 is "a cup of tea"; \u676f is the measure word. Together, you are asking for another cup, not just describing the tea.' },
    briefExplanation: '\u518d adds "again." Here, \u518d\u559d\u4e00\u676f means to have another cup.',
  },
  { id: 'plans', input: weekendPhrase.meaning, phrase: weekendPhrase, briefExplanation: '\u660e\u5929 sets the time: tomorrow. \u60f3\u53bb means "would like to go."' },
  { id: 'station', input: trainPhrase.meaning, phrase: trainPhrase, briefExplanation: '\u8f66\u7ad9 is the station. \u5728\u54ea\u91cc asks where it is.' },
]
const tutorMessage = (text, phrase, details = {}) => ({ from: 'tutor', text, phrase, ...details })
const userMessage = (text, details = {}) => ({ from: 'user', text, ...details })
const recapItem = (native, romanization, meaning, activity) => ({ native, romanization, meaning, activity })
function createConversation(values) {
  return { draft: '', voiceStage: 'idle', dictationSample: values.phrase.meaning, mode: 'conversation', shadowIntent: 'shadow', shadowTarget: null, shadowNeedsSample: true, creationKind: null, creationContext: '', creationSuppressed: false, ...values }
}
const conversations = [
  {
    id: 'tea', title: 'A moment at the tea house', kind: 'Reading companion', preview: 'Asking for another cup, a little more naturally.', phrase: teaPhrase, updated: 'Today',
    messages: [
      tutorMessage('Let\'s use your tea house story as a starting point. How would you ask for a cup of tea?'),
      userMessage('I know tea is \u8336. How do I say "I would like"?'),
      tutorMessage('Use \u6211\u60f3... to say "I would like..." or "I want..." \u6211\u60f3\u559d\u4e00\u676f\u8336\u3002 means "I would like to drink a cup of tea."'),
      userMessage('\u6211\u60f3\u559d\u4e00\u676f\u8336\u3002'),
      tutorMessage('That puts the whole request together. You can build on the same pattern to ask for another cup.'),
      userMessage('How would I ask for another cup?'),
      tutorMessage('Keep the words you already know and add \u518d, meaning "again." Try saying the whole request.', teaPhrase),
    ],
    recap: { items: [recapItem('\u8336', 'ch\u00e1', 'tea', 'Practiced'), recapItem('\u676f', 'b\u0113i', 'cup / measure word', 'Practiced'), recapItem('\u60f3', 'xi\u01ceng', 'would like', 'Introduced'), recapItem('\u518d', 'z\u00e0i', 'again', 'Introduced')], pattern: '\u6211\u60f3 + action makes a request. Add \u518d before the action to do it again.', next: 'Try the request without an English prompt.' },
  },
  {
    id: 'weekend', title: 'What are your weekend plans?', kind: 'Free conversation', preview: 'Talking about tomorrow and places to go.', phrase: weekendPhrase, updated: 'Yesterday',
    messages: [
      tutorMessage('Tell me about somewhere you like to spend time. English is welcome while we find the Mandarin words.'),
      userMessage('I like walking in the park.'),
      tutorMessage('\u516c\u56ed means "park." We can start with that and build a sentence around something you actually do. What would you like to do tomorrow?'),
      userMessage('Go to the park, if it does not rain.'),
      tutorMessage('Let\'s start with the plan itself. We can add the weather condition when you are ready.', weekendPhrase),
    ],
    recap: { items: [recapItem('\u660e\u5929', 'm\u00edngti\u0101n', 'tomorrow', 'Introduced'), recapItem('\u516c\u56ed', 'g\u014dngyu\u00e1n', 'park', 'Practiced')], pattern: 'Put a time expression before the action.', next: 'Add a simple condition about the weather.' },
  },
  {
    id: 'grammar', title: 'When do I use \u60f3?', kind: 'Grammar clinic', preview: 'A question turned into a reusable pattern.', phrase: teaPhrase, updated: 'Monday',
    messages: [
      userMessage('Does \u60f3 always mean "want"?'),
      tutorMessage('Not always. It can express wanting to do something, thinking, or missing someone, depending on context. In \u6211\u60f3\u559d\u8336, it expresses wanting to drink tea.'),
      userMessage('So I should learn it in a sentence, not as one English word.'),
      tutorMessage('Exactly. A useful first pattern is \u60f3 + an action. We can explore the other meanings when you encounter them.'),
    ],
    recap: { items: [recapItem('\u60f3', 'xi\u01ceng', 'would like / think', 'Explored in context')], pattern: '\u60f3 + action: express an intention or wish.', next: 'Collect a different use from your next reading.' },
  },
  {
    id: 'station', title: 'Finding the train station', kind: 'Everyday roleplay', preview: 'A short exchange about finding your way.', phrase: trainPhrase, updated: 'Sunday',
    messages: [
      tutorMessage('Imagine you are asking someone for directions to the station.'),
      userMessage('How do I ask where it is?'),
      tutorMessage('Start with the place, then ask where it is.', trainPhrase),
    ],
    recap: { items: [recapItem('\u8f66\u7ad9', 'ch\u0113zh\u00e0n', 'station', 'Introduced'), recapItem('\u54ea\u91cc', 'n\u01celi', 'where', 'Practiced')], pattern: 'Place + \u5728\u54ea\u91cc: ask for a location.', next: 'Practice understanding a short answer.' },
  },
].map(createConversation)
let selectedConversationId = 'tea'
let nextConversationId = 1
let openThreadOnNextRoute = false
const assistantPreferences = { romanization: true, speechSpeed: '0.75' }
let voiceModeStep = 'listening'
let voiceModePaused = false
let voiceModePreview = null
const currentConversation = () => conversations.find((thread) => thread.id === selectedConversationId)
function chatElement(tag, className, text) {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}
function conversationScroller() {
  return one(document.body.dataset.compactChat === 'true' ? '#conversation-history' : '#conversation-scroll')
}
function nameConversation(thread, text) {
  if (!thread.needsTitle) return
  const characters = Array.from(text.trim().replace(/\s+/g, ' '))
  thread.title = characters.length > 60 ? `${characters.slice(0, 57).join('')}...` : characters.join('')
  thread.needsTitle = false
  one('#thread-title').textContent = thread.title
  one('#thread-title').title = thread.title
}
function scrollConversationToEnd() {
  const scroller = conversationScroller()
  scroller.scrollTop = scroller.scrollHeight
}
function focusThread() {
  document.body.dataset.assistantView = 'thread'
  one('#main').scrollTop = 0
  scrollConversationToEnd()
  one('#thread-title').focus({ preventScroll: true })
}
function stopSimulatedTurn() {
  const thread = currentConversation()
  if (thread.voiceStage !== 'recording') return
  thread.voiceStage = 'review'
  thread.draft = thread.dictationSample
  notify('The demo voice turn was stopped. Its sample transcript stays with this conversation for review.')
}
function selectConversation(id) {
  closeAssistantSettings()
  endVoiceMode()
  stopSimulatedTurn()
  selectedConversationId = id
  renderConversation()
  focusThread()
}
function renderConversationList() {
  const query = one('#conversation-search').value.trim().toLowerCase()
  const list = one('#conversation-list')
  list.replaceChildren()
  one('#thread-count').textContent = String(conversations.length)
  conversations.forEach((thread) => {
    if (!`${thread.title} ${thread.kind} ${thread.preview} ${thread.mode}`.toLowerCase().includes(query)) return
    const button = chatElement('button', 'conversation-list-item')
    button.dataset.conversationId = thread.id
    button.setAttribute('aria-pressed', String(thread.id === selectedConversationId))
    const title = chatElement('strong', '', thread.title)
    const kind = chatElement('span', 'thread-kind', thread.mode === 'shadow' ? `${thread.kind} / Shadow` : thread.kind)
    const preview = chatElement('span', 'thread-preview', thread.preview)
    const metadata = chatElement('span', 'thread-metadata')
    const replies = thread.messages.filter((message) => message.from === 'user').length
    metadata.append(chatElement('span', '', replies ? `${replies} ${replies === 1 ? 'reply' : 'replies'}` : 'New conversation'), chatElement('span', thread.draft ? 'thread-draft' : '', thread.draft ? 'Draft' : thread.updated))
    button.append(kind, title, preview, metadata)
    button.addEventListener('click', () => selectConversation(thread.id))
    list.append(button)
  })
  one('#conversation-empty').hidden = list.children.length !== 0
}
function renderTranscript(scrollToEnd = false) {
  const actions = one('#assistant-message-actions')
  if (actions.matches(':popover-open')) actions.hidePopover()
  const thread = currentConversation()
  const log = one('#chat-messages')
  log.replaceChildren()
  thread.messages.forEach((entry) => {
    if (entry.from === 'mode') {
      log.append(chatElement('div', 'mode-change', entry.text))
      return
    }
    const message = chatElement('div', `message ${entry.from}-message`)
    if (entry.intent) message.dataset.intent = entry.intent
    if (entry.mode) message.dataset.mode = entry.mode
    const label = entry.from === 'user' ? 'YOU' : 'ASSISTANT / SCRIPTED DEMO'
    message.append(chatElement('span', 'message-label', entry.mode === 'shadow' ? `${label} / ${entry.intent.toUpperCase()}` : label), chatElement('p', '', entry.text))
    setTargetSnippetActions(message.lastElementChild, { source: `${thread.title} / ${entry.from === 'user' ? 'Your message' : 'Assistant reply'}` })
    if (entry.phrase) {
      message.append(renderChatPhrase(entry.phrase))
      if (entry.briefExplanation) {
        message.append(chatElement('p', 'small muted', entry.briefExplanation))
        setTargetSnippetActions(message.lastElementChild, { source: `${thread.title} / Shadow explanation` })
      }
      if (entry.mode === 'shadow') {
        if (entry.intent === 'shadow') message.append(renderShadowActions(entry))
      } else if (entry.phrase.explanation) {
        const explain = chatElement('button', 'text-link explain-phrase', entry.explained ? 'Explanation added below' : 'Explain this pattern')
        explain.disabled = Boolean(entry.explained)
        explain.addEventListener('click', () => {
          entry.explained = true
          thread.messages.push(tutorMessage(entry.phrase.explanation))
          thread.updated = 'Just now'
          renderTranscript(true)
          renderConversationList()
          one('#chat-input').focus({ preventScroll: true })
        })
        message.append(explain)
      }
    }
    if (entry.creationId) message.append(renderCreationCard(entry.creationId))
    if (entry.lookupWordIds) entry.lookupWordIds.forEach((id) => message.append(renderLookupCard(id, thread.id)))
    if (entry.from === 'tutor') message.append(renderMessageActions(entry, thread))
    log.append(message)
  })
  const scroller = conversationScroller()
  scroller.scrollTop = scrollToEnd ? scroller.scrollHeight : 0
}
function renderChatPhrase(phrase) {
  const block = chatElement('div', 'chat-phrase')
  const native = chatElement('p', '', phrase.native)
  native.lang = phrase.nativeLanguage || 'zh-Hans'
  const romanization = chatElement('span', 'phrase-romanization', phrase.romanization)
  romanization.hidden = !assistantPreferences.romanization
  block.append(native, romanization, chatElement('p', 'small muted', phrase.meaning))
  setSnippetActions(native, { meaning: phrase.meaning, romanization: phrase.romanization, source: `${currentConversation().title} / Assistant phrase` })
  return block
}
function shadowReflection(sample) {
  return tutorMessage('A natural way to say that in Mandarin:', sample.phrase, {
    mode: 'shadow', intent: 'shadow', briefExplanation: sample.briefExplanation,
  })
}
function shadowSampleForThread() {
  return shadowSamples.find((sample) => sample.phrase.native === currentConversation().phrase.native) || shadowSamples[0]
}
function matchShadowSample(text) {
  const normalize = (value) => value.normalize('NFKC').trim().toLowerCase().replace(/\u2019/g, "'").replace(/[.!?\u3002\uff01\uff1f]+$/u, '')
  return shadowSamples.find((sample) => [sample.input, sample.phrase.meaning, sample.phrase.native].some((value) => normalize(value) === normalize(text)))
}
function renderShadowActions(entry) {
  const thread = currentConversation()
  const actions = chatElement('div', 'shadow-actions')
  const addAction = (intent, label, handler) => {
    const button = chatElement('button', 'button secondary', label)
    button.type = 'button'
    button.dataset.shadowAction = intent
    button.disabled = thread.mode !== 'shadow' || (intent === 'explain' && Boolean(entry.explained))
    if (thread.mode !== 'shadow') button.title = 'Switch to Shadow mode to use this action.'
    button.addEventListener('click', handler)
    actions.append(button)
  }
  addAction('repeat', 'Repeat after me', () => {
    thread.shadowIntent = 'repeat'
    thread.shadowTarget = entry
    resetVoicePreviewTurn()
    renderAssistantMode()
    scrollConversationToEnd()
    one('#chat-input').focus({ preventScroll: true })
  })
  addAction('explain', entry.explained ? 'Explanation added' : 'Explain more', () => {
    entry.explained = true
    thread.shadowIntent = 'shadow'
    thread.shadowTarget = entry
    thread.shadowNeedsSample = false
    const request = `Explain more about "${entry.phrase.meaning}"`
    nameConversation(thread, request)
    thread.messages.push(
      userMessage(request, { mode: 'shadow', intent: 'explain' }),
      tutorMessage(entry.phrase.explanation, undefined, { mode: 'shadow', intent: 'explain' }),
    )
    thread.updated = 'Just now'
    renderTranscript(true)
    renderRecap()
    renderConversationList()
    renderAssistantMode()
    if (!one('#voice-mode-panel').hidden) renderVoiceMode()
    scrollConversationToEnd()
  })
  addAction('new', 'Say something else', showShadowSamples)
  return actions
}
function renderAssistantMode() {
  const thread = currentConversation()
  const shadow = thread.mode === 'shadow'
  const repeat = shadow && thread.shadowIntent === 'repeat'
  const task = thread.creationKind && assistantTaskTypes[thread.creationKind]
  const snippet = thread.snippetRequest
  one('#creation-intent').hidden = !task && !snippet
  one('#creation-intent-label').textContent = snippet ? `Text context / ${snippet.text.slice(0, 70)}` : task ? `${task.label} / ${task.destination}` : ''
  one('#cancel-creation-intent').textContent = snippet ? 'Remove context' : 'Cancel task'
  one('#assistant-mode').value = thread.mode
  one('#shadow-intent').hidden = !shadow || Boolean(task || snippet)
  one('#shadow-intent-label').textContent = repeat ? 'Shadow / Repeating' : 'Shadow / New phrase'
  one('#shadow-new').textContent = repeat ? 'New phrase' : 'Samples'
  one('#chat-input').placeholder = task ? 'Describe your request, then send' : repeat ? 'Repeat the phrase, or type it here' : shadow ? 'Say something to shadow' : 'Message the Assistant'
  const coach = one('#shadow-coach')
  coach.replaceChildren()
  coach.hidden = Boolean(task || snippet) || !shadow || !one('#voice-mode-caption').hidden || (!repeat && !thread.shadowNeedsSample)
  if (coach.hidden) return
  if (repeat) {
    coach.append(chatElement('h3', '', 'Repeat after the model / demo'), renderChatPhrase(thread.shadowTarget.phrase),
      chatElement('p', '', 'Use Hear to listen locally, then say the Mandarin phrase or type it below. Dictation previews a repetition; pronunciation is not assessed.'))
  } else {
    coach.append(chatElement('h3', '', 'Your meaning, reflected in Mandarin.'),
      chatElement('p', '', 'Say something, then explore its meaning or repeat it. This offline demo supports these three sample phrases; choosing one fills your draft without sending it.'))
    const samples = chatElement('div', 'shadow-samples')
    shadowSamples.forEach((sample) => {
      const button = chatElement('button', 'button secondary', sample.input)
      button.type = 'button'
      button.dataset.shadowSample = sample.id
      button.disabled = thread.voiceStage === 'recording'
      button.addEventListener('click', () => {
        if (thread.draft.trim()) {
          notify('Send or clear your current draft before choosing a sample. Your draft has not changed.')
          return
        }
        thread.draft = sample.input
        thread.voiceStage = 'idle'
        renderVoiceTurn()
        renderConversationList()
        one('#chat-input').focus({ preventScroll: true })
      })
      samples.append(button)
    })
    coach.append(samples)
  }
}
function resetVoicePreviewTurn() {
  voiceModeStep = 'listening'
  voiceModePreview = null
  if (!one('#voice-mode-panel').hidden) renderVoiceMode()
}
function showShadowSamples() {
  const thread = currentConversation()
  thread.shadowIntent = 'shadow'
  thread.shadowTarget = null
  thread.shadowNeedsSample = true
  resetVoicePreviewTurn()
  renderAssistantMode()
  scrollConversationToEnd()
  one('#chat-input').focus({ preventScroll: true })
}
one('#shadow-new').addEventListener('click', showShadowSamples)
one('#cancel-creation-intent').addEventListener('click', () => {
  const thread = currentConversation()
  thread.creationKind = null
  thread.creationContext = ''
  thread.readingRequest = null
  thread.snippetRequest = null
  thread.creationSuppressed = true
  renderAssistantMode()
  notify('Task canceled. Your draft is kept as a normal chat turn.')
  one('#chat-input').focus({ preventScroll: true })
})
one('#assistant-mode').addEventListener('change', (event) => {
  const thread = currentConversation()
  thread.mode = event.target.value
  thread.shadowIntent = 'shadow'
  thread.updated = 'Just now'
  thread.messages.push({ from: 'mode', mode: thread.mode, text: thread.mode === 'shadow' ? 'Shadow mode on / Applies to your next turn' : 'Conversation mode on / Applies to your next turn' })
  renderTranscript(true)
  renderConversationList()
  renderAssistantMode()
  if (!one('#voice-mode-panel').hidden) renderVoiceMode()
  scrollConversationToEnd()
})
function renderRecap() {
  const thread = currentConversation()
  const content = one('#conversation-recap-content')
  content.replaceChildren()
  const replies = thread.messages.filter((message) => message.from === 'user').length
  one('#recap-count').textContent = `${thread.recap.items.length} learning items`
  if (thread.recap.items.length) {
    const items = chatElement('div', 'recap-items')
    thread.recap.items.forEach((item) => {
      const card = chatElement('div', 'recap-item')
      const native = chatElement('strong', '', item.native)
      native.lang = 'zh-Hans'
      const romanization = chatElement('span', 'recap-romanization', item.romanization)
      romanization.hidden = !assistantPreferences.romanization
      card.append(chatElement('span', 'tag green', item.activity), native, romanization, chatElement('span', 'recap-meaning', item.meaning))
      setSnippetActions(native, { meaning: item.meaning, romanization: item.romanization, source: `${thread.title} / Practice recap` })
      items.append(card)
    })
    content.append(items)
    const pattern = chatElement('div', 'recap-pattern')
    pattern.append(chatElement('span', 'eyebrow', 'A PATTERN TO TAKE WITH YOU'), chatElement('p', '', thread.recap.pattern))
    setTargetSnippetActions(pattern.lastElementChild, { source: `${thread.title} / Recap pattern` })
    const next = chatElement('p', 'recap-next', `Try next: ${thread.recap.next}`)
    content.append(pattern, next, chatElement('p', 'small muted', 'Illustrative recap from the sample transcript, not a mastery assessment.'))
  } else {
    content.append(chatElement('h3', '', 'Your next little breakthrough starts here.'))
    content.append(chatElement('p', 'small muted', `You have sent ${replies} ${replies === 1 ? 'reply' : 'replies'} in this conversation. In a connected app, this recap would show the vocabulary and patterns you worked on. The mockup does not infer learning from scripted replies.`))
  }
}
function renderComposerAction() {
  const thread = currentConversation()
  const hasText = Boolean(thread.draft.trim())
  const voiceActive = !one('#voice-mode-panel').hidden
  const button = one('#composer-action')
  const label = hasText ? 'Send message' : voiceActive ? 'End voice mode' : 'Start voice mode (demo)'
  button.dataset.action = hasText ? 'send' : 'voice'
  button.title = label
  button.setAttribute('aria-label', label)
  button.disabled = thread.voiceStage === 'recording'
  one('#composer-action use').setAttribute('href', hasText ? '#i-send' : '#i-wave')
  if (hasText) {
    button.removeAttribute('aria-pressed')
    button.removeAttribute('aria-controls')
  } else {
    button.setAttribute('aria-pressed', String(voiceActive))
    button.setAttribute('aria-controls', 'voice-mode-panel')
  }
}
function renderVoiceTurn() {
  const thread = currentConversation()
  const recording = thread.voiceStage === 'recording'
  const review = thread.voiceStage === 'review'
  one('#recording-preview').hidden = thread.voiceStage === 'idle'
  one('#recording-status').textContent = recording ? 'SIMULATED RECORDING / NO MICROPHONE' : 'REVIEW BEFORE SENDING'
  one('#recording-help').textContent = recording ? 'No microphone is active. Stop to preview transcript review.' : 'Edit the sample transcript, then explicitly send. No audio was captured.'
  const dictationLabel = recording ? 'Stop dictation demo' : review ? 'Discard dictation draft' : 'Dictate a message (demo)'
  one('#record-demo').title = dictationLabel
  one('#record-demo').setAttribute('aria-label', dictationLabel)
  one('#record-demo').setAttribute('aria-pressed', String(recording))
  one('#record-demo use').setAttribute('href', recording ? '#i-stop' : review ? '#i-close' : '#i-mic')
  one('#chat-input').value = thread.draft
  one('#chat-input').disabled = recording
  one('#chat-input-label').textContent = review ? 'Review and edit the sample transcript' : 'Your turn'
  renderComposerAction()
}
function renderConversation() {
  const thread = currentConversation()
  one('#thread-title').textContent = thread.title
  one('#thread-title').title = thread.title
  one('#thread-subtitle').textContent = `${thread.kind} / Beginner Mandarin`
  renderConversationList()
  renderTranscript(true)
  renderRecap()
  one('#conversation-recap').open = false
  renderVoiceTurn()
  renderAssistantMode()
  scrollConversationToEnd()
}
one('#conversation-search').addEventListener('input', renderConversationList)
function showConversationList(moveFocus = false) {
  closeAssistantSettings()
  endVoiceMode()
  stopSimulatedTurn()
  renderConversationList()
  document.body.dataset.assistantView = 'list'
  one('#main').scrollTop = 0
  if (moveFocus) {
    one('#conversation-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
}
one('#back-to-conversations').addEventListener('click', () => showConversationList(true))
one('[data-nav="conversation"]').addEventListener('click', () => {
  openThreadOnNextRoute = false
  if (mobileLayout.matches) showConversationList(true)
})
one('#chat-input').addEventListener('input', (event) => {
  currentConversation().draft = event.target.value
  currentConversation().creationSuppressed = false
  renderComposerAction()
  renderConversationList()
})
one('#record-demo').addEventListener('click', () => {
  const thread = currentConversation()
  if (thread.voiceStage === 'idle') {
    if (thread.draft.trim()) {
      notify('Send or clear your typed draft before starting dictation.')
      return
    }
    endVoiceMode()
    thread.dictationSample = thread.creationKind ? assistantTaskTypes[thread.creationKind].request
      : thread.mode === 'shadow' && thread.shadowIntent === 'repeat' ? thread.shadowTarget.phrase.native : thread.phrase.meaning
    thread.voiceStage = 'recording'
  } else if (thread.voiceStage === 'recording') {
    thread.voiceStage = 'review'
    thread.draft = thread.dictationSample
  } else {
    thread.voiceStage = 'idle'
    thread.draft = ''
  }
  renderVoiceTurn()
  renderAssistantMode()
  renderConversationList()
  if (thread.voiceStage === 'review') one('#chat-input').focus()
})
one('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const thread = currentConversation()
  if (thread.voiceStage === 'recording') {
    notify('Stop the dictation demo and review its transcript before sending.')
    return
  }
  const text = thread.draft.trim()
  if (!text) {
    notify('Write a reply, or try a demo voice turn first.')
    one('#chat-input').focus()
    return
  }
  const snippet = thread.snippetRequest
  const task = snippet ? null : resolveAssistantTask(thread, text)
  const intent = snippet ? 'explain' : task ? 'create' : thread.mode === 'shadow' ? thread.shadowIntent : 'conversation'
  nameConversation(thread, text)
  thread.messages.push(userMessage(text, { mode: thread.mode, intent }))
  if (snippet) {
    thread.messages.push(tutorMessage(snippet.meaning
      ? 'Here is the sample meaning supplied with your snippet. Further explanation and pronunciation feedback need a connected assistant.'
      : 'Your selected text and source are kept with this request. This scripted preview cannot generate a new explanation.',
    { native: snippet.text, nativeLanguage: snippet.lang, romanization: snippet.romanization, meaning: snippet.meaning }))
  } else if (task) {
    addAssistantTaskReply(thread, task, text)
  } else if (thread.mode !== 'shadow') {
    thread.messages.push(tutorMessage('In a connected app, I would respond to what you said. For this preview, here is a sample pattern to try.', thread.phrase))
  } else if (intent === 'repeat') {
    thread.messages.push(tutorMessage('Your repetition is a practice turn, not a new phrase to shadow. This preview does not capture audio or assess pronunciation.', undefined, { mode: 'shadow', intent: 'repeat' }))
    thread.shadowIntent = 'shadow'
    thread.shadowNeedsSample = false
  } else {
    const sample = matchShadowSample(text)
    if (sample) {
      const reflection = shadowReflection(sample)
      thread.messages.push(reflection)
      thread.shadowTarget = reflection
      thread.shadowNeedsSample = false
    } else {
      thread.messages.push(tutorMessage('This offline preview cannot translate arbitrary text or speech. Your message is kept above; choose a sample phrase below to explore Shadow mode.', undefined, { mode: 'shadow', intent: 'shadow' }))
      thread.shadowTarget = null
      thread.shadowNeedsSample = true
    }
  }
  thread.draft = ''
  thread.creationKind = null
  thread.creationContext = ''
  thread.readingRequest = null
  thread.snippetRequest = null
  thread.creationSuppressed = false
  thread.voiceStage = 'idle'
  thread.updated = 'Just now'
  renderTranscript(true)
  renderRecap()
  renderVoiceTurn()
  renderAssistantMode()
  if (!one('#voice-mode-panel').hidden) renderVoiceMode()
  renderConversationList()
  scrollConversationToEnd()
  one('#chat-input').focus()
})
one('#show-romanization').addEventListener('click', () => {
  assistantPreferences.romanization = !assistantPreferences.romanization
  one('#show-romanization').setAttribute('aria-pressed', String(assistantPreferences.romanization))
  one('#romanization-setting-state').textContent = assistantPreferences.romanization ? 'On' : 'Off'
  all('.phrase-romanization, .recap-romanization').forEach((item) => { item.hidden = !assistantPreferences.romanization })
})
one('#target-speech-speed').addEventListener('change', (event) => {
  assistantPreferences.speechSpeed = event.target.value
  if (!one('#voice-mode-panel').hidden) renderVoiceMode()
  else notify(`Hear uses ${event.target.value}x for Mandarin. English stays at 1x. An installed local voice is required.`)
})
function renderVoiceMode() {
  const thread = currentConversation()
  const phrase = voiceModePreview?.phrase || thread.phrase
  const responding = voiceModeStep === 'responding'
  const shadowReply = responding && voiceModePreview.mode === 'shadow'
  const repeating = thread.mode === 'shadow' && thread.shadowIntent === 'repeat'
  one('#voice-mode-panel').dataset.paused = String(voiceModePaused)
  one('#voice-mode-status').textContent = voiceModePaused ? 'Voice mode paused' : responding ? (shadowReply ? 'Shadow model / demo' : 'Assistant speaking / demo') : repeating ? 'Your repeat / demo' : thread.mode === 'shadow' ? 'Say something to shadow / demo' : 'Your turn / demo'
  one('#voice-mode-state-help').textContent = voiceModePaused ? 'No microphone active.' : responding ? `Mandarin ${assistantPreferences.speechSpeed}x / English 1x. Demo only.` : 'Hands-free preview. No microphone active.'
  one('#voice-mode-caption').hidden = !responding
  one('#voice-mode-native').textContent = phrase.native
  setSnippetActions(one('#voice-mode-native'), { meaning: phrase.meaning, romanization: phrase.romanization, source: 'Assistant / Voice mode sample caption' })
  one('#voice-mode-romanization').textContent = phrase.romanization
  one('#voice-mode-romanization').hidden = !assistantPreferences.romanization
  one('#voice-mode-meaning').textContent = phrase.meaning
  one('#voice-mode-caption-label').textContent = shadowReply ? 'SHADOW / SAMPLE MODEL' : 'VOICE MODE / SAMPLE RESPONSE'
  one('#voice-mode-explanation').hidden = !shadowReply
  one('#voice-mode-explanation').textContent = shadowReply ? voiceModePreview.briefExplanation || 'Use Hear to listen locally, then repeat. Pronunciation assessment is not connected.' : ''
  setTargetSnippetActions(one('#voice-mode-explanation'), { source: 'Assistant / Voice mode explanation' })
  one('#voice-mode-followups').replaceChildren()
  if (shadowReply && voiceModePreview.intent === 'shadow') one('#voice-mode-followups').append(renderShadowActions(voiceModePreview))
  one('#voice-mode-next').firstChild.textContent = responding ? 'Next turn ' : 'Preview reply '
  one('#voice-mode-next').disabled = voiceModePaused
  one('#voice-mode-pause').setAttribute('aria-pressed', String(voiceModePaused))
  one('#voice-mode-pause span').textContent = voiceModePaused ? 'Resume' : 'Pause'
  renderAssistantMode()
}
function endVoiceMode(restoreFocus = false) {
  one('#voice-mode-panel').hidden = true
  one('#voice-mode-caption').hidden = true
  voiceModePreview = null
  voiceModeStep = 'listening'
  renderComposerAction()
  renderAssistantMode()
  if (restoreFocus) one('#composer-action').focus({ preventScroll: true })
}
one('#composer-action').addEventListener('click', () => {
  if (currentConversation().draft.trim()) {
    one('#chat-form').requestSubmit()
    return
  }
  if (!one('#voice-mode-panel').hidden) {
    endVoiceMode()
    return
  }
  stopSimulatedTurn()
  renderVoiceTurn()
  voiceModeStep = 'listening'
  voiceModePreview = null
  voiceModePaused = false
  renderVoiceMode()
  one('#voice-mode-panel').hidden = false
  renderComposerAction()
  scrollConversationToEnd()
})
one('#voice-mode-end').addEventListener('click', () => endVoiceMode(true))
one('#voice-mode-next').addEventListener('click', () => {
  if (voiceModeStep === 'listening') {
    const thread = currentConversation()
    voiceModePreview = thread.mode !== 'shadow' ? tutorMessage('', thread.phrase)
      : thread.shadowIntent === 'repeat' ? tutorMessage('', thread.shadowTarget.phrase, { mode: 'shadow', intent: 'repeat' })
        : shadowReflection(shadowSampleForThread())
  } else voiceModePreview = null
  voiceModeStep = voiceModeStep === 'listening' ? 'responding' : 'listening'
  renderVoiceMode()
  scrollConversationToEnd()
})
one('#voice-mode-pause').addEventListener('click', () => {
  voiceModePaused = !voiceModePaused
  renderVoiceMode()
})
function beginConversation(kind = 'Free conversation') {
  closeAssistantSettings()
  endVoiceMode()
  stopSimulatedTurn()
  const id = `new-${nextConversationId++}`
  const thread = createConversation({
    id, title: 'New conversation', needsTitle: true, kind,
    preview: 'A new starting point for your learning.', phrase: teaPhrase, updated: 'Just now',
    messages: [
      tutorMessage('Ask a question, practice a phrase, or create something for your learning. I can help with Library stories, lessons, exercises, game level briefs, and word lookup. The actions button below can start a task. This is a scripted preview, not a connected AI service.'),
    ],
    recap: { items: [] },
  })
  conversations.unshift(thread)
  selectedConversationId = id
  one('#conversation-search').value = ''
  renderConversation()
  focusThread()
  one('#chat-input').focus({ preventScroll: true })
  return thread
}
one('#new-conversation').addEventListener('click', () => beginConversation())
all('[data-reader-conversation], [data-lesson-conversation]').forEach((link) => link.addEventListener('click', () => {
  openThreadOnNextRoute = location.hash !== '#conversation'
  selectConversation(link.dataset.lessonConversation || 'tea')
}))
document.addEventListener('mockup-route-changed', (event) => {
  if (event.detail !== 'conversation') {
    closeAssistantSettings()
    endVoiceMode()
    stopSimulatedTurn()
    return
  }
  renderConversation()
  if (mobileLayout.matches) {
    if (openThreadOnNextRoute) focusThread()
    else showConversationList()
  }
  openThreadOnNextRoute = false
})
function syncConversationPicker() {
  const host = one(mobileLayout.matches ? '#mobile-conversations' : '#assistant-sidebar')
  host.append(one('#conversation-picker'))
  if (!mobileLayout.matches) document.body.dataset.assistantView = 'thread'
  if (document.body.dataset.assistantView === 'thread') {
    scrollConversationToEnd()
  }
}
function closeAssistantSettings() {
  for (const id of ['assistant-settings', 'assistant-message-actions']) {
    const panel = one(`#${id}`)
    if (panel.matches(':popover-open')) panel.hidePopover()
  }
}
function positionAssistantSettings() {
  positionAssistantPopover(one('#assistant-settings'), one('#assistant-settings-toggle'), one('.composer-input-row'))
  const panel = one('#assistant-message-actions')
  if (!panel.matches(':popover-open') || !assistantMessageActionAnchor) return
  const anchor = assistantMessageActionAnchor.getBoundingClientRect()
  const history = conversationScroller().getBoundingClientRect()
  if (!assistantMessageActionAnchor.isConnected || anchor.bottom < history.top || anchor.top > history.bottom) {
    panel.hidePopover()
    return
  }
  positionAssistantPopover(panel, assistantMessageActionAnchor, assistantMessageActionAnchor)
}
function positionAssistantPopover(panel, toggleElement, anchorElement) {
  if (!panel.matches(':popover-open')) return
  if (document.body.dataset.screen !== 'conversation' || document.body.dataset.assistantView !== 'thread') {
    closeAssistantSettings()
    return
  }
  const viewport = window.visualViewport
  const gap = 12
  const leftEdge = (viewport?.offsetLeft || 0) + gap
  const topEdge = (viewport?.offsetTop || 0) + gap
  const rightEdge = leftEdge + (viewport?.width || window.innerWidth) - gap * 2
  const bottomEdge = Math.min(
    (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight),
    mobileLayout.matches ? one('.sidebar').getBoundingClientRect().top : Infinity,
  ) - gap
  const anchor = anchorElement.getBoundingClientRect()
  const toggle = toggleElement.getBoundingClientRect()
  panel.style.maxWidth = `${Math.max(1, rightEdge - leftEdge)}px`
  panel.style.maxHeight = 'none'
  const naturalHeight = panel.getBoundingClientRect().height
  const above = Math.max(0, anchor.top - gap - topEdge)
  const below = Math.max(0, bottomEdge - anchor.bottom - gap)
  const useAbove = above >= naturalHeight || above >= below
  panel.style.maxHeight = `${Math.max(1, useAbove ? above : below)}px`
  const bounds = panel.getBoundingClientRect()
  panel.style.left = `${Math.max(leftEdge, Math.min(toggle.right - bounds.width, rightEdge - bounds.width))}px`
  panel.style.top = `${useAbove ? anchor.top - gap - bounds.height : anchor.bottom + gap}px`
  if (panel.contains(document.activeElement)) {
    const focused = document.activeElement.getBoundingClientRect()
    const visible = panel.getBoundingClientRect()
    if (focused.top < visible.top + 2) panel.scrollTop -= visible.top + 2 - focused.top
    else if (focused.bottom > visible.bottom - 2) panel.scrollTop += focused.bottom - visible.bottom + 2
  }
}
one('#assistant-settings').addEventListener('beforetoggle', (event) => {
  if (event.newState === 'open') requestAnimationFrame(positionAssistantSettings)
})
one('#assistant-settings').addEventListener('toggle', (event) => {
  const open = event.newState === 'open'
  one('#assistant-settings-toggle').setAttribute('aria-expanded', String(open))
  if (open) {
    event.currentTarget.scrollTop = 0
    one('#assistant-mode').focus({ preventScroll: true })
    positionAssistantSettings()
  }
})
function syncAssistantViewport() {
  const viewport = window.visualViewport
  if (viewport && viewport.scale !== 1) return
  const scroller = conversationScroller()
  const followLatest = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < 4
  const height = viewport ? viewport.height : window.innerHeight
  const compact = height <= 600
  const layoutChanged = document.body.dataset.compactChat !== String(compact)
  document.body.dataset.compactChat = String(compact)
  document.documentElement.style.setProperty('--assistant-viewport-height', `${height}px`)
  document.documentElement.style.setProperty('--assistant-viewport-top', `${viewport ? viewport.offsetTop : 0}px`)
  one('#conversation-history').tabIndex = compact ? 0 : -1
  one('#conversation-scroll').tabIndex = compact ? -1 : 0
  if (followLatest || layoutChanged) {
    requestAnimationFrame(() => {
      if (document.body.dataset.screen === 'conversation' && document.body.dataset.assistantView === 'thread') scrollConversationToEnd()
    })
  }
}
window.addEventListener('resize', syncAssistantViewport)
window.visualViewport?.addEventListener('resize', syncAssistantViewport)
window.visualViewport?.addEventListener('scroll', syncAssistantViewport)
window.addEventListener('resize', positionAssistantSettings)
window.visualViewport?.addEventListener('resize', positionAssistantSettings)
window.visualViewport?.addEventListener('scroll', positionAssistantSettings)
one('#conversation-scroll').addEventListener('scroll', positionAssistantSettings)
one('#conversation-history').addEventListener('scroll', positionAssistantSettings)
new ResizeObserver(positionAssistantSettings).observe(one('.workspace'))
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--assistant-composer-height', `${entry.target.getBoundingClientRect().height}px`)
  positionAssistantSettings()
}).observe(one('#chat-form'))
mobileLayout.addEventListener('change', syncConversationPicker)
document.body.dataset.assistantView = mobileLayout.matches ? 'list' : 'thread'
syncAssistantViewport()
syncConversationPicker()
renderConversation()
