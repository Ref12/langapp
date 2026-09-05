import { contextAroundSelection } from './textContext'

const stopWords = new Set([
  'a',
  'about',
  'after',
  'again',
  'against',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
])

export interface FrequentWord {
  sourceText: string
  count: number
  context: string
}

export function frequentContentWords(
  text: string,
  limit = 25,
  excludedWords: Iterable<string> = [],
): FrequentWord[] {
  const excluded = new Set(
    [...excludedWords].map((word) => word.toLocaleLowerCase()),
  )
  const counts = new Map<
    string,
    {
      sourceText: string
      count: number
      firstStart: number
      seenLowercase: boolean
    }
  >()
  const wordPattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g

  for (const match of text.matchAll(wordPattern)) {
    const sourceText = match[0]
    const normalized = sourceText.toLocaleLowerCase()
    if (
      sourceText.length < 2 ||
      stopWords.has(normalized) ||
      excluded.has(normalized)
    ) {
      continue
    }

    const current = counts.get(normalized)
    const startsLowercase = sourceText[0] === sourceText[0]?.toLocaleLowerCase()
    if (current) {
      current.count += 1
      current.seenLowercase ||= startsLowercase
      if (startsLowercase) current.sourceText = sourceText
    }
    else {
      counts.set(normalized, {
        sourceText,
        count: 1,
        firstStart: match.index,
        seenLowercase: startsLowercase,
      })
    }
  }

  return [...counts.values()]
    .filter((word) => word.seenLowercase)
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.firstStart - right.firstStart ||
        left.sourceText.localeCompare(right.sourceText),
    )
    .slice(0, limit)
    .map(({ sourceText, count, firstStart }) => ({
      sourceText,
      count,
      context: contextAroundSelection(
        text,
        {
          text: sourceText,
          start: firstStart,
          end: firstStart + sourceText.length,
        },
        1,
      ),
    }))
}

export function detectProperNames(text: string): string[] {
  const wordPattern = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g
  const candidates = new Map<
    string,
    { sourceText: string; count: number; seenMidSentence: boolean }
  >()
  const ignored = new Set([
    'chapter',
    'part',
    'book',
    'introduction',
    'preface',
    'footnotes',
  ])

  for (const match of text.matchAll(wordPattern)) {
    const sourceText = match[0]
    const normalized = sourceText.toLocaleLowerCase()
    const isCapitalized =
      sourceText[0] !== sourceText[0]?.toLocaleLowerCase() &&
      sourceText.slice(1) === sourceText.slice(1).toLocaleLowerCase()
    if (!isCapitalized || ignored.has(normalized) || stopWords.has(normalized)) {
      continue
    }

    const preceding = text.slice(0, match.index).trimEnd()
    const sentenceStart = !preceding || /[.!?]["')\]]?$/.test(preceding)
    const current = candidates.get(normalized)
    if (current) {
      current.count += 1
      current.seenMidSentence ||= !sentenceStart
    } else {
      candidates.set(normalized, {
        sourceText,
        count: 1,
        seenMidSentence: !sentenceStart,
      })
    }
  }

  return [...candidates.values()]
    .filter((candidate) => candidate.seenMidSentence || candidate.count > 1)
    .map((candidate) => candidate.sourceText)
}
