import { db } from '../database'
import { speechConnectionInputSchema, speechConnectionSchema, type SpeechConnectionInput } from './speech-contracts'

export async function saveSpeechConnection(input: SpeechConnectionInput): Promise<void> {
  const validated = speechConnectionInputSchema.parse(input)
  const connection = speechConnectionSchema.parse({
    ...validated,
    id: 'assistant-speech', revision: crypto.randomUUID(), updatedAt: Date.now(),
  })
  await db.speechConnections.put(connection)
}

export async function removeSpeechConnection(): Promise<void> {
  await db.speechConnections.delete('assistant-speech')
}
