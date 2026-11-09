import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db, initializeWorkspace, loadWorkspace } from '../core/database'
import { unitRef } from '../core/study/contracts'
import { loadCatalog } from '../core/study/catalog'
import { addUnits, nextGroup } from '../core/study/knowledge'
import { bandSummaries, grammarLabel, groupRows, zhTrack, type Track } from '../data/tracks'
import { TrackHeader } from '../components/TrackHeader'
import { LanguageSwitch } from '../components/LanguageSwitch'
import { workspaceSchema } from '../core/backup-codec'

const fake: Track = { id: 'xx', language: 'xx', name: 'Fakish', glyph: 'X', bands: [] }

beforeEach(async () => { window.location.hash = '#lessons'; await db.delete(); await db.open() })
afterEach(cleanup)

/** Runs New items sets in order: introduces the first `sets` groups (everything in each), dated one day apart. */
async function introduce(sets: number) {
  const catalog = await loadCatalog()
  await initializeWorkspace()
  const known = new Set<string>()
  for (let i = 0; i < sets; i++) {
    const next = nextGroup(catalog, known)!
    await addUnits(next.newUnits, 'new', Date.UTC(2026, 0, 1 + i))
    next.units.forEach(unit => known.add(unit.ref))
  }
  return { catalog, known }
}

