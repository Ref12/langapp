import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LearningModelView } from './LearningModels'
import { LessonStudy } from './LessonStudy'
import { contentWords, contentModels, contentGrammar, learningContent, lessonDefinitions, lessonLearningModels, lessonRoutes } from '../../data/learning-content'
import { buildLessonAudioScript, resolveUtterance, spokenProse } from '../../core/learning-content'
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
const workspace: Workspace = {
  preferences: { id: 'workspace', language: 'zh-Hans', name: 'Learner', theme: 'dark', pinyin: true, readingMode: 'source', sidebarCollapsed: false },
  words: [], readings: [], lessons: [], sessions: [], attempts: [],
}
const study = () => <LessonStudy definition={definition} lessonId={lessonId} workspace={workspace} busy={false} run={operation => operation()} />

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

function enterResponseGap() {
  fireEvent.click(screen.getByRole('button', { name: 'Guided audio lesson' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start guided audio' }))
  const gapIndex = script.findIndex(step => step.kind === 'response')
  for (let index = 0; index < gapIndex; index++) {
    act(() => {
      synthesis.speak.mock.calls[synthesis.speak.mock.calls.length - 1][0].onend?.()
      vi.advanceTimersByTime(0)
    })
  }
  expect(screen.getByRole('status')).toHaveTextContent('Your turn')
}

describe('whole-lesson model views', () => {
  it('shows only authored, in-cutoff models and places mode selection before lesson sections', () => {
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
    const mode = screen.getByRole('group', { name: 'Lesson mode' })
    const firstSection = document.getElementById('lesson-section-0')!
    expect(mode.compareDocumentPosition(firstSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/zh-hsk\d|Item ID:|Construction ID:/)
    expect(document.body.textContent).not.toMatch(/[a-z]+[1-5]--[a-z]|Lesson label:|Grammar label:|Content label:/)
    expect(screen.getByRole('button', { name: 'Interactive audio (planned)' })).toBeDisabled()
    expect(synthesis.speak).not.toHaveBeenCalled()
  })

  it('shows names and meanings, not authoring identifiers, even in expanded details', () => {
    const view = render(study())
    for (const detail of view.container.querySelectorAll('details')) fireEvent.click(detail.querySelector('summary')!)
    act(() => vi.advanceTimersByTime(0))
    for (const { label } of learningContent.labels.words) expect(view.container.textContent).not.toContain(label)
    for (const model of lessonLearningModels(lessonId)) expect(view.container.textContent).not.toContain(model.label)
    expect(view.container.textContent).not.toContain(definition.label)
    expect(view.container.querySelectorAll('.learning-requirements code')).toHaveLength(0)
    expect(screen.getByRole('heading', { name: '\u6211' })).toBeInTheDocument()
    expect(screen.getByText('w\u01d2')).toBeInTheDocument()
    expect(screen.getByText('I, me, my')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pinyin is a pronunciation map' })).toBeInTheDocument()
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
    render(study())
    fireEvent.click(screen.getByRole('button', { name: 'Guided audio lesson' }))
    expect(synthesis.speak).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start guided audio' }))
    expect(synthesis.speak.mock.calls[0][0].text).toContain(spokenProse(definition.description))
    expect(getPlaybackState().activeId).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Visual lesson' }))
    expect(getPlaybackState().activeId).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['unmount', 'escape', 'hidden', 'visual'] as const)('clears response timers on %s', action => {
    const view = render(study())
    enterResponseGap()
    const calls = synthesis.speak.mock.calls.length
    if (action === 'unmount') view.unmount()
    if (action === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (action === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      fireEvent(document, new Event('visibilitychange'))
    }
    if (action === 'visual') fireEvent.click(screen.getByRole('button', { name: 'Visual lesson' }))
    act(() => vi.advanceTimersByTime(60_000))
    expect(synthesis.speak).toHaveBeenCalledTimes(calls)
    expect(vi.getTimerCount()).toBe(0)
  })
})
