import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, initializeWorkspace, loadWorkspace } from '../../core/database'
import { createConversation, saveDraft, updateThread } from '../../core/assistant/store'
import { SelectionActions } from './SnippetActions'
import { clearVoiceCache, getPlaybackState, setSpeechVoicePreferences, stopBrowserSpeech } from '../../core/assistant/speech'
import { withAutoCompletedSpeechPreparation } from '../../test/mock-speech-preparation'

class Utterance {
  constructor(public text: string) {}
  voice?: SpeechSynthesisVoice
  lang = ''; rate = 1; volume = 1
  onstart?: (() => void) | null
  onend?: (() => void) | null
  onerror?: (() => void) | null
}
const voice: SpeechSynthesisVoice = { name: 'Mandarin test', lang: 'zh-CN', voiceURI: 'test-zh', localService: true, default: true }
const synthesis = Object.assign(new EventTarget(), {
  getVoices: () => [voice], speak: vi.fn<(utterance: Utterance) => void>(), cancel: vi.fn(),
})

beforeEach(async () => {
  await db.delete(); await db.open(); await initializeWorkspace()
  window.location.hash = '#reader/test'
  synthesis.speak.mockReset(); synthesis.cancel.mockReset()
  vi.stubGlobal('speechSynthesis', withAutoCompletedSpeechPreparation(synthesis))
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('fetch', vi.fn())
  clearVoiceCache(); setSpeechVoicePreferences(); stopBrowserSpeech()
})
afterEach(() => {
  cleanup(); stopBrowserSpeech(); window.getSelection()?.removeAllRanges()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

function Harness({ route = 'reader/test', text = '你好，朋友。', protectedText = false }: { route?: string; text?: string; protectedText?: boolean }) {
  return <>
    <main id="main" tabIndex={-1}><p id="source-text" data-assistant-protected={protectedText ? 'true' : undefined}>{text}</p>
      <p id="ruby-text"><ruby>茶<rt>chá</rt></ruby>。<span data-assistant-exclude>Hear</span></p></main>
    <SelectionActions route={route} title="Test source" rate={0.25} />
  </>
}
async function select(id = 'source-text') {
  await act(async () => {
    const range = document.createRange()
    range.selectNodeContents(document.getElementById(id)!)
    const selection = window.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
}
async function open() {
  const toolbar = await screen.findByRole('toolbar', { name: 'Selected text actions' })
  fireEvent.click(within(toolbar).getByRole('button', { name: 'Practice' }))
  const popup = await screen.findByRole('dialog', { name: 'Phrase practice' })
  await waitFor(() => expect(within(popup).getByRole('button', { name: 'Edit playlist' })).toBeEnabled())
  fireEvent.click(within(popup).getByRole('button', { name: 'Edit playlist' }))
  await within(popup).findByRole('list', { name: 'Phrase playlist' })
  return popup
}

it('offers Hear, Ask, and Practice and opens a silent same-page playlist with cleaned selected text', async () => {
  const before = await loadWorkspace()
  render(<Harness />)
  await select('ruby-text')
  const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' })
  expect(within(toolbar).getByRole('button', { name: 'Hear' })).toBeEnabled()
  expect(within(toolbar).getByRole('button', { name: 'Ask' })).toBeEnabled()
  const popup = await open()
  expect(within(popup).getByRole('button', { name: /^Play step 1:/ })).toHaveTextContent('茶。')
  expect(within(popup).getByLabelText('Practice speed')).toHaveValue('0.25')
  expect(within(popup).queryByRole('region', { name: 'Optional whole phrase recording' })).not.toBeInTheDocument()
  expect(synthesis.speak).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  expect(window.location.hash).toBe('#reader/test')
  expect(await db.assistantThreads.count()).toBe(0)
  expect(await loadWorkspace()).toEqual(before)
  expect(screen.queryByRole('toolbar', { name: 'Selected text actions' })).not.toBeInTheDocument()
  fireEvent.click(within(popup).getByRole('button', { name: 'Play practice' }))
  await waitFor(() => expect(synthesis.speak).toHaveBeenCalled())
  expect(synthesis.speak.mock.lastCall![0]).toMatchObject({ text: '茶。', lang: 'zh-CN', rate: 0.25 })
  fireEvent.click(within(popup).getByRole('button', { name: 'Close practice' }))
  await waitFor(() => expect(popup).not.toBeInTheDocument())
  expect(getPlaybackState().activeId).toBeUndefined()
})

it('uses the current conversation rate without replacing its draft, practice phrase, or history', async () => {
  const id = await createConversation()
  await updateThread(id, { speechRate: 0.75 })
  await saveDraft(id, 'Keep my draft')
  const thread = await db.assistantThreads.get(id)
  window.location.hash = `#conversation/${id}`
  render(<Harness route={`conversation/${id}`} />)
  await select()
  const popup = await open()
  expect(within(popup).getByLabelText('Practice speed')).toHaveValue('0.75')
  expect(await db.assistantThreads.get(id)).toEqual(thread)
  expect(await db.assistantMessages.count()).toBe(0)
})

it('does not expose Practice inside protected exercises or editable drafts', async () => {
  const view = render(<Harness protectedText />)
  await select()
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  view.rerender(<><main id="main"><p id="source-text" contentEditable suppressContentEditableWarning>你好</p></main><SelectionActions route="conversation/test" title="Draft" /></>)
  await select()
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
})

it.each([
  ['Hello there.', 'Select Mandarin text'],
  ['茶 means tea', 'Select Mandarin text'],
  ['你'.repeat(3001), '3,000 characters'],
])('keeps Ask available but explains why selection practice is unavailable (case %#)', async (text, reason) => {
  render(<Harness text={text} />)
  await select()
  const toolbar = screen.getByRole('toolbar', { name: 'Selected text actions' })
  const practice = within(toolbar).getByRole('button', { name: 'Practice' })
  expect(practice).toBeDisabled()
  expect(practice.getAttribute('title')).toContain(reason)
  expect(within(toolbar).getByText(new RegExp(reason))).toBeVisible()
  expect(within(toolbar).getByRole('button', { name: 'Ask' })).toBeEnabled()
})

it('preserves keyboard access and restores focus after closing practice', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await select()
  await user.keyboard('{Alt>}{Enter}{/Alt}')
  expect(screen.getByRole('button', { name: 'Hear' })).toHaveFocus()
  await user.tab()
  await user.tab()
  const button = screen.getByRole('button', { name: 'Practice' })
  expect(button).toHaveFocus()
  await user.keyboard('{Enter}')
  const popup = await screen.findByRole('dialog', { name: 'Phrase practice' })
  await within(popup).findByRole('region', { name: 'Current practice step' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(popup).not.toBeInTheDocument())
  expect(button).toHaveFocus()
})

it('stops existing Hear playback and reports interruption failures before opening practice', async () => {
  render(<Harness />)
  await select()
  fireEvent.click(screen.getByRole('button', { name: 'Hear' }))
  expect(getPlaybackState().activeId).toBeDefined()
  synthesis.cancel.mockImplementationOnce(() => { throw new Error('Device busy') })
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('The browser could not stop speech playback.')
  await open()
  expect(getPlaybackState().activeId).toBeUndefined()
})

it('keeps selection practice open through selection changes and closes cleanly on Escape or navigation', async () => {
  const view = render(<Harness />)
  await select()
  let popup = await open()
  await act(async () => {
    window.getSelection()?.removeAllRanges()
    document.dispatchEvent(new Event('selectionchange'))
  })
  expect(popup).toBeInTheDocument()
  fireEvent.keyDown(popup, { key: 'Escape' })
  await waitFor(() => expect(popup).not.toBeInTheDocument())
  await select()
  popup = await open()
  view.rerender(<Harness route="dictionary" />)
  await waitFor(() => expect(popup).not.toBeInTheDocument())
  expect(document.body.style.overflow).not.toBe('hidden')
})

it('retains edited chunks when reopening the same selection during this page visit', async () => {
  const user = userEvent.setup()
  const view = render(<Harness text="你好" />)
  await select()
  const popup = await open()
  await user.click(within(popup).getByRole('button', { name: 'Edit chunks' }))
  await user.click(within(popup).getByRole('button', { name: /^Split after character 1:/ }))
  await user.click(within(popup).getByRole('button', { name: 'Save chunks' }))
  await within(popup).findByRole('list', { name: 'Phrase playlist' })
  expect(within(popup).getAllByRole('button', { name: /^Play step/ })).toHaveLength(2)
  await user.click(within(popup).getByRole('button', { name: 'Close practice' }))
  await waitFor(() => expect(popup).not.toBeInTheDocument())
  await select()
  const reopened = await open()
  expect(within(reopened).getAllByRole('button', { name: /^Play step/ })).toHaveLength(2)
  expect(reopened.querySelector('[id$="-privacy"]')).toHaveTextContent(/saved in History/)
  expect(await db.assistantThreads.count()).toBe(0)
  view.rerender(<Harness route="dictionary" text="你好" />)
  await waitFor(() => expect(reopened).not.toBeInTheDocument())
  await select()
  const onAnotherPage = await open()
  expect(within(onAnotherPage).getAllByRole('button', { name: /^Play step/ })).toHaveLength(1)
})
