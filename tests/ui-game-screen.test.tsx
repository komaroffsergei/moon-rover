import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { GameSnapshot } from '../src/domain';
import type {
  GamePublishedView,
  GameSelectedEntity,
  GameStoreState,
} from '../src/ui/store/gameStore';
import { GameScreen } from '../src/ui/screens/GameScreen';

const snapshot: GameSnapshot = {
  phase: 'RUNNING',
  elapsedRealMilliseconds: 0,
  elapsedGameMinutes: 0,
  remainingRealMilliseconds: 60_000,
  centers: [],
  rovers: [],
  emergencyOperations: [],
  radioMessages: [],
};

function createScreenStore({
  radioOpen = false,
  selectedEntity = null,
}: {
  readonly radioOpen?: boolean;
  readonly selectedEntity?: GameSelectedEntity | null;
} = {}): StoreApi<GameStoreState> {
  const view: GamePublishedView = {
    snapshot,
    baseCell: { column: 0, row: 0 },
    selectedEntity,
    routingRoverId: null,
    focusRequest: null,
    centerMetrics: [],
    roverActions: [],
    routeDraft: null,
    candidateCells: [],
    forecast: null,
    canDispatchRoute: false,
  };

  return createStore<GameStoreState>()(
    () =>
      ({
        level: {
          id: 'test-level',
          ordinal: 1,
          title: 'Тестовая карта',
          description: 'Описание',
          objective: 'Сохранить центры',
          riskLevel: 'low',
          riskChoiceCenterCount: 1,
          shiftDurationRealSeconds: 60,
          centerCount: 0,
          roverCount: 0,
          courierCount: 0,
          previewAsset: '/test.webp',
        },
        view,
        screen: 'GAME',
        modal: null,
        batteryTransfer: null,
        radioOpen,
        commandError: null,
        cargoDrafts: {},
        pause: vi.fn(),
        resume: vi.fn(),
        closeRadio: vi.fn(),
        toggleRadio: vi.fn(),
      }) as unknown as GameStoreState,
  );
}

function renderGame(store: StoreApi<GameStoreState>): string {
  return renderToStaticMarkup(
    <GameScreen
      store={store}
      mountGame={vi.fn(() => vi.fn())}
      onReplay={vi.fn()}
      onLevelSelect={vi.fn()}
    />,
  );
}

describe('full-map game HUD', () => {
  it('keeps the map full-screen and renders only pause and radio chrome by default', () => {
    const markup = renderGame(createScreenStore());

    expect(markup).toContain('class="map-region"');
    expect(markup).toContain('data-testid="game-host"');
    expect(markup).toContain('hud-controls hud-controls--bottom-left');
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Поставить смену на паузу"');
    expect(markup).toContain('aria-label="Открыть рацию"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('game-topbar');
    expect(markup).not.toContain('game-sidebar');
    expect(markup).not.toContain('overview-panel');
    expect(markup).not.toContain('map-command-hint');
    expect(markup).not.toContain('class="radio-drawer"');
    expect(markup).not.toContain('selected-panel');
  });

  it('shows the left radio drawer and upper-right selected surface only on demand', () => {
    const markup = renderGame(
      createScreenStore({
        radioOpen: true,
        selectedEntity: { kind: 'base', id: 'base' },
      }),
    );

    expect(markup).toContain('class="game-hud__selected"');
    expect(markup).toContain('aria-label="Выбранный объект"');
    expect(markup).toContain('aria-label="Свернуть сведения об объекте"');
    expect(markup).toContain('class="radio-drawer" id="radio-drawer"');
    expect(markup).toContain('aria-label="Свернуть рацию"');
    expect(markup).toContain('aria-label="Скрыть рацию"');
    expect(markup).toContain('aria-expanded="true"');
  });
});
