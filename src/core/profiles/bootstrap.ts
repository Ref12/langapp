import { db, type LearningDatabase } from '../database'
import { DEFAULT_PROFILE_ID } from './identity'
import { localProfilesAvailable, readLocalDefaultProfile } from './local-client'
import { getActiveProfile, initializeProfiles, needsLocalSettingsImport, restoreActiveProfile } from './store'

export type DefaultProfileBootstrapResult = 'imported' | 'missing' | 'skipped'
let initialization: Promise<DefaultProfileBootstrapResult> | undefined

async function emptyDatabase(database: LearningDatabase): Promise<boolean> {
  for (const table of database.tables) {
    if (await table.count()) return false
  }
  return true
}

async function bootstrap(): Promise<DefaultProfileBootstrapResult> {
  if (!localProfilesAvailable()) return 'skipped'
  await initializeProfiles()
  if (getActiveProfile().id !== DEFAULT_PROFILE_ID || !await needsLocalSettingsImport()) return 'skipped'
  const database = db
  if (!await database.transaction('r', database.tables, () => emptyDatabase(database))) return 'skipped'

  let file: Awaited<ReturnType<typeof readLocalDefaultProfile>>
  try {
    file = await readLocalDefaultProfile(new AbortController().signal)
  } catch {
    throw new Error('Could not automatically load data/default.yaml. Check that it is valid profile YAML with profile.id: default and that the local development server is running, then reload. No browser data was replaced.')
  }
  if (!file) return 'missing'

  try {
    return await database.transaction('rw', database.tables, async () => {
      // Another tab or a user action may have populated any table while the file was loading.
      if (!await emptyDatabase(database)) return 'skipped'
      await restoreActiveProfile(file.yaml)
      return 'imported'
    })
  } catch {
    throw new Error('The automatic data/default.yaml import could not be saved. Check that browser storage is available, then reload. No browser data was replaced.')
  }
}

// Run before initializeWorkspace: even untouched, existing preferences belong to the browser.
export function bootstrapDefaultProfile(): Promise<DefaultProfileBootstrapResult> {
  if (!initialization) {
    initialization = bootstrap().catch(error => {
      initialization = undefined
      throw error
    })
  }
  return initialization
}
