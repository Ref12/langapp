import { db } from '../database'
import type { ConversationMessage } from '../domain'
import { recordingMetadataSchema } from './storage'

export async function submitVoiceMessage(
  message: ConversationMessage, profileId: string, recordingId?: string,
) {
  await db.transaction('rw', [db.conversationThreads, db.conversationMessages, db.voiceRecordings], async () => {
    const thread = await db.conversationThreads.get(message.threadId)
    if (thread?.profileId !== profileId) throw new Error('This conversation no longer belongs to the active profile.')
    if (recordingId) {
      const recording = await db.voiceRecordings.get(recordingId)
      if (!recording || !recordingMetadataSchema.safeParse(recording).success ||
        (recording.audio === undefined ? recording.audioUnavailable !== true : !(recording.audio instanceof Blob)) ||
        recording.messageId || recording.profileId !== profileId ||
        recording.threadId !== message.threadId || recording.purpose !== 'conversation') {
        throw new Error('Save this recording before sending, or resume an unsent recording.')
      }
      await db.voiceRecordings.update(recordingId, {
        messageId: message.id, submittedTranscript: message.canonicalContent,
      })
      message = { ...message, recordingId, recognizedTranscript: recording.recognizedTranscript }
    }
    await db.conversationMessages.add(message)
    await db.conversationThreads.update(message.threadId, {
      title: message.canonicalContent.slice(0, 48), updatedAt: new Date().toISOString(),
    })
  })
}
