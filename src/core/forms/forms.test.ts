import { describe, expect, it } from 'vitest'
import { analyse, formItemId, forms, formsEngine } from './index'
import jaParallel from '../../data/parallel/ja.json'
import koParallel from '../../data/parallel/ko.json'

const ja = (lemma: string, cls: string, form: string, reading?: string) => forms('ja', lemma, cls, form, { reading })
const ko = (lemma: string, cls: string, form: string, opts?: { prev?: string; after?: 'vowel' | 'consonant' }) => forms('ko', lemma, cls, form, opts)?.surface

describe('Japanese forms', () => {
  it('builds the named irregulars', () => {
    expect(ja('来る', 'kuru', 'masu', 'くる')).toEqual({ surface: '来ます', reading: 'きます' })
    expect(ja('する', 'suru', 'masu')).toEqual({ surface: 'します' })
    expect(ja('行く', 'godan-iku', 'te', 'いく')).toEqual({ surface: '行って', reading: 'いって' })
    expect(ja('いい', 'i-adj-ii', 'adj-past', 'いい')).toEqual({ surface: 'よかった', reading: 'よかった' })
    expect(ja('勉強する', 'suru-compound', 'masu')?.surface).toBe('勉強します')
  })
  it('conjugates every godan row, ichidan and the irregular verbs', () => {
    const rows: [string, string, string, string][] = [
      ['買う', 'godan-u', '買って', '買わない'], ['書く', 'godan-ku', '書いて', '書かない'], ['泳ぐ', 'godan-gu', '泳いで', '泳がない'],
      ['話す', 'godan-su', '話して', '話さない'], ['待つ', 'godan-tsu', '待って', '待たない'], ['死ぬ', 'godan-nu', '死んで', '死なない'],
      ['遊ぶ', 'godan-bu', '遊んで', '遊ばない'], ['飲む', 'godan-mu', '飲んで', '飲まない'], ['帰る', 'godan-ru', '帰って', '帰らない'],
      ['食べる', 'ichidan', '食べて', '食べない'], ['する', 'suru', 'して', 'しない'], ['来る', 'kuru', '来て', '来ない'],
    ]
    for (const [lemma, cls, te, nai] of rows) {
      expect(ja(lemma, cls, 'te')?.surface).toBe(te)
      expect(ja(lemma, cls, 'nai')?.surface).toBe(nai)
    }
    expect(ja('飲む', 'godan-mu', 'ta')?.surface).toBe('飲んだ')
    expect(ja('書く', 'godan-ku', 'masen')?.surface).toBe('書きません')
    expect(ja('書く', 'godan-ku', 'mashita')?.surface).toBe('書きました')
    expect(ja('書く', 'godan-ku', 'masendeshita')?.surface).toBe('書きませんでした')
    expect(ja('書く', 'godan-ku', 'nakatta')?.surface).toBe('書かなかった')
    expect(ja('書く', 'godan-ku', 'tai')?.surface).toBe('書きたい')
    expect(ja('書く', 'godan-ku', 'mashou')?.surface).toBe('書きましょう')
    expect(ja('書く', 'godan-ku', 'potential')?.surface).toBe('書ける')
    expect(ja('食べる', 'ichidan', 'potential')?.surface).toBe('食べられる')
    expect(ja('する', 'suru', 'potential')?.surface).toBe('できる')
    expect(ja('書く', 'godan-ku', 'volitional')?.surface).toBe('書こう')
    expect(ja('食べる', 'ichidan', 'volitional')?.surface).toBe('食べよう')
    expect(ja('来る', 'kuru', 'volitional', 'くる')?.reading).toBe('こよう')
    expect(ja('書く', 'godan-ku', 'teiru')?.surface).toBe('書いている')
    expect(ja('書く', 'godan-ku', 'teimasu')?.surface).toBe('書いています')
    expect(ja('ある', 'godan-aru', 'nai')?.surface).toBe('ない')
  })
  it('conjugates adjectives, na-adjectives and nouns', () => {
    const adj = ['adj-plain', 'adj-polite', 'adj-neg', 'adj-neg-polite', 'adj-past', 'adj-past-polite', 'adj-past-neg', 'adj-past-neg-polite']
    expect(adj.map(form => ja('高い', 'i-adj', form)?.surface)).toEqual(['高い', '高いです', '高くない', '高くないです', '高かった', '高かったです', '高くなかった', '高くなかったです'])
    expect(adj.map(form => ja('いい', 'i-adj-ii', form)?.surface)).toEqual(['いい', 'いいです', 'よくない', 'よくないです', 'よかった', 'よかったです', 'よくなかった', 'よくなかったです'])
    expect(adj.map(form => ja('静か', 'na-adj', form)?.surface)).toEqual(['静かだ', '静かです', '静かではない', '静かではないです', '静かだった', '静かでした', '静かではなかった', '静かではなかったです'])
    expect(ja('学生', 'noun', 'adj-polite')?.surface).toBe('学生です')
    expect(ja('高い', 'i-adj', 'adj-neg-polite-arimasen')?.surface).toBe('高くありません')
    expect(ja('高い', 'i-adj', 'masu')).toBeNull()
  })
  it('analyses a surface (or its kana reading) into the forms that build it', () => {
    expect(analyse('ja', '来ます', '来る', 'kuru', { reading: 'くる' })).toEqual(['masu'])
    expect(analyse('ja', 'きます', '来る', 'kuru', { reading: 'くる' })).toEqual(['masu'])
    expect(analyse('ja', '行って', '行く', 'godan-iku', { reading: 'いく' })).toEqual(['te'])
    expect(analyse('ja', '行いて', '行く', 'godan-iku', { reading: 'いく' })).toEqual([])
    expect(analyse('ja', 'よかった', 'いい', 'i-adj-ii')).toEqual(['adj-past'])
  })
  it('classifies from the dictionary form and the part of speech', () => {
    const engine = formsEngine('ja')
    expect(engine.classify('食べる', 'Ichidan verb; transitive verb')).toBe('ichidan')
    expect(engine.classify('帰る', "Godan verb with 'ru' ending; intransitive verb")).toBe('godan-ru')
    expect(engine.classify('買う', "Godan verb with 'u' ending; transitive verb")).toBe('godan-u')
    expect(engine.classify('行く', "Godan verb - Iku/Yuku special class")).toBe('godan-iku')
    expect(engine.classify('勉強する', 'verb')).toBe('suru-compound')
    expect(engine.classify('する', 'verb')).toBe('suru')
    expect(engine.classify('来る', 'Kuru verb - special class')).toBe('kuru')
    expect(engine.classify('高い', 'adjective (keiyoushi)')).toBe('i-adj')
    expect(engine.classify('いい', 'adjective (keiyoushi) - yoi/ii class')).toBe('i-adj-ii')
    expect(engine.classify('きれい', 'adjectival nouns or quasi-adjectives (keiyodoshi)')).toBe('na-adj')
    expect(engine.classify('学校', 'noun (common) (futsuumeishi)')).toBeNull()
  })
  it('marks only the irregular forms as items', () => {
    const engine = formsEngine('ja')
    expect(engine.irregular('来る', 'kuru', 'masu', { reading: 'くる' })).toBe(true)
    expect(engine.irregular('行く', 'godan-iku', 'te', { reading: 'いく' })).toBe(true)
    expect(engine.irregular('行く', 'godan-iku', 'masu', { reading: 'いく' })).toBe(false)
    expect(engine.irregular('書く', 'godan-ku', 'te')).toBe(false)
    expect(engine.irregular('勉強する', 'suru-compound', 'masu')).toBe(false)
    expect(formItemId('ja', '来る', 'masu')).toBe('ja:f:来る:masu')
  })
})

