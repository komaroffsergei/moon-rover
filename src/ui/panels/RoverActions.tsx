import type { Cargo, RoverSnapshot } from '../../domain';
import type { GameStoreState } from '../store/gameStore';
import {
  formatGameMinuteCountdown,
  formatPercent,
  ROVER_STATUS_LABELS,
} from '../components/formatters';
import { ResourceBar } from '../components/ResourceBar';
import { formatGameQuantity } from '../../shared/formatGameQuantity';

interface RoverActionsProps {
  readonly rover: RoverSnapshot;
  readonly state: GameStoreState;
}

export function RoverActions({ rover, state }: RoverActionsProps) {
  const draft = state.cargoDrafts[rover.id] ?? rover.cargo;
  const draftTotal = draft.oxygen + draft.food + draft.equipment;
  const availability = state.view.roverActions.find(
    ({ roverId }) => roverId === rover.id,
  );
  const unloadCenter = state.view.snapshot.centers.find(
    ({ id }) => id === availability?.unloadCenterId,
  );
  const operation = state.view.snapshot.emergencyOperations.find(
    ({ helperRoverId, targetRoverId }) =>
      helperRoverId === rover.id || targetRoverId === rover.id,
  );
  const roverName = (roverId: string) =>
    state.view.snapshot.rovers.find(({ id }) => id === roverId)?.name ??
    roverId;

  const editCargo = (resource: keyof Cargo, value: string) => {
    state.editCargo(rover.id, resource, Math.max(0, Number(value) || 0));
  };

  return (
    <div className="selected-rover">
      <div className="selected-panel__heading">
        <div>
          <p className="panel-kicker">
            {rover.kind === 'repair' ? 'Ремонтный ровер' : 'Курьер'}
          </p>
          <h2>{rover.name}</h2>
        </div>
        <div className="selected-rover__visual">
          <img
            src={
              rover.kind === 'repair'
                ? '/assets/objects/repair-rover.png'
                : '/assets/objects/rover.png'
            }
            alt=""
            aria-hidden="true"
          />
          <span
            className={`status-chip status-chip--${rover.status.toLowerCase()}`}
          >
            {ROVER_STATUS_LABELS[rover.status]}
          </span>
        </div>
      </div>

      <ResourceBar
        icon="⌁"
        label="Батарея"
        value={(rover.battery / rover.batteryCapacity) * 100}
        tone="battery"
      />

      {rover.activeIncident ? (
        <div className="state-callout state-callout--critical" role="status">
          <strong>△ Аварийное состояние</strong>
          <p>
            {rover.status === 'STUCK'
              ? 'Ровер застрял в кратере и ожидает спасателя.'
              : rover.status === 'BROKEN'
                ? 'Требуется ремонтный ровер в соседней клетке.'
                : 'Выполняется локальное восстановление.'}
          </p>
        </div>
      ) : null}

      {operation ? (
        <p className="state-callout" role="status">
          <strong>
            {operation.kind === 'REPAIR' ? 'Ремонт' : 'Спасение'} выполняется
          </strong>
          <span>Осталось {Math.ceil(operation.remainingGameMinutes)} мин.</span>
        </p>
      ) : null}

      {availability?.canEditCargo ? (
        <fieldset className="cargo-editor">
          <legend>
            Смешанный груз · {formatGameQuantity(draftTotal)}/
            {formatGameQuantity(rover.cargoCapacity)}
          </legend>
          {(['oxygen', 'food', 'equipment'] as const).map((resource) => (
            <label key={resource}>
              <span>
                {resource === 'oxygen'
                  ? 'Кислород'
                  : resource === 'food'
                    ? 'Пайки'
                    : 'Оборудование'}
              </span>
              <input
                type="number"
                min={0}
                max={rover.cargoCapacity}
                step={1}
                value={draft[resource]}
                onChange={(event) => editCargo(resource, event.target.value)}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={() => state.applyCargo(rover.id)}
            disabled={draftTotal > rover.cargoCapacity}
          >
            Применить груз
          </button>
        </fieldset>
      ) : (
        <dl className="metric-list metric-list--compact">
          <div>
            <dt>Кислород</dt>
            <dd>{formatGameQuantity(rover.cargo.oxygen)}</dd>
          </div>
          <div>
            <dt>Пайки</dt>
            <dd>{formatGameQuantity(rover.cargo.food)}</dd>
          </div>
          <div>
            <dt>Оборудование</dt>
            <dd>{formatGameQuantity(rover.cargo.equipment)}</dd>
          </div>
        </dl>
      )}

      {rover.route ? (
        <section className="rover-route-plan" aria-label="Активный маршрут">
          <div>
            <p className="panel-kicker">Активный маршрут</p>
            <strong>{rover.route.steps.length} клеток</strong>
          </div>
          <dl>
            <div>
              <dt>Текущий участок</dt>
              <dd>
                {rover.movement
                  ? formatPercent(rover.movement.progress * 100)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Плановое время</dt>
              <dd>
                {formatGameMinuteCountdown(rover.route.forecast.gameMinutes)}
              </dd>
            </div>
            <div>
              <dt>Заряд на финише</dt>
              <dd>
                {formatPercent(
                  (rover.route.forecast.batteryRemaining /
                    rover.batteryCapacity) *
                    100,
                )}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="selected-panel__actions">
        {availability?.canAssignRoute ? (
          <p className="rover-route-hint">
            <span aria-hidden="true">ПКМ</span>
            {rover.route
              ? 'Укажите новую точку на карте — маршрут перестроится без остановки.'
              : 'Укажите точку на карте — ровер начнёт движение сразу.'}
          </p>
        ) : null}
        {availability?.canCharge ? (
          <button
            type="button"
            onClick={() =>
              state.sendCommand({ type: 'CHARGE_ROVER', roverId: rover.id })
            }
          >
            Зарядить
          </button>
        ) : null}
        {unloadCenter ? (
          <button
            type="button"
            onClick={() =>
              state.sendCommand({
                type: 'UNLOAD_ROVER_CARGO',
                roverId: rover.id,
                centerId: unloadCenter.id,
              })
            }
          >
            Разгрузить в {unloadCenter.name}
          </button>
        ) : null}
        {availability?.repairCommands.map((command) => (
          <button
            type="button"
            key={`repair-${command.repairRoverId}-${command.targetRoverId}`}
            onClick={() => state.sendCommand(command)}
          >
            {command.repairRoverId === rover.id
              ? `Ремонтировать ${roverName(command.targetRoverId)}`
              : `Начать ремонт: ${roverName(command.repairRoverId)}`}
          </button>
        ))}
        {availability?.rescueCommands.map((command) => (
          <button
            type="button"
            key={`rescue-${command.rescuerRoverId}-${command.targetRoverId}`}
            onClick={() => state.sendCommand(command)}
          >
            {command.rescuerRoverId === rover.id
              ? `Спасти ${roverName(command.targetRoverId)}`
              : `Начать спасение: ${roverName(command.rescuerRoverId)}`}
          </button>
        ))}
        {availability?.batteryTransferPairs.map((pair) => (
          <button
            type="button"
            key={`battery-${pair.donorRoverId}-${pair.repairRoverId}`}
            onClick={() =>
              state.openBatteryTransfer(pair.donorRoverId, pair.repairRoverId)
            }
          >
            {pair.donorRoverId === rover.id
              ? `Передать батарею ${roverName(pair.repairRoverId)}`
              : `Передать батарею: ${roverName(pair.donorRoverId)}`}
          </button>
        ))}
      </div>
    </div>
  );
}
