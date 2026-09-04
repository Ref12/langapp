import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Search } from 'lucide-react'
import { useActiveProfile } from '../core/activeProfile'
import { db } from '../core/database'
import type { KnowledgeTier, LearningItem } from '../core/domain'
import { nowIso } from '../core/ids'

interface DictionaryEntry {
  item: LearningItem
  tier: KnowledgeTier
  confidence: number
}

export function DictionaryPage() {
  const profile = useActiveProfile()
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<'all' | KnowledgeTier>('all')
  const entries = useLiveQuery(async (): Promise<DictionaryEntry[]> => {
    if (!profile) return []
    const states = await db.userItemStates
      .where('profileId')
      .equals(profile.id)
      .toArray()
    const items = await db.learningItems.bulkGet(
      states.map((state) => state.itemId),
    )
    return states.flatMap((state, index) => {
      const item = items[index]
      return item
        ? [{ item, tier: state.tier, confidence: state.confidence }]
        : []
    })
  }, [profile?.id])

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return (entries ?? []).filter((entry) => {
      const matchesTier = tier === 'all' || entry.tier === tier
      const matchesSearch =
        !query ||
        [entry.item.sourceText, entry.item.targetText, entry.item.romanization]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)
      return matchesTier && matchesSearch
    })
  }, [entries, search, tier])

  const updateTier = async (itemId: string, nextTier: KnowledgeTier) => {
    if (!profile) return
    await db.userItemStates.update(`${profile.id}:${itemId}`, {
      tier: nextTier,
      confidence:
        nextTier === 'learning' ? 0.2 : nextTier === 'familiar' ? 0.6 : 0.9,
      updatedAt: nowIso(),
    })
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{profile?.name} Dictionary</p>
          <h1>Your learning set</h1>
          <p>Only items you have started learning appear here.</p>
        </div>
      </header>

      <div className="toolbar">
        <label className="search-field">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search native form, romanization, or English"
          />
        </label>
        <select
          value={tier}
          onChange={(event) =>
            setTier(event.target.value as 'all' | KnowledgeTier)
          }
          aria-label="Filter by tier"
        >
          <option value="all">All tiers</option>
          <option value="learning">Learning</option>
          <option value="familiar">Familiar</option>
          <option value="mastered">Mastered</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <BookTextIcon />
          <h2>No matching items yet</h2>
          <p>Analyze a text or conversation to begin your learning set.</p>
        </div>
      ) : (
        <div className="dictionary-list">
          {filtered.map(({ item, tier: currentTier }) => (
            <article className="dictionary-row" key={item.id}>
              <div>
                <div className="dictionary-native">{item.targetText}</div>
                <div className="dictionary-romanization">
                  {item.romanization}
                </div>
              </div>
              <div>
                <strong>{item.sourceText}</strong>
                <p>{item.gloss}</p>
              </div>
              <span className="item-type">{item.itemType}</span>
              <select
                className={`tier-select ${currentTier}`}
                value={currentTier}
                onChange={(event) =>
                  updateTier(item.id, event.target.value as KnowledgeTier)
                }
                aria-label={`Knowledge tier for ${item.sourceText}`}
              >
                <option value="learning">Learning</option>
                <option value="familiar">Familiar</option>
                <option value="mastered">Mastered</option>
              </select>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function BookTextIcon() {
  return <span className="empty-icon">Aa</span>
}
