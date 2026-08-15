import { useEffect, useRef, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';

import type { GameStoreState } from '../store/gameStore';
import { Modal } from '../components/Modal';
import { ResultDialog } from '../components/ResultDialog';
import { RadioPanel } from '../panels/RadioPanel';
import { SelectedEntityPanel } from '../panels/SelectedEntityPanel';

export interface GameScreenProps {
  readonly mountGame: (host: HTMLElement) => Promise<() => void> | (() => void);
  readonly store: StoreApi<GameStoreState>;
  readonly onReplay: () => void;
  readonly onLevelSelect: () => void;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'button, input, select, textarea, a, [role="button"], [contenteditable="true"]',
    ) !== null
  );
}

function isMapTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-testid="game-host"]') !== null
  );
}

interface DismissedSelectedEntitySurface {
  readonly selectedEntity: GameStoreState['view']['selectedEntity'];
  readonly commandError: GameStoreState['commandError'];
}

function SelectedEntitySurface({ state }: { readonly state: GameStoreState }) {
  const [dismissed, setDismissed] =
    useState<DismissedSelectedEntitySurface | null>(null);
  const isDismissed =
    dismissed?.selectedEntity === state.view.selectedEntity &&
    dismissed.commandError === state.commandError;
  if (isDismissed) return null;

  return (
    <div className="game-hud__selected">
      <SelectedEntityPanel
        state={state}
        onDismiss={() =>
          setDismissed({
            selectedEntity: state.view.selectedEntity,
            commandError: state.commandError,
          })
        }
      />
    </div>
  );
}

