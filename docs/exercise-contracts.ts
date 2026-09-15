/**
 * Design sample, not an implemented application API.
 *
 * These TypeScript contracts are the intended source for generated Zod validators.
 * Assistant output is JSON, never executable TypeScript. Generation and application
 * integration are deliberately not part of this draft.
 *
 * The app owns rendering, progression, permissions, assessment, and attempts.
 * Answer keys, hints, and reference data are not automatically learner-visible.
 * Schema validation must be followed by checks for valid references, unique IDs,
 * supported capabilities, and meaningful evaluation criteria.
 */

export interface TextMaterial {
  type: 'text'
  text: string
  locale: string
}

export interface AudioMaterial {
  type: 'audio'
  /** Text for app-owned speech synthesis; not a visible transcript. */
  text: string
  locale: string
}

export interface ImageMaterial {
  type: 'image'
  assetId: string
  alt: string
}

export type Material = TextMaterial | AudioMaterial | ImageMaterial

export interface ExerciseSupport {
  hints?: string[]
  /** May be shown after assessment, even when hints were unavailable. */
  answerExplanation?: string
}

export interface ExerciseBase {
  id: string
  instruction: string
  learningItemIds?: string[]
  support?: ExerciseSupport
}

export interface MatchingExercise extends ExerciseBase {
  type: 'matching'
  pairs: {
    id: string
    left: Material
    right: Material
  }[]
}

export interface ChoiceExercise extends ExerciseBase {
  type: 'choice'
  prompt: Material[]
  options: { id: string; content: Material }[]
  answer:
    | { selection: 'single'; optionId: string }
    | { selection: 'multiple'; optionIds: string[] }
}

export interface AcceptedAnswers {
  type: 'accepted-answers'
  answers: string[]
  caseSensitive: boolean
  punctuation: 'significant' | 'ignored'
}

export interface ModelEvaluation {
  type: 'model'
  referenceAnswers: string[]
  rubric: string
}

/** Speech responses use their transcript here, not invented acoustic scores. */
export interface LanguageResponse {
  mode: 'text' | 'speech'
  locale: string
  evaluation: AcceptedAnswers | ModelEvaluation
}

export interface FillBlankExercise extends ExerciseBase {
  type: 'fill-blank'
  locale: string
  context?: Material[]
  parts: (
    | { type: 'text'; text: string }
    | {
        type: 'blank'
        id: string
        response:
          | { mode: 'text'; evaluation: AcceptedAnswers }
          | {
              mode: 'choice'
              options: { id: string; text: string }[]
              correctOptionId: string
            }
      }
  )[]
}

export interface OrderedTileResponse {
  mode: 'ordered-tiles'
  locale: string
  /** Shuffled by the player. Equal tiles are interchangeable, but counts matter. */
  tiles: string[]
  /** Ordered tile text, not IDs. Unused tiles are distractors. */
  acceptedAnswers: string[][]
}

export interface TranslationExercise extends ExerciseBase {
  type: 'translation'
  source: TextMaterial | AudioMaterial
  response: LanguageResponse | OrderedTileResponse
}

export interface DictationExercise extends ExerciseBase {
  type: 'dictation'
  audio: AudioMaterial
  response:
    | OrderedTileResponse
    | {
        mode: 'text'
        notation:
          | { type: 'native-script' }
          | { type: 'romanization'; system: string; tones: 'required' | 'ignored' }
        evaluation: AcceptedAnswers
      }
}

export interface SpeechImitationExercise extends ExerciseBase {
  type: 'speech-imitation'
  reference: AudioMaterial
  presentation: 'listen-and-repeat' | 'read-aloud'
  assessment: {
    type: 'pronunciation'
    criteria: ('accuracy' | 'fluency' | 'completeness')[]
  }
}

/** One situated reply, not an open-ended, multi-turn roleplay program. */
export interface ContextualResponseExercise extends ExerciseBase {
  type: 'contextual-response'
  situation: Material[]
  response:
    | LanguageResponse
    | {
        mode: 'choice'
        options: { id: string; content: Material }[]
        correctOptionIds: string[]
      }
}

/** The app resolves stored stroke data from the character and locale. */
export interface CharacterTarget {
  character: string
  locale: string
}

