import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db } from '../core/database'
import { curriculum, curriculumLessons, curriculumLevels } from '../data/curriculum'
import { getWord } from '../data/mandarin'

beforeEach(async () => {
  window.location.hash = '#lessons'
  await db.delete()
  await db.open()
})
afterEach(cleanup)

async function go(route: string) {
  await act(async () => { window.location.hash = route; window.dispatchEvent(new HashChangeEvent('hashchange')) })
}

describe('curriculum experience', () => {
  it('removes the sources page and all links to it from the learning interface', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Your Mandarin path.' })
    for (const [route, title] of [
      ['lessons', 'Your Mandarin path.'],
      [`lesson/${curriculumLessons[0].id}`, curriculumLessons[0].title],
      ['dictionary', 'Your learning set.'],
      ['settings', 'Your workspace.'],
    ]) {
      await go(route)
      await screen.findByRole('heading', { name: title })
      expect(document.querySelector('a[href="#curriculum-sources"]')).toBeNull()
      expect(screen.queryByRole('link', { name: 'Curriculum sources' })).not.toBeInTheDocument()
    }
    await go('curriculum-sources')
    await screen.findByRole('heading', { name: 'This page is not available' })
    expect(await db.words.count()).toBe(0)
  })

  it('shows all thirty levels and previews later goals without starting or awarding anything', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Your Mandarin path.' })
    expect(document.querySelectorAll('a.level-card')).toHaveLength(30)
    expect(screen.getAllByText('Beginner path', { exact: true })).toHaveLength(4)
    const later = curriculumLevels[4]
    await user.click(screen.getByRole('heading', { name: later.title }).closest('a')!)
    await screen.findByRole('heading', { name: later.title })
    expect(screen.getByText('Not assessed', { exact: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start lesson practice' })).not.toBeInTheDocument()
    expect(screen.queryByText('Part 1')).not.toBeInTheDocument()
    expect(await db.words.count()).toBe(0)
    expect(await db.lessons.count()).toBe(0)
  })

  it('opens real grammar and finishes a persisted small lesson without passing the level checkpoint', async () => {
    const user = userEvent.setup()
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Your Mandarin path.' })
    await user.click(screen.getByRole('link', { name: 'Continue your path' }))
    const lesson = curriculumLessons[0]
    await screen.findByRole('heading', { name: lesson.title })
    const grammar = curriculum.grammar.find(item => item.id === lesson.curriculum!.grammarIds[0])!
    await go(`lesson/${lesson.id}/${lesson.wordIds.length + 1}`)
    await screen.findByRole('heading', { name: grammar.ds })
    expect(screen.getByText(grammar.note)).toBeInTheDocument()
    expect(screen.queryByText(grammar.examples[0].target)).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Next' }))
    await screen.findByText(grammar.examples[0].target)
    expect(screen.getByText(grammar.examples[0].target)).toBeInTheDocument()
    expect(screen.queryByText(grammar.examples[1].target)).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Next' }))
    await screen.findByText(grammar.examples[1].target)
    expect(screen.queryByText(grammar.examples[0].target)).not.toBeInTheDocument()
    expect(await db.words.count()).toBe(0)
    await user.click(screen.getByText('Lesson overview and references'))
    await user.click(screen.getByRole('button', { name: 'Start lesson practice' }))
    await screen.findByRole('heading', { name: 'What does this word mean?' })
    const session = (await db.sessions.toArray())[0]
    for (const [index, question] of session.questions.entries()) {
      await screen.findByText(`Question ${index + 1} of ${session.questions.length}`)
      const word = getWord(question.wordId)
      await user.click(screen.getByRole('radio', { name: question.activity === 'meaning' ? word.meaning : word.native }))
      await user.click(screen.getByRole('button', { name: 'Check answer' }))
      await screen.findByText('Correct, without help.')
      if (index === 0) {
        view.unmount()
        render(<App />)
        await screen.findByText('Correct, without help.')
      }
      await user.click(screen.getByRole('button', { name: index === session.questions.length - 1 ? 'Finish practice' : 'Next question' }))
    }
    await screen.findByRole('heading', { name: 'One more step forward.' })
    expect(await db.words.count()).toBe(lesson.wordIds.length)
    await go('level/zh-level-01')
    await screen.findByRole('heading', { name: curriculumLevels[0].title })
    expect(screen.getByText('Reading practiced', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Not assessed', { exact: true })).toBeInTheDocument()
    await waitFor(async () => expect((await db.lessons.get(lesson.id))?.completedAt).toBeDefined())
  }, 15000)

  it('introduces one word per page, supports previous and reload, and does not award progress', async () => {
    const user = userEvent.setup()
    const lesson = curriculumLessons[0]
    const view = render(<App />)
    await screen.findByRole('heading', { name: 'Your Mandarin path.' })
    await go(`lesson/${lesson.id}`)
    await screen.findByRole('heading', { name: getWord(lesson.wordIds[0]).native })
    expect(document.querySelectorAll('.word-card')).toHaveLength(1)
    expect(document.querySelector('.word-card rt')).toHaveTextContent(getWord(lesson.wordIds[0]).pinyin)
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await user.click(screen.getByRole('link', { name: 'Next word' }))
    await screen.findByRole('heading', { name: getWord(lesson.wordIds[1]).native })
    expect(window.location.hash).toBe(`#lesson/${lesson.id}/2`)
    expect(document.querySelectorAll('.word-card')).toHaveLength(1)
    view.unmount()
    render(<App />)
    await screen.findByRole('heading', { name: getWord(lesson.wordIds[1]).native })
    await user.click(screen.getByRole('link', { name: 'Previous' }))
    await screen.findByRole('heading', { name: getWord(lesson.wordIds[0]).native })
    expect(await db.words.count()).toBe(0)
    expect(await db.lessons.count()).toBe(0)
    const grammarPages = lesson.curriculum.grammarIds.reduce((count, id) => count + 1 + curriculum.grammar.find(grammar => grammar.id === id)!.examples.length, 0)
    await go(`lesson/${lesson.id}/${lesson.wordIds.length + grammarPages + 1}`)
    await screen.findByRole('heading', { name: 'Try the reading practice.' })
    expect(document.querySelector('.word-card')).toBeNull()
    expect(screen.getByRole('button', { name: 'Start lesson practice' })).toBeEnabled()
  })

  it('rejects invalid lesson page links instead of silently showing the wrong word', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Your Mandarin path.' })
    for (const page of ['0', '-1', '999', '1.5', 'word']) {
      await go(`lesson/${curriculumLessons[0].id}/${page}`)
      await screen.findByRole('heading', { name: 'This lesson page is not available' })
      expect(document.querySelector('.word-card')).toBeNull()
    }
    expect(await db.words.count()).toBe(0)
  })

  it('searches spaced pinyin and keeps same-form curriculum senses separate from starter examples', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { name: 'Your Mandarin path.' })
    await go('dictionary')
    await screen.findByRole('heading', { name: 'Your learning set.' })
    await user.click(screen.getByRole('button', { name: 'Curriculum (205)' }))
    const search = screen.getByRole('searchbox', { name: 'Search dictionary' })
    await user.type(search, 'kafei')
    expect(screen.getByRole('heading', { name: getWord('zh-hsk3-00396-s001').native })).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'zh-hsk1-00140-')
    const cards = screen.getAllByRole('article')
    expect(cards).toHaveLength(3)
    const greeting = cards.find(card => within(card).queryByText('hello (after a pronoun)'))!
    await user.click(within(greeting).getByRole('button', { name: 'Add to learning set' }))
    await within(greeting).findByRole('button', { name: 'In your learning set' })
    expect((await db.words.toArray()).map(word => word.wordId)).toEqual(['zh-hsk1-00140-s009'])
    await user.click(screen.getByRole('button', { name: 'Starter examples (14)' }))
    await user.clear(search)
    expect(screen.getAllByRole('article')).toHaveLength(14)
  }, 15000)
})
