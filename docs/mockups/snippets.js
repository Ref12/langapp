// Shared by the documentation screens; speech never falls back to a remote voice.
const snippetAttachments = new WeakMap()
const snippetPayloads = new WeakMap()
let snippetPlayback = null
let snippetNoticeTimer = null

function snippetElement(tag, className, text) {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}
function snippetButton(icon, label) {
  const button = snippetElement('button', 'snippet-action')
  button.type = 'button'
  button.dataset.tooltip = label
  button.setAttribute('aria-label', label)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS(svg.namespaceURI, 'use')
  use.setAttribute('href', `#i-${icon}`)
  svg.append(use)
  button.append(svg)
  return button
}
function mandarinSnippet(text) {
  if (!/\p{L}/u.test(text.replace(/\p{Script=Han}/gu, ''))) return text.trim()
  return (text.match(/(?:\d[\d.,]*\s*)?[\p{Script=Han}]+(?:\s*\d[\d.,]*)?|_{2,}|[\u3002\uff0c\uff01\uff1f]/gu) || []).join(' ')
}
function snippetLanguage(lang) {
  if (/^(zh|cmn)(-|$)/i.test(lang)) return 'Mandarin'
  return new Intl.DisplayNames(['en'], { type: 'language' }).of(lang) || lang
}
function wordSnippetOptions(word, source) {
  return { lang: word.nativeLanguage || 'zh-Hans', meaning: word.gloss, romanization: word.romanization, source }
}
function createSnippetActions(text, options = {}) {
  const snippet = Object.freeze({
    text: text.trim(), lang: options.lang || 'zh-Hans',
    source: options.source || 'Language preview',
    meaning: options.meaning || '', romanization: options.romanization || '',
  })
  const group = snippetElement('div', 'snippet-actions')
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', `Text actions: ${snippet.text}`)
  snippetPayloads.set(group, snippet)
  const hear = snippetButton('speaker', `Hear in ${snippetLanguage(snippet.lang)}: ${snippet.text}`)
  hear.dataset.snippetAction = 'hear'
  hear.setAttribute('aria-pressed', 'false')
  hear.addEventListener('click', () => playSnippet(snippet, hear))
  const ask = snippetButton('chat', `Ask Assistant about: ${snippet.text}`)
  ask.dataset.snippetAction = 'ask'
  ask.addEventListener('click', () => askAboutSnippet(snippet, ask))
  group.append(hear, ask)
  return group
}
function setSnippetActions(element, options = {}) {
  snippetAttachments.get(element)?.remove()
  if (options.lang === '' || !element.textContent.trim()) return
  const actions = createSnippetActions(element.textContent, { lang: element.lang || 'zh-Hans', ...options })
  element.after(actions)
  snippetAttachments.set(element, actions)
  return actions
}
function setTargetSnippetActions(element, options = {}) {
  snippetAttachments.get(element)?.remove()
  if (!/\p{Script=Han}/u.test(element.textContent)) return
  return setSnippetActions(element, { ...options, lang: 'zh-Hans' })
}

const snippetPlayer = snippetElement('aside', 'snippet-player')
snippetPlayer.hidden = true
snippetPlayer.setAttribute('aria-label', 'Local speech and text actions')
const snippetStatus = snippetElement('p', 'snippet-player-status')
snippetStatus.setAttribute('role', 'status')
const snippetStop = snippetButton('stop', 'Stop local speech')
snippetStop.addEventListener('click', () => stopSnippetSpeech())
const snippetDismiss = snippetButton('close', 'Dismiss text action status')
snippetDismiss.addEventListener('click', () => {
  stopSnippetSpeech(false)
  snippetPlayer.hidden = true
})
snippetPlayer.append(snippetStatus, snippetStop, snippetDismiss)
document.body.append(snippetPlayer)

