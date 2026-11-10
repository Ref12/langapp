import type { PackForm } from './pack-data'
import { getPack } from './index'

const cache = new Map<string, Promise<PackForm[] | undefined>>()

/** The forms table of the build's pack, read once; undefined for a pack without one (Chinese). */
export function loadPackForms(): Promise<PackForm[] | undefined> {
  const pack = getPack()
  if (!pack.forms) return Promise.resolve(undefined)
  const loader = pack.forms
  let loaded = cache.get(pack.id)
  if (!loaded) {
    loaded = loader().then(module => (module.default as { forms: PackForm[] }).forms)
    cache.set(pack.id, loaded)
  }
  return loaded
}
