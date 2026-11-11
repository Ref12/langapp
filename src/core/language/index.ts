import { buildLanguage } from '../storage-names'
import type { SpeechLocale } from '../assistant/contracts'
import type { SpeechHint } from './speech-text'
import { packFor, type LanguagePack } from './packs'

export * from './ids'
export * from './areas'
export * from './packs'

/** The pack of the language this bundle was built for. */
export function getPack(): LanguagePack { return packFor(buildLanguage()) }

export type { SpeechHint, SpeechKind } from './speech-text'
/** The text to hand the speech engine for a text of this locale: the build's pack decides for its own language (speech-text.ts), other locales (English) are spoken as they are. */
export function spokenText(locale: SpeechLocale, text: string, hint?: SpeechHint): string {
  const pack = getPack()
  return locale === pack.speechLocale ? pack.speechText(text, hint) : text
}