export function GameScreen({
  mountGame,
  store,
  onReplay,
  onLevelSelect,
}: GameScreenProps) {
  const state = useStore(store);
  const gameHostRef = useRef<HTMLDivElement>(null);
  const radioToggleRef = useRef<HTMLButtonElement>(null);
  const selectedPanelAvailable =
    state.view.selectedEntity !== null || state.commandError !== null;

  useEffect(() => {
    const gameHost = gameHostRef.current;
    if (!gameHost) return undefined;

    let mounted = true;
    let cleanup: (() => void) | undefined;
    void Promise.resolve(mountGame(gameHost)).then((destroy) => {
      if (mounted) cleanup = destroy;
      else destroy();
    });

    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [mountGame]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const current = store.getState();

      if (event.key === 'Escape') {
        if (current.modal === 'PAUSE') {
          current.resume();
        } else if (current.modal === 'BATTERY_TRANSFER') {
          current.cancelBatteryTransfer();
        } else if (current.radioOpen) {
          current.closeRadio();
          radioToggleRef.current?.focus();
        } else {
          return;
        }
        event.preventDefault();
        return;
      }

      if (
        (event.code === 'Space' || event.key === ' ') &&
        !isInteractiveTarget(event.target) &&
        !isMapTarget(event.target)
      ) {
        if (current.modal === 'PAUSE') current.resume();
        else if (current.view.snapshot.phase === 'RUNNING') current.pause();
        else return;
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  const snapshot = state.view.snapshot;
  const transfer = state.batteryTransfer;
  const transferDonor = transfer
    ? snapshot.rovers.find(({ id }) => id === transfer.donorRoverId)
    : undefined;
  const transferReceiver = transfer
    ? snapshot.rovers.find(({ id }) => id === transfer.repairRoverId)
    : undefined;
  const missionEnded =
    snapshot.phase === 'VICTORY' || snapshot.phase === 'DEFEAT';
  const selectedRover =
    state.view.selectedEntity?.kind === 'rover'
      ? snapshot.rovers.find(({ id }) => id === state.view.selectedEntity?.id)
      : undefined;
  const selectedRoverCanRoute =
    selectedRover !== undefined &&
    state.view.roverActions.some(
      ({ roverId, canAssignRoute }) =>
        roverId === selectedRover.id && canAssignRoute,
    );
  const radioSourceNames = Object.fromEntries([
    ...snapshot.centers.map(({ id, name }) => [id, name] as const),
    ...snapshot.rovers.map(({ id, name }) => [id, name] as const),
  ]);
  const collapseRadio = () => {
    state.closeRadio();
    radioToggleRef.current?.focus();
  };

  return (
    <section className="game-screen" aria-label="Экран диспетчера">
      <h1 className="visually-hidden">{state.level.title}</h1>
      <p id="game-objective-help" className="visually-hidden">
        {state.level.objective}
      </p>
      <section
        className="map-region"
        data-testid="map-region"
        aria-label="Тактическая карта"
      >
        <p id="map-keyboard-help" className="visually-hidden">
          Колесо мыши изменяет масштаб. Средняя кнопка или Space с
          перетаскиванием перемещают карту. Левый клик выбирает ровер. Правый
          клик сразу отправляет выбранный ровер и перестраивает его маршрут во
          время движения.
        </p>
        <div
          ref={gameHostRef}
          className={`game-host${selectedRoverCanRoute ? ' game-host--route-ready' : ''}`}
          data-testid="game-host"
          role="application"
          aria-label={`Карта уровня ${state.level.title}`}
          aria-describedby="game-objective-help map-keyboard-help"
          tabIndex={0}
        />
      </section>

      <div className="game-hud">
        {selectedPanelAvailable ? (
          <SelectedEntitySurface state={state} />
        ) : null}

        {state.radioOpen ? (
          <div className="radio-drawer" id="radio-drawer">
            <RadioPanel
              messages={snapshot.radioMessages}
              sourceNames={radioSourceNames}
              onCollapse={collapseRadio}
            />
          </div>
        ) : null}

        <div className="hud-controls hud-controls--bottom-left">
          <button
            className="icon-button hud-control hud-control--pause"
            type="button"
            aria-label="Поставить смену на паузу"
            onClick={() => state.pause()}
            disabled={snapshot.phase !== 'RUNNING'}
          >
            <svg
              className="hud-control__icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
          <button
            ref={radioToggleRef}
            className={`icon-button hud-control hud-control--radio${state.radioOpen ? ' hud-control--active' : ''}`}
            type="button"
            aria-label={state.radioOpen ? 'Скрыть рацию' : 'Открыть рацию'}
            aria-expanded={state.radioOpen}
            aria-controls="radio-drawer"
            onClick={() => state.toggleRadio()}
          >
            <svg
              className="hud-control__icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M8 6.5 17.5 3" />
              <rect x="4" y="7" width="16" height="12" rx="3" />
              <circle cx="9" cy="13" r="2.5" />
              <path d="M14 11h3M14 14h3M7 21h10" />
            </svg>
          </button>
        </div>
      </div>

      {!missionEnded && state.modal === 'PAUSE' ? (
        <Modal
          title="Смена приостановлена"
          onDismiss={() => state.resume()}
          footer={
            <>
              <button type="button" onClick={onLevelSelect}>
                Выбор карты
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => state.resume()}
              >
                Продолжить
              </button>
            </>
          }
        >
          <p>Симуляция остановлена. Карта и текущий маршрут сохранены.</p>
          <p className="keyboard-hint">Space или Esc — продолжить</p>
        </Modal>
      ) : null}

      {!missionEnded && state.modal === 'BATTERY_TRANSFER' && transfer ? (
        <Modal
          title="Подтвердить передачу батареи"
          tone="danger"
          onDismiss={state.cancelBatteryTransfer}
          footer={
            <>
              <button type="button" onClick={state.cancelBatteryTransfer}>
                Отмена
              </button>
              <button
                className="button button--primary"
                type="button"
                onClick={() => state.confirmBatteryTransfer()}
              >
                Передать заряд
              </button>
            </>
          }
        >
          <p>
            {transferDonor?.name ?? transfer.donorRoverId} отдаст весь заряд{' '}
            роверу {transferReceiver?.name ?? transfer.repairRoverId}.
          </p>
          <dl className="metric-list">
            <div>
              <dt>Донор после</dt>
              <dd>{transfer.preview.donorBatteryAfter}</dd>
            </div>
            <div>
              <dt>Получатель после</dt>
              <dd>{transfer.preview.repairBatteryAfter}</dd>
            </div>
            <div>
              <dt>Потеря заряда</dt>
              <dd>{transfer.preview.discardedCharge}</dd>
            </div>
          </dl>
        </Modal>
      ) : null}

      {missionEnded ? (
        <ResultDialog
          snapshot={snapshot}
          onReplay={onReplay}
          onLevelSelect={onLevelSelect}
        />
      ) : null}
    </section>
  );
}
