// Original, memory-only interaction samples. Never write production learning state.
;(() => {
  const q = (selector) => document.querySelector(selector)
  const el = snippetElement
  const glossary = {
    我: { pinyin: 'wǒ', meaning: 'I; me' },
    喝: { pinyin: 'hē', meaning: 'to drink' },
    茶: { pinyin: 'chá', meaning: 'tea' },
    水: { pinyin: 'shuǐ', meaning: 'water' },
    也: { pinyin: 'yě', meaning: 'also; too', isNew: true },
    想: { pinyin: 'xiǎng', meaning: 'would like; want' },
    你: { pinyin: 'nǐ', meaning: 'you' },
    什么: { pinyin: 'shénme', meaning: 'what' },
    朋友: { pinyin: 'péngyou', meaning: 'friend' },
  }
  const samples = [
    {
      id: 'translate-tiles', kind: 'tiles', title: 'Translate with tiles',
      instruction: 'Translate the two sentences.', skill: 'Reading / ordered tiles',
      description: 'Build an English answer. Repeated words are interchangeable.',
      source: '我喝茶。我也喝水。', sourceLocale: 'zh-CN',
      terms: ['我', '喝', '茶', '。', '我', '也', '喝', '水', '。'],
      answerLocale: 'en-US', tiles: ['I', 'drink', 'tea', 'I', 'also', 'drink', 'water', 'coffee'],
      answers: [['I', 'drink', 'tea', 'I', 'also', 'drink', 'water']],
      meaning: 'I drink tea. I also drink water.', audio: true,
      explanation: '也 adds "also" to the second statement. Both I tiles and both drink tiles are interchangeable.',
    },
    {
      id: 'translation-choice', kind: 'choice', title: 'Choose a translation',
      instruction: 'Select the correct translation.', skill: 'Reading / recognition',
      description: 'Recognize a meaning before producing an answer yourself.',
      source: 'tea', sourceLocale: 'en-US', answerLocale: 'zh-CN',
      options: ['水', '茶', '朋友'], correct: 1,
      meaning: '茶 means tea.', explanation: '水 is water; 朋友 is friend.',
    },
    {
      id: 'listening-tiles', kind: 'tiles', title: 'Arrange what you hear',
      instruction: 'Tap the words in the order you hear them.', skill: 'Listening / ordered tiles',
      description: 'Listen at normal or slow speed, then reconstruct the phrase.',
      source: '我也喝茶。', sourceLocale: 'zh-CN', terms: ['我', '也', '喝', '茶', '。'],
      answerLocale: 'zh-CN', tiles: ['茶', '我', '水', '喝', '也'], answers: [['我', '也', '喝', '茶']],
      meaning: 'I also drink tea.', explanation: 'This repeats the heard words in the same language; it is not translation.',
      audio: true, audioOnly: true,
    },
    {
      id: 'picture-gap', kind: 'gap', title: 'Complete the thought',
      instruction: 'Complete the sentence.', skill: 'Reading / a supplied visual hint',
      description: 'Use a picture and a meaning cue to choose the missing word.',
      source: '我想喝', sourceLocale: 'zh-CN', terms: ['我', '想', '喝'],
      hint: 'A warm cup of tea, please.', scene: true, answerLocale: 'zh-CN',
      options: ['水', '朋友', '茶'], correct: 2,
      meaning: '我想喝茶。 / I would like to drink tea.',
      explanation: 'The picture and English cue belong to the question. They do not count as requested help.',
    },
    {
      id: 'matching', kind: 'matching', title: 'Match meanings',
      instruction: 'Match each word to its meaning.', skill: 'Reading / matching',
      description: 'Make all four pairs, then check them together.',
      pairs: [
        { native: '茶', meaning: 'tea' }, { native: '水', meaning: 'water' },
        { native: '朋友', meaning: 'friend' }, { native: '我', meaning: 'I; me' },
      ],
      meaning: '茶 — tea; 水 — water; 朋友 — friend; 我 — I / me.',
      explanation: 'Each word has one partner. You can change a pair before checking.',
    },
    {
      id: 'repeat', kind: 'repeat', title: 'Repeat a phrase',
      instruction: 'Listen, then repeat the phrase.', skill: 'Speaking / simulation only',
      description: 'Explore recording controls and word-level sample feedback.',
      source: '我想喝茶。', sourceLocale: 'zh-CN', terms: ['我', '想', '喝', '茶', '。'], audio: true,
      meaning: 'I would like to drink tea.', explanation: 'Sample word highlighting is not a pronunciation measurement.',
    },
    {
      id: 'spoken-choice', kind: 'spoken-choice', title: 'Choose and say a reply',
      instruction: 'Respond to the tea-house host.', skill: 'Listening + speaking / simulation only',
      description: 'Hear a question, select a suitable reply, then preview saying it.',
      source: '你想喝什么？', sourceLocale: 'zh-CN', terms: ['你', '想', '喝', '什么', '？'],
      audio: true, audioOnly: true, answerLocale: 'zh-CN',
      options: ['我想喝茶。', '你好，我是小林。'], correct: 0,
      meaning: 'What would you like to drink? / I would like to drink tea.',
      explanation: 'The host asks about a drink. Introducing yourself does not answer that question.',
    },
  ]
  let session = null
  let wasOpen = false
  let helpAnchor = null
  const outcomeLabels = {
    passed: 'Unaided correct', failed: 'Check failed / needs review',
    'not-assessed': 'Not assessed', previewed: 'Speech simulation / not assessed',
  }

  function action(label, handler, className = 'button secondary') {
    const button = el('button', className, label)
    button.type = 'button'
    button.addEventListener('click', handler)
    return button
  }
  function shuffle(values) {
    const result = [...values]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
  function current() { return session.items[session.index] }
  function state() { return session.states[session.index] }
  function isSpeech(item = current()) { return item.kind === 'repeat' || item.kind === 'spoken-choice' }
  function announce(text) { q('#activity-announcement').textContent = text }
  function begin(mode, id) {
    if (mode !== 'lesson' && mode !== 'quiz') throw new Error(`Unknown sample mode: ${mode}`)
    const items = id ? samples.filter(item => item.id === id) : samples
    if (!items.length) throw new Error(`Unknown sample exercise: ${id}`)
    stopSnippetSpeech(false)
    session = {
      mode, items, index: 0, results: [],
      states: items.map(item => ({
        chosen: [], selected: null, left: null, pairs: [], voice: null,
        bank: shuffle((item.tiles || []).map((text, instance) => ({ text, instance }))),
        rightOrder: shuffle((item.pairs || []).map((_, index) => index)),
        revealed: false, helpUsed: false, tries: 0, firstOutcome: null, feedback: null,
      })),
    }
    location.hash = 'exercise'
    render()
    q('#activity-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
  function resume() {
    location.hash = 'exercise'
    render()
  }
  function updateResume() {
    const button = q('#activity-resume')
    button.hidden = !session
    if (session) button.textContent = session.index === session.items.length
      ? 'Review sample results' : `Resume sample (${session.index + 1} of ${session.items.length})`
  }
  function markHelp() {
    if (state().feedback) return
    state().helpUsed = true
    if (!isSpeech()) state().firstOutcome ??= 'failed'
    announce(session.mode === 'quiz' ? 'Extra help used. This Check is recorded as failed.' : 'Extra help recorded for this practice attempt.')
  }
  function closeHelp() {
    q('#activity-word-help').hidden = true
    helpAnchor?.setAttribute('aria-expanded', 'false')
  }
  function wordHelp(text, owner) {
    markHelp()
    closeHelp()
    helpAnchor = owner
    owner.setAttribute('aria-expanded', 'true')
    const word = glossary[text]
    const panel = q('#activity-word-help')
    panel.replaceChildren(
      el('h3', '', `${text} / ${word.pinyin}`),
      el('p', '', word.meaning),
      el('p', 'small', state().feedback ? 'Post-answer word help.' : 'Extra help is recorded; it cannot turn an assisted answer into an unaided Check.'),
      action('Close word help', () => { closeHelp(); owner.focus() }, 'button quiet'),
    )
    panel.hidden = false
  }
  function nativeText(parts, parent, interactive = true) {
    parts.forEach(text => {
      const word = glossary[text]
      if (!word || !interactive) { parent.append(document.createTextNode(text)); return }
      const button = action('', () => wordHelp(text, button), 'activity-word')
      button.lang = 'zh-CN'
      button.setAttribute('aria-label', `Word help: ${text}`)
      button.setAttribute('aria-expanded', 'false')
      if (word.isNew && session.mode === 'lesson') {
        button.classList.add('new-word')
        const ruby = el('ruby', '', text)
        ruby.append(el('rt', '', word.pinyin))
        button.append(ruby)
      } else button.textContent = text
      parent.append(button)
    })
  }
  function audioControls(parent) {
    const controls = el('div', 'activity-audio')
    const item = current()
    for (const [label, rate] of [['Play audio', 1], ['Play slowly', 0.65]]) {
      const button = snippetButton('speaker', label)
      button.classList.add('button', 'secondary')
      button.append(el('span', '', label))
      button.setAttribute('aria-pressed', 'false')
      button.addEventListener('click', () => playSnippet({
        text: item.source, lang: item.sourceLocale, rate,
        concealText: Boolean(item.audioOnly && !state().revealed && !state().feedback),
      }, button))
      controls.append(button)
    }
    parent.append(controls)
  }
  function renderSource() {
    closeHelp()
    const item = current()
    const host = q('#activity-source')
    host.replaceChildren()
    if (!item.source) return
    const box = el('div', 'activity-source')
    if (item.scene) {
      const image = el('img', 'activity-scene')
      image.src = './exercise-cafe.svg'
      image.alt = 'A warm cup of tea at a tea-house counter.'
      image.width = 600
      image.height = 220
      box.append(image, el('p', 'small muted', `Supplied hint: ${item.hint}`))
    }
    const hiddenSource = item.audioOnly && !state().revealed && !state().feedback
    if (hiddenSource) {
      const placeholder = el('div', 'activity-audio-only')
      placeholder.append(el('strong', '', 'Listen before you look.'), el('p', '', 'The transcript is hidden for this listening task.'))
      box.append(placeholder)
    } else {
      if (item.terms?.some(text => glossary[text]?.isNew) && session.mode === 'lesson') {
        box.append(el('span', 'tag lavender', 'NEW WORD / 也'))
      }
      const sentence = el('p', 'activity-sentence')
      sentence.lang = item.sourceLocale
      sentence.tabIndex = -1
      if (item.terms) nativeText(item.terms, sentence)
      else sentence.textContent = item.source
      if (item.kind === 'gap') {
        const blank = el('span', 'activity-gap', state().selected === null ? '___' : item.options[state().selected])
        blank.id = 'activity-gap'
        blank.setAttribute('aria-label', state().selected === null ? 'Blank to complete' : `Selected word: ${item.options[state().selected]}`)
        sentence.append(blank, document.createTextNode('。'))
      }
      box.append(sentence)
    }
    if (item.audio) audioControls(box)
    host.append(box)
  }
  function updateGap() {
    const blank = q('#activity-gap')
    if (!blank) return
    const text = state().selected === null ? '___' : current().options[state().selected]
    blank.textContent = text
    blank.setAttribute('aria-label', text === '___' ? 'Blank to complete' : `Selected word: ${text}`)
  }

  // Align selected text to an accepted sequence, not to tile-instance identities.
  function compareTiles(answer, expected) {
    const grid = Array.from({ length: answer.length + 1 }, () => Array(expected.length + 1).fill(0))
    for (let a = answer.length - 1; a >= 0; a--) {
      for (let b = expected.length - 1; b >= 0; b--) {
        grid[a][b] = answer[a] === expected[b] ? grid[a + 1][b + 1] + 1 : Math.max(grid[a + 1][b], grid[a][b + 1])
      }
    }
    const aligned = new Set()
    let a = 0
    let b = 0
    while (a < answer.length && b < expected.length) {
      if (answer[a] === expected[b]) { aligned.add(a++); b++ }
      else if (grid[a + 1][b] >= grid[a][b + 1]) a++
      else b++
    }
    return { errors: answer.map((_, index) => index).filter(index => !aligned.has(index)), distance: answer.length + expected.length - 2 * aligned.size }
  }
  function renderTiles(host) {
    const item = current()
    const attempt = state()
    const answer = el('div', 'activity-answer')
    answer.setAttribute('role', 'group')
    answer.setAttribute('aria-label', 'Your ordered answer; select a tile to return it')
    attempt.chosen.forEach((instance, index) => {
      const tile = attempt.bank.find(tile => tile.instance === instance)
      const button = action(tile.text, () => {
        attempt.chosen.splice(index, 1)
        renderResponse()
        q(`[data-bank-instance="${instance}"]`).focus()
      }, 'activity-tile')
      button.lang = item.answerLocale
      button.dataset.answerIndex = String(index)
      button.setAttribute('aria-label', `Remove ${tile.text}, position ${index + 1}`)
      button.disabled = Boolean(attempt.feedback)
      if (attempt.feedback) button.classList.add(attempt.feedback.errors?.includes(index) ? 'needs-review' : 'is-correct')
      answer.append(button)
    })
    const tools = el('div', 'activity-answer-controls')
    const clear = action('Clear answer', () => {
      attempt.chosen = []
      renderResponse()
      q('.activity-bank button:not(:disabled)').focus()
    }, 'button quiet')
    clear.disabled = !attempt.chosen.length || Boolean(attempt.feedback)
    tools.append(clear)
    const bank = el('div', 'activity-bank')
    bank.setAttribute('role', 'group')
    bank.setAttribute('aria-label', 'Available tiles')
    attempt.bank.forEach(tile => {
      const used = attempt.chosen.includes(tile.instance)
      const button = action(tile.text, () => {
        attempt.chosen.push(tile.instance)
        renderResponse()
        const next = q('.activity-bank button:not(:disabled)')
        ;(next || q('#activity-submit')).focus()
      }, `activity-tile${used ? ' used' : ''}`)
      button.lang = item.answerLocale
      button.dataset.bankInstance = String(tile.instance)
      button.disabled = used || Boolean(attempt.feedback)
      button.setAttribute('aria-label', used ? `${tile.text}, used` : `Add ${tile.text}`)
      bank.append(button)
    })
    host.append(answer, tools, bank)
  }
  function renderChoices(host) {
    const item = current()
    const attempt = state()
    const choices = el('div', 'activity-choices')
    choices.setAttribute('role', 'group')
    choices.setAttribute('aria-label', isSpeech() ? 'Choose a reply to say' : 'Answer choices')
    item.options.forEach((text, index) => {
      const button = action('', () => {
        attempt.selected = index
        attempt.voice = null
        renderResponse()
        updateGap()
        q(`[data-activity-choice="${index}"]`).focus()
      }, 'activity-choice')
      if (isSpeech()) {
        const icon = snippetButton('mic', 'Speech preview')
        button.append(icon.querySelector('svg'))
      } else button.append(el('span', 'choice-index', String(index + 1)))
      const label = el('span', '', text)
      label.lang = item.answerLocale
      button.append(label)
      button.dataset.activityChoice = String(index)
      button.setAttribute('aria-pressed', String(attempt.selected === index))
      button.disabled = Boolean(attempt.feedback)
      if (attempt.feedback && attempt.feedback.kind !== 'retry') {
        if (index === item.correct) button.classList.add('is-correct')
        else if (index === attempt.selected) button.classList.add('is-incorrect')
      }
      choices.append(button)
    })
    host.append(choices)
  }
  function renderMatching(host) {
    const item = current()
    const attempt = state()
    const columns = el('div', 'activity-matching')
    for (const side of ['left', 'right']) {
      const column = el('div', 'activity-match-column')
      column.append(el('h3', '', side === 'left' ? 'Chinese' : 'Meaning'))
      const indexes = side === 'left' ? item.pairs.map((_, index) => index) : attempt.rightOrder
      indexes.forEach(index => {
        const linked = attempt.pairs.find(pair => pair[side] === index)
        const text = side === 'left' ? item.pairs[index].native : item.pairs[index].meaning
        const button = action('', () => {
          if (side === 'left') {
            attempt.pairs = attempt.pairs.filter(pair => pair.left !== index)
            attempt.left = index
          } else {
            if (attempt.left === null) { announce('Choose a Chinese word first.'); return }
            attempt.pairs = attempt.pairs.filter(pair => pair.right !== index)
            attempt.pairs.push({ left: attempt.left, right: index })
            attempt.left = null
          }
          renderResponse()
          q(`[data-match-${side}="${index}"]`).focus()
        })
        button.setAttribute('aria-pressed', String(side === 'left' && attempt.left === index))
        button.disabled = Boolean(attempt.feedback)
        button.dataset[side === 'left' ? 'matchLeft' : 'matchRight'] = String(index)
        const label = el('span', '', text)
        label.lang = side === 'left' ? 'zh-CN' : 'en-US'
        button.append(label)
        if (linked) button.append(el('span', 'pair-label', `Pair ${linked.left + 1}`))
        if (linked && attempt.feedback) button.classList.add(linked.left === linked.right ? 'is-correct' : 'is-incorrect')
        column.append(button)
      })
      columns.append(column)
    }
    host.append(el('p', 'small muted', 'Select a Chinese word, then its meaning. Select a paired word to change it.'), columns)
  }
  function renderSpeech(host) {
    const attempt = state()
    const item = current()
    const panel = el('section', 'activity-speech-preview')
    panel.append(el('span', 'eyebrow', 'SPEECH UI PREVIEW / NO MICROPHONE'),
      el('p', '', 'No audio is recorded or assessed. Choose an authored result to explore the feedback. This cannot pass a knowledge check.'))
    if (item.kind === 'spoken-choice' && attempt.selected === null) {
      panel.append(el('p', '', 'First choose the reply you would say.'))
    } else {
      const buttons = el('div', 'button-row')
      for (const [value, text] of [['clear', 'Preview a clear attempt'], ['incomplete', 'Preview a missed word']]) {
        const button = action(text, () => {
          attempt.voice = value
          renderResponse()
          q('#activity-submit').focus()
        })
        button.dataset.speechPreview = value
        button.setAttribute('aria-pressed', String(attempt.voice === value))
        button.disabled = Boolean(attempt.feedback)
        buttons.append(button)
      }
      panel.append(buttons)
      if (attempt.voice) {
        const preview = el('p', 'activity-speech-tokens')
        preview.lang = 'zh-CN'
        const text = item.kind === 'spoken-choice' ? item.options[attempt.selected] : item.source
        const characters = Array.from(text)
        characters.forEach((character, index) => preview.append(el('span',
          attempt.voice === 'incomplete' && index === 1 ? 'missed' : 'recognized', character)))
        panel.append(preview, el('p', 'small', 'Illustrative recognized/missed text, not accuracy or pronunciation scores.'))
      }
    }
    host.append(panel)
  }
  function renderResponse() {
    const host = q('#activity-response')
    host.replaceChildren()
    const item = current()
    if (item.kind === 'tiles') renderTiles(host)
    else if (item.kind === 'matching') renderMatching(host)
    else if (item.options) renderChoices(host)
    if (isSpeech()) renderSpeech(host)
    updateControls()
  }
  function ready() {
    const item = current()
    const attempt = state()
    if (isSpeech()) return attempt.voice !== null
    if (item.kind === 'tiles') return attempt.chosen.length > 0
    if (item.kind === 'matching') return attempt.pairs.length === item.pairs.length
    return attempt.selected !== null
  }
  function updateControls() {
    const feedback = state().feedback
    q('#activity-submit').disabled = !feedback && !ready()
    q('#activity-submit').textContent = feedback
      ? session.index === session.items.length - 1 ? 'See results' : 'Continue'
      : isSpeech() ? 'Show sample feedback' : 'Check answer'
    q('#activity-retry').hidden = session.mode === 'quiz' || !feedback || feedback.kind === 'correct'
    q('#activity-retry').textContent = feedback?.kind === 'retry' ? 'Try again' : 'Practice again'
    const support = q('#activity-support')
    support.replaceChildren()
    if (feedback) return
    if (current().audioOnly && !state().revealed) {
      support.append(action('Reveal transcript', () => {
        stopSnippetSpeech(false)
        markHelp()
        state().revealed = true
        renderSource()
        updateControls()
        q('.activity-sentence').focus()
      }, 'button quiet'))
    }
    if (current().audioOnly) support.append(action("Can't listen now", () => finishItem('Listening unavailable right now.'), 'button quiet'))
    if (isSpeech()) support.append(action("Can't speak now", () => finishItem('Speaking unavailable right now.'), 'button quiet'))
    if (!isSpeech()) support.append(action("I don't know", () => {
      state().firstOutcome ??= 'failed'
      state().feedback = { kind: 'incorrect', message: 'That is useful to know. Review the answer, then continue.' }
      renderSource()
      renderResponse()
      renderFeedback()
      q('#activity-submit').focus()
    }, 'button quiet'))
  }
  function assess() {
    const item = current()
    const attempt = state()
    let correct
    let errors = []
    let near = false
    if (item.kind === 'tiles') {
      const answer = attempt.chosen.map(instance => attempt.bank.find(tile => tile.instance === instance).text)
      const comparisons = item.answers.map(expected => compareTiles(answer, expected)).sort((a, b) => a.distance - b.distance)
      correct = comparisons[0].distance === 0
      errors = comparisons[0].errors
      near = comparisons[0].distance <= 2
    } else if (item.kind === 'matching') correct = attempt.pairs.every(pair => pair.left === pair.right)
    else if (isSpeech()) correct = attempt.voice === 'clear' && (item.kind === 'repeat' || attempt.selected === item.correct)
    else correct = attempt.selected === item.correct
    attempt.tries++
    attempt.firstOutcome ??= isSpeech() ? 'previewed' : correct && !attempt.helpUsed ? 'passed' : 'failed'
    const retry = !correct && near && attempt.tries === 1 && session.mode === 'lesson'
    attempt.feedback = {
      kind: correct ? 'correct' : retry ? 'retry' : 'incorrect', errors,
      message: correct ? 'Meaning and order are right.' : retry
        ? 'Almost there. Look at the marked tiles or a missing word, then try again.'
        : 'Compare your answer with the model below.',
    }
    if (isSpeech()) {
      attempt.feedback.message = attempt.voice === 'clear'
        ? 'Sample recognition: all words matched.' : 'Sample recognition: one word was missed.'
      if (item.kind === 'spoken-choice') attempt.feedback.message += attempt.selected === item.correct
        ? ' Your selected reply answers the question.'
        : ' Your selected reply does not answer the question, even if its words are recognized.'
    }
    renderSource()
    renderResponse()
    renderFeedback()
    q('#activity-feedback').scrollIntoView({ block: 'nearest' })
  }
  function renderFeedback() {
    const host = q('#activity-feedback')
    const feedback = state().feedback
    host.hidden = !feedback
    host.replaceChildren()
    if (!feedback) return
    host.dataset.kind = feedback.kind
    host.append(el('h3', '', isSpeech() ? 'Simulated speech feedback' : feedback.kind === 'correct' ? 'Nicely done.' : feedback.kind === 'retry' ? 'So close. Take another look.' : 'Not quite, yet.'),
      el('p', '', feedback.message))
    if (feedback.kind !== 'retry') {
      host.append(el('p', '', `Meaning / model answer: ${current().meaning}`), el('p', '', current().explanation))
    }
    if (state().firstOutcome === 'failed') host.append(el('p', 'small', feedback.kind === 'correct'
      ? 'Practice corrected. The original Check remains failed.'
      : 'This initial Check is failed. A guided retry will not replace that result.'))
    else if (isSpeech()) host.append(el('p', 'small', 'This is a preview, not evidence of speaking or listening ability.'))
  }
  function retry() {
    stopSnippetSpeech(false)
    state().feedback = null
    state().helpUsed = true
    state().voice = null
    renderSource()
    renderResponse()
    renderFeedback()
    announce('Practice retry. The initial result is unchanged.')
    q('#activity-title').focus({ preventScroll: true })
  }
  function finishItem(reason = '') {
    stopSnippetSpeech(false)
    const attempt = state()
    session.results.push({
      title: current().title, outcome: attempt.firstOutcome || 'not-assessed',
      corrected: attempt.firstOutcome === 'failed' && attempt.feedback?.kind === 'correct',
      reason, help: attempt.helpUsed,
    })
    session.index++
    render()
    const title = q(session.index === session.items.length ? '#activity-summary-title' : '#activity-title')
    title.focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
  function renderSummary() {
    const host = q('#activity-summary')
    const title = el('h2', '', 'Practice completed. Results kept distinct.')
    title.id = 'activity-summary-title'
    title.tabIndex = -1
    host.replaceChildren(el('p', 'eyebrow accent', 'A LITTLE MORE FAMILIAR'), title,
      el('p', 'small muted', 'These results describe this sample only. Nothing is written to Dictionary, lesson completion, or mastery.'))
    const list = el('ul', 'activity-result-list')
    session.results.forEach(result => {
      const item = el('li', '')
      item.append(el('strong', '', result.title), el('span', '', outcomeLabels[result.outcome]))
      if (result.corrected) item.append(el('span', '', 'Subsequent practice: corrected with help.'))
      if (result.help) item.append(el('span', '', 'Extra help used.'))
      if (result.reason) item.append(el('span', '', result.reason))
      list.append(item)
    })
    const back = el('a', 'button secondary', 'All exercises')
    back.href = '#practice'
    host.append(list, back)
  }
  function render() {
    closeHelp()
    const complete = session.index === session.items.length
    q('#activity-question').hidden = complete
    q('#activity-summary').hidden = !complete
    q('#practice-activity').setAttribute('aria-labelledby', complete ? 'activity-summary-title' : 'activity-title')
    q('#activity-mode').textContent = session.mode === 'quiz' ? 'Knowledge check / sample' : 'Lesson practice / sample'
    q('#activity-position').textContent = complete ? `${session.items.length} of ${session.items.length} completed` : `${session.index + 1} / ${session.items.length}`
    q('#activity-progress').max = session.items.length
    q('#activity-progress').value = session.index
    q('#activity-outline').replaceChildren(...session.items.map((item, index) => {
      const row = el('li', '', item.title)
      if (index === session.index) row.setAttribute('aria-current', 'step')
      return row
    }))
    updateResume()
    if (complete) { renderSummary(); return }
    q('#activity-title').textContent = current().instruction
    q('#activity-skill').textContent = current().skill
    renderSource()
    renderResponse()
    renderFeedback()
  }

  samples.forEach(item => {
    const card = el('article', 'exercise-card')
    card.append(el('span', 'tag', item.skill.split(' / ')[0]), el('h3', '', item.title), el('p', '', item.description))
    const start = action('Try exercise', () => begin('lesson', item.id))
    start.dataset.activityId = item.id
    start.setAttribute('aria-label', `Try exercise: ${item.title}`)
    card.append(start)
    q('#activity-cards').append(card)
  })
  document.querySelectorAll('[data-activity-start]').forEach(button => button.addEventListener('click', () => begin(button.dataset.activityStart)))
  q('#activity-resume').addEventListener('click', resume)
  q('#activity-restart').addEventListener('click', () => begin(session.mode, session.items.length === 1 ? session.items[0].id : undefined))
  q('#activity-submit').addEventListener('click', () => state().feedback ? finishItem() : assess())
  q('#activity-retry').addEventListener('click', retry)
  document.addEventListener('mockup-route-changed', () => {
    const open = location.hash === '#exercise'
    if (wasOpen && !open) { stopSnippetSpeech(false); closeHelp() }
    wasOpen = open
    if (open) {
      if (!session) begin('lesson')
      else render()
    }
    updateResume()
  })
  if (location.hash === '#exercise') { wasOpen = true; begin('lesson') }
})()
