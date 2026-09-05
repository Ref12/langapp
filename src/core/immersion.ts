import type { ImmersionToken } from './domain'

export function normalizeImmersionToken(
  token: string[],
  properNames: ReadonlySet<string>,
  id: string,
): ImmersionToken | null {
  const rawTarget = token[0]?.trim()
  if (!rawTarget) return null

  const rawEnglish = token[2]?.trim() || rawTarget
  const properName = [...properNames].find(
    (name) => name.toLocaleLowerCase() === rawEnglish.toLocaleLowerCase(),
  )

  return {
    id,
    targetText: properName ?? rawTarget,
    romanization: properName ? '' : (token[1] ?? '').trim(),
    english: rawEnglish,
    after: token.slice(3).join(''),
  }
}
