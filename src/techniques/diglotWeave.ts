import { db } from '../core/database'
import type {
  LanguageProfile,
  LearningItem,
  WeaveAnnotation,
} from '../core/domain'
import { invokeAIOperation } from '../core/ai/operations'
import { createId, localDateKey, nowIso } from '../core/ids'

export function removeOverlaps(
  annotations: WeaveAnnotation[],
): WeaveAnnotation[] {
  const sorted = [...annotations].sort(
    (left, right) => left.start - right.start || right.end - right.start - (left.end - left.start),
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
