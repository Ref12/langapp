import type { Lesson, Story, Word } from '../core/model'
import { curriculumLessons, curriculumWords } from './curriculum'

// Original authored examples adapted from the mockups, not an official HSK syllabus.
export const CONTENT_VERSION = 2
export const starterWords: Word[] = [
  { id: 'zh:tea', native: '\u8336', pinyin: 'ch\u00e1', meaning: 'tea', kind: 'Noun', example: '\u6211\u60f3\u559d\u8336\u3002', translation: 'I would like to drink tea.' },
  { id: 'zh:rain', native: '\u96e8', pinyin: 'y\u01d4', meaning: 'rain', kind: 'Noun', example: '\u96e8\u505c\u4e86\u3002', translation: 'The rain has stopped.' },
  { id: 'zh:cup', native: '\u676f\u5b50', pinyin: 'b\u0113izi', meaning: 'cup', kind: 'Noun', example: '\u676f\u5b50\u662f\u6e29\u7684\u3002', translation: 'The cup is warm.' },
  { id: 'zh:friend', native: '\u670b\u53cb', pinyin: 'p\u00e9ngyou', meaning: 'friend', kind: 'Noun', example: '\u6211\u7684\u670b\u53cb\u6765\u4e86\u3002', translation: 'My friend has arrived.' },
  { id: 'zh:window', native: '\u7a97\u6237', pinyin: 'chu\u0101nghu', meaning: 'window', kind: 'Noun', example: '\u5979\u5750\u5728\u7a97\u6237\u65c1\u8fb9\u3002', translation: 'She sits beside the window.' },
  { id: 'zh:slowly', native: '\u6162\u6162\u5730', pinyin: 'm\u00e0nman de', meaning: 'slowly', kind: 'Expression', example: '\u5979\u6162\u6162\u5730\u559d\u8336\u3002', translation: 'She drinks tea slowly.' },
  { id: 'zh:want', native: '\u60f3', pinyin: 'xi\u01ceng', meaning: 'would like to', kind: 'Verb', example: '\u6211\u60f3\u559d\u8336\u3002', translation: 'I would like to drink tea.' },
  { id: 'zh:drink', native: '\u559d', pinyin: 'h\u0113', meaning: 'drink', kind: 'Verb', example: '\u4f60\u559d\u8336\u5417\uff1f', translation: 'Do you drink tea?' },
  { id: 'zh:cupful', native: '\u676f', pinyin: 'b\u0113i', meaning: 'cupful (measure word)', kind: 'Measure word', example: '\u4e00\u676f\u8336', translation: 'a cup of tea' },
  { id: 'zh:hello', native: '\u4f60\u597d', pinyin: 'n\u01d0 h\u01ceo', meaning: 'hello', kind: 'Greeting', example: '\u4f60\u597d\uff01', translation: 'Hello!' },
  { id: 'zh:thanks', native: '\u8c22\u8c22', pinyin: 'xi\u00e8xie', meaning: 'thank you', kind: 'Expression', example: '\u8c22\u8c22\u4f60\u3002', translation: 'Thank you.' },
  { id: 'zh:tomorrow', native: '\u660e\u5929', pinyin: 'm\u00edngti\u0101n', meaning: 'tomorrow', kind: 'Time word', example: '\u6211\u660e\u5929\u53bb\u516c\u56ed\u3002', translation: 'I am going to the park tomorrow.' },
  { id: 'zh:go', native: '\u53bb', pinyin: 'q\u00f9', meaning: 'go', kind: 'Verb', example: '\u6211\u53bb\u516c\u56ed\u3002', translation: 'I am going to the park.' },
  { id: 'zh:park', native: '\u516c\u56ed', pinyin: 'g\u014dngyu\u00e1n', meaning: 'park', kind: 'Noun', example: '\u516c\u56ed\u5f88\u5b89\u9759\u3002', translation: 'The park is very quiet.' },
]

export const starterLessons: Lesson[] = [
  {
    id: 'zh:greetings', title: 'Greet someone and say thanks', objective: 'Begin a brief exchange politely.',
    native: '\u4f60\u597d\uff01\u8c22\u8c22\u4f60\u3002', pinyin: 'N\u01d0 h\u01ceo! Xi\u00e8xie n\u01d0.',
    translation: 'Hello! Thank you.',
    pattern: 'Use \u4f60\u597d to greet someone. \u8c22\u8c22\u4f60 directly thanks the person you are speaking to.',
    note: 'In natural speech the first third tone in n\u01d0 h\u01ceo changes to a rising tone. Pinyin here keeps the dictionary tone marks.',
    wordIds: ['zh:hello', 'zh:thanks'],
  },
  {
    id: 'zh:request', title: 'Build a simple request', objective: 'Say what you would like, then add a little more detail.',
    native: '\u6211\u60f3\u559d\u4e00\u676f\u8336\u3002', pinyin: 'W\u01d2 xi\u01ceng h\u0113 y\u00ec b\u0113i ch\u00e1.',
    translation: 'I would like to drink a cup of tea.',
    pattern: '\u6211\u60f3 + action means I would like to do something. Add a quantity before the drink: \u4e00\u676f\u8336 is a cup of tea.',
    note: '\u676f measures a cupful; \u676f\u5b50 names the cup itself. This is a companion lesson, not a quotation from the story. The pinyin y\u00ec reflects the spoken tone of \u4e00 before b\u0113i.',
    wordIds: ['zh:want', 'zh:drink', 'zh:cupful', 'zh:tea'], storyId: 'zh:tea-house',
  },
  {
    id: 'zh:plans', title: 'Talk about tomorrow', objective: 'Combine a time and a place into a useful plan.',
    native: '\u6211\u660e\u5929\u53bb\u516c\u56ed\u3002', pinyin: 'W\u01d2 m\u00edngti\u0101n q\u00f9 g\u014dngyu\u00e1n.',
    translation: 'I am going to the park tomorrow.',
    pattern: 'Person + time + action: \u6211 + \u660e\u5929 + \u53bb\u516c\u56ed. Put the time before the main action.',
    note: 'The time word gives this sentence its future context. The verb does not need a future ending.',
    wordIds: ['zh:tomorrow', 'zh:go', 'zh:park'], storyId: 'zh:after-rain',
  },
]

