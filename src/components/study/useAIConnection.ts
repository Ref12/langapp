import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../core/database'

/** The saved AI connection: undefined while loading, null when none is set up. */
export function useAIConnection() {
  return useLiveQuery(() => db.aiConnections.get('assistant').then(connection => connection ?? null), [])
}
