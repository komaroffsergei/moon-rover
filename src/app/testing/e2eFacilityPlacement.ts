import type { RuntimeLevelId } from '../../content/levels/catalog';

/** Stable seed remains separate from the simulation seed in E2E sessions. */
export const E2E_GOLDEN_PLACEMENT_SEEDS: Readonly<
  Record<RuntimeLevelId, string>
> = Object.freeze({
  'tycho-crater': '3',
  'shackleton-rift': '2',
  'tranquility-sea': '1',
  'south-pole': '0',
  'aitken-labyrinth': '4',
});

/** Explicitly pins coordinate-based E2E fixtures to validated authoring cells. */
export const E2E_AUTHORING_LAYOUT_IDS: Readonly<
  Record<RuntimeLevelId, string>
> = Object.freeze({
  'tycho-crater': 'tycho-west',
  'shackleton-rift': 'shackleton-west',
  'tranquility-sea': 'tranquility-south',
  'south-pole': 'south-pole-west',
  'aitken-labyrinth': 'aitken-west',
});
