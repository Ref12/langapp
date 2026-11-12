import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'
import { setBuildChannelForTests, setBuildLanguageForTests } from '../core/storage-names'
import { TONE_PALETTES } from '../core/tone-colour'
import { resetProfileStorage } from '../test/profile-storage'

vi.mock('../core/games/sudoku-client', () => ({ generateSudokuInWorker: vi.fn() }))

beforeEach(async () => {
  window.location.hash = ''
  document.documentElement.removeAttribute('style'); document.documentElement.removeAttribute('data-tone-scheme')
  await resetProfileStorage()
  await initializeWorkspace()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); setBuildLanguageForTests(undefined); setBuildChannelForTests(undefined) })

async function openQuick() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('button', { name: 'Workspace settings' }))
  return { user, sheet: await screen.findByRole('dialog', { name: 'Page settings' }) }
}
const prefs = async () => (await db.preferences.get('workspace'))!

describe('quick settings: reading and tone switches', () => {
  it('has Show pinyin and Tone colours in Chinese, and Tone colours switches the setting', async () => {
    window.location.hash = '#lessons'
    const { user, sheet } = await openQuick()
    expect(within(sheet).getByLabelText('Show pinyin')).toBeChecked()
    expect(within(sheet).queryByText('Japanese reading format')).toBeNull()
    const tones = within(sheet).getByLabelText('Tone colours')
    expect(tones).not.toBeChecked()
    await user.click(tones)
    await waitFor(async () => expect((await prefs()).toneColours).toBe(true))
    await user.click(within(sheet).getByLabelText('Show pinyin'))
    await waitFor(async () => expect((await prefs()).pinyin).toBe(false))
  })
  it('has no Tone colours in Japanese, shows the Japanese reading format there, and words it through the pack', async () => {
    setBuildLanguageForTests('ja')
    window.location.hash = '#lessons'
    const { sheet } = await openQuick()
    expect(within(sheet).queryByLabelText('Tone colours')).toBeNull()
    expect(within(sheet).getByLabelText('Show readings')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Japanese reading format')).toBeInTheDocument()
  })
  it('has no Tone colours and no Japanese reading format in Korean', async () => {
    setBuildLanguageForTests('ko')
    window.location.hash = '#lessons'
    const { sheet } = await openQuick()
    expect(within(sheet).queryByLabelText('Tone colours')).toBeNull()
    expect(within(sheet).queryByText('Japanese reading format')).toBeNull()
    expect(within(sheet).getByLabelText('Show readings')).toBeInTheDocument()
  })
})

describe('Settings: tone colours', () => {
  async function settings() {
    window.location.hash = '#settings'
    render(<App />)
    return screen.findByRole('heading', { name: 'Tone colours', level: 2 })
  }
  it('switches the scheme, and Hanping-style is applied to the page', async () => {
    await settings()
    expect(screen.getByLabelText('Colour scheme')).toHaveValue('pleco')
    await userEvent.selectOptions(screen.getByLabelText('Colour scheme'), 'hanping')
    await waitFor(() => expect(document.documentElement.dataset.toneScheme).toBe('hanping'))
    expect((await prefs()).toneColourScheme).toBe('hanping')
  })
  it('Custom is pre-filled from the scheme it was switched from and applies the colour of the theme in use', async () => {
    await settings()
    await userEvent.selectOptions(screen.getByLabelText('Colour scheme'), 'hanping')
    await waitFor(async () => expect((await prefs()).toneColourScheme).toBe('hanping'))
    // The page re-renders from the saved preference after the write; choose Custom only once it shows Hanping and is enabled again.
    await waitFor(() => { expect(screen.getByLabelText('Colour scheme')).toHaveValue('hanping'); expect(screen.getByLabelText('Colour scheme')).toBeEnabled() })
    await userEvent.selectOptions(screen.getByLabelText('Colour scheme'), 'custom')
    const dark2 = await screen.findByLabelText('Dark theme tone 2 colour')
    expect(dark2).toHaveValue(TONE_PALETTES.hanping.dark[1])
    expect(screen.getByLabelText('Light theme tone 2 colour')).toHaveValue(TONE_PALETTES.hanping.light[1])
    fireEvent.change(dark2, { target: { value: '#123456' } })
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--tone-2')).toBe('#123456'))
    fireEvent.change(screen.getByLabelText('Light theme tone 2 colour'), { target: { value: '#abcdef' } })
    await waitFor(async () => expect((await prefs()).toneColoursCustom?.light[1]).toBe('#abcdef'))
    const stored = (await prefs()).toneColoursCustom!
    expect([stored.dark[1], stored.light[1], stored.dark[2], stored.light[2]]).toEqual(['#123456', '#abcdef', TONE_PALETTES.hanping.dark[2], TONE_PALETTES.hanping.light[2]])
  })
  it('applies the light colours in the light theme', async () => {
    await settings()
    await userEvent.selectOptions(screen.getByLabelText('Colour scheme'), 'custom')
    const light1 = await screen.findByLabelText('Light theme tone 1 colour')
    fireEvent.change(light1, { target: { value: '#abcdef' } })
    await waitFor(async () => expect((await prefs()).toneColoursCustom?.light[0]).toBe('#abcdef'))
    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'light')
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--tone-1')).toBe('#abcdef'))
  })
  it('warns when a custom colour is below 3:1 against the page, and Reset goes back to Pleco-style', async () => {
    await settings()
    await userEvent.selectOptions(screen.getByLabelText('Colour scheme'), 'custom')
    expect(screen.queryByRole('note')).toBeNull()
    const dark4 = await screen.findByLabelText('Dark theme tone 4 colour')
    fireEvent.change(dark4, { target: { value: '#101820' } })
    expect(await screen.findByText(/Tone 4 on the dark theme is hard to read/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(document.documentElement.dataset.toneScheme).toBe('pleco'))
    expect(screen.getByLabelText('Colour scheme')).toHaveValue('pleco')
    expect(screen.queryByLabelText('Dark theme tone 4 colour')).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--tone-4')).toBe('')
    expect((await prefs()).toneColoursCustom).toBeUndefined()
  })
  it('has no tone colours section in Japanese', async () => {
    setBuildLanguageForTests('ja')
    window.location.hash = '#settings'
    render(<App />)
    await screen.findByRole('heading', { name: /Reading and appearance/ })
    expect(screen.queryByRole('heading', { name: 'Tone colours' })).toBeNull()
  })
})
