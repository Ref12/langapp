import { z } from 'zod'

// Practice by skill (docs/skill-practice.md, step 1). Which skills each activity exercises lives here and only here: adjust the tables to change what counts.

export const SKILLS = ['reading', 'listening', 'speaking', 'writing'] as const
export type Skill = typeof SKILLS[number]
export const skillSchema = z.enum(SKILLS)
export const SKILL_LABEL: Record<Skill, string> = { reading: 'Reading', listening: 'Listening', speaking: 'Speaking', writing: 'Writing' }
export const SKILL_LETTER: Record<Skill, string> = { reading: 'R', listening: 'L', speaking: 'S', writing: 'W' }

/** A familiar item sorts as if its count were this much higher in that skill. */
export const FAMILIAR_PENALTY = 10
/** "Recent" means added to the knowledge set within this many days. */
export const RECENT_DAYS = 3
export const SKILL_SIZES = [10, 20] as const
export const PICK_STRATEGIES = ['least', 'recent'] as const
export type PickStrategy = typeof PICK_STRATEGIES[number] | 'due'
export const STRATEGY_LABEL: Record<typeof PICK_STRATEGIES[number], string> = { least: 'Least practiced', recent: 'Recent' }

/** The skills each drill type counts towards. Match pairs and Word meanings show Chinese, so they are reading. */
export const DRILL_SKILLS: Record<string, readonly Skill[]> = {
  meanings: ['reading'], match: ['reading'], learn: ['writing'], write: ['writing'], pinyin: ['speaking'], translate: ['writing'],
  repeat: ['speaking'], listen: ['listening'], read: ['reading'],
}
/** Other activities. Hands-free: intro cards and Chinese to English prompts are listening; English to Chinese and repeat-after are speaking. */
export const ACTIVITY_SKILLS = {
  lessonExercise: ['reading'],
  introCard: ['reading'],
} as const satisfies Record<string, readonly Skill[]>
/** A Hands-free prompt by its kind (the script marks each): intro and Chinese → English are listening; English → Chinese and repeat-after are speaking. */
export const PROMPT_SKILLS: Record<'intro' | 'toEnglish' | 'toChinese', readonly Skill[]> = { intro: ['listening'], toEnglish: ['listening'], toChinese: ['speaking'] }

export const drillSkills = (type: string): readonly Skill[] => DRILL_SKILLS[type] ?? []

export const skillPracticeSchema = z.object({
  ref: z.string().min(1).max(200),
  skill: skillSchema,
  count: z.number().int().nonnegative(),
  lastAt: z.number().int().nonnegative(),
  familiar: z.boolean(),
  /** How many of the counted attempts were right the first time (written by the practice engine's first graded attempt; absent on rows from before it existed, and on rows only other activities wrote). */
  correct: z.number().int().nonnegative().optional(),
}).strict()
export type SkillPractice = z.infer<typeof skillPracticeSchema>
export const skillPracticeBackupSchema = z.array(skillPracticeSchema).max(20000)