describe('tracks', () => {
  it('rows come from the v2 groups, grouped by band and numbered within the band', async () => {
    const catalog = await loadCatalog()
    const rows = groupRows(zhTrack, { orderedGroups: catalog.orderedGroups, titleOf: (_k, ref) => ref }, new Map(), undefined, (k, ref) => `${k}:${ref}`)
    expect(rows).toHaveLength(catalog.orderedGroups.length)
    expect(rows[0]).toMatchObject({ id: 'zh-hsk-1-lesson-0001', band: '1', number: 1 })
    const firstOfSecond = rows.find(row => row.band === '2')!
    expect(firstOfSecond.number).toBe(1)
    expect(rows.filter(row => row.band === '1')).toHaveLength(catalog.bands.find(band => band.band === '1')!.groups.length)
  })

  it('after New items sets in order: all Done, then Next, nothing partial; date is the last introduction', async () => {
    const { catalog, known } = await introduce(3)
    const workspace = await loadWorkspace()
    const next = nextGroup(catalog, known)!
    const rows = groupRows(zhTrack, { orderedGroups: catalog.orderedGroups, titleOf: () => '', },
      new Map(workspace.knowledge.map(entry => [entry.ref, entry.addedAt])), next.group.id, (k, ref) => unitRef(k as 'vocabulary', ref))
    expect(rows.slice(0, 3).map(row => row.status)).toEqual(['done', 'done', 'done'])
    expect(rows[3].status).toBe('current')
    expect(rows[3].id).toBe(next.group.id)
    expect(rows.filter(row => row.status === 'partial')).toEqual([])
    expect(rows.slice(4).every(row => row.status === 'upcoming')).toBe(true)
    expect(rows[2].completedAt).toBe(Date.UTC(2026, 0, 3))
  })

  it('renders on #lessons/list with titles from the items, Done/Next statuses and the Next row', async () => {
    await introduce(2)
    window.location.hash = '#lessons/list'
    render(<App />)
    expect(await screen.findByTestId('track-header')).toHaveTextContent('Chinese')
    const list = await screen.findByRole('region', { name: 'Chinese lessons' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')[2]).toHaveClass('current'))
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveClass('done')
    expect(rows[0]).toHaveTextContent('我')
    expect(rows[0]).toHaveTextContent('Done')
    expect(rows[2]).toHaveTextContent('Next')
    expect(rows[3]).toHaveTextContent('Upcoming')
  })

  it('renders rows only for the band holding Next; other bands are one collapsed header until expanded', async () => {
    const user = userEvent.setup()
    await introduce(2)
    window.location.hash = '#lessons/list'
    render(<App />)
    const list = await screen.findByRole('region', { name: 'Chinese lessons' })
    const bands = within(list).getAllByRole('button')
    expect(bands.map(button => button.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/HSK 1.*2 of 87 done/), expect.stringMatching(/HSK 2.*0 of 72 done/)]))
    expect(bands[0]).toHaveAttribute('aria-expanded', 'true')
    expect(bands[1]).toHaveAttribute('aria-expanded', 'false')
    expect(within(list).getAllByRole('listitem')).toHaveLength(87)
    await user.click(bands[1])
    expect(within(list).getAllByRole('listitem')).toHaveLength(87 + 72)
  })

  it('counts Done per band without building rows', async () => {
    const catalog = await loadCatalog()
    const all = new Map(catalog.orderedGroups.flatMap(({ group }) => group.units.map(unit => [unitRef(unit.kind, unit.ref), 1] as [string, number])))
    const sums = bandSummaries(zhTrack, catalog.orderedGroups, all, (k, ref) => unitRef(k as 'vocabulary', ref))
    expect(sums.every(sum => sum.done === sum.total)).toBe(true)
    expect(sums[0]).toMatchObject({ band: '1', total: 87 })
  })

  it('titles use short grammar labels and show a repeated word once', async () => {
    expect(grammarLabel('<subject> + 是 + <noun>', 's-shi4-n--identity')).toBe('是 (gr.)')
    expect(grammarLabel('<verb phrase> + <adjective>', 'vp-adj--describe')).toBe('describe (gr.)')
    expect(grammarLabel('<subject> + 想 + 去', 'x--y')).toBe('想去 (gr.)')
    const catalog = await loadCatalog()
    const source = { orderedGroups: [{ band: '1' as const, group: { id: 'g', units: [{ kind: 'vocabulary', ref: 'a' }, { kind: 'vocabulary', ref: 'b' }, { kind: 'vocabulary', ref: 'c' }] } }], titleOf: (_k: string, ref: string) => ({ a: '想', b: '住', c: '想' } as Record<string, string>)[ref] }
    expect(groupRows(zhTrack, source, new Map(), undefined, (k, ref) => `${k}:${ref}`)[0].title).toBe('想\u2009·\u2009住')
    const rows = groupRows(zhTrack, { orderedGroups: catalog.orderedGroups, titleOf: (k, ref) => { const u = catalog.units.get(unitRef(k as 'vocabulary', ref)); return !u ? ref : u.kind === 'vocabulary' ? u.record.ch : grammarLabel(u.record.pt, u.record.lb) } }, new Map(), undefined, (k, ref) => unitRef(k as 'vocabulary', ref), '1')
    expect(rows.every(row => !/[<>]/.test(row.title))).toBe(true)
  })

  it('opens a read-only group view with items and examples, no start button', async () => {
    await initializeWorkspace()
    const catalog = await loadCatalog()
    const group = catalog.orderedGroups[0].group
    window.location.hash = `#lessons/group/${group.id}`
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Items' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Examples' })).toHaveTextContent('I am a student.')
    expect(screen.getByRole('region', { name: 'Items' })).toHaveTextContent('学生')
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull()
  })

  it('becomes a picker with a second track, started tracks first', async () => {
    const user = userEvent.setup()
    const picked: string[] = []
    render(<TrackHeader tracks={[zhTrack, fake]} current={zhTrack} onSelect={track => picked.push(track.id)} />)
    const select = screen.getByRole('combobox', { name: 'Course track' })
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Chinese', 'More tracks…'])
    await user.selectOptions(select, 'More tracks…')
    expect(picked).toEqual([])
  })

  it('hides the language switch with one language and shows it with two', () => {
    const view = render(<LanguageSwitch tracks={[zhTrack]} current="zh" onChange={() => undefined} />)
    expect(view.container).toBeEmptyDOMElement()
    view.rerender(<LanguageSwitch tracks={[zhTrack, fake]} current="zh" onChange={() => undefined} />)
    expect(screen.getByRole('group', { name: 'Current language' })).toBeInTheDocument()
  })

  it('labels the Practice source from the track language', async () => {
    window.location.hash = '#practice'
    render(<App />)
    const select = await screen.findByRole('combobox', { name: 'Learning from' })
    expect(within(select).getByRole('option', { name: 'Chinese curriculum' })).toBeInTheDocument()
  })

  it('loads a profile that carries the new key, and a default profile never writes it', async () => {
    await initializeWorkspace()
    expect((await loadWorkspace()).preferences).not.toHaveProperty('currentLanguage')
    await db.preferences.update('workspace', { currentLanguage: 'zh' })
    const workspace = await loadWorkspace()
    expect(workspace.preferences.currentLanguage).toBe('zh')
    expect(workspaceSchema.shape.preferences.safeParse(workspace.preferences).success).toBe(true)
    const { currentLanguage, ...old } = workspace.preferences
    void currentLanguage
    expect(workspaceSchema.shape.preferences.safeParse(old).success).toBe(true)
  })
})
