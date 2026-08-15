import type { GridCell } from '../domain';

export type MapTileLayerName = 'terrain' | 'hazards' | 'obstacles';

export interface MapTileLayerSource {
  readonly name: MapTileLayerName;
  readonly data: readonly number[];
  readonly opacity: number;
}

export interface MapObjectSource {
  readonly id: number;
  readonly name: string;
  readonly className: 'base' | 'center' | 'roverSpawn' | 'repairSpawn';
  readonly entityId: string | null;
  readonly cell: GridCell;
}

export interface MapAssetSource {
  readonly background: string;
  readonly tileAtlas: string;
  readonly tileFrameWidth: number;
  readonly tileFrameHeight: number;
  readonly tileMargin: number;
  readonly tileSpacing: number;
  readonly base: string;
  readonly center: string;
  readonly rover: string;
  readonly repairRover: string;
  readonly roverWheel: string;
}

export interface MapPalette {
  readonly grid: string;
  readonly hazard: string;
  readonly hazardEdge: string;
  readonly route: string;
  readonly safe: string;
  readonly warning: string;
}

export interface PhaserMapSource {
  readonly id: string;
  readonly tiledJson: object;
  readonly tilesetName: string;
  readonly width: number;
  readonly height: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly firstGid: number;
  readonly layers: readonly MapTileLayerSource[];
  readonly objects: readonly MapObjectSource[];
  readonly assets: MapAssetSource;
  readonly palette: MapPalette;
}
