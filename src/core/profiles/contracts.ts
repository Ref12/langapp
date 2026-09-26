import { z } from 'zod'
import { CONTENT_VERSION } from '../../data/mandarin'
import { aiConnectionInputSchema, assistantBackupSchema } from '../assistant/contracts'
import { speechConnectionInputSchema } from '../assistant/speech-contracts'
import { validateAssistant, validateStudy, validateWorkspace, workspaceSchema } from '../backup-codec'
import { studyBackupSchema, unitKindSchema, unitLabelSchema } from '../study/contracts'
import { profileMetadataSchema } from './identity'

export const MAX_PROFILE_BYTES = 10 * 1024 * 1024
export const PROFILE_FORMAT = 'linguaweave-profile'
export const PROFILE_VERSION = 3
export const profileDataSchema = z.object({
  format: z.literal(PROFILE_FORMAT),
  version: z.literal(PROFILE_VERSION),
  contentVersion: z.literal(CONTENT_VERSION),
  exportedAt: z.number().int().nonnegative(),
  profile: profileMetadataSchema,
  settings: z.object({
    preferences: workspaceSchema.shape.preferences,
    aiConnection: aiConnectionInputSchema.optional(),
    speechConnection: speechConnectionInputSchema.optional(),
  }).strict(),
  knowledge: workspaceSchema.omit({ preferences: true }).extend({ study: studyBackupSchema }).strict(),
  conversations: assistantBackupSchema,
}).strict()

export const profileSnapshotSchema = profileDataSchema.superRefine((snapshot, context) => {
  try {
    const { study, ...learning } = snapshot.knowledge
    validateWorkspace({ preferences: snapshot.settings.preferences, ...learning })
    validateStudy(study)
    validateAssistant(snapshot.conversations)
  } catch {
    context.addIssue({ code: 'custom', message: 'Profile data contains invalid relationships.' })
  }
})

export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>

const wordSchema = workspaceSchema.shape.words.element.omit({ wordId: true }).extend({ lb: unitLabelSchema })
const questionSchema = workspaceSchema.shape.sessions.element.shape.questions.element.omit({ wordId: true })
  .extend({ lb: unitLabelSchema, options: z.array(unitLabelSchema) })
const sessionSchema = workspaceSchema.shape.sessions.element.extend({ questions: z.array(questionSchema) })
const attemptSchema = workspaceSchema.shape.attempts.element.omit({ wordId: true, answerId: true })
  .extend({ lb: unitLabelSchema, answerLb: unitLabelSchema })
const studyKnowledgeSchema = studyBackupSchema.shape.knowledge.element.omit({ ref: true })
const studyCardSchema = studyBackupSchema.shape.cards.element.omit({ id: true, ref: true })
  .extend({ kind: unitKindSchema, lb: unitLabelSchema })

// The wire format uses labels; normalized snapshots retain database keys in memory.
export const profileYamlSchema = profileDataSchema.extend({
  knowledge: profileDataSchema.shape.knowledge.extend({
    words: z.array(wordSchema),
    sessions: z.array(sessionSchema),
    attempts: z.array(attemptSchema),
    study: studyBackupSchema.extend({
      knowledge: z.array(studyKnowledgeSchema),
      cards: z.array(studyCardSchema),
    }),
  }),
})
export type ProfileYaml = z.infer<typeof profileYamlSchema>
