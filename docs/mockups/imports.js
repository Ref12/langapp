// Imports are memory-only. Binary conversion and lesson generation use authored fixtures.
const importSampleText = '# A simple request\n\nAt the tea house, ask for a cup of tea.\n\n\u6211\u60f3\u559d\u4e00\u676f\u8336\u3002\n\nI would like to drink a cup of tea.\n\n## A useful pattern\n\n\u6211\u60f3 + action expresses what you would like to do. \u676f is a measure word for a cupful.'
const importAppendSample = '# Plans for tomorrow\n\nUse a time expression before the action.\n\n\u6211\u660e\u5929\u60f3\u53bb\u516c\u56ed\u3002\n\nI would like to go to the park tomorrow.'
const importFormats = {
  text: { name: 'Text', accept: '.txt,text/plain', help: 'Paste text or choose a UTF-8 .txt file. Nothing leaves this browser.' },
  markdown: { name: 'Markdown', accept: '.md,.markdown,text/markdown', help: 'Paste Markdown or choose a UTF-8 .md file. Source formatting is retained; the preview shows basic headings and paragraphs.' },
  epub: { name: 'EPUB', accept: '.epub,application/epub+zip', help: 'A connected app would convert the EPUB into reading content. This mockup shows an original sample instead of parsing your book.' },
  images: { name: 'Images', accept: 'image/*', help: 'Choose one or more page images. AI would extract clean, structured text for review. This mockup uses an original extraction sample.' },
}
const libraryDocuments = new Map([['document-1', {
  id: 'document-1', title: 'Everyday Mandarin (sample import)', origin: 'import',
  parts: [{ reference: 'Unit 1 / sample pages 1-2', format: 'images', files: ['sample-page-01.png', 'sample-page-02.png'], text: importSampleText, simulated: true }],
}]])
let nextLibraryDocument = 2
let nextImportedLesson = 1
let selectedImportedDocument = null
let importSession = null
let importReadToken = 0

