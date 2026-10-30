/** The user-facing name for a collection, in one place. Change the values to rename it in the UI (data, routes and code names stay as they are). */
export const TERM = {
  singular: 'study set',
  plural: 'study sets',
  Singular: 'Study set',
  Plural: 'Study sets',
} as const

/** "1 item" / "3 items": the unit inside a collection. */
export const itemCount = (count: number) => `${count} ${count === 1 ? 'item' : 'items'}`
