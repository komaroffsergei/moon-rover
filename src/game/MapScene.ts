import Phaser from 'phaser';

import type {
  CenterSnapshot,
  GridCell,
  NavigationPoint,
  RadioMessage,
  RoverSnapshot,
} from '../domain';
import {
  clampCameraState,
  coverFitZoom,
  resizeCameraPreservingCenter,
  zoomAtPointer,
  type CameraConstraints,
  type CameraState,
} from './camera/cameraMath';
import {
  createCenterMapPresentation,
  type CenterMapTone,
} from './centerMapPresentation';
import {
  cellCenter,
  navigationPointWorldPosition,
  worldToGridCell,
  type WorldPoint,
} from './input/mapGeometry';
import type {
  MapGameController,
  MapGameView,
  MapSelectedEntity,
} from './mapGamePort';
import type { PhaserMapSource } from './mapSource';
import {
  createOrganicZoneContours,
  createPolygonHatchSegments,
  createRoundedRoutePoints,
  createRoverGroupOffset,
  createRoverHudPresentation,
} from './renderers/mapPresentationGeometry';
import { roverWorldPosition } from './renderers/snapshotProjection';
import { rotateTowards } from './roverHeading';

const TEXTURE_KEYS = {
  background: 'shackleton-background',
  base: 'moon-base',
  center: 'science-center',
  repairRover: 'repair-rover',
  rover: 'courier-rover',
  roverWheel: 'rover-wheel',
} as const;

const MAP_DEPTH = {
  background: 0,
  hazards: 20,
  obstacles: 30,
  route: 50,
  entities: 60,
  effects: 70,
  speech: 80,
  controls: 1_000,
} as const;

const DRAG_THRESHOLD_PIXELS = 6;
const MAX_CAMERA_ZOOM = 3;
const SPEECH_BUBBLE_POOL_SIZE = 3;
const SPEECH_BUBBLE_QUEUE_LIMIT = 12;
const SPEECH_BUBBLE_WIDTH = 208;
const SPEECH_BUBBLE_MIN_HEIGHT = 54;
const SPEECH_BUBBLE_MARGIN = 14;
const SPEECH_BUBBLE_GAP = 14;
const SPEECH_BUBBLE_ENTER_MILLISECONDS = 160;
const SPEECH_BUBBLE_BOTTOM_RESERVED = 58;

interface MapSceneDependencies {
  readonly controller: MapGameController;
  readonly host: HTMLElement;
  readonly map: PhaserMapSource;
  readonly onRouteCommandResult?: (
    result: ReturnType<MapGameController['routeSelectedRoverTo']>,
  ) => void;
}

interface DragState {
  readonly pointerId: number;
  readonly originX: number;
  readonly originY: number;
  readonly camera: CameraState;
  readonly pansCamera: boolean;
  moved: boolean;
}

interface EntityVisual {
  readonly sprite: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly accent: Phaser.GameObjects.Graphics;
}

interface WheelVisual {
  readonly image: Phaser.GameObjects.Image;
  readonly localX: number;
  readonly localY: number;
  readonly phase: number;
}

interface RoverVisual extends EntityVisual {
  readonly wheels: readonly WheelVisual[];
  headingRadians: number;
  wheelPhase: number;
  dustVisibleCount: number;
}

interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface SpeechBubblePlacement {
  readonly rect: ScreenRect;
  readonly tail: 'top' | 'bottom';
  readonly tailOffsetX: number;
  readonly anchor: WorldPoint;
}

interface SpeechBubbleVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly background: Phaser.GameObjects.Graphics;
  readonly text: Phaser.GameObjects.Text;
  readonly closeButton: Phaser.GameObjects.Text;
  message: RadioMessage | null;
  remainingMilliseconds: number;
  ageMilliseconds: number;
  width: number;
  height: number;
  placement: SpeechBubblePlacement | null;
}

