import type { GridCell } from '../domain';

export type MapTileLayerName = 'hazards' | 'obstacles';

interface MapTileLayerSource {
  readonly name: MapTileLayerName;
  readonly data: readonly number[];
  readonly opacity: number;
}

interface MapAssetSource {
  readonly background: string;
  readonly base: string;
  readonly center: string;
  readonly rover: string;
  readonly repairRover: string;
  readonly roverWheel: string;
}

interface MapPalette {
  readonly hazard: string;
  readonly hazardEdge: string;
  readonly route: string;
  readonly safe: string;
  readonly warning: string;
}

export interface PhaserMapSource {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly baseCell: GridCell;
  readonly backgroundLayer: {
    readonly x: number;
    readonly y: number;
    readonly opacity: number;
    readonly visible: boolean;
  };
  readonly layers: readonly MapTileLayerSource[];
  readonly assets: MapAssetSource;
  readonly palette: MapPalette;
}
