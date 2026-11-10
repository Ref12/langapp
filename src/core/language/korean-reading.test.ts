import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { pronounceKoreanWord, romanizeKorean, romanizeKoreanByRules, romanizePronunciation } from './korean-reading'

const root = resolve(__dirname, '../../..')
const overlay = parse(readFileSync(resolve(root, 'curriculum/korean/reading-overlay.yaml'), 'utf8')) as { entries: Record<string, { pronunciations?: string[] }> }
const band = JSON.parse(readFileSync(resolve(root, 'src/data/packs/ko/band-1.generated.json'), 'utf8')) as { vocabulary: { id: string; ch: string }[] }
const official = band.vocabulary.filter(word => overlay.entries[word.id]?.pronunciations?.[0]).map(word => ({ ch: word.ch, said: overlay.entries[word.id].pronunciations![0].replace(/\u02d0/g, '') }))

const WORDS: [string, string][] = [
  // liaison
  ['읽어요', 'ilgeoyo'], ['먹어요', 'meogeoyo'], ['한국어', 'hangugeo'], ['음악이', 'eumagi'], ['책이', 'chaegi'], ['밥을', 'babeul'], ['앉아요', 'anjayo'], ['없어요', 'eopseoyo'], ['먹었어요', 'meogeosseoyo'], ['십일', 'sibil'], ['옷이', 'osi'],
  // nasalization and ㄹ assimilation
  ['입니다', 'imnida'], ['감사합니다', 'gamsahamnida'], ['십육', 'simnyuk'], ['이십육', 'isimnyuk'], ['먹는', 'meongneun'], ['국립', 'gungnip'], ['종로', 'jongno'], ['신라', 'silla'], ['달님', 'dallim'],
  // tensification (RR does not write it)
  ['학생', 'haksaeng'], ['학교', 'hakgyo'], ['먹습니다', 'meokseumnida'], ['있다', 'itda'],
  // palatalization
  ['같이', 'gachi'], ['굳이', 'guji'], ['닫히다', 'dachida'], ['끝이', 'kkeuchi'],
  // ㅎ
  ['좋아요', 'joayo'], ['좋다', 'jota'], ['많이', 'mani'], ['괜찮아요', 'gwaenchanayo'], ['못하다', 'motada'], ['축하', 'chuka'], ['입학', 'ipak'], ['전화', 'jeonhwa'],
  // final clusters
  ['값', 'gap'], ['값이', 'gapsi'], ['읽다', 'ikda'], ['읽고', 'ilgo'], ['닭', 'dak'], ['삶', 'sam'], ['넓다', 'neolda'], ['젊다', 'jeomda'],
]
describe('Korean reading rules', () => {
  it.each(WORDS)('%s is %s', (word, expected) => { expect(romanizeKorean(word)).toBe(expected); expect(romanizeKoreanByRules(word)).toBe(expected) })
  it('says what the rules do to the sound', () => {
    expect(pronounceKoreanWord('학생')).toBe('학쌩')
    expect(pronounceKoreanWord('좋아요')).toBe('조아요')
    expect(pronounceKoreanWord('같이')).toBe('가치')
  })
})

const SENTENCES: [string, string][] = [
  ['저는 학생이에요.', 'jeoneun haksaengieyo.'],
  ['저는 한국어를 공부해요.', 'jeoneun hangugeoreul gongbuhaeyo.'],
  ['안녕하세요?', 'annyeonghaseyo?'],
  ['감사합니다.', 'gamsahamnida.'],
  ['만나서 반갑습니다.', 'mannaseo bangapseumnida.'],
  ['이것은 책입니다.', 'igeoseun chaegimnida.'],
  ['저는 매일 책을 읽어요.', 'jeoneun maeil chaegeul ilgeoyo.'],
  ['밥을 먹었어요.', 'babeul meogeosseoyo.'],
  ['지금 몇 시예요?', 'jigeum myeot siyeyo?'],
  ['오늘은 날씨가 좋아요.', 'oneureun nalssiga joayo.'],
  ['학교에 갑니다.', 'hakgyoe gamnida.'],
  ['한국 음식이 맛있어요.', 'hanguk eumsigi masisseoyo.'],
  ['값이 얼마예요?', 'gapsi eolmayeyo?'],
  ['이 책은 십육 달러예요.', 'i chaegeun simnyuk dalleoyeyo.'],
  ['저는 이십오 살이에요.', 'jeoneun isibo sarieyo.'],
  ['사과가 세 개 있어요.', 'sagwaga se gae isseoyo.'],
  ['친구를 만났습니다.', 'chingureul mannatseumnida.'],
  ['내일 학교에 가요.', 'naeil hakgyoe gayo.'],
  ['날씨가 많이 추워요.', 'nalssiga mani chuwoyo.'],
  ['집에서 공부합니다.', 'jibeseo gongbuhamnida.'],
  ['괜찮아요.', 'gwaenchanayo.'],
  ['같이 가요.', 'gachi gayo.'],
  ['무엇을 읽어요?', 'mueoseul ilgeoyo?'],
  ['꽃이 예뻐요.', 'kkochi yeppeoyo.'],
  ['어디에 있어요?', 'eodie isseoyo?'],
  ['주말에 영화를 봤어요.', 'jumare yeonghwareul bwasseoyo.'],
  ['물을 마십니다.', 'mureul masimnida.'],
  ['저는 중국어를 공부해요.', 'jeoneun junggugeoreul gongbuhaeyo.'],
  ['한국어는 재미있어요.', 'hangugeoneun jaemiisseoyo.'],
  ['십일 월 이십일 일이에요.', 'sibil wol isibil irieyo.'],
]
describe('Korean sentences', () => {
  it.each(SENTENCES)('%s', (text, expected) => { expect(romanizeKorean(text)).toBe(expected) })
  it('keeps what is not Hangul', () => { expect(romanizeKorean('3월 15일, OK!')).toBe('3wol 15il, OK!') })
})

describe('the official pronunciations of the lesson words', () => {
  it('there are 252 of them', () => { expect(official).toHaveLength(252) })
  it('every one matches after the length mark is removed and the sound is written in RR', () => {
    const wrong = official.filter(word => romanizeKorean(word.ch) !== romanizePronunciation(word.said, word.ch))
    expect(wrong).toEqual([])
  })
  it('the rules alone agree with most of them', () => {
    const agree = official.filter(word => romanizeKoreanByRules(word.ch) === romanizePronunciation(word.said, word.ch))
    console.log('rules alone match ' + agree.length + ' of ' + official.length + ': ' + official.filter(word => !agree.includes(word)).map(word => word.ch + ' ' + romanizeKoreanByRules(word.ch) + ' / ' + romanizePronunciation(word.said, word.ch)).join('; '))
    expect(agree.length).toBeGreaterThanOrEqual(official.length - 20)
  })
})
