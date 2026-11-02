/** A set made by the Hands-free shortcut used to be titled "Hands-free · <date>", naming a practice type. It takes the title its source gives any set: "New items · <date>", "Reviews · <date>", or the skill title. Other titles are returned as they are. */
export function sourceTitle<T extends { title: string; source?: string; emphasis?: unknown }>(set: T): T {
  const match = /^Hands-free · (.+)$/.exec(set.title)
  if (!match) return set
  const rest = match[1]
  const title = set.emphasis ? rest : set.source === 'new' ? `New items · ${rest}` : set.source === 'review' ? `Reviews · ${rest}` : rest
  return { ...set, title }
}
