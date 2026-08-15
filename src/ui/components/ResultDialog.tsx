import type { GameSnapshot } from '../../domain';
import { formatRealClock } from './formatters';
import { Modal } from './Modal';

interface ResultDialogProps {
  readonly snapshot: GameSnapshot;
  readonly onReplay: () => void;
  readonly onLevelSelect: () => void;
}

export function ResultDialog({
  snapshot,
  onReplay,
  onLevelSelect,
}: ResultDialogProps) {
  const victory = snapshot.phase === 'VICTORY';
  const lostCenters = snapshot.centers.filter(
    ({ status }) => status === 'LOST',
  );
  const recentMessages = snapshot.radioMessages.slice(0, 5);

  return (
    <Modal
      title={victory ? 'Смена завершена' : 'Миссия потеряна'}
      tone={victory ? 'success' : 'danger'}
      footer={
        <>
          <button type="button" onClick={onLevelSelect}>
            Выбор карты
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={onReplay}
          >
            Повторить
          </button>
        </>
      }
    >
      <p className="result-dialog__lead">
        {victory
          ? 'Все действующие центры пережили рабочую смену.'
          : lostCenters.length > 0
            ? `Потерян центр: ${lostCenters.map(({ name }) => name).join(', ')}.`
            : 'Критическое условие миссии не выполнено.'}
      </p>
      <dl className="metric-list">
        <div>
          <dt>Время</dt>
          <dd>{formatRealClock(snapshot.elapsedRealMilliseconds)}</dd>
        </div>
        <div>
          <dt>Центры</dt>
          <dd>
            {snapshot.centers.length - lostCenters.length}/
            {snapshot.centers.length}
          </dd>
        </div>
        <div>
          <dt>Сообщения</dt>
          <dd>{snapshot.radioMessages.length}</dd>
        </div>
      </dl>
      {!victory && recentMessages.length > 0 ? (
        <div className="result-dialog__events">
          <h3>Последние события</h3>
          <ol>
            {recentMessages.map((message) => (
              <li key={message.id}>{message.text}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </Modal>
  );
}