describe('Korean forms', () => {
  it('builds the named irregulars', () => {
    expect(ko('춥다', 'b-irregular', 'haeyo')).toBe('추워요')
    expect(ko('듣다', 'd-irregular', 'haeyo')).toBe('들어요')
    expect(ko('모르다', 'reu-irregular', 'haeyo')).toBe('몰라요')
    expect(ko('하다', 'hada', 'haeyo')).toBe('해요')
    expect(ko('이다', 'copula-ida', 'haeyo', { after: 'vowel' })).toBe('예요')
    expect(ko('이다', 'copula-ida', 'haeyo', { prev: '학생' })).toBe('이에요')
    expect(ko('이다', 'copula-ida', 'haeyo', { prev: '친구' })).toBe('예요')
    expect(ko('아니다', 'copula-anida', 'haeyo')).toBe('아니에요')
  })
  it('contracts and harmonises regular stems', () => {
    const cases: [string, string, string][] = [
      ['가다', 'regular-vowel', '가요'], ['보다', 'regular-vowel', '봐요'], ['배우다', 'regular-vowel', '배워요'], ['마시다', 'regular-vowel', '마셔요'],
      ['되다', 'regular-vowel', '돼요'], ['먹다', 'regular-consonant', '먹어요'], ['좋다', 'regular-consonant', '좋아요'], ['있다', 'regular-consonant', '있어요'],
      ['쓰다', 'eu-stem', '써요'], ['아프다', 'eu-stem', '아파요'], ['예쁘다', 'eu-stem', '예뻐요'], ['크다', 'eu-stem', '커요'],
      ['살다', 'l-stem', '살아요'], ['낫다', 's-irregular', '나아요'], ['그렇다', 'h-irregular', '그래요'], ['돕다', 'b-irregular', '도와요'],
      ['공부하다', 'hada', '공부해요'], ['부르다', 'reu-irregular', '불러요'],
    ]
    for (const [lemma, cls, expected] of cases) expect(ko(lemma, cls, 'haeyo')).toBe(expected)
  })
  it('builds every form of the brief', () => {
    expect(ko('가다', 'regular-vowel', 'past')).toBe('갔어요')
    expect(ko('먹다', 'regular-consonant', 'past')).toBe('먹었어요')
    expect(ko('춥다', 'b-irregular', 'past')).toBe('추웠어요')
    expect(ko('가다', 'regular-vowel', 'future')).toBe('갈 거예요')
    expect(ko('먹다', 'regular-consonant', 'future')).toBe('먹을 거예요')
    expect(ko('살다', 'l-stem', 'future')).toBe('살 거예요')
    expect(ko('가다', 'regular-vowel', 'wish')).toBe('가고 싶어요')
    expect(ko('춥다', 'b-irregular', 'wish')).toBe('춥고 싶어요')
    expect(ko('먹다', 'regular-consonant', 'honorific')).toBe('먹으세요')
    expect(ko('가다', 'regular-vowel', 'honorific')).toBe('가세요')
    expect(ko('살다', 'l-stem', 'honorific')).toBe('사세요')
    expect(ko('듣다', 'd-irregular', 'honorific')).toBe('들으세요')
    expect(ko('먹다', 'regular-consonant', 'neg-ji')).toBe('먹지 않아요')
    expect(ko('가다', 'regular-vowel', 'an-neg')).toBe('안 가요')
    expect(ko('공부하다', 'hada', 'an-neg')).toBe('공부 안 해요')
    expect(ko('먹다', 'regular-consonant', 'lkka')).toBe('먹을까요')
    expect(ko('가다', 'regular-vowel', 'lkka')).toBe('갈까요')
    expect(ko('먹다', 'regular-consonant', 'juseyo')).toBe('먹어 주세요')
    expect(ko('가다', 'regular-vowel', 'dict')).toBe('가다')
    expect(ko('가다', 'regular-vowel', 'go')).toBe('가고')
    expect(ko('가다', 'regular-vowel', 'aseo')).toBe('가서')
    expect(ko('살다', 'l-stem', 'formal')).toBe('삽니다')
    expect(ko('춥다', 'b-irregular', 'future')).toBe('추울 거예요')
    expect(ko('낫다', 's-irregular', 'honorific')).toBe('나으세요')
  })
  it('analyses a surface into the forms that build it', () => {
    expect(analyse('ko', '추워요', '춥다', 'b-irregular')).toEqual(['haeyo'])
    expect(analyse('ko', '공부 안 해요', '공부하다', 'hada')).toEqual(['an-neg'])
    expect(analyse('ko', '예요', '이다', 'copula-ida')).toEqual(['haeyo'])
    expect(analyse('ko', '춥어요', '춥다', 'b-irregular')).toEqual([])
  })
  it('classifies from the dictionary form', () => {
    const engine = formsEngine('ko')
    const cases: [string, string, string | null][] = [
      ['춥다', 'descriptive verb', 'b-irregular'], ['좁다', 'descriptive verb', 'regular-consonant'], ['입다', 'verb', 'regular-consonant'], ['듣다', 'verb', 'd-irregular'],
      ['받다', 'verb', 'regular-consonant'], ['낫다', 'verb', 's-irregular'], ['모르다', 'verb', 'reu-irregular'], ['따르다', 'verb', 'eu-stem'], ['그렇다', 'descriptive verb', 'h-irregular'],
      ['좋다', 'descriptive verb', 'regular-consonant'], ['살다', 'verb', 'l-stem'], ['쓰다', 'verb', 'eu-stem'], ['공부하다', 'verb', 'hada'], ['가다', 'verb', 'regular-vowel'],
      ['이다', '', 'copula-ida'], ['아니다', '', 'copula-anida'], ['학생', 'noun', null],
    ]
    for (const [lemma, pos, expected] of cases) expect(engine.classify(lemma, pos)).toBe(expected)
  })
  it('marks only the irregular forms as items', () => {
    const engine = formsEngine('ko')
    expect(engine.irregular('춥다', 'b-irregular', 'haeyo')).toBe(true)
    expect(engine.irregular('듣다', 'd-irregular', 'go')).toBe(false)
    expect(engine.irregular('살다', 'l-stem', 'honorific')).toBe(true)
    expect(engine.irregular('살다', 'l-stem', 'haeyo')).toBe(false)
    expect(engine.irregular('공부하다', 'hada', 'haeyo')).toBe(false)
    expect(formItemId('ko', '춥다', 'haeyo')).toBe('ko:f:춥다:haeyo')
  })
})

