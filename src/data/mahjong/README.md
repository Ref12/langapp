# Mahjong tile configurations

Each `*.yaml` file in this directory contributes one configuration to the game.
Vite discovers the files automatically: adding a file does not require editing
an import list, route, picker, or game engine.

The shipped configurations are **Courtyard** (48 tiles), **Pagoda** (40 tiles),
and **Twin bridges** (42 tiles). All use the same matching and free-tile rules.
The configuration describes geometry, not vocabulary, pair identities, scoring,
colors, or game state.

## Format version 1

```yaml
version: 1
id: small-garden
name: Small garden
description: Two short rows for a quick game.
layers:
  - rows:
      - { y: 0, x: [0, 1, 2, 3] }
      - { y: 1, x: [0, 1, 2, 3] }
```

| Field | Meaning |
| --- | --- |
| `version` | Required integer `1`. Unknown versions are rejected. |
| `id` | Unique, stable lowercase slug, up to 64 characters. Use letters, numbers, and single hyphens; begin with a letter. |
| `name` | Nonempty display name, up to 60 characters. |
| `description` | Nonempty picker description, up to 240 characters. |
| `layers` | One to five layers, ordered from the table upward. Array index becomes `z`, starting at zero. |
| `layers[].rows` | One to 48 row declarations in authored order. |
| `rows[].y` | Top edge of this row, measured in tile heights. |
| `rows[].x` | One to 12 left-edge coordinates, measured in tile widths. Each value creates one tile. |

Each tile occupies a **1 by 1 rectangle** in logical coordinates. `x` increases
to the right and `y` downward. Coordinates are nonnegative multiples of `0.25`,
up to `11`; quarter- and half-tile offsets allow staggered stacks. The renderer
derives board dimensions from these rectangles and adds the visual tile depth.
Do not include that visual depth in the coordinates.

For example, `{ y: 1.25, x: [0.5, 1.5] }` creates two touching tiles, offset
half a tile from the left edge and a quarter tile below row 1. Add a second
`layers` entry to place tiles above the first layer:

```yaml
version: 1
id: raised-garden
name: Raised garden
description: A small raised pair above two rows.
layers:
  - rows:
      - { y: 0, x: [0, 1, 2, 3] }
      - { y: 1, x: [0, 1, 2, 3] }
  - rows:
      - { y: 0.5, x: [1, 2] }
```

## Validation and rules

- A configuration must contain an even number of tiles, between 8 and 144.
- Tiles may touch but must not overlap on the same layer.
- At least half of every raised tile's area must be supported by tiles on the
  layer directly below it. Unsupported floating tiles are rejected.
- A tile is covered when any higher tile overlaps it with positive area.
  Touching an edge alone does not cover it.
- A side is blocked by a tile on the same layer touching that horizontal edge
  with positive vertical overlap. A playable tile must be uncovered and have
  at least one free left or right side.
- The loader must find a complete legal pair-removal sequence. It rejects
  unsolvable configurations and explicitly rejects configurations it cannot
  prove within 2,000 search states. It never marks an unproven layout solvable.
- Unknown fields, duplicate YAML keys, duplicate configuration IDs, custom tags,
  and aliases are rejected. Errors include the source file name.

The executable contracts are `layoutDocumentSchema` in
`src/core/games/mahjong-layouts.ts` and `layoutPositionsSchema` in
`src/core/games/mahjong-geometry.ts`. The picker preview, renderer, deal size,
solvable deals, and reshuffling all use the expanded geometry.

## Adding a configuration

1. Add a file such as `small-garden.yaml` beside the existing configurations.
2. Give it a new `id`, name, description, and bottom-to-top layer list.
3. Run `npm run test:pages -- src/core/games/mahjong-layouts.test.ts`.
4. Open **Practice -> Play Mahjong**, choose the configuration, and inspect its
   preview and a dealt board at both mobile and desktop sizes.

The layout tests discover every file and validate its geometry, removal proof,
deal, saved-board reload, and completion. They run in the Pages deployment suite.
For the full game regression set, run:

```text
npm run test:pages -- src/core/games/mahjong-layouts.test.ts src/core/games/mahjong.test.ts src/core/games/mahjong-store.test.ts src/pages/Mahjong.test.tsx
```

Large or wide arrangements can require scrolling on compact windows; do not
trade readable vocabulary and tappable tiles for a dense, illegible board.

## Saved-board compatibility

Position IDs are assigned consecutively in layer, row, and `x` list order.
New saved games embed the configuration ID, display name, and complete original
positions. They resume and reshuffle from that snapshot even if the YAML changes
or the configuration is removed from the catalog.

Existing pre-YAML **Courtyard** saves have no snapshot and still refer to its
original position IDs. **Keep `courtyard.yaml`'s coordinates and array order
unchanged.** Add a new ID for a revised courtyard. The regression suite pins the
original geometry. Older 8-, 12-, and 20-tile boards retain their legacy layout.
