import { db } from './database'
import {
  defaultRomanization,
  languageNames,
  type LanguageProfile,
  type TargetLanguage,
} from './domain'
import { createId, nowIso } from './ids'

export async function createLanguageProfile(
  targetLanguage: TargetLanguage,
  dailyNewItemLimit: number,
): Promise<LanguageProfile> {
  const timestamp = nowIso()
  const profile: LanguageProfile = {
    id: createId('profile'),
    name: languageNames[targetLanguage],
    sourceLanguage: 'en',
    targetLanguage,
    romanization: defaultRomanization[targetLanguage],
    dailyNewItemLimit,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  await db.profiles.add(profile)
  await db.settings.put({ key: 'activeProfileId', value: profile.id })
  return profile
}

export async function getActiveProfile(): Promise<LanguageProfile | undefined> {
  const setting = await db.settings.get('activeProfileId')
  if (setting) {
    const selected = await db.profiles.get(setting.value)
    if (selected) return selected
  }

  return db.profiles.orderBy('createdAt').first()
}

export async function setActiveProfile(profileId: string): Promise<void> {
  await db.settings.put({ key: 'activeProfileId', value: profileId })
}