function importElement(tag, text, className = '') {
  const element = document.createElement(tag)
  element.textContent = text
  element.className = className
  return element
}
function addLibraryDocument(values) {
  const document = { origin: 'import', parts: [], ...values, id: `document-${nextLibraryDocument++}` }
  libraryDocuments.set(document.id, document)
  return document
}
function renderImportedSource(container, text) {
  container.replaceChildren()
  let paragraph = []
  const flush = () => {
    if (paragraph.length) container.append(importElement('p', paragraph.join('\n')))
    paragraph = []
  }
  // Render only headings and paragraphs; imported HTML is always literal text.
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flush()
      container.append(importElement(`h${heading[1].length + 2}`, heading[2]))
    } else if (!line.trim()) flush()
    else paragraph.push(line)
  }
  flush()
}
function showLibraryCatalog(moveFocus = false) {
  one('#library-catalog').hidden = false
  one('#library-document').hidden = true
  one('#library').setAttribute('aria-labelledby', 'library-title')
  if (moveFocus) {
    one('#library-title').focus({ preventScroll: true })
    scrollWorkspaceToTop()
  }
}
function showImportedDocument(id) {
  const document = libraryDocuments.get(id)
  if (!document) {
    notify('That imported document is not available.')
    return
  }
  selectedImportedDocument = id
  const generated = document.origin === 'assistant'
  one('#append-document').hidden = generated
  one('#library-append-note').hidden = generated
  one('#library-creation-context').hidden = !generated
  one('#library-document-origin').textContent = generated ? 'CREATED WITH ASSISTANT / SAMPLE' : 'YOUR MATERIAL, A LITTLE AT A TIME'
  if (generated) renderCreationProvenance(one('#library-creation-context'), document.creationId)
  one('#imported-document-title').textContent = document.title
  one('#imported-document-meta').textContent = generated ? 'An authored story preview, saved from your conversation.'
    : `${document.parts.length} imported ${document.parts.length === 1 ? 'section' : 'sections'} / Add more whenever you are ready`
  const parts = one('#imported-document-parts')
  parts.replaceChildren()
  document.parts.forEach((part, index) => {
    const article = importElement('article', '', 'imported-part')
    article.append(importElement('span', `SECTION ${index + 1} / ${importFormats[part.format].name}`, 'eyebrow'))
    article.append(importElement('h2', part.reference || `Import ${index + 1}`))
    article.append(importElement('p', generated ? 'Assistant / Authored sample' : part.files.length ? part.files.join(' / ') : 'Pasted source', 'small muted'))
    if (part.simulated) article.append(importElement('p', 'Conversion was simulated using original sample content. This section contains the text you reviewed, including any edits.', 'import-notice'))
    const content = importElement('div', '', 'imported-source')
    renderImportedSource(content, part.text)
    article.append(content)
    parts.append(article)
  })
  one('#library-catalog').hidden = true
  one('#library-document').hidden = false
  one('#library').setAttribute('aria-labelledby', 'imported-document-title')
  one('#imported-document-title').focus({ preventScroll: true })
  scrollWorkspaceToTop()
}
function renderImportedLibrary() {
  all('[data-library-document]').forEach((card) => card.remove())
  libraryDocuments.forEach((document) => {
    const generated = document.origin === 'assistant'
    const card = importElement('article', '', 'book-card imported-book')
    card.dataset.libraryDocument = document.id
    if (!generated) card.dataset.importedDocument = document.id
    card.dataset.collectionItem = generated ? 'saved' : 'saved imported'
    card.dataset.topic = generated ? 'everyday' : 'imported'
    card.dataset.title = document.title
    const cover = importElement('button', '', 'book-cover cover-imported')
    cover.type = 'button'
    cover.setAttribute('aria-label', `Open ${document.title}`)
    cover.append(importElement('span', generated ? 'ASSISTANT / STORY PREVIEW' : 'YOUR MATERIAL / IMPORTED', 'cover-kicker'), importElement('span', document.title, 'cover-title'), importElement('span', generated ? 'From a conversation to your Library.' : 'A book you can build a few pages at a time.', 'cover-bottom'))
    cover.addEventListener('click', () => showImportedDocument(document.id))
    const details = importElement('div', '', 'book-details')
    const heading = importElement('h3', '')
    const title = importElement('button', document.title, 'title-button')
    title.type = 'button'
    title.addEventListener('click', () => showImportedDocument(document.id))
    heading.append(title)
    details.append(importElement('span', generated ? 'Assistant / Story preview' : `${document.parts.length} imported ${document.parts.length === 1 ? 'section' : 'sections'}`, 'tag sand'), heading,
      importElement('p', generated ? 'Familiar vocabulary and new grammar targets / Authored sample' : 'Your sources stay together. Add the next section whenever you need it.'))
    const actions = importElement('div', '', 'import-card-actions')
    const open = importElement('button', 'Open document', 'button secondary')
    open.type = 'button'
    open.addEventListener('click', () => showImportedDocument(document.id))
    const append = importElement('button', 'Append material', 'button quiet')
    append.type = 'button'
    append.dataset.appendDocument = document.id
    append.addEventListener('click', () => openImport('library', document.id))
    actions.append(open)
    if (!generated) actions.append(append)
    details.append(actions)
    card.append(cover, details)
    one('#book-grid').append(card)
  })
  one('#library-count').textContent = String(3 + libraryDocuments.size)
  one('#imported-count').textContent = String([...libraryDocuments.values()].filter((document) => document.origin === 'import').length)
  filterLibrary()
}
function importError(message) {
  one('#import-error').textContent = message
  one('#import-error').hidden = false
}
function importSampleForDestination() {
  return one('#import-destination').value === 'append' ? importAppendSample : importSampleText
}
function updateImportDestination() {
  const library = importSession.context === 'library'
  const append = library && one('#import-destination').value === 'append'
  one('#import-destination-fields').hidden = !library
  one('#import-destination').disabled = !library
  one('#import-target-field').hidden = !append
  one('#import-target').disabled = !append
  one('#import-target').required = append
  one('#import-title-field').hidden = append
  one('#import-title-input').disabled = append
  one('#import-title-input').required = !append
  one('#import-title-label').textContent = library ? 'Book or document title' : 'Lesson title'
}
function updateImportFormat() {
  const format = one('#import-format').value
  const textual = format === 'text' || format === 'markdown'
  one('#import-format-help').textContent = importFormats[format].help
  one('#import-files').accept = importFormats[format].accept
  one('#import-files').multiple = format === 'images'
  one('#import-files-label').textContent = textual ? `Choose a ${importFormats[format].name.toLowerCase()} file (optional)` : format === 'images' ? 'Choose page images' : 'Choose an EPUB'
  one('#import-paste-field').hidden = !textual
  one('#import-text').disabled = !textual || importSession.reading
  one('#import-clear-files').hidden = importSession.files.length === 0
}
function setImportStage(stage) {
  importSession.stage = stage
  for (const name of ['source', 'review', 'lesson']) {
    const panel = one(`#import-${name}-step`)
    panel.hidden = name !== stage
    panel.disabled = name !== stage
  }
  one('#import-step-label').textContent = { source: '1 / Choose material', review: '2 / Review the source', lesson: '3 / Preview the lesson' }[stage]
  one('#import-back').hidden = stage === 'source'
  one('#import-primary').disabled = importSession.reading
  one('#import-primary').textContent = stage === 'source' ? 'Review source' : stage === 'lesson' ? 'Add to Lessons'
    : importSession.context === 'lessons' ? 'Preview lesson'
      : one('#import-destination').value === 'append' ? 'Append material' : 'Add to Library'
  one('#import-error').hidden = true
  one('.import-step-content').scrollTop = 0
}
function openImport(context, target = null) {
  if (target && libraryDocuments.get(target)?.origin !== 'import') {
    notify('Only imported documents can receive appended imports.')
    return
  }
  importReadToken += 1
  importSession = { context, stage: 'source', files: [], reading: false, invalidFiles: false, sourceVersion: 0, reviewedVersion: -1, sampleText: importSampleText, pending: null }
  one('#import-form').reset()
  all('#import-form input, #import-form textarea, #import-form select').forEach((field) => field.setCustomValidity(''))
  one('#import-title').textContent = context === 'library' ? 'Import to Library' : 'Import a lesson'
  one('#import-title-input').placeholder = context === 'library' ? 'A book or document worth learning from' : 'A lesson from your textbook'
  all('#import-format option').forEach((option) => {
    option.disabled = context === 'lessons' && !['text', 'images'].includes(option.value)
    option.hidden = option.disabled
  })
  const targets = one('#import-target')
  targets.replaceChildren()
  const appendTargets = [...libraryDocuments.values()].filter((document) => document.origin === 'import')
  appendTargets.forEach((document) => {
    const option = importElement('option', `${document.title} / ${document.parts.length} ${document.parts.length === 1 ? 'section' : 'sections'}`)
    option.value = document.id
    targets.append(option)
  })
  one('#import-destination option[value="append"]').disabled = appendTargets.length === 0
  one('#import-destination').value = target ? 'append' : 'new'
  if (target) targets.value = target
  one('#import-file-status').textContent = 'No file selected.'
  setImportStage('source')
  updateImportDestination()
  updateImportFormat()
  one('#import-dialog').showModal()
}
all('[data-open-import]').forEach((button) => button.addEventListener('click', () => openImport(button.dataset.openImport)))
all('a[href="#library"]').forEach((link) => link.addEventListener('click', (event) => {
  const sameRoute = location.hash === '#library'
  if (sameRoute) event.preventDefault()
  showLibraryCatalog(sameRoute)
}))
one('#append-document').addEventListener('click', () => openImport('library', selectedImportedDocument))
one('#import-destination').addEventListener('change', updateImportDestination)
one('#import-format').addEventListener('change', () => {
  importReadToken += 1
  importSession.files = []
  importSession.reading = false
  importSession.invalidFiles = false
  importSession.sourceVersion += 1
  one('#import-files').value = ''
  one('#import-file-status').textContent = 'No file selected.'
  one('#import-primary').disabled = false
  updateImportFormat()
})
one('#import-text').addEventListener('input', () => { importSession.sourceVersion += 1 })
all('#import-form input, #import-form textarea, #import-form select').forEach((field) => field.addEventListener('input', () => {
  field.setCustomValidity('')
  one('#import-error').hidden = true
}))
one('#import-files').addEventListener('change', (event) => {
  const session = importSession
  const token = ++importReadToken
  const format = one('#import-format').value
  const files = [...event.target.files]
  const matches = (file) => format === 'images' ? file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif|avif|tiff?|bmp)$/i.test(file.name)
    : format === 'text' ? /\.txt$/i.test(file.name) : format === 'markdown' ? /\.(md|markdown)$/i.test(file.name) : /\.epub$/i.test(file.name)
  session.files = files.map((file) => file.name)
  session.sourceVersion += 1
  session.reading = false
  session.invalidFiles = files.some((file) => !matches(file)) || (format !== 'images' && files.length > 1)
  session.sampleText = importSampleForDestination()
  one('#import-primary').disabled = false
  one('#import-error').hidden = true
  updateImportFormat()
  one('#import-file-status').textContent = files.length ? session.files.join(' / ') : 'No file selected.'
  if (session.invalidFiles) {
    importError(`Choose ${format === 'images' ? 'image files' : `one ${importFormats[format].name} file`} for this source format.`)
    return
  }
  if (files.length && (format === 'text' || format === 'markdown')) {
    session.reading = true
    one('#import-primary').disabled = true
    one('#import-text').disabled = true
    one('#import-file-status').textContent = 'Reading local source...'
    files[0].text().then((text) => {
      if (token !== importReadToken || session !== importSession || !one('#import-dialog').open) return
      one('#import-text').value = text
      one('#import-text').setCustomValidity('')
      session.reading = false
      session.sourceVersion += 1
      one('#import-primary').disabled = false
      updateImportFormat()
      one('#import-file-status').textContent = `${files[0].name} / read locally`
    }, (error) => {
      if (token !== importReadToken || session !== importSession || !one('#import-dialog').open) return
      session.reading = false
      session.invalidFiles = true
      one('#import-primary').disabled = false
      updateImportFormat()
      one('#import-file-status').textContent = 'File could not be read.'
      importError('The source file could not be read. Choose another file or clear the selection and paste the text.')
      console.error('Import preview file read failed:', error)
    })
  }
})
one('#import-clear-files').addEventListener('click', () => {
  one('#import-files').value = ''
  one('#import-files').dispatchEvent(new Event('change'))
})
one('#import-use-sample').addEventListener('click', () => {
  importReadToken += 1
  const format = one('#import-format').value
  importSession.sampleText = importSampleForDestination()
  importSession.files = format === 'images' ? ['sample-page-01.png', 'sample-page-02.png'] : format === 'epub' ? ['original-sample.epub'] : []
  importSession.reading = false
  importSession.invalidFiles = false
  importSession.sourceVersion += 1
  one('#import-files').value = ''
  one('#import-text').value = importSession.sampleText
  one('#import-text').setCustomValidity('')
  one('#import-title-input').setCustomValidity('')
  if (!one('#import-title-input').value.trim()) one('#import-title-input').value = importSession.context === 'library' ? 'My Mandarin reading' : 'Requests from my textbook'
  if (!one('#import-reference').value.trim()) one('#import-reference').value = one('#import-destination').value === 'append' ? 'Unit 2 / next sample pages' : 'Unit 1 / original sample pages'
  one('#import-file-status').textContent = importSession.files.length ? `Demo selection: ${importSession.files.join(' / ')}` : 'Original sample text. No file selected.'
  one('#import-primary').disabled = false
  one('#import-error').hidden = true
  updateImportFormat()
})
one('#import-reviewed-text').addEventListener('input', () => renderImportedSource(one('#import-formatted-text'), one('#import-reviewed-text').value))
one('#import-back').addEventListener('click', () => {
  setImportStage(importSession.stage === 'lesson' ? 'review' : 'source')
})
one('#import-dialog').addEventListener('close', () => {
  if (!one('#import-dialog').open) importReadToken += 1
})

