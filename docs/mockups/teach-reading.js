let readingSelection = null
let readingPreparation = null

function teachingMaterial(id) {
  if (id === 'story-tea') {
    return { id, title: 'A morning at the tea house', language: 'English',
      chapters: [{ title: 'A place to pause / sample passage', text: sourcePassage.map((parts) => parts.map((part) => typeof part === 'string' ? part : words[part.id].gloss).join('')).join('\n\n') }] }
  }
  if (id === 'story-rain' || id === 'story-city') {
    const sample = samples[id.slice(6)]
    return { id, title: sample.title, language: 'English', chapters: [{ title: sample.title, text: sample.text }] }
  }
  const document = libraryDocuments.get(id)
  if (!document) return null
  return { id, title: document.title, language: document.origin === 'assistant' ? 'Mandarin' : '',
    chapters: document.parts.map((part, index) => ({ title: part.reference || `Section ${index + 1}`, text: part.text })) }
}
function updateReadingSelection() {
  if (one('#teach-reading-dialog').open) return
  const selection = window.getSelection()
  readingSelection = null
  if (selection && !selection.isCollapsed && selection.rangeCount) {
    const range = selection.getRangeAt(0)
    const passage = one('#reading-passage')
    if (document.body.dataset.screen === 'reader' && passage.contains(range.startContainer) && passage.contains(range.endContainer)) {
      const paragraphs = [...passage.children].map((paragraph) => [...paragraph.childNodes].map((node) => {
        if (!range.intersectsNode(node)) return ''
        if (node.nodeType === Node.ELEMENT_NODE) return node.dataset.originalText || ''
        const start = range.startContainer === node ? range.startOffset : 0
        const end = range.endContainer === node ? range.endOffset : node.textContent.length
        return node.textContent.slice(start, end)
      }).join('')).filter(Boolean)
      readingSelection = { id: 'story-tea', language: state.mode === 'target' ? 'Mandarin' : 'English', text: paragraphs.join('\n\n').trim() }
    } else if (document.body.dataset.screen === 'library' && !one('#library-document').hidden) {
      const sources = all('#imported-document-parts .imported-source')
      if (sources.some((source) => source.contains(range.startContainer)) && sources.some((source) => source.contains(range.endContainer))) {
        const blocks = sources.flatMap((source) => [...source.children]).filter((block) => !block.matches('.snippet-actions') && range.intersectsNode(block))
        const text = blocks.map((block) => {
          const selected = range.cloneRange()
          if (!block.contains(range.startContainer)) selected.setStart(block, 0)
          if (!block.contains(range.endContainer)) selected.setEnd(block, block.childNodes.length)
          return selected.toString()
        }).filter(Boolean).join('\n\n').trim()
        readingSelection = { id: selectedImportedDocument, language: teachingMaterial(selectedImportedDocument).language, text }
      }
    }
  }
  if (!readingSelection?.text) readingSelection = null
  all('[data-teach-selection]').forEach((button) => { button.disabled = !readingSelection })
  const label = readingSelection?.id === 'story-tea' ? 'Teach selected text' : 'Teach me to read this'
  one('#teach-reader-action').setAttribute('aria-label', label)
  one('#teach-reader-action').title = label
}
document.addEventListener('selectionchange', updateReadingSelection)
document.addEventListener('pointerdown', (event) => {
  if (readingSelection && event.target.closest('[data-teach-selection], [data-teach-library-item], [data-teach-current-document]')) event.preventDefault()
})
document.addEventListener('mockup-route-changed', () => {
  readingSelection = null
  all('[data-teach-selection]').forEach((button) => { button.disabled = true })
  one('#teach-reader-action').setAttribute('aria-label', 'Teach me to read this')
  one('#teach-reader-action').title = 'Teach me to read this'
})
function selectedTeachingSource() {
  const scope = one('input[name="reading-scope"]:checked').value
  const material = readingPreparation.material
  if (scope === 'selection') return { scope, label: 'Selected text', text: readingPreparation.selection.text, language: readingPreparation.selection.language }
  if (scope === 'chapter') {
    const chapter = material.chapters[Number(one('#teach-chapter').value)]
    return { scope, label: chapter.title, text: chapter.text, language: material.language }
  }
  return { scope, label: 'Whole text', text: material.chapters.map((chapter) => chapter.text).join('\n\n'), language: material.language }
}
function updateTeachingScope() {
  const source = selectedTeachingSource()
  one('#teach-chapter-field').hidden = source.scope !== 'chapter'
  one('#teach-source-preview').value = source.text
  one('#teach-source-size').textContent = `${source.text.length.toLocaleString()} characters retained / ${source.label}`
  one('#teach-language').value = source.language || readingPreparation.language || ''
  one('#teach-language').readOnly = Boolean(source.language)
  one('#teach-language').setCustomValidity('')
}
function openReadingPreparation(id, scope = 'whole', chapterIndex = 0) {
  const material = teachingMaterial(id)
  if (!material) {
    notify('That reading material is not available.')
    return
  }
  const selection = readingSelection?.id === id ? { ...readingSelection } : null
  if (scope === 'selection' && !selection) {
    notify('Select some text in the reader or document first.')
    return
  }
  readingPreparation = { material, selection }
  one('#teach-reading-form').reset()
  one('#teach-material-title').textContent = material.title
  one('#teach-selection-option').disabled = !selection
  one('#teach-selection-help').hidden = Boolean(selection)
  one('#teach-chapter').replaceChildren()
  material.chapters.forEach((chapter, index) => {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = chapter.title
    one('#teach-chapter').append(option)
  })
  one('#teach-chapter').value = String(chapterIndex)
  one(`input[name="reading-scope"][value="${scope}"]`).checked = true
  updateTeachingScope()
  one('#teach-reading-dialog').showModal()
}
document.addEventListener('click', (event) => {
  const item = event.target.closest('[data-teach-library-item]')
  if (item) openReadingPreparation(item.dataset.teachLibraryItem, item.dataset.teachChapter ? 'chapter' : item.id === 'teach-reader-action' && readingSelection ? 'selection' : 'whole', Number(item.dataset.teachChapter || 0))
  else if (event.target.closest('[data-teach-current-document]')) openReadingPreparation(selectedImportedDocument)
  else if (event.target.closest('[data-teach-selection]')) openReadingPreparation(readingSelection?.id, 'selection')
})
all('input[name="reading-scope"]').forEach((input) => input.addEventListener('change', updateTeachingScope))
one('#teach-chapter').addEventListener('change', updateTeachingScope)
one('#teach-language').addEventListener('input', (event) => {
  event.currentTarget.setCustomValidity('')
  readingPreparation.language = event.currentTarget.value
})
one('#teach-reading-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const language = one('#teach-language').value.trim()
  one('#teach-language').setCustomValidity(language ? '' : 'Choose the language of this material.')
  if (!event.currentTarget.reportValidity()) return
  const material = readingPreparation.material
  const source = selectedTeachingSource()
  const request = { materialId: material.id, title: material.title, scope: source.scope, scopeLabel: source.label, language, text: source.text }
  const prompt = `Teach me the vocabulary and grammar I need to read ${source.scope === 'whole' ? 'the whole text' : source.scope === 'chapter' ? `the chapter or section "${source.label}"` : 'this selection'} of "${material.title}" in ${language}. Use my learning history to build on what I know. Teach the necessary language, then help me read it myself; do not simply translate it.`
  const context = `Reading material: ${material.title}\nScope: ${source.label}\nLanguage: ${language}\n\n${source.text}`
  one('#teach-reading-dialog').close()
  startAssistantTask('lesson', prompt, context, request)
})
one('#teach-reading-dialog').addEventListener('close', () => { readingPreparation = null })

