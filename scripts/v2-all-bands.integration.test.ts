// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { orderCurriculum } from './v2-order-curriculum.mjs'

describe('complete authored Chinese v2 curriculum', () => {
  it('has all grammar examples, lexical prerequisites, contextual coverage and current all-band lesson projections', () => {
    expect(orderCurriculum({ check: true })).toEqual([])
  }, 120000)
})
