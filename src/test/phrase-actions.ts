import { fireEvent, within } from '@testing-library/react'

export function openPhraseActions(container: HTMLElement = document.body, index = 0) {
  const trigger = within(container).getAllByRole('button', { name: 'Phrase actions' })[index]
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
  return within(document.getElementById(trigger.getAttribute('aria-controls')!)!)
}