function colorNumber(hex: string): number {
  const parsed = Number.parseInt(hex.replace(/^#/, ''), 16);
  return Number.isFinite(parsed) ? parsed : 0xffffff;
}

function cellsEqual(left: GridCell, right: GridCell): boolean {
  return left.column === right.column && left.row === right.row;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function rectanglesOverlap(
  left: ScreenRect,
  right: ScreenRect,
  gap = 0,
): boolean {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  );
}

function speechBubbleDuration(message: RadioMessage): number {
  return clamp(
    3_200 + message.text.length * 24 + message.priority * 320,
    3_800,
    6_500,
  );
}

function speechBubbleAccent(message: RadioMessage): number {
  if (message.priority === 3) return 0xff8585;
  if (message.category === 'RESCUE') return 0x72e5ff;
  if (message.priority === 2) return 0xffd166;
  return 0x9cecff;
}

function layerCells(
  layer: PhaserMapSource['layers'][number],
  width: number,
): readonly GridCell[] {
  return layer.data.flatMap((gid, index) =>
    gid === 0
      ? []
      : [
          {
            column: index % width,
            row: Math.floor(index / width),
          },
        ],
  );
}

function drawOrganicZone(
  graphics: Phaser.GameObjects.Graphics,
  cells: readonly GridCell[],
  tileWidth: number,
  tileHeight: number,
  fill: number,
  edge: number,
  opacity: number,
  visualSeed: string,
): void {
  const contours = createOrganicZoneContours(
    cells,
    { tileWidth, tileHeight },
    visualSeed,
  );
  for (const points of contours) {
    const vectors = points.map(({ x, y }) => new Phaser.Math.Vector2(x, y));
    graphics.fillStyle(fill, 0.48 * opacity);
    graphics.fillPoints(vectors, true, true);
    graphics.lineStyle(1.5, edge, 0.34 * opacity);
    for (const segment of createPolygonHatchSegments(points, 14)) {
      graphics.lineBetween(
        segment.from.x,
        segment.from.y,
        segment.to.x,
        segment.to.y,
      );
    }
    graphics.lineStyle(8, 0x14080c, 0.54 * opacity);
    graphics.strokePoints(vectors, true, true);
    graphics.lineStyle(2.5, edge, 0.9 * opacity);
    graphics.strokePoints(vectors, true, true);
  }
}

function drawPolyline(
  graphics: Phaser.GameObjects.Graphics,
  routePoints: readonly NavigationPoint[],
  tileWidth: number,
  tileHeight: number,
): void {
  const points = createRoundedRoutePoints(routePoints, {
    tileWidth,
    tileHeight,
  });
  const first = points[0];
  if (!first) return;
  graphics.beginPath();
  graphics.moveTo(first.x, first.y);
  for (const point of points.slice(1)) {
    graphics.lineTo(point.x, point.y);
  }
  graphics.strokePath();
}

function centerStatusColor(
  tone: CenterMapTone,
  palette: PhaserMapSource['palette'],
): number {
  switch (tone) {
    case 'safe':
      return colorNumber(palette.safe);
    case 'warning':
      return colorNumber(palette.warning);
    case 'critical':
      return colorNumber(palette.hazardEdge);
  }
}

function roverOffset(
  rover: RoverSnapshot,
  rovers: readonly RoverSnapshot[],
): { x: number; y: number } {
  if (rover.movement) return { x: 0, y: 0 };
  const peers = rovers
    .filter(
      (candidate) =>
        candidate.movement === null && cellsEqual(candidate.cell, rover.cell),
    )
    .sort((left, right) => left.id.localeCompare(right.id));
  const index = peers.findIndex(({ id }) => id === rover.id);
  return createRoverGroupOffset(index, peers.length);
}

export class MapScene extends Phaser.Scene {
  readonly #controller: MapGameController;
  readonly #host: HTMLElement;
  readonly #map: PhaserMapSource;
  readonly #onRouteCommandResult:
    MapSceneDependencies['onRouteCommandResult'] | undefined;
  readonly #reducedMotion: boolean;
  readonly #diagnosticsEnabled: boolean;
  readonly #centerVisuals = new Map<string, EntityVisual>();
  readonly #roverVisuals = new Map<string, RoverVisual>();
  readonly #speechBubbleVisuals: SpeechBubbleVisual[] = [];
  readonly #seenRadioMessageIds = new Set<string>();
  readonly #pendingSpeechMessages: RadioMessage[] = [];

  #cameraState: CameraState;
  #dragState: DragState | null = null;
  #routeGraphics!: Phaser.GameObjects.Graphics;
  #selectionGraphics!: Phaser.GameObjects.Graphics;
  #incidentGraphics!: Phaser.GameObjects.Graphics;
  #motionGraphics!: Phaser.GameObjects.Graphics;
  #zoomInButton!: Phaser.GameObjects.Container;
  #zoomOutButton!: Phaser.GameObjects.Container;
  #lastView!: MapGameView;
  #lastFocusRequestKey: number | null = null;
  #lastDiagnosticsTime = Number.NEGATIVE_INFINITY;
  #radioMessagesInitialized = false;
  #spacePanActive = false;
  #originalCanvasTabIndex: string | null = null;

  constructor({
    controller,
    host,
    map,
    onRouteCommandResult,
  }: MapSceneDependencies) {
    super({ key: 'phaser-map' });
    this.#controller = controller;
    this.#host = host;
    this.#map = map;
    this.#onRouteCommandResult = onRouteCommandResult;
    this.#reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    this.#diagnosticsEnabled =
      import.meta.env.MODE === 'e2e' &&
      new URLSearchParams(window.location.search).get('e2e') === '1';
    this.#cameraState = {
      center: {
        x: (map.width * map.tileWidth) / 2,
        y: (map.height * map.tileHeight) / 2,
      },
      zoom: 1,
    };
  }

  preload(): void {
    this.load.image(TEXTURE_KEYS.background, this.#map.assets.background);
    this.load.image(TEXTURE_KEYS.base, this.#map.assets.base);
    this.load.image(TEXTURE_KEYS.center, this.#map.assets.center);
    this.load.image(TEXTURE_KEYS.rover, this.#map.assets.rover);
    this.load.image(TEXTURE_KEYS.repairRover, this.#map.assets.repairRover);
    this.load.image(TEXTURE_KEYS.roverWheel, this.#map.assets.roverWheel);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#080b10');
    this.cameras.main.setRoundPixels(false);
    this.#createMapLayers();
    this.#createEntityVisuals();

    this.#routeGraphics = this.add.graphics().setDepth(MAP_DEPTH.route);
    this.#selectionGraphics = this.add.graphics().setDepth(MAP_DEPTH.effects);
    this.#incidentGraphics = this.add.graphics().setDepth(MAP_DEPTH.effects);
    this.#motionGraphics = this.add.graphics().setDepth(MAP_DEPTH.entities + 2);
    this.#createSpeechBubbleVisuals();

    this.#makeCanvasFocusable();
    this.#createControls();
    this.#installInput();
    this.#initializeCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.#handleResize, this);
    this.game.events.on(
      Phaser.Core.Events.RESUME,
      this.#handleGameResume,
      this,
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.#handleShutdown);

    this.#lastView = this.#controller.getView();
    this.#renderView(this.#lastView, 0, 0);
    this.#host.dataset.mapReady = 'true';
  }

  update(time: number, delta: number): void {
    this.#controller.advance(Math.max(0, delta));
    this.#applyCamera();
    this.#lastView = this.#controller.getView();
    this.#renderView(this.#lastView, time, delta);
  }

  #worldWidth(): number {
    return this.#map.width * this.#map.tileWidth;
  }

  #worldHeight(): number {
    return this.#map.height * this.#map.tileHeight;
  }

  #metrics() {
    return {
      columns: this.#map.width,
      rows: this.#map.height,
      tileWidth: this.#map.tileWidth,
      tileHeight: this.#map.tileHeight,
    };
  }

  #constraints(): CameraConstraints {
    const viewport = {
      width: Math.max(1, this.scale.width),
      height: Math.max(1, this.scale.height),
    };
    const world = {
      x: 0,
      y: 0,
      width: this.#worldWidth(),
      height: this.#worldHeight(),
    };
    const minimumZoom = coverFitZoom(viewport, world);
    return {
      viewport,
      world,
      zoom: { min: minimumZoom, max: Math.max(MAX_CAMERA_ZOOM, minimumZoom) },
    };
  }

  #initializeCamera(): void {
    const constraints = this.#constraints();
    this.#cameraState = clampCameraState(
      { ...this.#cameraState, zoom: constraints.zoom.min },
      constraints,
    );
    this.#applyCamera();
  }

  readonly #handleResize = (): void => {
    const constraints = this.#constraints();
    this.#cameraState = resizeCameraPreservingCenter(
      this.#cameraState,
      constraints,
    );
    this.#applyCamera();
    this.time.delayedCall(0, () => this.#applyCamera());
  };

  readonly #handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space' && this.#mapHasKeyboardFocus()) {
      event.preventDefault();
      this.#spacePanActive = true;
    }
  };

  readonly #handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this.#spacePanActive = false;
  };

  readonly #handleWindowBlur = (): void => {
    this.#spacePanActive = false;
  };

  readonly #handleGameResume = (pauseDurationMilliseconds: number): void => {
    if (
      !Number.isFinite(pauseDurationMilliseconds) ||
      pauseDurationMilliseconds <= 0
    ) {
      return;
    }
    this.#controller.advance(pauseDurationMilliseconds);
  };

  readonly #handleShutdown = (): void => {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.#handleResize, this);
    this.game.events.off(
      Phaser.Core.Events.RESUME,
      this.#handleGameResume,
      this,
    );
    this.input.keyboard?.off('keydown', this.#handleKeyDown);
    this.input.keyboard?.off('keyup', this.#handleKeyUp);
    window.removeEventListener('blur', this.#handleWindowBlur);
    this.game.canvas.removeEventListener('blur', this.#handleWindowBlur);
    if (this.#originalCanvasTabIndex === null) {
      this.game.canvas.removeAttribute('tabindex');
    } else {
      this.game.canvas.setAttribute('tabindex', this.#originalCanvasTabIndex);
    }
    this.#spacePanActive = false;
    this.#dragState = null;
    this.#clearSpeechBubbles();
    this.#seenRadioMessageIds.clear();
    this.#radioMessagesInitialized = false;
    delete this.#host.dataset.mapReady;
    delete this.#host.dataset.mapState;
  };

  #makeCanvasFocusable(): void {
    this.#originalCanvasTabIndex = this.game.canvas.getAttribute('tabindex');
    if (this.#originalCanvasTabIndex === null) {
      this.game.canvas.tabIndex = 0;
    }
    this.game.canvas.addEventListener('blur', this.#handleWindowBlur);
    window.addEventListener('blur', this.#handleWindowBlur);
  }

  #mapHasKeyboardFocus(): boolean {
    const activeElement = document.activeElement;
    return activeElement === this.game.canvas || activeElement === this.#host;
  }

  #applyCamera(): void {
    const camera = this.cameras.main;
    camera.setZoom(this.#cameraState.zoom);
    camera.centerOn(this.#cameraState.center.x, this.#cameraState.center.y);
    this.#positionControls();
  }

  #createMapLayers(): void {
    const background = this.#map.backgroundLayer;
    this.add
      .image(
        background.x + this.#worldWidth() / 2,
        background.y + this.#worldHeight() / 2,
        TEXTURE_KEYS.background,
      )
      .setDisplaySize(this.#worldWidth(), this.#worldHeight())
      .setAlpha(background.opacity)
      .setVisible(background.visible)
      .setDepth(MAP_DEPTH.background);

    this.#drawHazards();
    this.#drawObstacles();
  }

  #drawHazards(): void {
    const layer = this.#map.layers.find(({ name }) => name === 'hazards');
    if (!layer) return;
    const graphics = this.add.graphics().setDepth(MAP_DEPTH.hazards);
    const fill = colorNumber(this.#map.palette.hazard);
    const edge = colorNumber(this.#map.palette.hazardEdge);
    const cells = layerCells(layer, this.#map.width);
    drawOrganicZone(
      graphics,
      cells,
      this.#map.tileWidth,
      this.#map.tileHeight,
      fill,
      edge,
      layer.opacity,
      this.#map.id,
    );
  }

  #drawObstacles(): void {
    const layer = this.#map.layers.find(({ name }) => name === 'obstacles');
    if (!layer) return;
    const cells = layerCells(layer, this.#map.width);
    const graphics = this.add.graphics().setDepth(MAP_DEPTH.obstacles);
    for (const cell of cells) {
      const point = cellCenter(cell, this.#metrics());
      const outline = [
        { x: point.x - 25, y: point.y + 8 },
        { x: point.x - 19, y: point.y - 12 },
        { x: point.x - 4, y: point.y - 23 },
        { x: point.x + 10, y: point.y - 18 },
        { x: point.x + 24, y: point.y - 5 },
        { x: point.x + 26, y: point.y + 12 },
        { x: point.x + 9, y: point.y + 21 },
        { x: point.x - 13, y: point.y + 18 },
      ].map(({ x, y }) => new Phaser.Math.Vector2(x, y));
      graphics.fillStyle(0x050708, 0.48);
      graphics.fillPoints(outline, true, true);
      graphics.lineStyle(1.5, colorNumber(this.#map.palette.warning), 0.66);
      graphics.strokePoints(outline, true, true);
      graphics.fillStyle(0x050708, 0.86);
      graphics.fillTriangle(
        point.x - 13,
        point.y + 9,
        point.x - 2,
        point.y - 12,
        point.x + 6,
        point.y + 9,
      );
      graphics.fillTriangle(
        point.x - 1,
        point.y + 9,
        point.x + 9,
        point.y - 7,
        point.x + 16,
        point.y + 9,
      );
      graphics.lineStyle(1.5, 0xf2c25d, 0.72);
      graphics.lineBetween(
        point.x - 13,
        point.y + 12,
        point.x + 16,
        point.y + 12,
      );
    }
  }

  #createEntityVisuals(): void {
    const basePosition = cellCenter(this.#map.baseCell, this.#metrics());
    const baseSprite = this.add
      .image(basePosition.x, basePosition.y, TEXTURE_KEYS.base)
      .setDisplaySize(64, 64)
      .setDepth(MAP_DEPTH.entities)
      .setInteractive({ useHandCursor: true });
    baseSprite.on(
      Phaser.Input.Events.POINTER_UP,
      (pointer: Phaser.Input.Pointer) => {
        this.#handleEntityClick(pointer, { kind: 'base', id: 'base' });
      },
    );

    for (const center of this.#controller.getView().snapshot.centers) {
      const position = cellCenter(center.cell, this.#metrics());
      const sprite = this.add
        .image(position.x, position.y, TEXTURE_KEYS.center)
        .setDisplaySize(58, 58)
        .setDepth(MAP_DEPTH.entities)
        .setInteractive({ useHandCursor: true });
      sprite.on(
        Phaser.Input.Events.POINTER_UP,
        (pointer: Phaser.Input.Pointer) => {
          this.#handleEntityClick(pointer, {
            kind: 'center',
            id: center.id,
          });
        },
      );
      const label = this.add
        .text(position.x, position.y + 31, center.name, {
          color: '#eaf7ff',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '9px',
          fontStyle: '700',
          align: 'center',
          backgroundColor: '#071018e6',
          padding: { x: 6, y: 4 },
          stroke: '#04101a',
          strokeThickness: 2,
        })
        .setOrigin(0.5, 0)
        .setDepth(MAP_DEPTH.entities + 2);
      const accent = this.add.graphics().setDepth(MAP_DEPTH.entities + 1);
      this.#centerVisuals.set(center.id, { sprite, label, accent });
    }

    for (const rover of this.#controller.getView().snapshot.rovers) {
      const key =
        rover.kind === 'repair' ? TEXTURE_KEYS.repairRover : TEXTURE_KEYS.rover;
      const position = roverWorldPosition(rover, this.#metrics());
      const wheelOffsets = [
        { x: -13, y: -10, phase: 0 },
        { x: 13, y: -10, phase: 1 },
        { x: -13, y: 10, phase: 2 },
        { x: 13, y: 10, phase: 3 },
      ] as const;
      const wheels = wheelOffsets.map(({ x, y, phase }) => ({
        image: this.add
          .image(position.x + x, position.y + y, TEXTURE_KEYS.roverWheel)
          .setCrop(450, 165, 370, 890)
          .setDisplaySize(6.5, 14)
          .setDepth(MAP_DEPTH.entities + 5),
        localX: x,
        localY: y,
        phase,
      }));
      const sprite = this.add
        .image(position.x, position.y, key)
        .setDisplaySize(42, 42)
        .setDepth(MAP_DEPTH.entities + 4);
      const roverHitRadius = Math.min(sprite.width, sprite.height) * 0.38;
      sprite.setInteractive({
        hitArea: new Phaser.Geom.Circle(
          sprite.width / 2,
          sprite.height / 2,
          roverHitRadius,
        ),
        hitAreaCallback: Phaser.Geom.Circle.Contains,
        useHandCursor: true,
      });
      sprite.on(
        Phaser.Input.Events.POINTER_UP,
        (pointer: Phaser.Input.Pointer) => {
          this.#handleEntityClick(pointer, {
            kind: 'rover',
            id: rover.id,
          });
        },
      );
      const label = this.add
        .text(position.x, position.y + 21, rover.name, {
          color: '#f4fbff',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '10px',
          fontStyle: '600',
          stroke: '#04101a',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 0)
        .setDepth(MAP_DEPTH.entities + 6);
      const accent = this.add.graphics().setDepth(MAP_DEPTH.entities + 3);
      this.#roverVisuals.set(rover.id, {
        sprite,
        label,
        accent,
        wheels,
        headingRadians: 0,
        wheelPhase: 0,
        dustVisibleCount: 0,
      });
    }
  }

  #createSpeechBubbleVisuals(): void {
    this.#speechBubbleVisuals.length = 0;
    for (let index = 0; index < SPEECH_BUBBLE_POOL_SIZE; index += 1) {
      const background = this.add.graphics();
      const text = this.add
        .text(0, 0, '', {
          color: '#f5fbff',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '14px',
          fontStyle: '600',
          align: 'center',
          lineSpacing: 2,
          stroke: '#02070b',
          strokeThickness: 2,
          wordWrap: {
            width: SPEECH_BUBBLE_WIDTH - 52,
            useAdvancedWrap: true,
          },
        })
        .setOrigin(0.5)
        .setPosition(-6, 3);
      const closeButton = this.add
        .text(0, 0, '×', {
          color: '#d7e6ee',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: '20px',
          fontStyle: '700',
          padding: { x: 7, y: 1 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      const container = this.add
        .container(0, 0, [background, text, closeButton])
        .setDepth(MAP_DEPTH.speech)
        .setVisible(false);
      const visual: SpeechBubbleVisual = {
        container,
        background,
        text,
        closeButton,
        message: null,
        remainingMilliseconds: 0,
        ageMilliseconds: 0,
        width: SPEECH_BUBBLE_WIDTH,
        height: SPEECH_BUBBLE_MIN_HEIGHT,
        placement: null,
      };
      const stopInputPropagation = (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => event.stopPropagation();
      closeButton.on(Phaser.Input.Events.POINTER_DOWN, stopInputPropagation);
      closeButton.on(
        Phaser.Input.Events.POINTER_UP,
        (
          _pointer: Phaser.Input.Pointer,
          _localX: number,
          _localY: number,
          event: Phaser.Types.Input.EventData,
        ) => {
          event.stopPropagation();
          this.#releaseSpeechBubble(visual);
        },
      );
      this.#speechBubbleVisuals.push(visual);
    }
  }

  #handleEntityClick(
    pointer: Phaser.Input.Pointer,
    entity: MapSelectedEntity,
  ): void {
    // Phaser получает window pointerup даже поверх React HUD. Проверяем реальную
    // цель, иначе исчезающий inspector перехватывает click у DOM-кнопки.
    if (pointer.upElement !== this.game.canvas) return;
    if (pointer.button !== 0) return;
    const drag = this.#dragState;
    if (
      (drag?.pointerId === pointer.id && (drag.moved || drag.pansCamera)) ||
      Phaser.Math.Distance.Between(
        pointer.downX,
        pointer.downY,
        pointer.x,
        pointer.y,
      ) >= DRAG_THRESHOLD_PIXELS
    ) {
      return;
    }

    this.#controller.selectEntity(entity);
  }

  #createControls(): void {
    this.#zoomInButton = this.#createTextButton('+', 44, 0x182833, () => {
      this.#zoomBy(1.22);
    });
    this.#zoomOutButton = this.#createTextButton('−', 44, 0x182833, () => {
      this.#zoomBy(1 / 1.22);
    });
    this.#positionControls();
  }

  #createTextButton(
    label: string,
    size: number,
    color: number,
    action: () => void,
  ): Phaser.GameObjects.Container {
    const background = this.add.graphics();
    this.#drawControlBackground(background, size, color, 0.94);
    const text = this.add
      .text(0, -1, label, {
        color: '#eaf7ff',
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: '24px',
        fontStyle: '500',
      })
      .setOrigin(0.5);
    const container = this.add
      .container(0, 0, [background, text])
      .setDepth(MAP_DEPTH.controls)
      .setInteractive(
        new Phaser.Geom.Rectangle(-size / 2, -size / 2, size, size),
        Phaser.Geom.Rectangle.Contains,
      );
    container.on(
      Phaser.Input.Events.POINTER_DOWN,
      (pointer: Phaser.Input.Pointer) => {
        if (pointer.button === 0 && !this.#spacePanActive) action();
      },
    );
    container.on(Phaser.Input.Events.POINTER_OVER, () => container.setAlpha(1));
    container.on(Phaser.Input.Events.POINTER_OUT, () =>
      container.setAlpha(0.9),
    );
    container.setAlpha(0.9);
    return container;
  }

  #drawControlBackground(
    graphics: Phaser.GameObjects.Graphics,
    size: number,
    color: number,
    alpha: number,
  ): void {
    graphics.clear();
    graphics.fillStyle(0x050b10, 0.72);
    graphics.fillRoundedRect(
      -size / 2 - 3,
      -size / 2 - 3,
      size + 6,
      size + 6,
      15,
    );
    graphics.fillStyle(color, alpha);
    graphics.fillRoundedRect(-size / 2, -size / 2, size, size, 12);
    graphics.lineStyle(1, 0xdaf4ff, 0.42);
    graphics.strokeRoundedRect(-size / 2, -size / 2, size, size, 12);
  }

  #positionControls(): void {
    if (!this.#zoomInButton || !this.#zoomOutButton) return;
    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height);
    this.#placeScreenObject(this.#zoomInButton, width - 31, height - 83);
    this.#placeScreenObject(this.#zoomOutButton, width - 31, height - 31);
  }

  #placeScreenObject(
    object: Phaser.GameObjects.Container,
    x: number,
    y: number,
  ): void {
    const zoom = this.#cameraState.zoom;
    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height);
    object
      .setPosition(
        this.#cameraState.center.x + (x - width / 2) / zoom,
        this.#cameraState.center.y + (y - height / 2) / zoom,
      )
      .setScale(1 / zoom);
  }

  #zoomBy(multiplier: number, pointer?: Phaser.Input.Pointer): void {
    const constraints = this.#constraints();
    const anchor = pointer
      ? { x: pointer.x, y: pointer.y }
      : {
          x: constraints.viewport.width / 2,
          y: constraints.viewport.height / 2,
        };
    this.#cameraState = zoomAtPointer(
      this.#cameraState,
      anchor,
      this.#cameraState.zoom * multiplier,
      constraints,
    );
    this.#applyCamera();
  }

  #installInput(): void {
    this.input.mouse?.disableContextMenu();
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (
        pointer: Phaser.Input.Pointer,
        over: readonly Phaser.GameObjects.GameObject[],
      ) => {
        this.game.canvas.focus({ preventScroll: true });
        if (pointer.rightButtonDown()) {
          const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
          const cell = worldToGridCell(world, this.#metrics());
          if (cell) {
            const result = this.#controller.routeSelectedRoverTo(cell);
            this.#onRouteCommandResult?.(result);
          }
          return;
        }
        const pansCamera =
          pointer.middleButtonDown() ||
          (pointer.leftButtonDown() && this.#spacePanActive);
        if (!pointer.leftButtonDown() && !pointer.middleButtonDown()) return;
        if (over.length > 0 && !pansCamera) return;
        this.#dragState = {
          pointerId: pointer.id,
          originX: pointer.x,
          originY: pointer.y,
          camera: this.#cameraState,
          pansCamera,
          moved: false,
        };
      },
    );
    this.input.on(
      Phaser.Input.Events.POINTER_MOVE,
      (pointer: Phaser.Input.Pointer) => {
        const drag = this.#dragState;
        if (!drag || drag.pointerId !== pointer.id || !pointer.isDown) return;
        const deltaX = pointer.x - drag.originX;
        const deltaY = pointer.y - drag.originY;
        if (Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD_PIXELS) {
          drag.moved = true;
        }
        if (!drag.moved || !drag.pansCamera) return;
        this.#cameraState = clampCameraState(
          {
            center: {
              x: drag.camera.center.x - deltaX / drag.camera.zoom,
              y: drag.camera.center.y - deltaY / drag.camera.zoom,
            },
            zoom: drag.camera.zoom,
          },
          this.#constraints(),
        );
        this.#applyCamera();
      },
    );
    this.input.on(Phaser.Input.Events.POINTER_UP, () => {
      this.#dragState = null;
    });
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (
        pointer: Phaser.Input.Pointer,
        _over: readonly Phaser.GameObjects.GameObject[],
        _deltaX: number,
        deltaY: number,
      ) => {
        this.#zoomBy(Math.exp(-deltaY * 0.0015), pointer);
      },
    );
    this.input.keyboard?.on('keydown', this.#handleKeyDown);
    this.input.keyboard?.on('keyup', this.#handleKeyUp);
  }

  #clearSpeechBubbles(): void {
    this.#pendingSpeechMessages.length = 0;
    for (const visual of this.#speechBubbleVisuals) {
      this.#releaseSpeechBubble(visual);
    }
  }

  #releaseSpeechBubble(visual: SpeechBubbleVisual): void {
    visual.message = null;
    visual.remainingMilliseconds = 0;
    visual.ageMilliseconds = 0;
    visual.placement = null;
    visual.container.setVisible(false).setAlpha(1).setScale(1);
    visual.text.setText('');
    visual.background.clear();
  }

  #speechMessageAnchor(message: RadioMessage): WorldPoint | null {
    if (message.objectId === null || message.sourceKind === 'SYSTEM') {
      return null;
    }
    const visual =
      message.sourceKind === 'CENTER'
        ? this.#centerVisuals.get(message.objectId)
        : this.#roverVisuals.get(message.objectId);
    return visual ? { x: visual.sprite.x, y: visual.sprite.y } : null;
  }

  #enqueueSpeechMessage(message: RadioMessage): void {
    if (
      message.objectId === null ||
      message.sourceKind === 'SYSTEM' ||
      this.#speechMessageAnchor(message) === null ||
      this.#pendingSpeechMessages.some(({ id }) => id === message.id) ||
      this.#speechBubbleVisuals.some(
        (visual) => visual.message?.id === message.id,
      )
    ) {
      return;
    }
    this.#pendingSpeechMessages.push(message);
    this.#pendingSpeechMessages.sort(
      (left, right) =>
        right.priority - left.priority ||
        left.gameMinute - right.gameMinute ||
        left.id.localeCompare(right.id),
    );
    this.#pendingSpeechMessages.splice(SPEECH_BUBBLE_QUEUE_LIMIT);
  }

  #syncSpeechMessages(view: MapGameView): void {
    const messages = view.snapshot.radioMessages;
    if (!this.#radioMessagesInitialized) {
      this.#radioMessagesInitialized = true;
      if (view.snapshot.phase !== 'RUNNING') {
        for (const message of messages) {
          this.#seenRadioMessageIds.add(message.id);
        }
        return;
      }
      const recentGameMinute = Math.max(
        0,
        view.snapshot.elapsedGameMinutes - 1,
      );
      for (const message of messages) {
        if (message.gameMinute < recentGameMinute) {
          this.#seenRadioMessageIds.add(message.id);
        }
      }
    }

    const journalIds = new Set(messages.map(({ id }) => id));
    for (const id of this.#seenRadioMessageIds) {
      if (!journalIds.has(id)) this.#seenRadioMessageIds.delete(id);
    }
    const added = messages
      .filter(({ id }) => !this.#seenRadioMessageIds.has(id))
      .reverse();
    for (const message of added) {
      this.#seenRadioMessageIds.add(message.id);
      this.#enqueueSpeechMessage(message);
    }
  }

  #fillSpeechBubbleVisuals(): void {
    for (const visual of this.#speechBubbleVisuals) {
      if (visual.message !== null) continue;
      const activeObjectIds = new Set(
        this.#speechBubbleVisuals.flatMap((candidate) =>
          candidate.message?.objectId ? [candidate.message.objectId] : [],
        ),
      );
      let pendingIndex = this.#pendingSpeechMessages.findIndex(
        ({ objectId }) => objectId !== null && !activeObjectIds.has(objectId),
      );
      while (pendingIndex >= 0) {
        const [message] = this.#pendingSpeechMessages.splice(pendingIndex, 1);
        if (!message) break;
        if (this.#speechMessageAnchor(message) === null) {
          pendingIndex = this.#pendingSpeechMessages.findIndex(
            ({ objectId }) =>
              objectId !== null && !activeObjectIds.has(objectId),
          );
          continue;
        }
        visual.message = message;
        visual.remainingMilliseconds = speechBubbleDuration(message);
        visual.ageMilliseconds = 0;
        visual.text.setText(message.text);
        visual.width = SPEECH_BUBBLE_WIDTH;
        visual.height = Math.max(
          SPEECH_BUBBLE_MIN_HEIGHT,
          Math.ceil(visual.text.height) + 32,
        );
        visual.closeButton.setPosition(
          visual.width / 2 - 17,
          -visual.height / 2 + 17,
        );
        visual.placement = null;
        visual.container.setVisible(true).setAlpha(this.#reducedMotion ? 1 : 0);
        break;
      }
    }
  }

  #worldToScreen(point: WorldPoint): WorldPoint {
    const width = Math.max(1, this.scale.width);
    const height = Math.max(1, this.scale.height);
    return {
      x:
        (point.x - this.#cameraState.center.x) * this.#cameraState.zoom +
        width / 2,
      y:
        (point.y - this.#cameraState.center.y) * this.#cameraState.zoom +
        height / 2,
    };
  }

  #hudOcclusionRects(): readonly ScreenRect[] {
    const gameScreen = this.#host.closest('.game-screen');
    if (gameScreen === null) return [];
    const canvasRect = this.game.canvas.getBoundingClientRect();
    return [
      ...gameScreen.querySelectorAll<HTMLElement>(
        '.game-hud__selected, .radio-drawer, .hud-controls',
      ),
    ].flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const clippedLeft = clamp(
        rect.left - canvasRect.left,
        0,
        canvasRect.width,
      );
      const clippedTop = clamp(rect.top - canvasRect.top, 0, canvasRect.height);
      const clippedRight = clamp(
        rect.right - canvasRect.left,
        0,
        canvasRect.width,
      );
      const clippedBottom = clamp(
        rect.bottom - canvasRect.top,
        0,
        canvasRect.height,
      );
      return clippedRight > clippedLeft && clippedBottom > clippedTop
        ? [
            {
              x: clippedLeft,
              y: clippedTop,
              width: clippedRight - clippedLeft,
              height: clippedBottom - clippedTop,
            },
          ]
        : [];
    });
  }

  #findSpeechBubblePlacement(
    anchorWorld: WorldPoint,
    bubbleWidth: number,
    bubbleHeight: number,
    occupied: readonly ScreenRect[],
    occlusions: readonly ScreenRect[],
  ): SpeechBubblePlacement | null {
    const viewportWidth = Math.max(1, this.scale.width);
    const viewportHeight = Math.max(1, this.scale.height);
    const anchor = this.#worldToScreen(anchorWorld);
    const verticalOffset = 38 + bubbleHeight / 2;
    const horizontalOffset = bubbleWidth * 0.58;
    const candidates = [
      { x: anchor.x, y: anchor.y - verticalOffset },
      { x: anchor.x - horizontalOffset, y: anchor.y - verticalOffset },
      { x: anchor.x + horizontalOffset, y: anchor.y - verticalOffset },
      { x: anchor.x, y: anchor.y + verticalOffset },
      { x: anchor.x - horizontalOffset, y: anchor.y + verticalOffset },
      { x: anchor.x + horizontalOffset, y: anchor.y + verticalOffset },
    ];
    const maximumX = Math.max(
      SPEECH_BUBBLE_MARGIN,
      viewportWidth - SPEECH_BUBBLE_MARGIN - bubbleWidth,
    );
    const maximumY = Math.max(
      SPEECH_BUBBLE_MARGIN,
      viewportHeight -
        SPEECH_BUBBLE_MARGIN -
        SPEECH_BUBBLE_BOTTOM_RESERVED -
        bubbleHeight,
    );
    const phaserControls: ScreenRect = {
      x: Math.max(0, viewportWidth - 72),
      y: Math.max(0, viewportHeight - 116),
      width: 72,
      height: 116,
    };

    for (const candidate of candidates) {
      const rect = {
        x: clamp(candidate.x - bubbleWidth / 2, SPEECH_BUBBLE_MARGIN, maximumX),
        y: clamp(
          candidate.y - bubbleHeight / 2,
          SPEECH_BUBBLE_MARGIN,
          maximumY,
        ),
        width: bubbleWidth,
        height: bubbleHeight,
      };
      if (
        rectanglesOverlap(rect, phaserControls, SPEECH_BUBBLE_GAP) ||
        occlusions.some((surface) =>
          rectanglesOverlap(rect, surface, SPEECH_BUBBLE_GAP),
        ) ||
        occupied.some((placed) =>
          rectanglesOverlap(rect, placed, SPEECH_BUBBLE_GAP),
        )
      ) {
        continue;
      }
      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      return {
        rect,
        tail: centerY <= anchor.y ? 'bottom' : 'top',
        tailOffsetX: clamp(
          anchor.x - centerX,
          -bubbleWidth / 2 + 26,
          bubbleWidth / 2 - 26,
        ),
        anchor,
      };
    }
    return null;
  }

  #drawSpeechBubble(
    visual: SpeechBubbleVisual,
    placement: SpeechBubblePlacement,
  ): void {
    const message = visual.message;
    if (message === null) return;
    const graphics = visual.background;
    const accent = speechBubbleAccent(message);
    const halfWidth = visual.width / 2;
    const halfHeight = visual.height / 2;
    const tailY =
      placement.tail === 'bottom' ? halfHeight - 2 : -halfHeight + 2;
    const tailTipY =
      placement.tail === 'bottom' ? halfHeight + 12 : -halfHeight - 12;

    graphics.clear();
    graphics.fillStyle(0x07131b, 0.98);
    graphics.fillTriangle(
      placement.tailOffsetX - 10,
      tailY,
      placement.tailOffsetX + 10,
      tailY,
      placement.tailOffsetX,
      tailTipY,
    );
    graphics.lineStyle(4, 0x010508, 0.98);
    graphics.strokeTriangle(
      placement.tailOffsetX - 10,
      tailY,
      placement.tailOffsetX + 10,
      tailY,
      placement.tailOffsetX,
      tailTipY,
    );
    graphics.lineStyle(2, accent, 1);
    graphics.strokeTriangle(
      placement.tailOffsetX - 10,
      tailY,
      placement.tailOffsetX + 10,
      tailY,
      placement.tailOffsetX,
      tailTipY,
    );
    graphics.fillStyle(0x07131b, 0.98);
    graphics.fillRoundedRect(
      -halfWidth,
      -halfHeight,
      visual.width,
      visual.height,
      14,
    );
    graphics.lineStyle(5, 0x010508, 0.98);
    graphics.strokeRoundedRect(
      -halfWidth,
      -halfHeight,
      visual.width,
      visual.height,
      14,
    );
    graphics.lineStyle(2, accent, 1);
    graphics.strokeRoundedRect(
      -halfWidth,
      -halfHeight,
      visual.width,
      visual.height,
      14,
    );
  }

  #positionSpeechBubble(
    visual: SpeechBubbleVisual,
    placement: SpeechBubblePlacement,
  ): void {
    const viewportWidth = Math.max(1, this.scale.width);
    const viewportHeight = Math.max(1, this.scale.height);
    const centerX = placement.rect.x + placement.rect.width / 2;
    const centerY = placement.rect.y + placement.rect.height / 2;
    const transition = this.#reducedMotion
      ? 1
      : clamp(visual.ageMilliseconds / SPEECH_BUBBLE_ENTER_MILLISECONDS, 0, 1);
    const eased = 1 - Math.pow(1 - transition, 3);
    const presentationScale = this.#reducedMotion ? 1 : 0.9 + eased * 0.1;
    visual.container
      .setPosition(
        this.#cameraState.center.x +
          (centerX - viewportWidth / 2) / this.#cameraState.zoom,
        this.#cameraState.center.y +
          (centerY - viewportHeight / 2) / this.#cameraState.zoom,
      )
      .setScale(presentationScale / this.#cameraState.zoom)
      .setAlpha(this.#reducedMotion ? 1 : eased)
      .setVisible(true);
  }

  #layoutSpeechBubbles(): void {
    if (this.#speechBubbleVisuals.every(({ message }) => message === null)) {
      return;
    }
    const occupied: ScreenRect[] = [];
    const occlusions = this.#hudOcclusionRects();
    const rejected: RadioMessage[] = [];
    for (const visual of this.#speechBubbleVisuals) {
      const message = visual.message;
      if (message === null) continue;
      const anchor = this.#speechMessageAnchor(message);
      const placement = anchor
        ? this.#findSpeechBubblePlacement(
            anchor,
            visual.width,
            visual.height,
            occupied,
            occlusions,
          )
        : null;
      if (placement === null) {
        rejected.push(message);
        this.#releaseSpeechBubble(visual);
        continue;
      }
      visual.placement = placement;
      occupied.push(placement.rect);
      this.#drawSpeechBubble(visual, placement);
      this.#positionSpeechBubble(visual, placement);
    }
    for (const message of rejected) this.#enqueueSpeechMessage(message);
  }

  #renderSpeechBubbles(view: MapGameView, delta: number): void {
    if (
      view.snapshot.phase === 'BRIEFING' ||
      view.snapshot.phase === 'VICTORY' ||
      view.snapshot.phase === 'DEFEAT'
    ) {
      for (const message of view.snapshot.radioMessages) {
        this.#seenRadioMessageIds.add(message.id);
      }
      this.#clearSpeechBubbles();
      return;
    }

    this.#syncSpeechMessages(view);
    if (view.snapshot.phase === 'RUNNING') {
      const elapsed = clamp(delta, 0, 100);
      for (const visual of this.#speechBubbleVisuals) {
        if (visual.message === null) continue;
        visual.remainingMilliseconds -= elapsed;
        visual.ageMilliseconds += elapsed;
        if (visual.remainingMilliseconds <= 0) {
          this.#releaseSpeechBubble(visual);
        }
      }
    }
    this.#fillSpeechBubbleVisuals();
    this.#layoutSpeechBubbles();
  }

  #renderView(view: MapGameView, time: number, delta: number): void {
    this.#applyFocusRequest(view);
    this.#renderRoutes(view);
    this.#renderCenters(view.snapshot.centers);
    this.#renderRovers(view, time, delta);
    this.#renderSpeechBubbles(view, delta);
    this.#renderSelection(view);
    this.#publishReadOnlyState(view, time);
  }

  #applyFocusRequest(view: MapGameView): void {
    const request = view.focusRequest;
    if (request === null || request.key === this.#lastFocusRequestKey) return;
    this.#lastFocusRequestKey = request.key;
    this.#cameraState = clampCameraState(
      {
        center: cellCenter(request.cell, this.#metrics()),
        zoom: this.#cameraState.zoom,
      },
      this.#constraints(),
    );
    this.#applyCamera();
  }

  #renderRoutes(view: MapGameView): void {
    const { tileWidth, tileHeight } = this.#map;
    const routeColor = colorNumber(this.#map.palette.route);
    this.#routeGraphics.clear();
    const routeOwnerId =
      view.selectedEntity?.kind === 'rover' ? view.selectedEntity.id : null;
    const confirmed = view.snapshot.rovers.find(
      ({ id }) => id === routeOwnerId,
    )?.route;
    if (confirmed) {
      const routePoints = [
        confirmed.originPosition,
        ...confirmed.legs.map(({ to }) => to),
      ];
      this.#routeGraphics.lineStyle(9, 0x02090e, 0.78);
      drawPolyline(this.#routeGraphics, routePoints, tileWidth, tileHeight);
      this.#routeGraphics.lineStyle(3, routeColor, 0.92);
      drawPolyline(this.#routeGraphics, routePoints, tileWidth, tileHeight);
      const destination = navigationPointWorldPosition(routePoints.at(-1)!, {
        tileWidth,
        tileHeight,
      });
      this.#routeGraphics.lineStyle(2, routeColor, 0.9);
      this.#routeGraphics.strokeCircle(destination.x, destination.y, 10);
      this.#routeGraphics.strokeCircle(destination.x, destination.y, 15);
    }
  }

  #renderCenters(centers: readonly CenterSnapshot[]): void {
    for (const center of centers) {
      const visual = this.#centerVisuals.get(center.id);
      if (!visual) continue;
      const position = cellCenter(center.cell, this.#metrics());
      const presentation = createCenterMapPresentation(center);
      const labelAbove = center.cell.row >= this.#map.height - 1;
      const labelY = labelAbove ? position.y - 58 : position.y + 31;
      visual.sprite.setPosition(position.x, position.y);
      this.#positionEntityLabel(visual.label, position.x, labelY);
      visual.label
        .setText(
          `${presentation.label}\nO₂ ${Math.round(center.resources.oxygen)}  ▰ ${Math.round(center.resources.food)}  ◇ ${Math.round(center.resources.equipment)}`,
        )
        .setColor(presentation.tone === 'critical' ? '#ffb4b4' : '#eaf7ff');
      visual.accent.clear();
      const status = centerStatusColor(presentation.tone, this.#map.palette);
      visual.accent.fillStyle(status, 0.12);
      visual.accent.fillCircle(position.x, position.y, 33);
      visual.accent.lineStyle(5, 0x030a0f, 0.82);
      visual.accent.strokeCircle(position.x, position.y, 30);
      visual.accent.lineStyle(2, status, 0.96);
      visual.accent.strokeCircle(position.x, position.y, 27);
      const bars = [
        [center.resources.oxygen, colorNumber(this.#map.palette.route)],
        [center.resources.food, colorNumber(this.#map.palette.safe)],
        [center.resources.equipment, colorNumber(this.#map.palette.warning)],
      ] as const;
      bars.forEach(([value, color], index) => {
        const x = position.x - 28 + index * 19;
        const y = position.y - 42;
        visual.accent.fillStyle(0x061018, 0.94);
        visual.accent.fillRoundedRect(x, y, 18, 7, 3);
        visual.accent.fillStyle(color, 0.96);
        visual.accent.fillRoundedRect(
          x + 1,
          y + 1,
          16 * Math.min(1, value / 100),
          5,
          2,
        );
      });
    }
  }

  #renderRovers(view: MapGameView, time: number, delta: number): void {
    this.#incidentGraphics.clear();
    this.#motionGraphics.clear();
    const cargoColors = [
      colorNumber(this.#map.palette.route),
      colorNumber(this.#map.palette.safe),
      colorNumber(this.#map.palette.warning),
    ] as const;
    for (const rover of view.snapshot.rovers) {
      const visual = this.#roverVisuals.get(rover.id);
      if (!visual) continue;
      const position = roverWorldPosition(rover, this.#metrics());
      const offset = roverOffset(rover, view.snapshot.rovers);
      const x = position.x + offset.x;
      const y = position.y + offset.y;
      const motionActive =
        rover.movement !== null &&
        view.snapshot.phase === 'RUNNING' &&
        !this.#reducedMotion;
      if (
        rover.movement &&
        (view.snapshot.phase === 'RUNNING' || this.#reducedMotion)
      ) {
        const direction = Math.atan2(
          rover.movement.to.row - rover.movement.from.row,
          rover.movement.to.column - rover.movement.from.column,
        );
        const targetHeading = direction - Math.PI / 2;
        visual.headingRadians = rotateTowards(
          visual.headingRadians,
          targetHeading,
          this.#reducedMotion
            ? Number.POSITIVE_INFINITY
            : Math.PI * 3 * (Math.min(delta, 100) / 1_000),
        );
      }
      visual.wheelPhase = motionActive ? Math.floor((time * 0.16) % 60) : 0;
      visual.dustVisibleCount = motionActive ? 3 : 0;

      this.#motionGraphics.fillStyle(0x020507, 0.34);
      this.#motionGraphics.fillEllipse(x, y + 4, 34, 15);
      if (motionActive) {
        const forward = visual.headingRadians + Math.PI / 2;
        const backX = x - Math.cos(forward) * 19;
        const backY = y - Math.sin(forward) * 19;
        const lateralX = Math.cos(forward + Math.PI / 2);
        const lateralY = Math.sin(forward + Math.PI / 2);
        for (let mote = 0; mote < visual.dustVisibleCount; mote += 1) {
          const drift = Math.sin(time / 95 + mote * 2.1) * (4 + mote * 2);
          const trail = ((time / 38 + mote * 7) % 13) + 2;
          this.#motionGraphics.fillStyle(0xc8c2b6, 0.18 - mote * 0.035);
          this.#motionGraphics.fillCircle(
            backX + lateralX * drift - Math.cos(forward) * trail,
            backY + lateralY * drift - Math.sin(forward) * trail,
            2.5 + mote,
          );
        }
      }

      visual.sprite.setPosition(x, y).setRotation(visual.headingRadians);
      const cos = Math.cos(visual.headingRadians);
      const sin = Math.sin(visual.headingRadians);
      for (const wheel of visual.wheels) {
        const wheelX = x + wheel.localX * cos - wheel.localY * sin;
        const wheelY = y + wheel.localX * sin + wheel.localY * cos;
        const treadOffset = motionActive
          ? (visual.wheelPhase + wheel.phase * 17) % 60
          : 0;
        wheel.image
          .setCrop(450, 165 + treadOffset, 370, 850)
          .setDisplaySize(6.5, 14)
          .setPosition(wheelX, wheelY)
          .setRotation(
            visual.headingRadians +
              (motionActive ? Math.sin(time / 70 + wheel.phase) * 0.045 : 0),
          );
      }
      const selected =
        view.selectedEntity?.kind === 'rover' &&
        view.selectedEntity.id === rover.id;
      this.#positionEntityLabel(visual.label, x, y + 20);
      visual.label.setVisible(selected);
      visual.accent.clear();
      const hud = createRoverHudPresentation(rover);
      visual.accent.lineStyle(5, 0x3b4951, 0.96);
      visual.accent.strokeCircle(x, y, 27);
      if (hud.batteryRatio > 0) {
        visual.accent.lineStyle(5, colorNumber(this.#map.palette.safe), 1);
        visual.accent.beginPath();
        visual.accent.arc(
          x,
          y,
          27,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * hud.batteryRatio,
          false,
        );
        visual.accent.strokePath();
      }
      if (hud.cargoRatios) {
        const barX = x - 20;
        const barY = y - 47;
        const innerWidth = 38;
        visual.accent.fillStyle(0x26343c, 0.96);
        visual.accent.fillRoundedRect(barX, barY, 40, 6, 3);
        let segmentX = barX + 1;
        hud.cargoRatios.forEach((ratio, index) => {
          const segmentWidth = innerWidth * ratio;
          if (segmentWidth <= 0) return;
          visual.accent.fillStyle(cargoColors[index] ?? cargoColors[0], 1);
          visual.accent.fillRect(segmentX, barY + 1, segmentWidth, 4);
          segmentX += segmentWidth;
        });
      }
      if (rover.activeIncident) {
        const pulse = this.#reducedMotion
          ? 0.7
          : 0.52 + Math.sin(time / 180) * 0.18;
        const markerX = x + 24;
        const markerY = y - 23;
        this.#incidentGraphics.fillStyle(0x061018, 0.88);
        this.#incidentGraphics.fillTriangle(
          markerX,
          markerY - 9,
          markerX - 9,
          markerY + 8,
          markerX + 9,
          markerY + 8,
        );
        this.#incidentGraphics.lineStyle(
          2.5,
          colorNumber(this.#map.palette.warning),
          pulse + 0.2,
        );
        this.#incidentGraphics.strokeTriangle(
          markerX,
          markerY - 9,
          markerX - 9,
          markerY + 8,
          markerX + 9,
          markerY + 8,
        );
        this.#incidentGraphics.lineStyle(2, 0xf7fbff, pulse + 0.2);
        this.#incidentGraphics.lineBetween(
          markerX,
          markerY - 3,
          markerX,
          markerY + 3,
        );
        this.#incidentGraphics.fillStyle(0xf7fbff, pulse + 0.2);
        this.#incidentGraphics.fillCircle(markerX, markerY + 6, 1.5);
      }
    }
  }

  #positionEntityLabel(
    label: Phaser.GameObjects.Text,
    x: number,
    y: number,
  ): void {
    const edgePadding = 4;
    const halfTile = this.#map.tileWidth / 2;
    if (x <= halfTile) {
      label.setOrigin(0, 0).setPosition(edgePadding, y);
      return;
    }
    if (x >= this.#worldWidth() - halfTile) {
      label.setOrigin(1, 0).setPosition(this.#worldWidth() - edgePadding, y);
      return;
    }
    label.setOrigin(0.5, 0).setPosition(x, y);
  }

  #renderSelection(view: MapGameView): void {
    this.#selectionGraphics.clear();
    const entity = view.selectedEntity;
    if (entity === null) return;

    let position: { x: number; y: number } | null = null;
    let radius = 34;
    if (entity.kind === 'base' && entity.id === 'base') {
      position = cellCenter(view.baseCell, this.#metrics());
    } else if (entity.kind === 'center') {
      const center = view.snapshot.centers.find(({ id }) => id === entity.id);
      if (center) {
        position = cellCenter(center.cell, this.#metrics());
        radius = 31;
      }
    } else if (entity.kind === 'rover') {
      return;
    }
    if (position === null) return;

    this.#selectionGraphics.lineStyle(7, 0x04101a, 0.78);
    this.#selectionGraphics.strokeCircle(position.x, position.y, radius);
    this.#selectionGraphics.lineStyle(
      3,
      colorNumber(this.#map.palette.route),
      0.98,
    );
    this.#selectionGraphics.strokeCircle(position.x, position.y, radius);
  }

  #publishReadOnlyState(view: MapGameView, time: number): void {
    if (!this.#diagnosticsEnabled || time - this.#lastDiagnosticsTime < 100) {
      return;
    }
    this.#lastDiagnosticsTime = time;
    this.#host.dataset.mapState = JSON.stringify({
      phase: view.snapshot.phase,
      selectedEntity: view.selectedEntity,
      selectedRoverId:
        view.selectedEntity?.kind === 'rover' ? view.selectedEntity.id : null,
      camera: this.#cameraState,
      reducedMotion: this.#reducedMotion,
      hazardCells: layerCells(
        this.#map.layers.find(({ name }) => name === 'hazards') ?? {
          name: 'hazards',
          data: [],
          opacity: 1,
        },
        this.#map.width,
      ),
      centers: view.snapshot.centers.map((center) => ({
        id: center.id,
        cell: center.cell,
        status: center.status,
        resources: center.resources,
      })),
      speechQueueLength: this.#pendingSpeechMessages.length,
      speechBubbles: this.#speechBubbleVisuals.flatMap((visual) => {
        const message = visual.message;
        const placement = visual.placement;
        if (
          message === null ||
          placement === null ||
          !visual.container.visible
        ) {
          return [];
        }
        return [
          {
            messageId: message.id,
            eventCode: message.eventCode,
            objectId: message.objectId,
            sourceKind: message.sourceKind,
            text: message.text,
            priority: message.priority,
            remainingMilliseconds: Math.round(visual.remainingMilliseconds),
            transitioning:
              !this.#reducedMotion &&
              visual.ageMilliseconds < SPEECH_BUBBLE_ENTER_MILLISECONDS,
            presentationScale: Number(
              (visual.container.scaleX * this.#cameraState.zoom).toFixed(4),
            ),
            screenRect: placement.rect,
            closeScreenRect: {
              x: placement.rect.x + placement.rect.width - 34,
              y: placement.rect.y,
              width: 34,
              height: 34,
            },
            anchorScreen: placement.anchor,
          },
        ];
      }),
      rovers: view.snapshot.rovers.map((rover) => {
        const hud = createRoverHudPresentation(rover);
        return {
          id: rover.id,
          cell: rover.cell,
          position: rover.position,
          cargo: rover.cargo,
          movement: rover.movement,
          route: rover.route,
          status: rover.status,
          batteryRatio: hud.batteryRatio,
          cargoRatios: hud.cargoRatios,
          headingRadians: this.#roverVisuals.get(rover.id)?.headingRadians ?? 0,
          wheelPhase: this.#roverVisuals.get(rover.id)?.wheelPhase ?? 0,
          dustVisibleCount:
            this.#roverVisuals.get(rover.id)?.dustVisibleCount ?? 0,
          world: (() => {
            const position = roverWorldPosition(rover, this.#metrics());
            const offset = roverOffset(rover, view.snapshot.rovers);
            return { x: position.x + offset.x, y: position.y + offset.y };
          })(),
        };
      }),
    });
  }
}
