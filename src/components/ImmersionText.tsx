import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type {
  ImmersionBlock,
  ImmersionToken,
  LanguageProfile,
  LearningItem,
  UserItemState,
} from '../core/domain'
import { db } from '../core/database'
import { createId, nowIso } from '../core/ids'
import { propagateLearningItemAcrossLibrary } from '../techniques/diglotWeave'
import { SpeechControls } from './SpeechControls'

function tokenKey(targetText: string, english: string): string {
  return `${targetText.trim().toLocaleLowerCase()}\u0000${english
    .trim()
    .toLocaleLowerCase()}`
}

export function ImmersionText({
  blocks,
  profile,
}: {
  blocks: ImmersionBlock[]
  profile: LanguageProfile
}) {
  const [active, setActive] = useState<ImmersionToken | null>(null)
  const [status, setStatus] = useState('')
  const [overrides, setOverrides] = useState<
    Record<string, { showRomanization: boolean; showEnglish: boolean }>
  >({})
  const tracked = useLiveQuery(async () => {
    const states = await db.userItemStates
      .where('profileId')
      .equals(profile.id)
      .toArray()
    const items = await db.learningItems.bulkGet(
      states.map((state) => state.itemId),
    )
    return states.flatMap((state, index) =>
      items[index] ? [{ state, item: items[index] }] : [],
    ) as Array<{ state: UserItemState; item: LearningItem }>
  }, [profile.id])
  const trackedByToken = new Map(
    (tracked ?? []).map(({ state, item }) => [
      tokenKey(item.targetText, item.sourceText),
      { state, item },
    ]),
  )
  const occurrenceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const token of blocks.flatMap((block) => block.tokens)) {
      const key = token.targetText.trim().toLocaleLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [blocks])

  const displayFor = (token: ImmersionToken) => {
    const trackedEntry = trackedByToken.get(
      tokenKey(token.targetText, token.english),
    )
    const override = overrides[token.id]
    return {
      trackedEntry,
      showRomanization:
        override?.showRomanization ??
        trackedEntry?.state.showRomanization ??
        true,
      showEnglish:
        override?.showEnglish ?? trackedEntry?.state.showEnglish ?? true,
    }
  }

  const ensureTracked = async (
    token: ImmersionToken,
    preferences: { showRomanization: boolean; showEnglish: boolean },
  ) => {
    const key = tokenKey(token.targetText, token.english)
    const trackedEntry = trackedByToken.get(key)
    let item = trackedEntry?.item

    if (!item) {
      item = await db.learningItems
        .where('targetLanguage')
        .equals(profile.targetLanguage)
        .filter(
          (candidate) =>
            tokenKey(candidate.targetText, candidate.sourceText) === key,
        )
        .first()
    }
    if (!item) {
      item = {
        id: createId('item'),
        targetLanguage: profile.targetLanguage,
        sourceText: token.english,
        targetText: token.targetText,
        romanization: token.romanization,
        gloss: token.english,
        itemType: 'word',
        createdAt: nowIso(),
      }
      await db.learningItems.add(item)
    }

    const stateId = `${profile.id}:${item.id}`
    const existingState = trackedEntry?.state ?? (await db.userItemStates.get(stateId))
    const timestamp = nowIso()
    if (existingState) {
      await db.userItemStates.update(existingState.id, {
        ...preferences,
        updatedAt: timestamp,
      })
    } else {
      await db.transaction(
        'rw',
        [db.userItemStates, db.evidenceEvents],
        async () => {
          await db.userItemStates.add({
            id: stateId,
            profileId: profile.id,
            itemId: item!.id,
            tier: 'learning',
            confidence: 0.15,
            ...preferences,
            introducedAt: timestamp,
            updatedAt: timestamp,
          })
          await db.evidenceEvents.add({
            id: createId('event'),
            profileId: profile.id,
            itemId: item!.id,
            sourceModuleId: 'reading-immersion',
            type: 'introduced',
            createdAt: timestamp,
          })
        },
      )
      await propagateLearningItemAcrossLibrary(profile.id, item, 'learning')
    }
    setStatus(`“${token.english}” is in your global weave.`)
  }

  const updateDisplay = async (
    token: ImmersionToken,
    preferences: { showRomanization: boolean; showEnglish: boolean },
  ) => {
    setOverrides((current) => ({ ...current, [token.id]: preferences }))
    await ensureTracked(token, preferences)
  }

  const activeDisplay = active ? displayFor(active) : undefined

  return (
    <>
      <div className="immersion-text">
        {blocks.map((block) => (
          <p key={block.id}>
            {block.tokens.map((token) => {
              const display = displayFor(token)
              return (
                <span className="immersion-unit" key={token.id}>
                  <button
                    type="button"
                    className="immersion-token"
                    onClick={() => {
                      setActive(token)
                      setStatus('')
                    }}
                  >
                    <ruby>
                      {token.targetText}
                      {display.showRomanization && (
                        <rt>{token.romanization}</rt>
                      )}
                    </ruby>
                    {display.showEnglish && (
                      <span className="immersion-english">
                        {token.english}
                      </span>
                    )}
                  </button>
                  {token.after}
                </span>
              )
            })}
          </p>
        ))}
      </div>
      {active && activeDisplay && (
        <div className="word-popover" role="dialog" aria-label="Word details">
          <button
            className="close-button"
            onClick={() => setActive(null)}
            aria-label="Close word details"
          >
            ×
          </button>
          <div className="word-native">{active.targetText}</div>
          <div className="word-romanization">{active.romanization}</div>
          <div className="word-gloss">{active.english}</div>
          <p className="occurrence-count">
            {occurrenceCounts.get(
              active.targetText.trim().toLocaleLowerCase(),
            ) ?? 1}{' '}
            occurrences in this chapter
          </p>
          <div className="display-preferences">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={activeDisplay.showRomanization}
                onChange={(event) =>
                  updateDisplay(active, {
                    showRomanization: event.target.checked,
                    showEnglish: activeDisplay.showEnglish,
                  })
                }
              />
              Show romanization
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={activeDisplay.showEnglish}
                onChange={(event) =>
                  updateDisplay(active, {
                    showRomanization: activeDisplay.showRomanization,
                    showEnglish: event.target.checked,
                  })
                }
              />
              Show English meaning
            </label>
          </div>
          {!activeDisplay.trackedEntry && (
            <button
              type="button"
              className="primary-button full-width"
              onClick={() =>
                ensureTracked(active, {
                  showRomanization: activeDisplay.showRomanization,
                  showEnglish: activeDisplay.showEnglish,
                })
              }
            >
              Add to weave
            </button>
          )}
          {status && <div className="success-banner compact">{status}</div>}
          <SpeechControls
            text={active.targetText}
            language={
              profile.targetLanguage === 'zh'
                ? 'zh-CN'
                : profile.targetLanguage === 'ja'
                  ? 'ja-JP'
                  : 'ko-KR'
            }
          />
        </div>
      )}
    </>
  )
}