function showSnippetNotice(message, owner, playing = false) {
  clearTimeout(snippetNoticeTimer)
  const dialog = owner?.closest('dialog[open]')
  const host = dialog || document.body
  if (snippetPlayer.parentElement !== host) host.append(snippetPlayer)
  snippetPlayer.classList.toggle('in-dialog', Boolean(dialog))
  snippetStatus.textContent = message
  snippetStop.hidden = !playing
  snippetPlayer.hidden = false
}
function resetSnippetButton(button) {
  button.setAttribute('aria-pressed', 'false')
  button.querySelector('use').setAttribute('href', '#i-speaker')
  button.setAttribute('aria-label', button.dataset.tooltip)
}
function stopSnippetSpeech(announce = true) {
  const playback = snippetPlayback
  if (!playback) return
  snippetPlayback = null
  clearTimeout(snippetNoticeTimer)
  snippetPlayer.hidden = true
  resetSnippetButton(playback.button)
  window.speechSynthesis?.cancel()
  if (announce) {
    showSnippetNotice('Local speech stopped.', playback.button)
    snippetNoticeTimer = setTimeout(() => { snippetPlayer.hidden = true }, 2000)
  }
}
function localSnippetVoice(lang) {
  const voices = window.speechSynthesis.getVoices().filter((voice) => voice.localService === true)
  if (/^(zh|cmn)(-|$)/i.test(lang)) {
    const mandarin = voices.filter((voice) => /^(cmn(?:-|$)|zh(?:$|-(?:cn|sg|tw|hans|hant)(?:-|$)))/i.test(voice.lang) && !/-hk$/i.test(voice.lang))
    return mandarin.find((voice) => /^zh-(cn|hans)$/i.test(voice.lang)) || mandarin[0]
  }
  return voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase())
    || voices.find((voice) => voice.lang.split('-')[0].toLowerCase() === lang.split('-')[0].toLowerCase())
}
async function playSnippet(snippet, button) {
  if (snippetPlayback?.button === button) {
    stopSnippetSpeech()
    return
  }
  stopSnippetSpeech(false)
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    showSnippetNotice('This browser does not support local speech. Try a browser with installed speech voices.', button)
    return
  }
  const playback = { button }
  snippetPlayback = playback
  button.setAttribute('aria-pressed', 'true')
  button.setAttribute('aria-label', 'Stop local speech')
  button.querySelector('use').setAttribute('href', '#i-stop')
  showSnippetNotice('Finding an installed local voice...', button, true)
  // Some browsers populate their voice list asynchronously on first use.
  if (!window.speechSynthesis.getVoices().length) {
    await new Promise((resolve) => {
      const ready = () => {
        clearTimeout(timer)
        window.speechSynthesis.removeEventListener('voiceschanged', ready)
        resolve()
      }
      const timer = setTimeout(ready, 800)
      window.speechSynthesis.addEventListener('voiceschanged', ready)
    })
  }
  if (snippetPlayback !== playback) return
  const voice = localSnippetVoice(snippet.lang)
  if (!voice) {
    stopSnippetSpeech(false)
    showSnippetNotice(`No local ${snippetLanguage(snippet.lang)} voice is available. Install an offline voice in your device's speech settings. Remote voices are not used.`, button)
    return
  }
  const mandarin = /^(zh|cmn)(-|$)/i.test(snippet.lang)
  const speechText = (mandarin ? mandarinSnippet(snippet.text) : snippet.text).replace(/_{2,}/g, mandarin ? '\u7a7a\u767d' : 'blank')
  if (!speechText.trim()) {
    stopSnippetSpeech(false)
    showSnippetNotice('There is no speakable text in this snippet for the selected language.', button)
    return
  }
  const utterance = new SpeechSynthesisUtterance(speechText)
  playback.utterance = utterance
  utterance.voice = voice
  utterance.lang = voice.lang
  utterance.rate = snippet.rate ?? (mandarin ? Number(document.querySelector('#target-speech-speed').value) : 1)
  utterance.onstart = () => {
    const description = snippet.concealText ? 'Audio prompt / transcript hidden.' : snippet.text.slice(0, 70)
    if (snippetPlayback === playback) showSnippetNotice(`${snippetLanguage(snippet.lang)} / ${utterance.rate}x / local voice. ${description}`, button, true)
  }
  utterance.onend = () => {
    if (snippetPlayback !== playback) return
    snippetPlayback = null
    resetSnippetButton(button)
    showSnippetNotice('Finished speaking locally.', button)
    snippetNoticeTimer = setTimeout(() => { snippetPlayer.hidden = true }, 2000)
  }
  utterance.onerror = (event) => {
    if (snippetPlayback !== playback) return
    stopSnippetSpeech(false)
    showSnippetNotice(`Local speech could not finish (${event.error}). Try again or select a shorter snippet. No remote voice was used.`, button)
  }
  try {
    window.speechSynthesis.speak(utterance)
  } catch (error) {
    stopSnippetSpeech(false)
    console.error('Local speech could not start:', error)
    showSnippetNotice('Local speech could not start. Check your installed voice and browser speech permissions.', button)
  }
}

function askAboutSnippet(snippet, owner, draft) {
  stopSnippetSpeech(false)
  snippetPlayer.hidden = true
  const dialog = owner.closest('dialog[open]')
  const thread = beginConversation('Text companion')
  thread.snippetRequest = snippet
  thread.draft = draft ?? `Help me understand and practice this ${snippetLanguage(snippet.lang)} text:\n\n"${snippet.text}"\n\nFrom: ${snippet.source}${snippet.meaning ? `\nSupplied meaning: ${snippet.meaning}` : ''}`
  thread.creationSuppressed = true
  renderVoiceTurn()
  renderAssistantMode()
  renderConversationList()
  closeSnippetSelection()
  if (dialog) {
    showSnippetNotice('Prepared a new Assistant draft. Finish or cancel this dialog, then open Assistant. Your current edits are unchanged.', owner)
    return
  }
  openThreadOnNextRoute = location.hash !== '#conversation'
  location.hash = 'conversation'
  focusThread()
  document.querySelector('#chat-input').focus({ preventScroll: true })
}

