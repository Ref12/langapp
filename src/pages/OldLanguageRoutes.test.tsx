import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { db, initializeWorkspace } from '../core/database'

beforeEach(async () => { await db.delete(); await db.open(); await initializeWorkspace() })
afterEach(cleanup)

describe('the old Japanese and Korean lesson routes', () => {
  for (const route of ['#lessons/ja/1', '#lessons/ko/1', '#lessons/ja/review', '#lessons/ko/3/practise']) {
    it(`${route} shows the not-found page`, async () => {
      window.location.hash = route
      render(<App />)
      expect(await screen.findByRole('heading', { name: 'This page is not available' })).toBeInTheDocument()
    })
  }
})