export const stories: Story[] = [
  {
    id: 'zh:tea-house', title: 'A morning at the tea house',
    description: 'A quiet street. A warm cup. A few new words to make your own.',
    topic: 'Everyday life', glyph: '\u8336', lessonId: 'zh:request',
    attribution: 'Original LinguaWeave story and Mandarin translation, adapted from the experience mockups.',
    passages: [
      {
        source: ['The ', { wordId: 'zh:rain' }, ' has stopped, but the street is still shining. Lin walks into the little tea house on the corner. Her ', { wordId: 'zh:friend' }, ' is already there, sitting beside the ', { wordId: 'zh:window' }, '.'],
        target: [{ wordId: 'zh:rain' }, '\u505c\u4e86\uff0c\u4f46\u8857\u9053\u8fd8\u5728\u53d1\u4eae\u3002\u5c0f\u6797\u8d70\u8fdb\u8857\u89d2\u7684\u5c0f\u8336\u9986\u3002\u5979\u7684', { wordId: 'zh:friend' }, '\u5df2\u7ecf\u5230\u4e86\uff0c\u6b63\u5750\u5728', { wordId: 'zh:window' }, '\u65c1\u8fb9\u3002'],
      },
      {
        source: ['The owner brings a pot of ', { wordId: 'zh:tea' }, ' and two small cups. Outside, people hurry past with their umbrellas. Inside, there is no reason to hurry. Lin wraps her hands around a warm ', { wordId: 'zh:cup' }, '.'],
        target: ['\u8001\u677f\u7aef\u6765\u4e00\u58f6', { wordId: 'zh:tea' }, '\u548c\u4e24\u4e2a\u5c0f\u676f\u5b50\u3002\u5916\u9762\uff0c\u4eba\u4eec\u62ff\u7740\u96e8\u4f1e\u5306\u5306\u8d70\u8fc7\u3002\u5728\u8fd9\u91cc\uff0c\u4e0d\u7528\u7740\u6025\u3002\u5c0f\u6797\u53cc\u624b\u6367\u7740\u4e00\u4e2a\u6e29\u70ed\u7684', { wordId: 'zh:cup' }, '\u3002'],
      },
      {
        source: ['They talk about nothing important: the weather, a book, what to cook for dinner. Lin drinks ', { wordId: 'zh:slowly' }, '. For a little while, the whole morning fits inside this room.'],
        target: ['\u5979\u4eec\u804a\u7684\u90fd\u662f\u5c0f\u4e8b\uff1a\u5929\u6c14\u3001\u4e00\u672c\u4e66\u3001\u665a\u996d\u5403\u4ec0\u4e48\u3002\u5c0f\u6797', { wordId: 'zh:slowly' }, '\u559d\u7740\u8336\u3002\u8fd9\u4e00\u523b\uff0c\u6574\u4e2a\u65e9\u6668\u4eff\u4f5b\u90fd\u5728\u8fd9\u95f4\u5c0f\u5c4b\u91cc\u3002'],
      },
    ],
  },
  {
    id: 'zh:after-rain', title: 'After the rain',
    description: 'Put your phone away and take the longer path home.',
    topic: 'Nature', glyph: '\u96e8', lessonId: 'zh:plans',
    attribution: 'Original LinguaWeave micro-story from the experience mockups; authored Mandarin sample translation.',
    passages: [{
      source: ['The ', { wordId: 'zh:park' }, ' is quiet after the ', { wordId: 'zh:rain' }, '. A small bird shakes the water from its wings. I put my phone away and take the longer path home.'],
      target: [{ wordId: 'zh:rain' }, '\u540e\uff0c', { wordId: 'zh:park' }, '\u5f88\u5b89\u9759\u3002\u4e00\u53ea\u5c0f\u9e1f\u6296\u6389\u7fc5\u8180\u4e0a\u7684\u6c34\u3002\u6211\u6536\u8d77\u624b\u673a\uff0c\u7ed5\u8fdc\u8def\u56de\u5bb6\u3002'],
    }],
  },
]

// Starter IDs remain separate: old recognition attempts are not curriculum evidence.
export const words: Word[] = [...curriculumWords, ...starterWords]
export const lessons: Lesson[] = [...curriculumLessons, ...starterLessons]
const wordIndex = new Map(words.map(word => [word.id, word]))

export function getWord(id: string): Word {
  const word = wordIndex.get(id)
  if (!word) throw new Error(`Unknown Mandarin word: ${id}`)
  return word
}

export function getStory(id: string): Story {
  const story = stories.find(item => item.id === id)
  if (!story) throw new Error('That story is not available in this collection.')
  return story
}

export function getLesson(id: string): Lesson {
  const lesson = lessons.find(item => item.id === id)
  if (!lesson) throw new Error('That lesson is not available in this collection.')
  return lesson
}
