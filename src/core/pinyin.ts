import { z } from 'zod'

export const pinyinFormatSchema = z.enum(['marks', 'marks-and-numbers', 'numbers'])
export type PinyinFormat = z.infer<typeof pinyinFormatSchema>
export const DEFAULT_PINYIN_FORMAT: PinyinFormat = 'marks'

const toneMarks: Record<string, string> = { '\u0304': '1', '\u0301': '2', '\u030c': '3', '\u0300': '4' }
const tonePattern = /[\u0304\u0301\u030c\u0300]/g
const syllables = new Set(`a ai an ang ao
ba bai ban bang bao bei ben beng bi bian biao bie bin bing bo bu
ca cai can cang cao ce cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang chui chun chuo ci cong cou cu cuan cui cun cuo
da dai dan dang dao de dei den deng di dia dian diao die ding diu dong dou du duan dui dun duo
e ei en eng er ê
fa fan fang fei fen feng fo fou fu
ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo
ha hai han hang hao he hei hen heng hm hng hong hou hu hua huai huan huang hui hun huo
ji jia jian jiang jiao jie jin jing jiong jiu ju juan jue jun
ka kai kan kang kao ke kei ken keng kong kou ku kua kuai kuan kuang kui kun kuo
la lai lan lang lao le lei leng li lia lian liang liao lie lin ling liu lo long lou lu luan lun luo lü lüe
m ma mai man mang mao me mei men meng mi mian miao mie min ming miu mo mou mu
n na nai nan nang nao ne nei nen neng ng ni nian niang niao nie nin ning niu nong nou nu nuan nuo nü nüe
o ou
pa pai pan pang pao pei pen peng pi pian piao pie pin ping po pou pu
qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun
r ran rang rao re ren reng ri rong rou ru ruan rui run ruo
sa sai san sang sao se sen seng sha shai shan shang shao she shei shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song sou su suan sui sun suo
ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan tui tun tuo
wa wai wan wang wei wen weng wo wu
xi xia xian xiang xiao xie xin xing xiong xiu xu xuan xue xun
ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun
za zai zan zang zao ze zei zen zeng zha zhai zhan zhang zhao zhe zhei zhen zheng zhi zhong zhou zhu zhua zhuai zhuan zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo`.split(/\s+/))

interface Syllable { marked: string; base: string; tone: string }

function markSyllable(base: string, tone: string): string | undefined {
  // a/e take priority, then the o in ou, otherwise the final vowel.
  const index = base.search(/[aeê]|ou/i)
  const target = index >= 0 ? index : base.search(/[iouü](?!.*[iouü])/i)
  const position = target >= 0 ? target : base.search(/[mn]/i)
  if (position < 0) return undefined
  const mark = Object.keys(toneMarks).find(mark => toneMarks[mark] === tone)
  return `${base.slice(0, position + 1)}${mark}${base.slice(position + 1)}`.normalize('NFC')
}

function readSyllable(text: string): Syllable | undefined {
  const normalized = text.replace(/u:|v/gi, value => value[0] === value[0].toUpperCase() ? 'Ü' : 'ü').normalize('NFD')
  const marks = normalized.match(tonePattern) ?? []
  const number = normalized.match(/[0-5]$/)?.[0]
  if (marks.length > 1) return undefined
  const base = normalized.replace(tonePattern, '').replace(/[0-5]$/, '').normalize('NFC')
  const lower = base.toLowerCase()
  if (!syllables.has(lower) && !(lower.endsWith('r') && syllables.has(lower.slice(0, -1)))) return undefined
  const mark = marks[0]
  const tone = mark ? toneMarks[mark] : number && number !== '0' ? number : '5'
  if (number && (number === '0' ? '5' : number) !== tone) return undefined
  const marked = marks.length || tone === '5' ? normalized.replace(/[0-5]$/, '').normalize('NFC')
    : markSyllable(base, tone)
  if (!marked) return undefined
  return { marked, base, tone }
}

function splitToken(token: string): Syllable[] | undefined {
  const single = readSyllable(token)
  if (single) return [single]
  // Joined spellings need explicit tone evidence. Do not guess how plain prose
  // or ambiguous transcriptions divide into syllables.
  if (!token.normalize('NFD').match(tonePattern) || token.length > 100) return undefined
  const letters = Array.from(token.normalize('NFC'))
  const paths: (Syllable[] | undefined)[] = Array(letters.length + 1)
  const ways = Array<number>(letters.length + 1).fill(0)
  paths[letters.length] = []
  ways[letters.length] = 1
  for (let start = letters.length - 1; start >= 0; start--) {
    for (let end = start + 1; end <= Math.min(letters.length, start + 8); end++) {
      const next = paths[end]
      const part = readSyllable(letters.slice(start, end).join(''))
      if (!part || !next) continue
      const candidate = [part, ...next]
      if (!paths[start] || candidate.length < paths[start]!.length) {
        paths[start] = candidate
        ways[start] = ways[end]
      } else if (candidate.length === paths[start]!.length) {
        ways[start] = Math.min(2, ways[start] + ways[end])
      }
    }
  }
  return ways[0] === 1 ? paths[0] : undefined
}

export function formatPinyin(text: string, format: PinyinFormat = DEFAULT_PINYIN_FORMAT): string {
  return text.replace(/(?:u:|[\p{Script=Latin}\p{M}])+[0-9]*/giu, token => {
    if (/^[A-Z]$/.test(token)) return token
    const parts = splitToken(token)
    if (!parts) return token
    return parts.map(part => format === 'marks' ? part.marked
      : `${format === 'numbers' ? part.base : part.marked}${part.tone}`).join('')
  })
}
