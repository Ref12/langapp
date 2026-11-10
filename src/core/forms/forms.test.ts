import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { romanizeKorean } from '../language/korean-reading'
import { analyse, formItemId, forms, formsEngine } from './index'
import { wordFormsTable } from './conjugate'

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

  it('builds the irregular classes the lessons use against a reference (43 lemmas: polite, past, formal, honorific, -아서/어서)', () => {
    // [lemma, class, 해요체, past, 합니다체, 세요, 서] from a Korean dictionary's conjugation tables (Naver / Wiktionary), checked by hand
    const reference: string[][] = [
      ['춥다', 'b-irregular', '추워요', '추웠어요', '춥습니다', '추우세요', '추워서'], ['덥다', 'b-irregular', '더워요', '더웠어요', '덥습니다', '더우세요', '더워서'],
      ['뜨겁다', 'b-irregular', '뜨거워요', '뜨거웠어요', '뜨겁습니다', '뜨거우세요', '뜨거워서'], ['돕다', 'b-irregular', '도와요', '도왔어요', '돕습니다', '도우세요', '도와서'],
      ['어렵다', 'b-irregular', '어려워요', '어려웠어요', '어렵습니다', '어려우세요', '어려워서'], ['입다', 'regular-consonant', '입어요', '입었어요', '입습니다', '입으세요', '입어서'],
      ['듣다', 'd-irregular', '들어요', '들었어요', '듣습니다', '들으세요', '들어서'], ['걷다', 'd-irregular', '걸어요', '걸었어요', '걷습니다', '걸으세요', '걸어서'],
      ['받다', 'regular-consonant', '받아요', '받았어요', '받습니다', '받으세요', '받아서'], ['낫다', 's-irregular', '나아요', '나았어요', '낫습니다', '나으세요', '나아서'],
      ['웃다', 'regular-consonant', '웃어요', '웃었어요', '웃습니다', '웃으세요', '웃어서'], ['모르다', 'reu-irregular', '몰라요', '몰랐어요', '모릅니다', '모르세요', '몰라서'],
      ['부르다', 'reu-irregular', '불러요', '불렀어요', '부릅니다', '부르세요', '불러서'], ['이르다', 'reu-irregular', '일러요', '일렀어요', '이릅니다', '이르세요', '일러서'],
      ['머무르다', 'reu-irregular', '머물러요', '머물렀어요', '머무릅니다', '머무르세요', '머물러서'], ['살다', 'l-stem', '살아요', '살았어요', '삽니다', '사세요', '살아서'],
      ['알다', 'l-stem', '알아요', '알았어요', '압니다', '아세요', '알아서'], ['만들다', 'l-stem', '만들어요', '만들었어요', '만듭니다', '만드세요', '만들어서'],
      ['팔다', 'l-stem', '팔아요', '팔았어요', '팝니다', '파세요', '팔아서'], ['놀다', 'l-stem', '놀아요', '놀았어요', '놉니다', '노세요', '놀아서'], ['열다', 'l-stem', '열어요', '열었어요', '엽니다', '여세요', '열어서'],
      ['쓰다', 'eu-stem', '써요', '썼어요', '씁니다', '쓰세요', '써서'], ['크다', 'eu-stem', '커요', '컸어요', '큽니다', '크세요', '커서'], ['예쁘다', 'eu-stem', '예뻐요', '예뻤어요', '예쁩니다', '예쁘세요', '예뻐서'],
      ['바쁘다', 'eu-stem', '바빠요', '바빴어요', '바쁩니다', '바쁘세요', '바빠서'], ['아프다', 'eu-stem', '아파요', '아팠어요', '아픕니다', '아프세요', '아파서'],
      ['그렇다', 'h-irregular', '그래요', '그랬어요', '그렇습니다', '그러세요', '그래서'], ['어떻다', 'h-irregular', '어때요', '어땠어요', '어떻습니다', '어떠세요', '어때서'],
      ['좋다', 'regular-consonant', '좋아요', '좋았어요', '좋습니다', '좋으세요', '좋아서'], ['공부하다', 'hada', '공부해요', '공부했어요', '공부합니다', '공부하세요', '공부해서'],
      ['가다', 'regular-vowel', '가요', '갔어요', '갑니다', '가세요', '가서'], ['오다', 'regular-vowel', '와요', '왔어요', '옵니다', '오세요', '와서'],
      ['주다', 'regular-vowel', '줘요', '줬어요', '줍니다', '주세요', '줘서'], ['마시다', 'regular-vowel', '마셔요', '마셨어요', '마십니다', '마시세요', '마셔서'], ['보다', 'regular-vowel', '봐요', '봤어요', '봅니다', '보세요', '봐서'],
      ['쉽다', 'b-irregular', '쉬워요', '쉬웠어요', '쉽습니다', '쉬우세요', '쉬워서'], ['맵다', 'b-irregular', '매워요', '매웠어요', '맵습니다', '매우세요', '매워서'], ['좁다', 'regular-consonant', '좁아요', '좁았어요', '좁습니다', '좁으세요', '좁아서'],
      ['묻다', 'd-irregular', '물어요', '물었어요', '묻습니다', '물으세요', '물어서'], ['짓다', 's-irregular', '지어요', '지었어요', '짓습니다', '지으세요', '지어서'],
      ['빠르다', 'reu-irregular', '빨라요', '빨랐어요', '빠릅니다', '빠르세요', '빨라서'], ['다르다', 'reu-irregular', '달라요', '달랐어요', '다릅니다', '다르세요', '달라서'], ['하얗다', 'h-irregular', '하얘요', '하얬어요', '하얗습니다', '하야세요', '하얘서'],
    ]
    const ids = ['haeyo', 'past', 'formal', 'honorific', 'aseo']
    expect(reference.length).toBeGreaterThanOrEqual(40)
    for (const row of reference) ids.forEach((id, at) => expect(ko(row[0], row[1], id), row[0] + ' ' + id).toBe(row[2 + at]))
  })
  it('builds every form the lessons teach for every lesson verb and adjective, and never a verb-only form for an adjective', () => {
    const engine = formsEngine('ko')
    const band = JSON.parse(readFileSync(new URL('../../data/packs/ko/band-1.generated.json', import.meta.url), 'utf8')) as { vocabulary: { ch: string; ps?: string; cl?: string }[]; grammar: { id: string }[] }
    const words = band.vocabulary.filter(item => item.cl && !item.cl.startsWith('copula'))
    expect(words.length).toBe(79)
    let built = 0
    for (const item of words) {
      const kind = item.ps === 'adjective' ? 'adjective' : 'verb'
      for (const id of engine.formIds(item.cl!, kind)) {
        const form = engine.forms(item.ch, item.cl!, id)
        // a form restricted by lemma (only: / not: in forms.yaml) is absent for the words it does not fit, and for no other word
        if (!form) { expect(engine.rules.forms[id].only ?? engine.rules.forms[id].not, item.ch + ' ' + id).toBeTruthy(); continue }
        expect(form.surface.includes('undefined')).toBe(false)
        built++
      }
      if (kind === 'adjective') for (const id of ['wish', 'juseyo', 'purpose', 'progressive', 'prohibit']) expect(engine.formIds(item.cl!, kind).includes(id), item.ch + ' ' + id).toBe(false)
      expect(engine.forms(item.ch, item.cl!, 'haeyo')?.surface.endsWith('요')).toBe(true)
    }
    // the forms restricted by lemma (forms.yaml only: / not:) leave 1952 of the 2000-odd class-wide forms; the floor catches a rule that drops far more
    expect(built).toBeGreaterThan(1900)
  })
  it('builds the resultive (-아/어 있어요) only for intransitive verbs of change of state or position, and never for the other verbs', () => {
    const engine = formsEngine('ko')
    expect(engine.forms('공부하다', 'hada', 'resultive'), '공부해 있어요 is not Korean').toBeNull()
    for (const [lemma, cls] of [['먹다', 'regular-consonant'], ['읽다', 'regular-consonant'], ['마시다', 'regular-vowel'], ['쓰다', 'eu-stem'], ['듣다', 'd-irregular'], ['만들다', 'l-stem']]) expect(engine.forms(lemma, cls, 'resultive'), lemma).toBeNull()
    expect(ko('앉다', 'regular-consonant', 'resultive')).toBe('앉아 있어요')
    expect(ko('일어나다', 'regular-vowel', 'resultive')).toBe('일어나 있어요')
    expect(ko('켜지다', 'regular-vowel', 'resultive')).toBe('켜져 있어요')
    // the transitive 켜다 / 열다 take the resultive of their intransitive partner (lesson 47: 켜져 있어요)
    expect(ko('켜다', 'regular-vowel', 'resultive')).toBe('켜져 있어요')
    expect(ko('열다', 'l-stem', 'resultive')).toBe('열려 있어요')
    // the progressive is the form for the ordinary verb (공부하고 있어요), and the states have neither
    expect(ko('공부하다', 'hada', 'progressive')).toBe('공부하고 있어요')
    expect(engine.forms('있다', 'regular-consonant', 'progressive')).toBeNull()
    expect(engine.forms('필요하다', 'hada', 'wish')).toBeNull()
    expect(engine.forms('가다', 'regular-vowel', 'purpose')).toBeNull()
    expect(ko('먹다', 'regular-consonant', 'purpose')).toBe('먹으러')
  })
  it('keeps the resultive off 공부하다 on its card and in the questions, and on the intransitive lesson verb 앉다', () => {
    const band = JSON.parse(readFileSync(new URL('../../data/packs/ko/band-1.generated.json', import.meta.url), 'utf8')) as { vocabulary: { ch: string; ps?: string; cl?: string }[] }
    const engine = formsEngine('ko')
    const rowsOf = (lemma: string) => { const item = band.vocabulary.find(word => word.ch === lemma)!; return wordFormsTable('ko', lemma, item.cl!, undefined, new Set()).map(row => row.formId) }
    expect(rowsOf('공부하다')).not.toContain('resultive')
    expect(rowsOf('앉다')).toContain('resultive')
    expect(rowsOf('켜다')).toContain('resultive')
    // every lesson verb that gets the resultive is intransitive (or the transitive partner of one)
    const withIt = band.vocabulary.filter(item => item.cl && engine.forms(item.ch, item.cl, 'resultive')).map(item => item.ch)
    expect(withIt.sort()).toEqual(['가다', '앉다', '열다', '오다', '일어나다', '켜다', '살다'].sort())
  })
  it('grades spacing-only differences as almost', async () => {
    const { gradeConjugate } = await import('./conjugate')
    const answer = { surface: '만들 수 있어요' }
    expect(gradeConjugate('ko', '만들 수 있어요', answer)).toBe('right')
    expect(gradeConjugate('ko', '만들수 있어요', answer)).toBe('almost')
    expect(gradeConjugate('ko', '만들 수있어요', answer)).toBe('almost')
    expect(gradeConjugate('ko', '만들어요', answer)).toBe('wrong')
  })
  it('romanizes conjugated forms (Revised Romanization with sound changes): 20 forms', () => {
    const cases: [string, string, string, string][] = [['춥다', 'b-irregular', 'haeyo', 'chuwoyo'], ['듣다', 'd-irregular', 'haeyo', 'deureoyo'], ['부르다', 'reu-irregular', 'haeyo', 'bulleoyo'], ['만들다', 'l-stem', 'formal', 'mandeumnida'],
      ['먹다', 'regular-consonant', 'formal', 'meokseumnida'], ['좋다', 'regular-consonant', 'haeyo', 'joayo'], ['쓰다', 'eu-stem', 'haeyo', 'sseoyo'], ['공부하다', 'hada', 'haeyo', 'gongbuhaeyo'],
      ['공부하다', 'hada', 'formal', 'gongbuhamnida'], ['읽다', 'regular-consonant', 'haeyo', 'ilgeoyo'], ['앉다', 'regular-consonant', 'past', 'anjasseoyo'], ['많다', 'regular-consonant', 'haeyo', 'manayo'],
      ['없다', 'regular-consonant', 'haeyo', 'eopseoyo'], ['맛있다', 'regular-consonant', 'haeyo', 'masisseoyo'], ['좋아하다', 'hada', 'wish', 'joahago sipeoyo'], ['먹다', 'regular-consonant', 'honorific', 'meogeuseyo'],
      ['놀다', 'l-stem', 'future', 'nol geoyeyo'], ['입다', 'regular-consonant', 'formal', 'ipseumnida'], ['가다', 'regular-vowel', 'possible', 'gal su isseoyo'], ['일어나다', 'regular-vowel', 'past', 'ireonasseoyo']]
    for (const [lemma, cls, form, expected] of cases) expect(romanizeKorean(ko(lemma, cls, form)!), lemma + ' ' + form).toBe(expected)
  })
})