function renderReadingPreparationPreview(container, request) {
  container.append(chatElement('p', '', `Read in ${request.language} / ${request.scopeLabel}`),
    chatElement('p', '', 'Build the vocabulary and grammar needed for this material, then practice reading it without a translation.'),
    chatElement('p', 'import-notice', 'Reading preparation request preview. Source and scope are retained, but no personalized lesson or vocabulary assessment has been generated.'))
  const source = chatElement('details', 'creation-content-preview')
  source.append(chatElement('summary', '', 'Selected reading material'), chatElement('p', 'creation-request-text', request.text))
  if (request.language === 'Mandarin') setSnippetActions(source.lastElementChild, { source: `${request.title} / ${request.scopeLabel}` })
  container.append(source)
}
function readingPreparationLesson(request) {
  return {
    title: `Prepare to read: ${request.title}`,
    objective: `Read ${request.scopeLabel.toLowerCase()} in ${request.language}, using the vocabulary and grammar needed for the material.`,
    native: request.text.slice(0, 400) + (request.text.length > 400 ? '...' : ''),
    nativeLanguage: request.language === 'Mandarin' ? 'zh-Hans' : request.language === 'English' ? 'en' : '',
    romanization: '', meaning: 'An excerpt of the selected material, not a translation.',
    pattern: 'Vocabulary in context; sentence patterns; supported reading; an independent reread.',
    usage: 'This is a saved preparation request, not a generated lesson. The full source and scope remain in the Assistant context. Live analysis and teaching are not connected in this mockup.',
    source: false, words: [], readingRequest: request,
  }
}
