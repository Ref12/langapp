import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { loadCatalog } from '../core/study/catalog'
import { unitRef } from '../core/study/contracts'
import { addToKnowledge } from '../core/study/knowledge'

beforeEach(async () => {
  window.location.hash = '#overview'
  await db.delete()
  await db.open()
})
afterEach(() => { cleanup() })

/** Every item of the first `count` units of a level goes into the knowledge set. */
async function addUnits(band: '1' | '2', count: number) {
  const catalog = await loadCatalog()
  const groups = catalog.orderedGroups.filter(entry => entry.band === band).slice(0, count)
  await addToKnowledge(groups.flatMap(({ group }) => group.units.map(unit => unitRef(unit.kind, unit.ref))))
}

const headline = async () => {
  const next = await screen.findByRole('article', { name: 'Next step' })
  return { next, heading: await within(next).findByRole('heading', { level: 2 }) }
}

describe('the Overview names the level, module and unit', () => {
  it('starts at the first unit of HSK 1', async () => {
    render(<App />)
    const { next, heading } = await headline()
    await waitFor(() => expect(heading).toHaveTextContent('HSK 1 · Introductions, politeness and 吗 questions · Unit 1 of 8'))
    expect(within(next).getByText('HSK 1: 0 of 87 units')).toBeInTheDocument()
    expect(within(next).getByText('Module 1 of 10')).toBeInTheDocument()
    expect(within(next).getByRole('progressbar', { name: 'HSK 1 units added' })).toHaveAttribute('value', '0')
    expect(within(next).getByRole('progressbar', { name: 'HSK 1 units added' })).toHaveAttribute('max', '87')
    expect(next).not.toHaveTextContent(/1491/)
    expect(next).not.toHaveTextContent(/group/i)
  })

  it('counts the unit inside its module and the units added in the level', async () => {
    await addUnits('1', 2)
    render(<App />)
    const { next } = await headline()
    await waitFor(() => expect(next).toHaveTextContent('HSK 1 · Introductions, politeness and 吗 questions · Unit 3 of 8'))
    expect(within(next).getByText('HSK 1: 2 of 87 units')).toBeInTheDocument()
    expect(within(next).getByText('Module 1 of 10')).toBeInTheDocument()
  })

  it('moves to the next module in the same level', async () => {
    await addUnits('1', 8)
    render(<App />)
    const { next } = await headline()
    await waitFor(() => expect(next).toHaveTextContent('HSK 1 · Meals, drinks and daily routines · Unit 1 of 9'))
    expect(within(next).getByText('Module 2 of 10')).toBeInTheDocument()
  })

  it('takes the numbers of HSK 2 over once HSK 1 is complete', async () => {
    await addUnits('1', 87)
    render(<App />)
    const { next } = await headline()
    await waitFor(() => expect(next).toHaveTextContent('HSK 2 · Motion, directions and comparisons · Unit 1 of 9'))
    expect(within(next).getByText('HSK 2: 0 of 72 units')).toBeInTheDocument()
    expect(within(next).getByText('Module 1 of 8')).toBeInTheDocument()
    expect(within(next).getByRole('progressbar', { name: 'HSK 2 units added' })).toHaveAttribute('max', '72')
  }, 30000)
})
