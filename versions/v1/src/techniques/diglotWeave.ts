import { db } from '../core/database'
import type {
  DocumentChapter,
  KnowledgeTier,
  LanguageProfile,
  LearningItem,
  WeaveAnnotation,
} from '../core/domain'
import { invokeAIOperation } from '../core/ai/operations'
import { createId, localDateKey, nowIso } from '../core/ids'
import { chaptersFor } from '../core/importers'

export function removeOverlaps(
  annotations: WeaveAnnotation[],
): WeaveAnnotation[] {
  const sorted = [...annotations].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - right.start - (left.end - left.start),
  )
  const accepted: WeaveAnnotation[] = []

  for (const annotation of sorted) {
    if (
      annotation.start >= annotation.end ||
      accepted.some(
        (current) =>
          annotation.start < current.end && annotation.end > current.start,
      )
    ) {
      continue
    }
    accepted.push(annotation)
  }

  return accepted.sort((left, right) => left.start - right.start)
}

function isEnglishWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/.test(character)
}

export function annotationsForLearningItem(
  content: string,
  item: LearningItem,
  tier: KnowledgeTier,
): WeaveAnnotation[] {
  const source = item.sourceText
  if (!source) return []

  const contentLower = content.toLocaleLowerCase()
  const sourceLower = source.toLocaleLowerCase()
  const requiresLeftBoundary = isEnglishWordCharacter(source[0])
  const requiresRightBoundary = isEnglishWordCharacter(source[source.length - 1])
  const annotations: WeaveAnnotation[] = []
  let searchFrom = 0

  while (searchFrom < content.length) {
    const start = contentLower.indexOf(sourceLower, searchFrom)
    if (start < 0) break
    const end = start + source.length
    const leftIsValid =
      !requiresLeftBoundary || !isEnglishWordCharacter(content[start - 1])
    const rightIsValid =
      !requiresRightBoundary || !isEnglishWordCharacter(content[end])

    if (leftIsValid && rightIsValid) {
      annotations.push({
        id: createId('annotation'),
        itemId: item.id,
        start,
        end,
        sourceText: content.slice(start, end),
        targetText: item.targetText,
        romanization: item.romanization,
        gloss: item.gloss,
        tier,
      })
    }
    searchFrom = Math.max(end, start + 1)
  }

  return annotations
}

function mergeLearningItemIntoChapter(
  chapter: DocumentChapter,
  item: LearningItem,
  tier: KnowledgeTier,
  force = false,
): DocumentChapter {
  let existing = chapter.annotations.map((annotation) =>
    annotation.itemId === item.id ? { ...annotation, tier } : annotation,
  )
  const generated = annotationsForLearningItem(chapter.content, item, tier)
  if (force) {
    existing = existing.filter(
      (annotation) =>
        annotation.itemId === item.id ||
        !generated.some(
          (candidate) =>
            candidate.start < annotation.end &&
            candidate.end > annotation.start,
        ),
    )
  }
  const existingKeys = new Set(
    existing.map(
      (annotation) =>
        `${annotation.itemId}:${annotation.start}:${annotation.end}`,
    ),
  )
  const additions = generated.filter(
    (annotation) =>
      !existingKeys.has(
        `${annotation.itemId}:${annotation.start}:${annotation.end}`,
      ),
  )
  return {
    ...chapter,
    annotations: removeOverlaps([...existing, ...additions]),
  }
}

export async function weaveTrackedItemsIntoChapters(
  profileId: string,
  chapters: DocumentChapter[],
): Promise<DocumentChapter[]> {
  const states = await db.userItemStates
    .where('profileId')
    .equals(profileId)
    .toArray()
  const items = await db.learningItems.bulkGet(
    states.map((state) => state.itemId),
  )
  const tracked = states.flatMap((state, index) =>
    items[index] ? [{ state, item: items[index] }] : [],
  ) as Array<{
    state: (typeof states)[number]
    item: LearningItem
  }>

  return chapters.map((chapter) =>
    tracked.reduce(
      (current, { item, state }) =>
        mergeLearningItemIntoChapter(current, item, state.tier),
      chapter,
    ),
  )
}

