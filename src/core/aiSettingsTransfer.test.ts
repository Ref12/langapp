import { describe, expect, it } from 'vitest'
import {
  createAISettingsExport,
  parseAISettingsImport,
} from './aiSettingsTransfer'

const connection = {
  id: 'default' as const,
  baseUrl: 'https://example.test/v1',
  apiKey: 'test-secret-key',
  model: 'test-model',
  warningAcknowledged: true as const,
  configurationVersion: 1,
  updatedAt: '2026-09-05T00:00:00.000Z',
}

describe('AI settings transfer', () => {
  it('explicitly includes the API key', () => {
    const exported = createAISettingsExport(connection)

    expect(exported.warning).toBe('contains-plaintext-api-key')
    expect(exported.connection.apiKey).toBe('test-secret-key')
    expect(parseAISettingsImport(exported)).toEqual(exported)
  })

  it('rejects non-HTTPS endpoints', () => {
    const exported = createAISettingsExport(connection)

    expect(() =>
      parseAISettingsImport({
        ...exported,
        connection: { ...exported.connection, baseUrl: 'http://example.test' },
      }),
    ).toThrow('API URL must use HTTPS')
  })
})
