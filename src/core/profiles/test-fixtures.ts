import { createEmptyProfile } from './codec'
import { type ProfileSnapshot } from './contracts'

export function populatedProfile(running = false): ProfileSnapshot {
  const snapshot = createEmptyProfile({ id: 'default', name: 'Synthetic profile' }, {
    aiConnection: {
      apiType: 'responses', baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic-ai-key', model: 'synthetic-model',
      nativeTools: true, structuredOutput: false, storageAcknowledged: true,
    },
    speechConnection: { provider: 'azure', region: 'eastus', apiKey: 'synthetic-speech-key', storageAcknowledged: true },
    defaultSpeechRate: 0.75,
    speechVoices: { 'zh-Hans': { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural' } },
  })
  snapshot.exportedAt = 123
  snapshot.settings.preferences.name = 'Existing learner'
  snapshot.knowledge = {
    words: [{
      wordId: 'zh:tea', language: 'zh-Hans', introducedAt: 1, introducedFrom: 'dictionary', attempts: 1,
      independentCorrect: 1, successfulDays: ['2026-01-01'], successfulActivities: ['meaning'], dueAt: 200000,
    }],
    readings: [{ storyId: 'zh:tea-house', passage: 1, completed: [0], updatedAt: 3 }],
    lessons: [{ lessonId: 'zh:greetings', startedAt: 1, completedAt: 3 }],
    sessions: [{
      id: 'legacy-session', kind: 'all', questions: [{ wordId: 'zh:tea', activity: 'meaning', options: ['zh:tea', 'zh:rain'], revealed: false }],
      cursor: 0, status: 'completed', createdAt: 1, completedAt: 3,
    }],
    attempts: [{
      id: 'legacy-session:0', sessionId: 'legacy-session', question: 0, wordId: 'zh:tea', activity: 'meaning',
      answerId: 'zh:tea', correct: true, assisted: false, createdAt: 2,
    }],
    study: {
      knowledge: [{ ref: 'vocabulary:tea', kind: 'vocabulary', lb: 'tea', band: '1', addedAt: 1, source: 'dictionary' }],
      cards: [{
        id: 'vocabulary:tea:reading', ref: 'vocabulary:tea', domain: 'reading', due: 10000,
        stability: 2.5, difficulty: 4, reps: 3, lapses: 1, state: 'review', lastReview: 2, updatedAt: 3,
      }],
      sessions: [{
        id: 'study-session', mode: 'review', domain: 'reading', targetRefs: ['vocabulary:tea'], reviewRefs: [],
        exercises: [{
          id: 'exercise', type: 'choice', targets: ['vocabulary:tea'], direction: 'zh-to-en',
          question: '茶', options: ['tea', 'rain'], answer: 0, explanation: 'Tea.',
        }],
        cursor: 0, status: 'completed', model: 'synthetic-model', rejected: ['Synthetic rejected draft'],
        createdAt: 1, completedAt: 3,
      }],
      attempts: [{
        id: 'study-session:0', sessionId: 'study-session', index: 0, refs: ['vocabulary:tea'],
        response: '0', correct: true, createdAt: 2,
      }],
    },
  }
  const phrase = { type: 'speech', text: '茶', locale: 'zh-Hans', meaning: 'tea' } as const
  snapshot.conversations = {
    threads: [{
      id: 'thread', title: 'Synthetic conversation', draft: 'My saved draft', source: { text: '茶\n', title: 'Tea', route: 'dictionary' },
      mode: 'conversation', shadowIntent: 'repeat', shadowPhrase: phrase, practiceInput: 'spoken-feedback',
      speechFeedback: true, voiceEnabled: true, voiceInputLocale: 'zh-Hans', practicePhrase: phrase,
      practiceDraft: '茶', romanization: false, speechRate: 0.5, returnRoute: 'dictionary', createdAt: 1, updatedAt: 3,
    }],
    messages: [{
      id: 'user', threadId: 'thread', sequence: 0, role: 'user', text: 'Tea', blocks: [],
      practice: { phrase, input: 'speech-transcript' }, mode: 'conversation', intent: 'repeat',
      status: 'completed', runId: 'run', createdAt: 1,
    }, {
      id: 'reply', threadId: 'thread', sequence: 1, role: 'assistant', text: '', blocks: running ? [] : [phrase],
      mode: 'conversation', intent: 'repeat', status: running ? 'pending' : 'completed', runId: 'run', createdAt: 2,
      ...(running ? {} : { practiceResults: [{ blockIndex: 0, result: {
        kind: 'azure' as const, phrase, transcript: '茶', assessment: {
          status: 'assessed' as const, accuracy: 98, fluency: 95, completeness: 100,
          words: [{ text: '茶', accuracy: 98, phonemes: [{ text: 'ch', accuracy: 98 }] }],
        },
      } }] }),
    }],
    runs: [{
      id: 'run', threadId: 'thread', userMessageId: 'user', assistantMessageId: 'reply', connectionRevision: 'original-revision',
      status: running ? 'running' : 'awaiting-learner', steps: [{
        callId: 'tool', name: 'lookup_words', arguments: { query: 'tea' }, result: 'Synthetic result',
      }], createdAt: 1, updatedAt: 3, expiresAt: 100000,
    }],
  }
  return snapshot
}
