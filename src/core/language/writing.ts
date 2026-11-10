// The writing entry of a language pack: which stroke data the build's language has and which characters its write, stroke and introduction views take.
// Screens ask the pack (getPack().writing); nothing tests the language. A build that sets __PACK_DATA__ keeps only its own language's index (the others fold away, as in packs.ts).

import type { CharacterAssetSummary, WritingLanguage } from '../characters/summary'
import zhIndex from '../../data/characters/index.generated.json'
import { isHan, isHangul, isKana } from '../characters/scripts'
import jaIndex from '../../../public/characters/japanese/index.generated.json'
import koIndex from '../../../public/characters/korean/index.generated.json'

declare const __PACK_DATA__: string

export interface PackWriting {
  /** The language whose stroke data this build writes with (the folder under public/characters). */
  language: WritingLanguage
  /** Whether the language's own stroke data has this character. Synchronous; a character without a guide has no Write button. */
  hasGuide(character: string): boolean
  /** The character's stroke count in the language's data; undefined without a guide. */
  strokeCount(character: string): number | undefined
  /** The characters of a word the write and stroke views take, in order: every one that has a guide. */
  guidedChars(word: string): string[]
  /** Whether a character with a guide gets a "new character" introduction (and is queued to learn). The one place to change what is taught as a character. */
  introduces(character: string): boolean
  /** The characters of a word that get an introduction: guided and introduced. */
  introducedChars(word: string): string[]
  /** Every character the language has a guide for. */
  guideCharacters(): string[]
  /** The same, as the asset index lists them (the Chinese index entries themselves; Japanese and Korean: count only). */
  summaries(): CharacterAssetSummary[]
  /** Whether the language has Chinese-style character data around the strokes (meanings, parts, practice history). Only Chinese does. */
  characterData: boolean
  /** Whether finishing a character's practice is recorded in this build's own character states (true for the build's language, false for another language's guide shown beside it). */
  records: boolean
}

function entry(language: WritingLanguage, strokes: () => Map<string, number>, summaries: () => CharacterAssetSummary[], introduces: (character: string) => boolean, characterData = false): PackWriting {
  const hasGuide = (character: string) => strokes().has(character)
  const guidedChars = (word: string) => Array.from(word).filter(hasGuide)
  return {
    language, hasGuide, strokeCount: character => strokes().get(character), guidedChars, introduces,
    introducedChars: word => guidedChars(word).filter(introduces), guideCharacters: () => [...strokes().keys()], summaries, characterData, records: true,
  }
}
const memo = <T,>(make: () => T): (() => T) => { let value: T | undefined; return () => (value ??= make()) }
const fromMap = (index: { characters: Record<string, number> }, variant: string, keep: (character: string) => boolean = () => true) => {
  const strokes = memo(() => new Map(Object.entries(index.characters).filter(([character]) => keep(character))))
  return { strokes, summaries: memo(() => [...strokes()].map(([character, strokeCount]) => ({ character, strokeCount, reviewed: false, variant }))) }
}

const zhCharacters: CharacterAssetSummary[] = (typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'zh') ? zhIndex.characters : []
const zhStrokes = memo(() => new Map(zhCharacters.map(asset => [asset.character, asset.strokeCount])))
const jaData = fromMap((typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'ja') ? jaIndex : { characters: {} }, 'japanese-source')
const koData = fromMap((typeof __PACK_DATA__ === 'undefined' || __PACK_DATA__ === 'all' || __PACK_DATA__ === 'ko') ? koIndex : { characters: {} }, 'original-monoline-pilot', isHangul) // the Korean index also holds two punctuation marks; they are not written

/** Chinese: today's rule. A Han character with a guide, taught as it is written. */
export const zhWriting: PackWriting = entry('zh', zhStrokes, () => zhCharacters, isHan, true)
/** Japanese: every character with a guide, kanji and kana, is written; only kanji get an introduction (change `introduces` to teach kana as characters). */
export const jaWriting: PackWriting = entry('ja', jaData.strokes, jaData.summaries, isHan)
/** Korean: Hangul, from its own index; every Hangul character with a guide is written and introduced. */
export const koWriting: PackWriting = entry('ko', koData.strokes, koData.summaries, isHangul)

/** A language that is not the build's (the old parallel screens): no index here, so it says yes to anything of its script and the load decides. */
const foreign = (language: WritingLanguage): PackWriting => {
  const writable = (character: string) => language === 'zh' ? isHan(character) : language === 'ja' ? isHan(character) || isKana(character) : isHangul(character)
  return {
    language, hasGuide: writable, strokeCount: () => undefined, guidedChars: word => Array.from(word).filter(writable),
    introduces: writable, introducedChars: word => Array.from(word).filter(writable), guideCharacters: () => [], summaries: () => [], characterData: language === 'zh', records: false,
  }
}
/** The entry for a writing language: the pack's own when it is the build's language, else the permissive one above. */
export function writingFor(build: PackWriting, language: WritingLanguage): PackWriting {
  return build.language === language ? build : foreign(language)
}