function reviewImportSource() {
  const format = one('#import-format').value
  const append = importSession.context === 'library' && one('#import-destination').value === 'append'
  if (importSession.reading || importSession.invalidFiles) {
    importError(importSession.reading ? 'Wait for the source file to finish reading.' : 'Choose a supported source file before continuing.')
    return
  }
  const allowed = importSession.context === 'library' ? ['text', 'markdown', 'epub', 'images'] : ['text', 'images']
  if (!allowed.includes(format)) {
    importError('That format is not supported for this destination.')
    return
  }
  const target = append ? libraryDocuments.get(one('#import-target').value) : null
  if (append && (!target || target.origin !== 'import')) {
    importError('Choose an existing imported document.')
    return
  }
  one('#import-title-input').setCustomValidity(append || one('#import-title-input').value.trim() ? '' : 'Please enter a title.')
  const binary = format === 'epub' || format === 'images'
  if (binary && !importSession.files.length) {
    importError('Choose source files, or try the original sample material.')
    return
  }
  one('#import-text').setCustomValidity(binary || one('#import-text').value.trim() ? '' : 'Paste source text or choose a source file.')
  if (!one('#import-form').reportValidity()) return
  if (importSession.reviewedVersion !== importSession.sourceVersion) {
    one('#import-reviewed-text').value = binary ? importSession.sampleText : one('#import-text').value
    one('#import-reviewed-text').setCustomValidity('')
    importSession.reviewedVersion = importSession.sourceVersion
  }
  importSession.pending = {
    title: append ? target.title : one('#import-title-input').value.trim(),
    target: append ? target.id : null,
    reference: one('#import-reference').value.trim(),
    format, files: [...importSession.files], simulated: binary,
  }
  one('#import-review-note').textContent = binary
    ? `${format === 'images' ? 'AI extraction' : 'EPUB conversion'} is simulated. This is original sample content, not an extraction from your files. Review and edit the intended structured output.`
    : 'Your source stays in this browser. Review it before adding. The formatted preview supports basic headings and paragraphs; no translation or analysis takes place.'
  one('#import-review-destination').textContent = append
    ? `Append as section ${target.parts.length + 1} of "${target.title}". Its ${target.parts.length} existing ${target.parts.length === 1 ? 'section' : 'sections'} will be kept.`
    : `${importSession.context === 'library' ? 'New Library document' : 'Lesson source'}: ${importSession.pending.title}`
  renderImportedSource(one('#import-formatted-text'), one('#import-reviewed-text').value)
  setImportStage('review')
  one('#import-reviewed-text').focus({ preventScroll: true })
}
function previewImportedLesson() {
  const lesson = lessonPreviews.request
  one('#import-lesson-title').textContent = importSession.pending.title
  one('#import-lesson-objective').textContent = lesson.objective
  one('#import-lesson-pattern').textContent = lesson.pattern
  one('#import-lesson-example').textContent = lesson.native
  one('#import-lesson-meaning').textContent = lesson.meaning
  const words = one('#import-lesson-words')
  words.replaceChildren()
  lesson.words.forEach(([native, , meaning]) => words.append(importElement('span', `${native} / ${meaning}`, 'tag')))
  setImportStage('lesson')
  one('#import-lesson-title').focus({ preventScroll: true })
}
function commitImport() {
  const pending = importSession.pending
  const part = { reference: pending.reference, format: pending.format, files: pending.files, simulated: pending.simulated, text: pending.text }
  if (importSession.context === 'library') {
    let document = pending.target ? libraryDocuments.get(pending.target) : null
    if (pending.target && (!document || document.origin !== 'import')) {
      importError('The selected document is no longer available. Go back and choose a destination.')
      return
    }
    if (!document) {
      document = addLibraryDocument({ title: pending.title })
    }
    document.parts.push(part)
    one('#import-primary').disabled = true
    one('#import-dialog').close()
    renderImportedLibrary()
    showImportedDocument(document.id)
    notify(pending.target ? 'Preview appended. Existing sections were kept.' : 'Document preview added to your Library for this page visit.')
  } else {
    const id = `imported-lesson-${nextImportedLesson++}`
    addLessonPreview(id, { ...lessonPreviews.request, title: pending.title, source: false, importSource: part },
      'IMPORTED MATERIAL / SAMPLE GENERATION', pending.reference || 'From your imported material')
    one('#import-primary').disabled = true
    one('#import-dialog').close()
    showLesson(id)
    notify('Lesson preview added for this page visit. Generation is simulated.')
  }
}
one('#import-form').addEventListener('submit', (event) => {
  event.preventDefault()
  if (!one('#import-dialog').open || one('#import-primary').disabled) return
  if (importSession.stage === 'source') {
    reviewImportSource()
  } else if (importSession.stage === 'review') {
    one('#import-reviewed-text').setCustomValidity(one('#import-reviewed-text').value.trim() ? '' : 'Please keep some source text in the preview.')
    if (!event.currentTarget.reportValidity()) return
    importSession.pending.text = one('#import-reviewed-text').value
    if (importSession.context === 'lessons') previewImportedLesson()
    else commitImport()
  } else if (importSession.stage === 'lesson') commitImport()
})
renderImportedLibrary()
