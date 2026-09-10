import { db } from '../database'
import type { PlaybackPreferences } from '../speech'
import { z } from 'zod'

export async function speechConnectionStatus() {
  const connection = await db.speechConnections.get('default')
  return connection ? {
    region: connection.region, configurationVersion: connection.configurationVersion,
    configured: !!connection.apiKey && connection.warningAcknowledged,
  } : null
}

export async function saveSpeechConnection(region: string, key: string, acknowledged: boolean) {
  if (!acknowledged) throw new Error('Acknowledge plaintext browser key storage first.')
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(region.trim())) throw new Error('Enter an Azure region identifier, for example eastus.')
  const previous = await db.speechConnections.get('default')
  const apiKey = key.trim() || previous?.apiKey
  if (!apiKey) throw new Error('Enter your Azure Speech key.')
  await db.speechConnections.put({
    id: 'default', region: region.trim(), apiKey, warningAcknowledged: true,
    configurationVersion: (previous?.configurationVersion ?? 0) + 1, updatedAt: new Date().toISOString(),
  })
}

export async function clearSpeechConnection() { await db.speechConnections.delete('default') }

export function loadPlaybackPreferences(): PlaybackPreferences {
  try {
    return z.record(z.enum(['en-US', 'zh-CN', 'ja-JP', 'ko-KR']), z.object({
      voiceURI: z.string().max(1000).optional(),
      rate: z.number().finite().min(0.25).max(1.25),
    })).parse(JSON.parse(localStorage.getItem('voice-playback') ?? '{}'))
  }
  catch { return {} }
}

export function savePlaybackPreferences(value: PlaybackPreferences) {
  localStorage.setItem('voice-playback', JSON.stringify(value))
}
