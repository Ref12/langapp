import { z } from 'zod'
import { CONTENT_VERSION } from '../../data/mandarin'
import { aiConnectionInputSchema, assistantBackupSchema } from '../assistant/contracts'
import { speechConnectionInputSchema } from '../assistant/speech-contracts'
import { validateAssistant, validateStudy, validateWorkspace, workspaceSchema } from '../backup-codec'
import { studyBackupSchema } from '../study/contracts'
import { profileMetadataSchema } from './identity'

export const MAX_PROFILE_BYTES = 10 * 1024 * 1024
export const PROFILE_FORMAT = 'linguaweave-profile'
export const profileSnapshotSchema = z.object({
  format: z.literal(PROFILE_FORMAT),
  version: z.literal(1),
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
}).strict().superRefine((snapshot, context) => {
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
