import { hasGuide, isHan } from '../../core/characters/writing-route'
import { writingRoute } from '../../core/characters/dictionary'
import { navigate } from '../../core/routing'

/** Opens the writing practice for the phrase's first character that has a stroke guide, coming back to `route`. Returns false when there is none. */
export function writePhrase(text: string, route: string): boolean {
  const chars = Array.from(text)
  const index = chars.findIndex(character => isHan(character) && hasGuide(character))
  if (index < 0) return false
  navigate(writingRoute(chars[index], 'all', { word: text, index, back: route }).slice(1))
  return true
}
