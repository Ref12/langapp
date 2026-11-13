// A time expression before or after the subject is the same answer (我晚上喝牛奶 = 晚上我喝牛奶; 今日は私は = 私は今日は; 오늘 저는 = 저는 오늘). The pack says what a time
// expression is and what a subject is; `canonicalTimeOrder` puts a sentence-initial pair in one order (time first) so the grader compares like with like. The vocabulary carries no word class
// for time words, so each language keeps a small explicit list here plus patterns for clock times and dates. Only the very start of the sentence is touched: a time word at the end, or
// between the verb and its object, keeps its place and stays a word-order mistake.

export interface TimeRules {
  /** Whole tiles that are time words. */
  words: ReadonlySet<string>
  /** Tiles that are time expressions by shape (clock times, dates, numerals plus a unit). */
  pattern?: RegExp
  /** A tile that is a number word and may be followed by a unit tile (Chinese 二零二六 + 年; Korean 세 + 시). */
  numeral?: RegExp
  /** A tile that is a unit after a number word, or alone when the digits were dropped by the segmenter (Chinese 年, 月, 点). */
  unit?: RegExp
  /** Whether a unit tile alone is a time expression (Chinese: the segmenter drops the digits of 2026年, leaving 年). */
  bareUnit?: boolean
  /** Particles a time expression may carry (に, 에) and a topic or subject carries (は, 는). */
  timeParticles: readonly string[]
  subjectParticles: readonly string[]
  /** Subjects need a particle (Japanese, Korean) or must not be one of these (Chinese adverbs and auxiliaries that open a sentence without a subject). */
  notSubject?: ReadonlySet<string>
  /** When set, only these tiles are taken for a subject (Chinese has no particle to mark one, and the data has no word class to tell a noun from a verb). */
  subjects?: ReadonlySet<string>
  requireSubjectParticle: boolean
}

const strip = (tile: string, particles: readonly string[]): string => {
  for (const particle of particles) if (tile.length > particle.length && tile.endsWith(particle)) return tile.slice(0, -particle.length)
  return tile
}

function isTimeTile(tile: string, rules: TimeRules): boolean {
  for (const form of [tile, strip(tile, rules.timeParticles), strip(tile, rules.subjectParticles)]) {
    if (rules.words.has(form) || rules.pattern?.test(form)) return true
  }
  return false
}

/** The number of tiles of the time expression that starts at `at` (0 when none), with its particle when it has one. */
function timeLength(words: readonly string[], at: number, rules: TimeRules): number {
  let index = at
  for (;;) {
    let next = index
    while (next < words.length && rules.numeral?.test(words[next])) next++
    const unit = next < words.length && rules.unit?.test(words[next]) && (next > index || rules.bareUnit)
    if (unit) next++
    else next = index
    if (next === index && index < words.length && isTimeTile(words[index], rules)) next = index + 1
    if (next === index) break
    index = next
  }
  if (index > at && index < words.length && rules.timeParticles.concat(rules.subjectParticles).includes(words[index])) index++
  return index - at
}

function subjectLength(words: readonly string[], at: number, rules: TimeRules): number {
  const tile = words[at]
  if (tile === undefined || timeLength(words, at, rules) || rules.notSubject?.has(tile) || (rules.subjects && !rules.subjects.has(tile))) return 0
  if (rules.subjectParticles.includes(tile) || rules.timeParticles.includes(tile)) return 0
  if (rules.subjectParticles.includes(words[at + 1] ?? '')) return 2
  if (rules.requireSubjectParticle) return rules.subjectParticles.some(particle => tile.length > particle.length && tile.endsWith(particle)) ? 1 : 0
  return 1
}

/** The sentence with a leading time expression and the subject next to it in the order time, subject. Anything else is returned as it came. */
export function canonicalTimeOrder(words: readonly string[], rules: TimeRules): string[] {
  const subject = subjectLength(words, 0, rules)
  if (subject) {
    const time = timeLength(words, subject, rules)
    // a time expression right after the subject is moved in front of it; something must follow, or the pair is the whole sentence
    if (time) return [...words.slice(subject, subject + time), ...words.slice(0, subject), ...words.slice(subject + time)]
  }
  return [...words]
}

const set = (text: string) => new Set(text.split(/\s+/u).filter(Boolean))

export const zhTime: TimeRules = {
  words: set('今天 明天 昨天 后天 前天 现在 早上 早晨 上午 中午 下午 晚上 晚间 夜里 半夜 今晚 明晚 昨晚 今早 明早 昨晚上 每天 每晚 每年 每月 每周 每个星期 周末 今年 明年 去年 本周 这周 下周 上周 这个星期 下个星期 上个星期 这个周末 下个周末 平时 平常 最近 以前 以后 刚才 马上 星期一 星期二 星期三 星期四 星期五 星期六 星期日 星期天 周一 周二 周三 周四 周五 周六 周日 周天 春天 夏天 秋天 冬天 暑假 寒假 小时候 现在的'),
  numeral: /^[零〇一二三四五六七八九十百两]+$/u,
  unit: /^(年|月|日|号|点|点钟|分|刻|半)$/u, bareUnit: true,
  timeParticles: [], subjectParticles: [], requireSubjectParticle: false,
  subjects: set('我 你 您 他 她 它 我们 你们 他们 她们 它们 咱们 大家 自己 妈妈 爸爸 哥哥 姐姐 弟弟 妹妹 爷爷 奶奶 老师 学生 同学 朋友 孩子 孩子们 老板 医生 老公 老婆 先生 太太 小明 小王 小李'),
  notSubject: set('也 都 就 才 还 又 再 不 没 没有 会 想 要 能 可以 常常 经常 总是 一直 已经 正在 在 把 被 很 非常 比较 先 然后 别 请 应该 必须'),
}

const JA_STAMP = /^[\d０-９〇一二三四五六七八九十]+(時|時半|分|秒|年|月|日|曜日|週間|時頃|時ごろ)$/u
export const jaTime: TimeRules = {
  words: set('今日 明日 昨日 一昨日 明後日 今朝 明朝 昨夜 今晩 今夜 毎日 毎朝 毎晩 毎週 毎月 毎年 今週 来週 先週 今月 来月 先月 今年 来年 去年 昨年 週末 今 いま 朝 昼 夜 午前 午後 夕方 最近 いつも あした きょう きのう あさ ゆうがた こんばん まいにち まいあさ まいばん しゅうまつ ことし らいねん きょねん げつようび 月曜日 火曜日 水曜日 木曜日 金曜日 土曜日 日曜日 休み 春 夏 秋 冬'),
  pattern: JA_STAMP,
  timeParticles: ['には', 'に', 'は', 'も'], subjectParticles: ['は', 'が', 'も'], requireSubjectParticle: true,
}

export const koTime: TimeRules = {
  words: set('오늘 내일 어제 모레 그저께 지금 아침 점심 저녁 밤 오전 오후 새벽 매일 매주 매달 매년 매일아침 주말 올해 내년 작년 이번 이번주 다음주 지난주 이번달 요즘 최근 방금 월요일 화요일 수요일 목요일 금요일 토요일 일요일 오늘아침 내일아침 오늘밤 어제밤'),
  pattern: /^[\d]+(시|분|초|년|월|일|시간)$/u,
  numeral: /^(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두|\d+)$/u,
  unit: /^(시|분|초|년|월|일)$/u,
  timeParticles: ['에는', '에', '은', '는', '도'], subjectParticles: ['은', '는', '이', '가', '도'], requireSubjectParticle: true,
}
