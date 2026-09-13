// Labels are independent of an item's source or its append/import capabilities.
const libraryLabels = new Map([
  ['everyday', 'Everyday life'], ['nature', 'Nature'], ['culture', 'Culture'],
  ['sample', 'Sample'], ['imported', 'Imported'], ['assistant', 'Assistant'],
])
const libraryItems = new Map()
const selectedLibraryLabels = new Set()
let nextLibraryLabel = 1
let libraryLabelEdit = null

function registerLibraryItem(id, title, labels) {
  const existing = libraryItems.get(id)
  if (existing) existing.title = title
  else libraryItems.set(id, { id, title, labels: new Set(labels) })
}
function libraryElement(tag, text, className = '') {
  const element = document.createElement(tag)
  element.textContent = text
  element.className = className
  return element
}
function filterLibrary() {
  const query = one('#library-search').value.trim().toLocaleLowerCase()
  let count = 0
  all('#book-grid > [data-library-item]').forEach((card) => {
    const item = libraryItems.get(card.dataset.libraryItem)
    const visible = item.title.toLocaleLowerCase().includes(query)
      && [...selectedLibraryLabels].every((id) => item.labels.has(id))
    card.hidden = !visible
    if (visible) count += 1
  })
  one('#library-empty').hidden = count !== 0
  one('#book-grid').hidden = count === 0
  one('#library-count').textContent = `${count} of ${libraryItems.size} items`
}
function renderLibraryLabelFilters() {
  const focused = document.activeElement.dataset.libraryLabelFilter
  const container = one('#library-label-filters')
  container.replaceChildren()
  const makeFilter = (id, name) => {
    const selected = id === 'all' ? selectedLibraryLabels.size === 0 : selectedLibraryLabels.has(id)
    const button = libraryElement('button', name, `chip${selected ? ' active' : ''}`)
    button.type = 'button'
    button.dataset.libraryLabelFilter = id
    button.setAttribute('aria-pressed', String(selected))
    button.addEventListener('click', () => {
      if (id === 'all') selectedLibraryLabels.clear()
      else if (selected) selectedLibraryLabels.delete(id)
      else selectedLibraryLabels.add(id)
      renderLibraryLabelFilters()
      filterLibrary()
    })
    container.append(button)
  }
  makeFilter('all', 'All items')
  libraryLabels.forEach((name, id) => makeFilter(id, name))
  if (focused) all('[data-library-label-filter]').find((button) => button.dataset.libraryLabelFilter === focused)?.focus({ preventScroll: true })
}
function renderLibraryItemTools() {
  all('#book-grid > [data-library-item]').forEach((card) => {
    const item = libraryItems.get(card.dataset.libraryItem)
    card.querySelector('.library-item-tools')?.remove()
    const tools = libraryElement('div', '', 'library-item-tools')
    const labels = libraryElement('div', '', 'item-label-list')
    item.labels.forEach((id) => labels.append(libraryElement('span', libraryLabels.get(id), 'tag')))
    if (!item.labels.size) labels.append(libraryElement('span', 'No labels', 'small muted'))
    const edit = libraryElement('button', 'Labels', 'button quiet')
    edit.type = 'button'
    edit.dataset.editLibraryLabels = item.id
    edit.setAttribute('aria-label', `Edit labels for ${item.title}`)
    edit.addEventListener('click', () => openLibraryLabels(item.id))
    const teach = libraryElement('button', 'Teach me to read', 'button secondary')
    teach.type = 'button'
    teach.dataset.teachLibraryItem = item.id
    teach.setAttribute('aria-label', `Teach me to read ${item.title}`)
    tools.append(labels, edit, teach)
    card.querySelector('.book-details').append(tools)
  })
}
function renderLabelChoices() {
  const choices = new Map([...libraryLabels, ...libraryLabelEdit.created])
  const container = one('#library-label-options')
  container.replaceChildren()
  choices.forEach((name, id) => {
    const label = libraryElement('label', '', 'label-choice')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.value = id
    checkbox.checked = libraryLabelEdit.selected.has(id)
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) libraryLabelEdit.selected.add(id)
      else libraryLabelEdit.selected.delete(id)
    })
    label.append(checkbox, libraryElement('span', name))
    container.append(label)
  })
}
function openLibraryLabels(id) {
  const item = libraryItems.get(id)
  if (!item) {
    notify('That Library item is not available.')
    return
  }
  libraryLabelEdit = { id, selected: new Set(item.labels), created: new Map() }
  one('#library-label-form').reset()
  one('#library-new-label').setCustomValidity('')
  one('#library-label-title').textContent = `Labels for ${item.title}`
  renderLabelChoices()
  one('#library-label-dialog').showModal()
}
function stageLibraryLabel() {
  const input = one('#library-new-label')
  const name = input.value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  input.setCustomValidity(!name ? 'Enter a label name.' : name.length > 48 ? 'Use 48 characters or fewer.' : '')
  if (!input.reportValidity()) return false
  const choices = [...libraryLabels, ...libraryLabelEdit.created]
  let id = choices.find(([, existing]) => existing.toLocaleLowerCase() === name.toLocaleLowerCase())?.[0]
  if (!id) {
    id = `label-${nextLibraryLabel++}`
    libraryLabelEdit.created.set(id, name)
  }
  libraryLabelEdit.selected.add(id)
  input.value = ''
  renderLabelChoices()
  input.focus()
  return true
}
one('#create-library-label').addEventListener('click', stageLibraryLabel)
one('#library-new-label').addEventListener('input', (event) => event.currentTarget.setCustomValidity(''))
one('#library-label-form').addEventListener('submit', (event) => {
  event.preventDefault()
  if (one('#library-new-label').value && !stageLibraryLabel()) return
  const item = libraryItems.get(libraryLabelEdit.id)
  libraryLabelEdit.created.forEach((name, id) => libraryLabels.set(id, name))
  item.labels = new Set(libraryLabelEdit.selected)
  renderLibraryItemTools()
  renderLibraryLabelFilters()
  filterLibrary()
  one('#library-label-dialog').close()
  const card = all('[data-library-item]').find((element) => element.dataset.libraryItem === item.id)
  const focus = !card.hidden ? card.querySelector('[data-edit-library-labels]') : one('#library-search')
  focus.focus({ preventScroll: true })
  notify('Labels updated. An item can belong to several labels.')
})
one('#library-label-dialog').addEventListener('close', () => { libraryLabelEdit = null })
one('#library-search').addEventListener('input', filterLibrary)
one('#reset-library').addEventListener('click', () => {
  one('#library-search').value = ''
  selectedLibraryLabels.clear()
  renderLibraryLabelFilters()
  filterLibrary()
  one('#library-search').focus()
})
all('#book-grid > [data-library-item]').forEach((card) => {
  registerLibraryItem(card.dataset.libraryItem, card.dataset.title, card.dataset.labels.split(' '))
})
renderLibraryItemTools()
renderLibraryLabelFilters()
filterLibrary()
