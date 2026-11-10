/** Whether a reading line says something the line above it does not: not when it is empty or the same as the text (a pattern name, a word written only in kana). */
export function showsReading(reading: string | undefined, text: string): boolean {
  const clean = (value: string) => value.normalize('NFC').replace(/\s+/g, '')
  return Boolean(reading) && clean(reading as string) !== clean(text)
}
