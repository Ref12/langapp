import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './database'
import type { LanguageProfile } from './domain'

export function useActiveProfile(): LanguageProfile | null | undefined {
  return useLiveQuery(async () => {
    const setting = await db.settings.get('activeProfileId')
    if (setting) {
      const selected = await db.profiles.get(setting.value)
      if (selected) return selected
    }
    return (await db.profiles.orderBy('createdAt').first()) ?? null
  })
}
