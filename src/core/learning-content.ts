import type { z } from 'zod'
import { learningDocumentSchema, learningModelSchema, lessonDefinitionSchema, utteranceSchema } from './learning-content-schema.mjs'
import type { SpeechLocale } from './assistant/contracts'

export type LearningModel = z.infer<typeof learningModelSchema>
export type LearningDocument = z.infer<typeof learningDocumentSchema>
export type LessonDefinition = z.infer<typeof lessonDefinitionSchema>
export type Utterance = z.infer<typeof utteranceSchema>
export type ContentWord = { id: string; label: string; ch: string; pr: string; ds: string }
export type ContentGrammar = { id: string; label: string; ds: string }
export type AudioStep =
  | { kind: 'speech'; modelId: string; title?: string; text: string; locale: SpeechLocale }
  | { kind: 'response'; modelId: string; title?: string; seconds: number }

export function resolveUtterance(utterance: Utterance, words: ReadonlyMap<string, ContentWord>) {
  let text = ''
  const pronunciation: string[] = []
  for (const segment of utterance.segments) {
    if ('word' in segment) {
      const word = words.get(segment.word)
      if (!word) throw new Error(`Missing learning content vocabulary: ${segment.word}`)
      text += word.ch
      pronunciation.push(word.pr)
    } else {
      text += segment.punctuation
      pronunciation.push(segment.punctuation)
    }
  }
  return { text, pinyin: pronunciation.join(' '), translation: utterance.translation }
}

export function spokenProse(markdown: string) {
  return markdown.replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '')
    .replace(/[*`]/g, '').replace(/\n+/g, ' ').trim()
}

export function buildAudioScript(models: LearningModel[], words: ReadonlyMap<string, ContentWord>): AudioStep[] {
  const steps: AudioStep[] = []
  for (const model of models) {
    const speak = (text: string, locale: SpeechLocale = 'en-US') => {
      steps.push({ kind: 'speech', modelId: model.label, title: model.title, text: spokenProse(text), locale })
    }
    const say = (utterance: Utterance) => {
      const resolved = resolveUtterance(utterance, words)
      speak(resolved.text, 'zh-Hans')
      speak(resolved.translation)
    }
    speak(`${model.title}. ${model.description}`)
    switch (model.kind) {
      case 'concept':
        model.examples.forEach(say)
        break
      case 'phrase':
        say(model.utterance)
        speak('Now repeat the Mandarin phrase.')
        steps.push({ kind: 'response', modelId: model.label, title: model.title, seconds: 5 })
        break
      case 'conversation':
        speak('Listen to the conversation.')
        for (const turn of model.turns) {
          const speaker = model.speakers.find(entry => entry.label === turn.speaker)
          if (!speaker) throw new Error(`Unknown conversation speaker: ${turn.speaker}`)
          speak(`${speaker.name}.`)
          // First pass stays in Mandarin; translations follow in a separate review.
          speak(resolveUtterance(turn.utterance, words).text, 'zh-Hans')
        }
        speak('Now review the meaning.')
        model.turns.forEach(turn => speak(turn.utterance.translation))
        break
      case 'exercise':
        speak(model.prompt)
        if (model.cue) speak(resolveUtterance(model.cue, words).text, 'zh-Hans')
        speak(`Answer aloud. You have ${model.responseSeconds} seconds.`)
        steps.push({ kind: 'response', modelId: model.label, title: model.title, seconds: model.responseSeconds })
        speak('One possible answer.')
        say(model.answer)
        speak(model.explanation)
        break
    }
  }
  return steps
}

export function buildLessonAudioScript(lesson: LessonDefinition, models: ReadonlyMap<string, LearningModel>,
  words: ReadonlyMap<string, ContentWord>, grammar: ReadonlyMap<string, ContentGrammar>): AudioStep[] {
  const steps: AudioStep[] = []
  const speak = (modelId: string, title: string, text: string, locale: SpeechLocale = 'en-US') => {
    steps.push({ kind: 'speech', modelId, title, text: spokenProse(text), locale })
  }
  speak(lesson.label, lesson.title, `${lesson.title}. ${lesson.description}`)
  speak(lesson.label, lesson.title, 'By the end of this lesson, you will work toward these goals.')
  lesson.objectives.forEach(objective => speak(lesson.label, lesson.title, objective))
  for (const [index, section] of lesson.sections.entries()) {
    const key = `${lesson.label}-section-${index + 1}`
    speak(key, section.title, `${section.title}. ${section.description}`)
    switch (section.kind) {
      case 'vocabulary':
        speak(key, section.title, section.role === 'new' ? 'New vocabulary.' : 'Vocabulary to revisit.')
        for (const label of section.words) {
          const word = words.get(label)
          if (!word) throw new Error(`Unknown lesson vocabulary: ${label}`)
          speak(key, section.title, word.ch, 'zh-Hans')
          speak(key, section.title, word.ds)
        }
        break
      case 'grammar':
        if (!grammar.has(section.grammar)) throw new Error(`Unknown lesson grammar: ${section.grammar}`)
        for (const example of section.examples) {
          const resolved = resolveUtterance(example, words)
          speak(key, section.title, resolved.text, 'zh-Hans')
          speak(key, section.title, resolved.translation)
        }
        break
      case 'models':
        for (const label of section.models) {
          const model = models.get(label)
          if (!model) throw new Error(`Unknown lesson model: ${label}`)
          steps.push(...buildAudioScript([model], words))
        }
        break
    }
  }
  speak(`${lesson.label}-complete`, lesson.title,
    'This lesson is finished. Your responses were not recorded or assessed. Replay any section you want to revisit.')
  return steps
}
