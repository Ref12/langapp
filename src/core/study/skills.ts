import { db } from '../database'
import { FAMILIAR_PENALTY, RECENT_DAYS, SKILLS, type Skill, type SkillPractice } from './skill-map'

export * from './skill-map'

const DAY = 86_400_000

/** Adds one to each (item, skill) pair, once each. Runs inside the caller's transaction when it has one. */
async function bump(pairs: readonly { ref: string; skill: Skill }[], now: number): Promise<void> {
  for (const { ref, skill } of pairs) {
    const current = await db.skillPractice.get([ref, skill])
    await db.skillPractice.put({ ref, skill, count: (current?.count ?? 0) + 1, lastAt: now, familiar: current?.familiar ?? false })
  }
}

const unique = (pairs: readonly { ref: string; skill: Skill }[]) => [...new Map(pairs.map(pair => [pair.ref + '|' + pair.skill, pair])).values()]

/** Counts a practice of these items in these skills, once per pair. */
export async function recordSkillPractice(refs: readonly string[], skills: readonly Skill[], now = Date.now()): Promise<void> {
  if (!refs.length || !skills.length) return
  await db.transaction('rw', db.skillPractice, () => bump(unique(refs.flatMap(ref => skills.map(skill => ({ ref, skill })))), now))
}

/** Counts pairs once per set's Hands-free activity: it remembers which (item, skill) pairs it has counted, so a replay or resume adds nothing. */
export async function recordRunPractice(setId: string, refs: readonly string[], skills: readonly Skill[], now = Date.now(), kind: 'introduction' | 'recall' = 'introduction'): Promise<number> {
  const field = kind === 'recall' ? 'handsfreeRecall' as const : 'handsfree' as const
  return db.transaction('rw', [db.drillSets, db.skillPractice], async () => {
    const set = await db.drillSets.get(setId)
    const activity = set?.[field]
    if (!activity) return 0
    const seen = new Set(activity.practiced ?? [])
    const fresh = unique(refs.flatMap(ref => skills.map(skill => ({ ref, skill })))).filter(pair => !seen.has(pair.ref + '|' + pair.skill))
    if (!fresh.length) return 0
    await bump(fresh, now)
    await db.drillSets.put({ ...set, [field]: { ...activity, practiced: [...seen, ...fresh.map(pair => pair.ref + '|' + pair.skill)].slice(-500) } })
    return fresh.length
  })
}

/** Counts a drill set's intro cards as reading, once per set. */
export async function recordSetIntro(setId: string, refs: readonly string[], skills: readonly Skill[], now = Date.now()): Promise<void> {
  await db.transaction('rw', [db.drillSets, db.skillPractice], async () => {
    const set = await db.drillSets.get(setId)
    if (!set || set.introSeen) return
    await db.drillSets.update(setId, { introSeen: true })
    await bump(unique(refs.flatMap(ref => skills.map(skill => ({ ref, skill })))), now)
  })
}

/** Marks or unmarks an item as familiar in one skill. */
export async function setFamiliar(ref: string, skill: Skill, familiar: boolean): Promise<void> {
  await db.transaction('rw', db.skillPractice, async () => {
    const current = await db.skillPractice.get([ref, skill])
    await db.skillPractice.put({ ref, skill, count: current?.count ?? 0, lastAt: current?.lastAt ?? 0, familiar })
  })
}

export type SkillCounts = Record<Skill, SkillPractice | undefined>
export const countsOf = (rows: readonly SkillPractice[]): SkillCounts => Object.fromEntries(SKILLS.map(skill => [skill, rows.find(row => row.skill === skill)])) as SkillCounts

/**
 * Pure ordering. Least practised: count (+10 when familiar) ascending, then the most recently added to the knowledge set first.
 * Recent: added within the last 3 days, newest first, then by count. Returns up to `size` refs.
 */
export function rankItems(entries: readonly { ref: string; addedAt: number }[], practice: readonly SkillPractice[], skill: Skill, strategy: 'least' | 'recent', size: number, now: number): string[] {
  const rows = new Map(practice.filter(row => row.skill === skill).map(row => [row.ref, row]))
  const score = (ref: string) => (rows.get(ref)?.count ?? 0) + (rows.get(ref)?.familiar ? FAMILIAR_PENALTY : 0)
  const pool = strategy === 'recent' ? entries.filter(entry => entry.addedAt >= now - RECENT_DAYS * DAY) : [...entries]
  const byRecency = (a: { ref: string; addedAt: number }, b: { ref: string; addedAt: number }) => b.addedAt - a.addedAt || a.ref.localeCompare(b.ref)
  return pool.sort(strategy === 'recent' ? (a, b) => byRecency(a, b) || score(a.ref) - score(b.ref) : (a, b) => score(a.ref) - score(b.ref) || byRecency(a, b)).slice(0, size).map(entry => entry.ref)
}

