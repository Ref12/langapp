/** Any language-prefixed ref (ja:, ko:, or a language this build does not know): never a Chinese record. Chinese refs are kind:label (vocabulary:, grammar:, phrase:, source:). */
export const isLanguageRef = (ref: string): boolean => /^[a-z]{2,3}:/.test(ref)
/** A lesson id of another language's track (ja:lesson:3). Chinese lesson ids never start with a language prefix. */
export const isLanguageLessonId = (id: string): boolean => /^(?!zh:)[a-z]{2,3}:/.test(id)