export async function propagateLearningItemAcrossLibrary(
  profileId: string,
  item: LearningItem,
  tier: KnowledgeTier,
): Promise<number> {
  const libraryItems = await db.libraryItems
    .where('profileId')
    .equals(profileId)
    .toArray()
  let occurrenceCount = 0
  const updatedItems = libraryItems.map((libraryItem) => {
    const chapters = chaptersFor(libraryItem).map((chapter) => {
      const updated = mergeLearningItemIntoChapter(chapter, item, tier, true)
      occurrenceCount += updated.annotations.filter(
        (annotation) => annotation.itemId === item.id,
      ).length
      return updated
    })
    return {
      ...libraryItem,
      chapters,
      updatedAt: nowIso(),
    }
  })

  if (updatedItems.length) await db.libraryItems.bulkPut(updatedItems)
  return occurrenceCount
}

export async function analyzeAndWeaveText(
  profile: LanguageProfile,
  text: string,
  sourceModuleId: string,
  signal?: AbortSignal,
): Promise<WeaveAnnotation[]> {
  const states = await db.userItemStates
    .where('profileId')
    .equals(profile.id)
    .toArray()
  const itemIds = states.map((state) => state.itemId)
  const knownItems = (await db.learningItems.bulkGet(itemIds)).filter(
    (item): item is LearningItem => item !== undefined,
  )

  const today = localDateKey()
  const introducedToday = (
    await db.evidenceEvents
      .where('profileId')
      .equals(profile.id)
      .filter(
        (event) =>
          event.type === 'introduced' && event.createdAt.startsWith(today),
      )
      .toArray()
  ).length
  const remaining = Math.max(profile.dailyNewItemLimit - introducedToday, 0)

  const result = await invokeAIOperation(
    'language.analyzeText',
    {
      text,
      targetLanguage: profile.targetLanguage,
      romanization: profile.romanization,
      maximumNewItems: remaining,
      knownItems: knownItems.map((item) => ({
        id: item.id,
        sourceText: item.sourceText,
        targetText: item.targetText,
        romanization: item.romanization,
        gloss: item.gloss,
      })),
    },
    signal,
  )

  const knownById = new Map(knownItems.map((item) => [item.id, item]))
  const stateByItemId = new Map(states.map((state) => [state.itemId, state]))
  const createdItems: LearningItem[] = []
  const annotations: WeaveAnnotation[] = []
  let newItemsUsed = 0

  for (const candidate of result.candidates) {
    if (
      candidate.end > text.length ||
      text.slice(candidate.start, candidate.end) !== candidate.sourceText
    ) {
      continue
    }

    let item = candidate.itemId ? knownById.get(candidate.itemId) : undefined
    if (!item) {
      if (newItemsUsed >= remaining) continue
      const existingCreated = createdItems.find(
        (created) =>
          created.sourceText.toLocaleLowerCase() ===
          candidate.sourceText.toLocaleLowerCase(),
      )
      item =
        existingCreated ??
        ({
          id: createId('item'),
          targetLanguage: profile.targetLanguage,
          sourceText: candidate.sourceText,
          targetText: candidate.targetText,
          romanization: candidate.romanization,
          gloss: candidate.gloss,
          itemType: candidate.itemType,
          createdAt: nowIso(),
        } satisfies LearningItem)

      if (!existingCreated) {
        createdItems.push(item)
        newItemsUsed += 1
      }
    }

    annotations.push({
      id: createId('annotation'),
      itemId: item.id,
      start: candidate.start,
      end: candidate.end,
      sourceText: candidate.sourceText,
      targetText: item.targetText,
      romanization: item.romanization,
      gloss: item.gloss,
      tier: stateByItemId.get(item.id)?.tier ?? 'learning',
    })
  }

  if (createdItems.length > 0) {
    const timestamp = nowIso()
    await db.transaction(
      'rw',
      [db.learningItems, db.userItemStates, db.evidenceEvents],
      async () => {
        await db.learningItems.bulkPut(createdItems)
        await db.userItemStates.bulkPut(
          createdItems.map((item) => ({
            id: `${profile.id}:${item.id}`,
            profileId: profile.id,
            itemId: item.id,
            tier: 'learning' as const,
            confidence: 0.15,
            showRomanization: true,
            showEnglish: false,
            introducedAt: timestamp,
            updatedAt: timestamp,
          })),
        )
        await db.evidenceEvents.bulkPut(
          createdItems.map((item) => ({
            id: createId('event'),
            profileId: profile.id,
            itemId: item.id,
            sourceModuleId,
            type: 'introduced' as const,
            createdAt: timestamp,
          })),
        )
      },
    )
  }

  return removeOverlaps(annotations)
}
