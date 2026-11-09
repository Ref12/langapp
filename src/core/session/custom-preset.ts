import { BUILTIN_PRESETS, customPresetSchema, presetFromCustom, type CustomPreset } from './presets'
import type { Preset } from './types'
import { storageNames } from '../storage-names'

const key = () => storageNames().local.customPresets

/** The learner's saved presets (the advanced builder), kept on this device. Invalid or unreadable data reads as none. */
export function loadCustomPresets(storage: Pick<Storage, 'getItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): CustomPreset[] {
  try {
    const raw = storage?.getItem(key())
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.flatMap(entry => { const parsed = customPresetSchema.safeParse(entry); return parsed.success ? [parsed.data] : [] }).slice(0, 12) : []
  } catch { return [] }
}

export function saveCustomPreset(preset: CustomPreset, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): CustomPreset[] {
  const parsed = customPresetSchema.parse(preset)
  const next = [...loadCustomPresets(storage).filter(entry => entry.id !== parsed.id), parsed].slice(-12)
  storage?.setItem(key(), JSON.stringify(next))
  return next
}

/** A preset by id: a built-in one, a saved one, else the default. */
export function resolvePreset(id: string, custom: readonly CustomPreset[] = loadCustomPresets()): Preset {
  const builtin = BUILTIN_PRESETS.find(entry => entry.id === id)
  if (builtin) return builtin
  const saved = custom.find(entry => entry.id === id)
  return saved ? presetFromCustom(saved) : BUILTIN_PRESETS[0]
}
