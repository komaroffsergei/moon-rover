import balanceSource from '../../../contracts/examples/balance.default.json';
import incidentSource from '../../../contracts/examples/incidents.default.json';
import radioSource from '../../../contracts/examples/radio.ru.json';
import tychoLevelSource from './level-01-tycho.json';
import shackletonLevelSource from './level-02-shackleton.json';
import tranquilityLevelSource from './level-03-tranquility.json';
import southPoleLevelSource from './level-04-south-pole.json';
import aitkenLevelSource from './level-05-aitken-labyrinth.json';
import aitkenMapText from './aitken-labyrinth.tmj?raw';
import aitkenThemeSource from './theme.aitken-maximum.json';
import southPoleMapText from './south-pole.tmj?raw';
import shackletonMapText from './shackleton-rift.tmj?raw';
import southPoleThemeSource from './theme.south-pole-extreme.json';
import shackletonThemeSource from './theme.shackleton-medium.json';
import tranquilityThemeSource from './theme.tranquility-high.json';
import tychoThemeSource from './theme.tycho-low.json';
import tranquilityMapText from './tranquility-sea.tmj?raw';
import tychoMapText from './tycho-crater.tmj?raw';

export const runtimeLevelIds = [
  'tycho-crater',
  'shackleton-rift',
  'tranquility-sea',
  'south-pole',
  'aitken-labyrinth',
] as const;

export type RuntimeLevelId = (typeof runtimeLevelIds)[number];
export type RuntimeRiskLevel =
  'low' | 'medium' | 'high' | 'extreme' | 'maximum';
export type RuntimeLevelOrdinal = 1 | 2 | 3 | 4 | 5;

export interface RuntimeLevelSource {
  readonly id: RuntimeLevelId;
  readonly ordinal: RuntimeLevelOrdinal;
  readonly riskLevel: RuntimeRiskLevel;
  readonly mapFileName: string;
  readonly levelMeta: unknown;
  readonly mapText: string;
  readonly theme: unknown;
}

export const commonContentSources = Object.freeze({
  balance: balanceSource as unknown,
  balanceProfileId: 'default',
  incidents: incidentSource as unknown,
  radio: radioSource as unknown,
});

export const runtimeLevelSources = Object.freeze([
  Object.freeze({
    id: 'tycho-crater',
    ordinal: 1,
    riskLevel: 'low',
    mapFileName: 'tycho-crater.tmj',
    levelMeta: tychoLevelSource,
    mapText: tychoMapText,
    theme: tychoThemeSource,
  }),
  Object.freeze({
    id: 'shackleton-rift',
    ordinal: 2,
    riskLevel: 'medium',
    mapFileName: 'shackleton-rift.tmj',
    levelMeta: shackletonLevelSource,
    mapText: shackletonMapText,
    theme: shackletonThemeSource,
  }),
  Object.freeze({
    id: 'tranquility-sea',
    ordinal: 3,
    riskLevel: 'high',
    mapFileName: 'tranquility-sea.tmj',
    levelMeta: tranquilityLevelSource,
    mapText: tranquilityMapText,
    theme: tranquilityThemeSource,
  }),
  Object.freeze({
    id: 'south-pole',
    ordinal: 4,
    riskLevel: 'extreme',
    mapFileName: 'south-pole.tmj',
    levelMeta: southPoleLevelSource,
    mapText: southPoleMapText,
    theme: southPoleThemeSource,
  }),
  Object.freeze({
    id: 'aitken-labyrinth',
    ordinal: 5,
    riskLevel: 'maximum',
    mapFileName: 'aitken-labyrinth.tmj',
    levelMeta: aitkenLevelSource,
    mapText: aitkenMapText,
    theme: aitkenThemeSource,
  }),
] satisfies readonly RuntimeLevelSource[]);

export const DEFAULT_RUNTIME_LEVEL_ID: RuntimeLevelId = 'shackleton-rift';

export function getRuntimeLevelSource(
  levelId: RuntimeLevelId,
): RuntimeLevelSource {
  const source = runtimeLevelSources.find(({ id }) => id === levelId);
  if (source === undefined) {
    throw new Error(`Неизвестный уровень: ${levelId}`);
  }
  return source;
}
