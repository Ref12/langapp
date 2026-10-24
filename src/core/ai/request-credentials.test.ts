import { describe, expect, it } from 'vitest'
import { requestCredentials } from './request-credentials'

describe('requestCredentials', () => {
  it('sends the page cookie only to its own origin', () => {
    expect(requestCredentials(location.origin + '/v1')).toBe('same-origin')
    expect(requestCredentials('/v1')).toBe('same-origin')
    expect(requestCredentials('https://api.example.test/v1')).toBe('omit')
    expect(requestCredentials('not a url ::')).toBe('same-origin')
  })
})
