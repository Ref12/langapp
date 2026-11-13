import { describe, expect, it } from 'vitest'
import { secMsGecV2 } from './edge-tts-gec'

// Expected values computed with edge-tts 7.3.1 generate_sec_ms_gec_v2(<timestamp>).
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'

describe('secMsGecV2', () => {
  it.each([
    [0, '52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6'],
    [1700000000, '2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2'],
    [1794000123, '6EA6AF6A0550F520-17E5A544A1EFE811EA5248AFBD9780637964201A6D3A15ADE53A30AB9D066A4F'],
  ])('matches the Python token at %i', (timestamp, expected) => {
    expect(secMsGecV2(timestamp, TOKEN)).toBe(expected)
  })
})