type Token = { t: string; w?: string; g?: string; form?: string; span?: number }
type Data = { entries: Record<string, { target: string; class?: string }>; formItems: Record<string, { lesson: number }>; counts: { forms: { tagged: number; unmatched: number } }; lessons: { number: number; forms?: string[]; phrases: { tokens: Token[]; strict: boolean; forms?: string[] }[] }[] }

describe.each([['ja', jaParallel], ['ko', koParallel]] as const)('retagged %s parallel data', (language, raw) => {
  const data = raw as unknown as Data
  it('tags tokens with a form, keeps the form on a token whose entry has a class', () => {
    const tagged = data.lessons.flatMap(lesson => lesson.phrases.flatMap(phrase => phrase.tokens.filter(token => token.form)))
    expect(tagged.length).toBe(data.counts.forms.tagged)
    expect(tagged.length).toBeGreaterThan(600)
    for (const token of tagged) if (token.w) expect(data.entries[token.w]?.class).toBeTruthy()
  })
  it('lists each irregular form item in the lesson where it first appears', () => {
    const firsts = new Map<string, number>()
    for (const lesson of data.lessons) for (const id of lesson.forms ?? []) firsts.set(id, lesson.number)
    expect([...firsts.keys()].sort()).toEqual(Object.keys(data.formItems).sort())
    for (const [id, number] of firsts) { expect(data.formItems[id].lesson).toBe(number); expect(id.startsWith(language + ':f:')).toBe(true) }
  })
  it('regenerates the written surface from the lemma, class and form of the tagged words', () => {
    const engine = formsEngine(language)
    let checked = 0, same = 0
    for (const lesson of data.lessons) for (const phrase of lesson.phrases) phrase.tokens.forEach((token, at) => {
      if (!token.w || !token.form) return
      const entry = data.entries[token.w] as { target: string; reading?: string; class?: string }
      if (!entry.class) return
      const written = phrase.tokens.slice(at, at + 1 + (token.span ?? 0)).map(item => item.t).join('')
      checked++
      if (engine.analyse(written, entry.target, entry.class, { reading: entry.reading }).includes(token.form)) same++
    })
    expect(checked).toBeGreaterThan(300)
    expect(same / checked).toBeGreaterThan(0.85)
  })
})
