import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearningModelView } from './LearningModels'
import { LessonStudy } from './LessonStudy'
import { contentWords, contentModels, contentGrammar, learningContent, lessonDefinitions, lessonLearningModels, lessonRoutes } from '../../data/learning-content'
import { buildLessonAudioScript, buildLessonPages, resolveUtterance, spokenProse } from '../../core/learning-content'
import { getPlaybackState, stopBrowserSpeech } from '../../core/assistant/speech'
import { curriculum } from '../../data/curriculum'
import type { Workspace } from '../../core/model'

class Utterance {
  constructor(public text: string) {}
  onend?: (() => void) | null
}
const synthesis = {
  getVoices: () => [
    { name: 'English', voiceURI: 'en', lang: 'en-US', localService: true, default: false },
    { name: 'Mandarin', voiceURI: 'zh', lang: 'zh-CN', localService: true, default: false },
  ],
  speak: vi.fn<(utterance: Utterance) => void>(),
  cancel: vi.fn(),
}
const exercise = learningContent.models.find(model => model.kind === 'exercise')!
const definition = learningContent.lessons[0]
const lessonId = lessonRoutes.get(definition.label)!
const script = buildLessonAudioScript(definition, contentModels, contentWords, contentGrammar)
const pages = buildLessonPages(definition)
const workspace: Workspace = {
  preferences: { id: 'workspace', language: 'zh-Hans', name: 'Learner', theme: 'dark', pinyin: true, readingMode: 'source', sidebarCollapsed: false },
  words: [], readings: [], lessons: [], sessions: [], attempts: [], knowledge: [], studyCards: [], exerciseSessions: [], exerciseAttempts: [],
}
const study = (page?: string) => <LessonStudy definition={definition} lessonId={lessonId} page={page} practice={<p>Reading practice</p>}
  workspace={workspace} busy={false} run={operation => operation()} />

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  vi.stubGlobal('speechSynthesis', synthesis)
  synthesis.speak.mockClear()
  synthesis.cancel.mockClear()
})
afterEach(() => {
  cleanup()
  stopBrowserSpeech()
  expect(vi.getTimerCount()).toBe(0)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function enterResponseGap() {
  fireEvent.click(screen.getByRole('button', { name: 'Start guided audio' }))
  const gapIndex = script.findIndex(step => step.kind === 'response')
  for (let index = 0; index < gapIndex; index++) {
    await act(async () => {
      synthesis.speak.mock.calls[synthesis.speak.mock.calls.length - 1][0].onend?.()
      await vi.advanceTimersByTimeAsync(0)
    })
  }
  expect(screen.getByRole('status')).toHaveTextContent('Your turn')
}

describe('whole-lesson model views', () => {
  it('offers lesson types on the opening overview alongside the authored goals', () => {
    for (const lesson of curriculum.lessons) {
      const visible = lessonLearningModels(lesson.id)
      if (lesson.levelId !== 'zh-level-01') expect(visible).toEqual([])
      const cutoff = curriculum.lessons.indexOf(lesson)
      expect(visible.every(model => curriculum.lessons.findIndex(entry => entry.id === lessonRoutes.get(model.lesson)) <= cutoff)).toBe(true)
      if (lesson.levelId === 'zh-level-01') expect(lessonDefinitions.has(lesson.id)).toBe(true)
    }
    render(study())
    expect(screen.getByRole('heading', { name: 'About this lesson' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Lesson sections' })).toBeInTheDocument()
    const mode = screen.getByRole('group', { name: 'Choose your lesson type' })
    expect(within(mode).getByRole('link', { name: 'Visual lesson' })).toHaveAttribute('href', `#lesson/${lessonId}/2`)
    expect(within(mode).getByRole('link', { name: 'Guided audio lesson' })).toHaveAttribute('href', `#lesson/${lessonId}/audio`)
    expect(screen.queryByRole('navigation', { name: 'Lesson pages' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/zh-hsk\d|Item ID:|Construction ID:/)
    expect(document.body.textContent).not.toMatch(/[a-z]+[1-5]--[a-z]|Lesson label:|Grammar label:|Content label:/)
    expect(screen.getByRole('button', { name: 'Interactive audio (planned)' })).toBeDisabled()
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('does not display lesson-type choices on any visual page or the audio player', () => {
    const view = render(study())
    for (const page of [...pages.slice(1).map((_, index) => String(index + 2)), 'audio']) {
      view.rerender(study(page))
      expect(screen.queryByRole('group', { name: 'Choose your lesson type' })).not.toBeInTheDocument()
      expect(screen.queryByText('Visual lesson', { exact: true })).not.toBeInTheDocument()
      expect(screen.queryByText('Guided audio lesson', { exact: true })).not.toBeInTheDocument()
      expect(screen.queryByText('Interactive audio (planned)')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Lesson overview' })).toHaveAttribute('href', `#lesson/${lessonId}`)
      expect(screen.queryByRole('link', { name: 'Go to reading practice' })).not.toBeInTheDocument()
      expect(screen.queryByText(/This authored pilot is not an HSK-readiness assessment/)).not.toBeInTheDocument()
      if (page !== 'audio') {
        const pagination = screen.getByRole('navigation', { name: 'Lesson pages' })
        expect(pagination).toBe(view.container.querySelector('.lesson-study')!.lastElementChild)
      }
    }
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('shows names and meanings, not authoring identifiers, even in expanded details', () => {
    const view = render(study())
    for (let page = 1; page <= pages.length; page++) {
      view.rerender(study(String(page)))
      for (const detail of view.container.querySelectorAll('details')) fireEvent.click(detail.querySelector('summary')!)
      act(() => vi.advanceTimersByTime(0))
      for (const { label } of learningContent.labels.words) expect(view.container.textContent).not.toContain(label)
      for (const model of lessonLearningModels(lessonId)) expect(view.container.textContent).not.toContain(model.label)
      expect(view.container.textContent).not.toContain(definition.label)
      expect(view.container.textContent).not.toMatch(/Item ID:|Construction ID:|Lesson label:|Grammar label:|Content label:/)
      expect(view.container.querySelectorAll('.learning-requirements code')).toHaveLength(0)
      expect(view.container.querySelectorAll('.word-card').length).toBeLessThanOrEqual(1)
      expect(view.container.querySelector('.word-card details')).toBeNull()
      expect(view.container.querySelectorAll('.learning-model').length).toBeLessThanOrEqual(1)
      expect(screen.queryByRole('button', { name: /Add to learning set|In your learning set/ })).not.toBeInTheDocument()
    }
    view.rerender(study(String(pages.findIndex(page => page.kind === 'vocabulary') + 1)))
    expect(screen.getByRole('heading', { name: '\u6211' })).toBeInTheDocument()
    expect(view.container.querySelector('.word-card rt')).toHaveTextContent('w\u01d2')
    expect(screen.getByText('I, me, my')).toBeInTheDocument()
    view.rerender(study(String(pages.findIndex(page => page.kind === 'model') + 1)))
    expect(screen.getByRole('heading', { name: 'Pinyin is a pronunciation map' })).toBeInTheDocument()
  })

  it('teaches the grammar explanation with its first example instead of a label-only page', () => {
    const grammar = definition.sections.find(section => section.kind === 'grammar')!
    const index = pages.findIndex(page => page.kind === 'grammar')
    const view = render(study(String(index + 1)))
    const example = resolveUtterance(grammar.examples[0], contentWords)
    expect(screen.getByRole('heading', { name: grammar.title })).toBeInTheDocument()
    const section = screen.getByRole('region', { name: grammar.title })
    for (const paragraph of grammar.description.trim().split(/\n\s*\n/)) {
      expect(section).toHaveTextContent(spokenProse(paragraph))
    }
    expect(section).toHaveTextContent('sh\u00ec')
    expect(section).not.toHaveTextContent('identity verb')
    expect(screen.getByText(example.text)).toBeVisible()
    expect(screen.getByText(example.translation)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hear' })).toBeEnabled()
    expect(screen.queryByText(contentGrammar.get(grammar.grammar)!.ds)).not.toBeInTheDocument()
    expect(view.container.querySelector('details')).toBeNull()
    const next = pages[index + 1]
    expect(next.kind).toBe('model')
    view.rerender(study(String(index + 2)))
    expect(view.container.querySelector('article.grammar-reference')).toBeNull()
  })

  it('keeps grammar descriptions without rendering an empty card when no example is authored', () => {
    const grammar = definition.sections.find(section => section.kind === 'grammar')!
    const withoutExample = { ...definition, sections: [{ ...grammar, examples: [] }] }
    const view = render(<LessonStudy definition={withoutExample} lessonId={lessonId} page="2" practice={<p>Reading practice</p>}
      workspace={workspace} busy={false} run={operation => operation()} />)
    const section = screen.getByRole('region', { name: grammar.title })
    for (const paragraph of grammar.description.trim().split(/\n\s*\n/)) {
      expect(section).toHaveTextContent(spokenProse(paragraph))
    }
    expect(view.container.querySelector('article.grammar-reference')).toBeNull()
  })

  it('starts each exercise page without a previous answer or response', () => {
    const exercisePage = pages.findIndex(page => page.kind === 'model' && page.model === exercise.label) + 1
    const view = render(study(String(exercisePage)))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My answer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal model answer' }))
    expect(screen.getByText('ONE POSSIBLE ANSWER / SELF-CHECK')).toBeInTheDocument()
    view.rerender(study(String(exercisePage - 1)))
    view.rerender(study(String(exercisePage)))
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(screen.queryByText('ONE POSSIBLE ANSWER / SELF-CHECK')).not.toBeInTheDocument()
  })

  it('hides exercise answers until requested and keeps learner input separate from feedback', () => {
    render(<LearningModelView model={exercise} pinyin={false} lessonLabel={exercise.lesson} />)
    const article = screen.getByRole('article')
    expect(within(article).queryByText('ONE POSSIBLE ANSWER / SELF-CHECK')).not.toBeInTheDocument()
    const response = screen.getByRole('textbox', { name: /Your response/ })
    fireEvent.change(response, { target: { value: 'My own answer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reveal model answer' }))
    expect(response).toHaveValue('My own answer')
    expect(within(article).getByText(resolveUtterance(exercise.answer, contentWords).translation)).toBeInTheDocument()
    expect(within(article).getByText(/does not assess pronunciation or award progress/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide model answer' }))
    expect(within(article).queryByText('ONE POSSIBLE ANSWER / SELF-CHECK')).not.toBeInTheDocument()
  })

  it('starts narration with the lesson description instead of jumping to the exercise', () => {
    const view = render(study('audio'))
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start guided audio' }))
    expect(synthesis.speak.mock.calls[0][0].text).toContain(spokenProse(definition.description))
    expect(getPlaybackState().activeId).toBeTruthy()
    view.rerender(study())
    expect(getPlaybackState().activeId).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['unmount', 'escape', 'hidden', 'overview'] as const)('clears response timers on %s', async action => {
    const view = render(study('audio'))
    await enterResponseGap()
    const calls = synthesis.speak.mock.calls.length
    if (action === 'unmount') view.unmount()
    if (action === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (action === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    }
    if (action === 'overview') view.rerender(study())
    act(() => vi.advanceTimersByTime(60_000))
    expect(synthesis.speak).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)
  })
})