// Selection keeps the reader quiet: individual words do not each need two icons.
const snippetSelection = snippetElement('div', 'snippet-selection')
snippetSelection.popover = 'manual'
snippetSelection.setAttribute('role', 'toolbar')
snippetSelection.setAttribute('aria-label', 'Selected text actions')
const snippetSelectionLabel = snippetElement('p', 'small muted', 'Selected text / Hear Mandarin or ask Assistant')
const snippetSelectionControls = snippetElement('div', '')
const snippetSelectionClose = snippetButton('close', 'Close selected text actions')
snippetSelectionClose.addEventListener('click', () => closeSnippetSelection())
snippetSelection.append(snippetSelectionLabel, snippetSelectionControls, snippetSelectionClose)
document.body.append(snippetSelection)
let snippetSelectedText = ''

function closeSnippetSelection() {
  if (snippetPlayback && snippetSelection.contains(snippetPlayback.button)) {
    stopSnippetSpeech(false)
    snippetPlayer.hidden = true
  }
  if (snippetSelection.matches(':popover-open')) snippetSelection.hidePopover()
  snippetSelectedText = ''
}
function updateSnippetSelection() {
  const selection = window.getSelection()
  if (!selection?.rangeCount || selection.isCollapsed) {
    if (!snippetSelection.contains(document.activeElement)) closeSnippetSelection()
    return
  }
  const range = selection.getRangeAt(0)
  const start = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement
  if (start.closest('input, textarea, [contenteditable], .snippet-actions, .snippet-selection, .snippet-player')) return
  const fragment = range.cloneContents()
  fragment.querySelectorAll('.snippet-actions, .reader-annotation, .snippet-player').forEach((element) => element.remove())
  const text = fragment.textContent.trim()
  if (!/\p{Script=Han}/u.test(text)) {
    closeSnippetSelection()
    return
  }
  const rect = range.getBoundingClientRect()
  if (!rect.width && !rect.height) return
  const dialog = start.closest('dialog[open]')
  const host = dialog || document.body
  if (snippetSelection.parentElement !== host) {
    closeSnippetSelection()
    host.append(snippetSelection)
  }
  if (snippetSelectedText !== text) {
    snippetSelectionControls.replaceChildren(createSnippetActions(text, { source: document.querySelector('.screen:not([hidden]) h1')?.textContent || 'Selected text' }))
    snippetSelectedText = text
  }
  if (!snippetSelection.matches(':popover-open')) snippetSelection.showPopover()
  const bounds = snippetSelection.getBoundingClientRect()
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft || 0
  const top = viewport?.offsetTop || 0
  const width = viewport?.width || innerWidth
  const height = viewport?.height || innerHeight
  snippetSelection.style.left = `${Math.max(left + 8, Math.min(rect.left, left + width - bounds.width - 8))}px`
  snippetSelection.style.top = `${Math.max(top + 8, Math.min(rect.bottom + 8, top + height - bounds.height - 84))}px`
}
document.addEventListener('selectionchange', () => {
  if (!snippetSelection.contains(document.activeElement)) updateSnippetSelection()
})
document.addEventListener('pointerdown', (event) => {
  if (snippetSelection.contains(event.target)) event.preventDefault()
  else if (!event.target.closest('.snippet-player')) closeSnippetSelection()
})
document.addEventListener('pointerup', () => {
  if (!snippetSelection.matches(':popover-open')) updateSnippetSelection()
})
document.addEventListener('keydown', (event) => {
  if (event.altKey && event.key === 'Enter') {
    updateSnippetSelection()
    if (snippetSelection.matches(':popover-open')) {
      event.preventDefault()
      snippetSelection.querySelector('button').focus({ preventScroll: true })
    }
  } else if (event.key === 'Escape') {
    stopSnippetSpeech()
    closeSnippetSelection()
  }
})
document.addEventListener('scroll', (event) => {
  if (!snippetSelection.contains(event.target)) closeSnippetSelection()
}, true)
window.addEventListener('resize', closeSnippetSelection)
window.visualViewport?.addEventListener('resize', closeSnippetSelection)
document.addEventListener('mockup-route-changed', () => {
  stopSnippetSpeech(false)
  snippetPlayer.hidden = true
  closeSnippetSelection()
})
document.addEventListener('close', (event) => {
  if (event.target.contains(snippetPlayer)) {
    stopSnippetSpeech(false)
    snippetPlayer.hidden = true
  }
}, true)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopSnippetSpeech(false)
})
window.addEventListener('pagehide', () => stopSnippetSpeech(false))
new MutationObserver(() => {
  const dialog = document.querySelector('dialog[open]')
  if (dialog && !dialog.contains(snippetSelection)) closeSnippetSelection()
  if (snippetPlayback && (!snippetPlayback.button.isConnected || !snippetPlayback.button.getClientRects().length || (dialog && !dialog.contains(snippetPlayback.button)))) {
    stopSnippetSpeech(false)
    snippetPlayer.hidden = true
  }
}).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] })
