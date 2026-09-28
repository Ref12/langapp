/** One readable palette shared by every game that colors groups of tiles. */
export const GAME_GROUP_COLORS = [
  { name: 'Mint', background: '#c8ebdc', border: '#3a8268', ink: '#173d30' },
  { name: 'Sky', background: '#cde5f5', border: '#4c7d9b', ink: '#203c53' },
  { name: 'Lavender', background: '#e1d8f3', border: '#7c67a2', ink: '#392958' },
  { name: 'Rose', background: '#f6d9e1', border: '#ab657a', ink: '#602a3c' },
  { name: 'Apricot', background: '#f7dfc6', border: '#b7814f', ink: '#613b1b' },
  { name: 'Lemon', background: '#f1ecc3', border: '#9e9441', ink: '#494319' },
  { name: 'Aqua', background: '#c6e9ed', border: '#4a929b', ink: '#1c4950' },
  { name: 'Sand', background: '#dedcca', border: '#827d5b', ink: '#403c28' },
] as const

export type GameGroupColor = (typeof GAME_GROUP_COLORS)[number]
