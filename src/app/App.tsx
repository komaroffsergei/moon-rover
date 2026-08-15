import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';

import type { MapRouteDispatchResult } from '../game/mapGamePort';
import {
  createGameStore,
  type GameScreen as GameScreenName,
} from '../ui/store/gameStore';
import { BriefingScreen } from '../ui/screens/BriefingScreen';
import { LevelSelectScreen } from '../ui/screens/LevelSelectScreen';
import {
  createRuntimeMap,
  listRuntimeLevels,
  type RuntimeLevelId,
} from './createRuntimeMap';
import { createPlacementSeed } from './createPlacementSeed';
import { E2E_AUTHORING_LAYOUT_IDS } from './testing/e2eFacilityPlacement';

const GameScreen = lazy(async () => {
  const module = await import('../ui/screens/GameScreen');
  return { default: module.GameScreen };
});

const runtimeLevels = listRuntimeLevels();

function createSession(
  levelId: RuntimeLevelId = 'shackleton-rift',
  initialScreen: GameScreenName = 'LEVEL_SELECT',
) {
  const useProceduralE2ePlacement =
    import.meta.env.MODE === 'e2e' &&
    new URLSearchParams(globalThis.location.search).get('placement') ===
      'procedural';
  const runtime = createRuntimeMap(
    levelId,
    createPlacementSeed(levelId),
    import.meta.env.MODE === 'e2e' && !useProceduralE2ePlacement
      ? { authoringLayoutId: E2E_AUTHORING_LAYOUT_IDS[levelId] }
      : undefined,
  );
  const gameStore = createGameStore({
    controller: runtime.controller,
    level: runtime.level,
    initialScreen,
  });
  return Object.freeze({ runtime, gameStore });
}

async function mountRuntimeGame(
  host: HTMLElement,
  runtime: ReturnType<typeof createRuntimeMap>,
  onRouteCommandResult: (result: MapRouteDispatchResult) => void,
): Promise<() => void> {
  const { createGame } = await import('../game/createGame');
  const game = createGame(host, runtime, onRouteCommandResult);
  return () => game.destroy(true);
}

export function App() {
  const [session, setSession] = useState(() => createSession());
  const screen = useStore(session.gameStore.store, (state) => state.screen);
  const level = useStore(session.gameStore.store, (state) => state.level);
  const openBriefing = useStore(
    session.gameStore.store,
    (state) => state.openBriefing,
  );
  const showLevelSelect = useStore(
    session.gameStore.store,
    (state) => state.showLevelSelect,
  );
  const startGame = useStore(
    session.gameStore.store,
    (state) => state.startGame,
  );

  useEffect(() => () => session.gameStore.dispose(), [session]);

  const mountGame = useCallback(
    (host: HTMLElement) =>
      mountRuntimeGame(host, session.runtime, (result) =>
        session.gameStore.store.getState().reportRouteCommandResult(result),
      ),
    [session],
  );

  const resetSession = (initialScreen: GameScreenName) => {
    setSession(createSession(session.runtime.level.id, initialScreen));
  };

  const selectLevel = (levelId: string) => {
    const selected = runtimeLevels.find(({ id }) => id === levelId);
    if (selected !== undefined && selected.id !== level.id) {
      setSession(createSession(selected.id));
    }
  };

  return (
    <main className="app-shell" data-testid="app-shell">
      {screen === 'LEVEL_SELECT' ? (
        <LevelSelectScreen
          levels={runtimeLevels}
          selectedLevelId={level.id}
          onSelect={selectLevel}
          onContinue={openBriefing}
        />
      ) : null}
      {screen === 'BRIEFING' ? (
        <BriefingScreen
          level={level}
          onBack={showLevelSelect}
          onStart={startGame}
        />
      ) : null}
      {screen === 'GAME' ? (
        <Suspense
          fallback={
            <div className="loading-screen" role="status">
              <span aria-hidden="true">◌</span>
              Подготовка диспетчерской карты…
            </div>
          }
        >
          <GameScreen
            store={session.gameStore.store}
            mountGame={mountGame}
            onReplay={() => resetSession('BRIEFING')}
            onLevelSelect={() => resetSession('LEVEL_SELECT')}
          />
        </Suspense>
      ) : null}
    </main>
  );
}
