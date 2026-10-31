import { db } from '../database'
import { requestStructuredJSON } from '../ai/structured'
import type { Collection } from './contracts'

// Short English study-set names: "Heavy Knight · 31 Oct". The AI writes the gist when a model is connected; otherwise a plain fallback is used.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MAX_NAME_WORDS = 4
const dateLabel = (time: number) => { const date = new Date(time); return `${date.getDate()} ${MONTHS[date.getMonth()]}` }
const hasChinese = (text: string) => /[\u3400-\u9fff]/.test(text)

/** At most four words, no stray punctuation at the ends. */
export function shortGist(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim().split(/\s+/).filter(Boolean).slice(0, MAX_NAME_WORDS).join(' ').replace(/^[\s"'“”‘’.,:;!?-]+|[\s"'“”‘’.,:;!?-]+$/g, '').slice(0, 60)
}

export const withDate = (gist: string, time: number) => `${gist} · ${dateLabel(time)}`

/** The name used without an AI: the media's English title cut short when it has one, else "Show". */
export function fallbackName(title: string, now: number): string {
  const gist = title && !hasChinese(title) ? shortGist(title) : ''
  return withDate(gist || 'Show', now)
}

const schema = { type: 'object', additionalProperties: false, required: ['names'], properties: { names: { type: 'array', items: { type: 'string' } } } }
const system = `You name study sets. For each title given (often a show's title in Chinese), reply with its English gist as a short title of at most ${MAX_NAME_WORDS} words, in title case, with no date, quotes or punctuation at the ends. Reply as JSON {"names": [...]} with one name per title, in the same order.`

/** One small request for the English gists of some titles; undefined when no AI is connected or the answer is unusable. */
export async function englishGists(titles: string[], signal?: AbortSignal): Promise<string[] | undefined> {
  const connection = await db.aiConnections.get('assistant')
  if (!connection || !titles.length) return undefined
  try {
    const value = await requestStructuredJSON(connection, { name: 'study_set_names', schema, system, user: JSON.stringify(titles), maxOutputTokens: 40 * titles.length + 100, signal })
    const names = (value as { names?: unknown } | null)?.names
    if (!Array.isArray(names) || names.length !== titles.length) return undefined
    const gists = names.map(name => typeof name === 'string' ? shortGist(name) : '')
    return gists.every(Boolean) ? gists : undefined
  } catch { return undefined }
}

/** The suggested name for a new study set made from media: AI gist plus the date, else the fallback. Always returns something editable. */
export async function suggestName(title: string, now = Date.now(), signal?: AbortSignal): Promise<string> {
  const gist = (await englishGists([title], signal))?.[0]
  return gist ? withDate(gist, now) : fallbackName(title, now)
}

/**
 * Existing sets still named after a media title (a show set, or any set whose name equals the title of the media its lines came from) get a short English name,
 * dated by when the set was made, and keep the old name as their subtitle. Sets the user renamed are never touched. One batched request; nothing changes without an AI.
 */
export async function renameMediaNamedSets(signal?: AbortSignal): Promise<number> {
  const collections = await db.collections.toArray()
  const items = await db.collectionItems.toArray()
  const media = new Map((await db.mediaItems.toArray()).map(item => [item.id, item.title]))
  const titlesOf = (collection: Collection) => new Set([
    ...(collection.mediaId && media.has(collection.mediaId) ? [media.get(collection.mediaId)!] : []),
    ...items.filter(item => item.collectionId === collection.id && item.source).map(item => item.source!.title),
  ])
  const pending = collections.filter(collection => !collection.subtitle && titlesOf(collection).has(collection.name))
  if (!pending.length) return 0
  const gists = await englishGists(pending.map(collection => collection.name), signal)
  if (!gists) return 0
  let renamed = 0
  await db.transaction('rw', db.collections, async () => {
    for (const [index, collection] of pending.entries()) {
      const current = await db.collections.get(collection.id)
      if (!current || current.name !== collection.name || current.subtitle) continue
      await db.collections.put({ ...current, name: withDate(gists[index], current.createdAt), subtitle: current.name.slice(0, 500) })
      renamed++
    }
  })
  return renamed
}
