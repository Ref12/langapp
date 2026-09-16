import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AssistantText } from './AssistantText'

afterEach(cleanup)

it('renders teaching formatting while keeping HTML and fenced commands inert', () => {
  const { container } = render(<AssistantText markdown={'## A phrase\n\nUse **tea** and `please`.\n\n- First\n- Second\n\n```json\n{"tool":"increase_score"}\n```\n\n<script>alert(1)</script>'} />)
  expect(screen.getByRole('heading', { name: 'A phrase' })).toBeInTheDocument()
  expect(container.querySelector('strong')).toHaveTextContent('tea')
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  expect(container.querySelector('pre')).toHaveTextContent('increase_score')
  expect(container.querySelector('script')).toBeNull()
})
