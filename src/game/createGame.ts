import Phaser from 'phaser';

import type { MapGameController } from './mapGamePort';
import type { PhaserMapSource } from './mapSource';
import { MapScene } from './MapScene';

export interface GameRuntime {
  readonly controller: MapGameController;
  readonly map: PhaserMapSource;
}

export function createGame(
  parent: HTMLElement,
  runtime: GameRuntime,
  onRouteCommandResult?: (
    result: ReturnType<MapGameController['routeSelectedRoverTo']>,
  ) => void,
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.CANVAS,
    width: Math.max(1, parent.clientWidth),
    height: Math.max(1, parent.clientHeight),
    parent,
    backgroundColor: '#0c121a',
    disableContextMenu: true,
    scene: new MapScene({ ...runtime, host: parent, onRouteCommandResult }),
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });
}
