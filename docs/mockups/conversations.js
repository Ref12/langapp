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
const tutorMessage = (text, phrase) => ({ from: 'tutor', text, phrase })
const userMessage = (text) => ({ from: 'user', text })
const recapItem = (native, romanization, meaning, activity) => ({ native, romanization, meaning, activity })
function createConversation(values) {
  return { draft: '', voiceStage: 'idle', ...values }
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
  thread.draft = thread.phrase.meaning
  notify('The demo voice turn was stopped. Its sample transcript stays with this conversation for review.')
}
function selectConversation(id) {
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
    if (!`${thread.title} ${thread.kind} ${thread.preview}`.toLowerCase().includes(query)) return
    const button = chatElement('button', 'conversation-list-item')
    button.dataset.conversationId = thread.id
    button.setAttribute('aria-pressed', String(thread.id === selectedConversationId))
    const title = chatElement('strong', '', thread.title)
    const kind = chatElement('span', 'thread-kind', thread.kind)
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
  const thread = currentConversation()
  const log = one('#chat-messages')
  log.replaceChildren()
  thread.messages.forEach((entry) => {
    const message = chatElement('div', `message ${entry.from}-message`)
    message.append(chatElement('span', 'message-label', entry.from === 'user' ? 'YOU' : 'ASSISTANT / SCRIPTED DEMO'), chatElement('p', '', entry.text))
    if (entry.phrase) {
      const phrase = chatElement('div', 'chat-phrase')
      const native = chatElement('p', '', entry.phrase.native)
      native.lang = 'zh-Hans'
      const romanization = chatElement('span', 'phrase-romanization', entry.phrase.romanization)
      romanization.hidden = !assistantPreferences.romanization
      phrase.append(native, romanization, chatElement('p', 'small muted', entry.phrase.meaning))
      message.append(phrase)
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
    log.append(message)
  })
  const scroller = conversationScroller()
  scroller.scrollTop = scrollToEnd ? scroller.scrollHeight : 0
}
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
      items.append(card)
    })
    content.append(items)
    const pattern = chatElement('div', 'recap-pattern')
    pattern.append(chatElement('span', 'eyebrow', 'A PATTERN TO TAKE WITH YOU'), chatElement('p', '', thread.recap.pattern))
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
  scrollConversationToEnd()
}
one('#conversation-search').addEventListener('input', renderConversationList)
function showConversationList(moveFocus = false) {
  endVoiceMode()
  stopSimulatedTurn()
  renderConversationList()
  document.body.dataset.assistantView = 'list'
  one('#main').scrollTop = 0
  if (moveFocus) {
    one('#conversation-title').focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }
}
one('#back-to-conversations').addEventListener('click', () => showConversationList(true))
one('[data-nav="conversation"]').addEventListener('click', () => {
  openThreadOnNextRoute = false
  if (mobileLayout.matches) showConversationList(true)
})
one('#chat-input').addEventListener('input', (event) => {
  currentConversation().draft = event.target.value
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
    thread.voiceStage = 'recording'
  } else if (thread.voiceStage === 'recording') {
    thread.voiceStage = 'review'
    thread.draft = thread.phrase.meaning
  } else {
    thread.voiceStage = 'idle'
    thread.draft = ''
  }
  renderVoiceTurn()
  renderConversationList()
  if (thread.voiceStage === 'review') one('#chat-input').focus()
})
one('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const thread = currentConversation()
  const text = thread.draft.trim()
  if (!text) {
    notify('Write a reply, or try a demo voice turn first.')
    one('#chat-input').focus()
    return
  }
  thread.messages.push(userMessage(text), tutorMessage('In a connected app, I would respond to what you said. For this preview, here is a sample pattern to try.', thread.phrase))
  thread.draft = ''
  thread.voiceStage = 'idle'
  thread.updated = 'Just now'
  renderTranscript(true)
  renderRecap()
  renderVoiceTurn()
  renderConversationList()
  scrollConversationToEnd()
  one('#chat-input').focus()
})
one('#show-romanization').addEventListener('click', () => {
  assistantPreferences.romanization = !assistantPreferences.romanization
  one('#show-romanization').setAttribute('aria-pressed', String(assistantPreferences.romanization))
  all('.phrase-romanization, .recap-romanization').forEach((item) => { item.hidden = !assistantPreferences.romanization })
})
one('#target-speech-speed').addEventListener('change', (event) => {
  assistantPreferences.speechSpeed = event.target.value
  if (!one('#voice-mode-panel').hidden) renderVoiceMode()
  else notify(`Mandarin speech: ${event.target.value}x. English stays at 1x. Audio is not connected in this mockup.`)
})
function renderVoiceMode() {
  const phrase = currentConversation().phrase
  const responding = voiceModeStep === 'responding'
  one('#voice-mode-panel').dataset.paused = String(voiceModePaused)
  one('#voice-mode-status').textContent = voiceModePaused ? 'Voice mode paused' : responding ? 'Assistant speaking / demo' : 'Your turn / demo'
  one('#voice-mode-state-help').textContent = voiceModePaused ? 'No microphone active.' : responding ? `Mandarin ${assistantPreferences.speechSpeed}x / English 1x. Demo only.` : 'Hands-free preview. No microphone active.'
  one('#voice-mode-caption').hidden = !responding
  one('#voice-mode-native').textContent = phrase.native
  one('#voice-mode-romanization').textContent = phrase.romanization
  one('#voice-mode-romanization').hidden = !assistantPreferences.romanization
  one('#voice-mode-meaning').textContent = phrase.meaning
  one('#voice-mode-next').firstChild.textContent = responding ? 'Next turn ' : 'Preview reply '
  one('#voice-mode-next').disabled = voiceModePaused
  one('#voice-mode-pause').setAttribute('aria-pressed', String(voiceModePaused))
  one('#voice-mode-pause span').textContent = voiceModePaused ? 'Resume' : 'Pause'
}
function endVoiceMode(restoreFocus = false) {
  one('#voice-mode-panel').hidden = true
  one('#voice-mode-caption').hidden = true
  renderComposerAction()
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
  voiceModePaused = false
  renderVoiceMode()
  one('#voice-mode-panel').hidden = false
  renderComposerAction()
  scrollConversationToEnd()
})
one('#voice-mode-end').addEventListener('click', () => endVoiceMode(true))
one('#voice-mode-next').addEventListener('click', () => {
  voiceModeStep = voiceModeStep === 'listening' ? 'responding' : 'listening'
  renderVoiceMode()
  scrollConversationToEnd()
})
one('#voice-mode-pause').addEventListener('click', () => {
  voiceModePaused = !voiceModePaused
  renderVoiceMode()
})
one('#new-conversation').addEventListener('click', () => {
  endVoiceMode()
  one('#conversation-dialog').showModal()
})
one('#conversation-topic').addEventListener('input', (event) => event.target.setCustomValidity(''))
one('#conversation-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const topic = one('#conversation-topic')
  topic.setCustomValidity(topic.value.trim() ? '' : 'Please enter a topic or question.')
  if (!event.currentTarget.reportValidity()) return
  endVoiceMode()
  stopSimulatedTurn()
  const id = `new-${nextConversationId++}`
  const thread = createConversation({
    id, title: topic.value.trim(), kind: one('#conversation-kind').value,
    preview: 'A new starting point for your learning.', phrase: teaPhrase, updated: 'Just now',
    messages: [
      tutorMessage(`Let's explore "${topic.value.trim()}." A connected assistant could help with conversation, explanations, or exercises. Replies here use a fixed tea-ordering example rather than adapting to your topic.`),
    ],
    recap: { items: [] },
  })
  conversations.unshift(thread)
  selectedConversationId = id
  one('#conversation-search').value = ''
  one('#conversation-dialog').close()
  event.currentTarget.reset()
  renderConversation()
  focusThread()
  one('#chat-input').focus({ preventScroll: true })
})
all('[data-reader-conversation], [data-lesson-conversation]').forEach((link) => link.addEventListener('click', () => {
  openThreadOnNextRoute = location.hash !== '#conversation'
  selectConversation(link.dataset.lessonConversation || 'tea')
}))
document.addEventListener('mockup-route-changed', (event) => {
  if (event.detail !== 'conversation') {
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
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--assistant-composer-height', `${entry.target.getBoundingClientRect().height}px`)
}).observe(one('#chat-form'))
mobileLayout.addEventListener('change', syncConversationPicker)
document.body.dataset.assistantView = mobileLayout.matches ? 'list' : 'thread'
syncAssistantViewport()
syncConversationPicker()
renderConversation()