export interface CharacterWritingExercise extends ExerciseBase {
  type: 'character-writing'
  target: CharacterTarget
  /** A recall cue must not reveal the target glyph or a writing guide. */
  prompt: Material[]
  assessment: {
    criteria: ('form' | 'stroke-order' | 'stroke-direction' | 'placement')[]
  }
  mode:
    | { type: 'teach' }
    | { type: 'check'; teachingFallback: 'offer' | 'disabled' }
}

/** A quiz cannot start a character item with tracing or guided writing. */
export interface CharacterWritingCheckExercise extends CharacterWritingExercise {
  mode: { type: 'check'; teachingFallback: 'offer' | 'disabled' }
}

export type StandardExercise =
  | MatchingExercise
  | ChoiceExercise
  | FillBlankExercise
  | TranslationExercise
  | DictationExercise
  | SpeechImitationExercise
  | ContextualResponseExercise

/** Also usable as a standalone interaction in an assistant conversation. */
export type Exercise = StandardExercise | CharacterWritingExercise
export type QuizExercise = StandardExercise | CharacterWritingCheckExercise

export type LessonStep =
  | { type: 'explanation'; id: string; markdown: string; audio?: AudioMaterial }
  | {
      type: 'worked-example'
      id: string
      prompt: Material[]
      answer: Material[]
      explanation?: string
    }
  | { type: 'character-demonstration'; id: string; target: CharacterTarget }
  | { type: 'exercise'; id: string; exercise: Exercise }

export interface LearningActivityBase {
  schemaVersion: 1
  id: string
  /** Identifies the exact authored content used by an attempt. */
  revision: number
  /** @minLength 1 */
  title: string
  targetLocale: string
  learningItemIds?: string[]
}

export interface Lesson extends LearningActivityBase {
  type: 'lesson'
  objectives: string[]
  /** Ordered teaching material and exercises; no generated branching logic. */
  steps: LessonStep[]
}

export interface Quiz extends LearningActivityBase {
  type: 'quiz'
  instructions?: string
  exercises: QuizExercise[]
  /**
   * Hints and answer keys stay hidden until the unaided assessment is recorded.
   * Feedback and any offered teaching follow this timing policy.
   */
  feedback: 'after-answer' | 'after-quiz'
}

export type LearningActivity = Lesson | Quiz

// App-owned runtime records below are not part of assistant-authored content.
// Raw learner stroke capture stays internal to the handwriting implementation.

export type CharacterTeachingStage = 'tracing' | 'guided-writing' | 'recall'
export type AssessmentOutcome = 'passed' | 'failed'

/**
 * The app runs tracing -> guided writing -> recall. Repetition thresholds are
 * player policy, not generated code or an authored workflow language.
 */
export type CharacterTeachingProgress =
  | { status: 'in-progress'; stage: CharacterTeachingStage }
  | { status: 'completed'; postTeachingRecall: AssessmentOutcome }
  | {
      status: 'stopped'
      stage: CharacterTeachingStage
      reason: 'cancelled' | 'interrupted' | 'assessment-unavailable'
    }

/**
 * Once unaided recall fails (including requesting help), the failed result is
 * retained. Teaching can only accompany a failed Check, never turn it into a pass.
 * Cancellation or unavailable assessment alone is not evidence of failure.
 */
export type CharacterCheckResult =
  | { outcome: 'passed'; unaided: true }
  | {
      outcome: 'failed'
      reason: 'incorrect' | 'unable' | 'requested-teaching'
      teaching?: CharacterTeachingProgress
    }
  | {
      outcome: 'not-assessed'
      reason: 'cancelled' | 'interrupted' | 'assessment-unavailable'
    }

export interface CharacterWritingAttempt {
  id: string
  exerciseId: string
  progress:
    | { mode: 'teach'; teaching: CharacterTeachingProgress }
    | { mode: 'check'; status: 'awaiting-recall' }
    | { mode: 'check'; status: 'resolved'; result: CharacterCheckResult }
}

/** Progress is separate from reusable definitions and from any quiz score. */
export interface LearningActivityAttempt {
  id: string
  activityId: string
  activityRevision: number
  status: 'in-progress' | 'completed' | 'abandoned'
  /** Lesson step ID or quiz exercise ID; absent when completed. */
  currentEntryId?: string
  exerciseAttemptIds: string[]
}
