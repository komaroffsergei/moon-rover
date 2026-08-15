import type { RadioCategory, RadioMessage } from '../../domain';

interface RadioPanelProps {
  readonly messages: readonly RadioMessage[];
  readonly sourceNames: Readonly<Record<string, string>>;
  readonly onCollapse: () => void;
}

const CATEGORY_LABELS: Readonly<Record<RadioCategory, string>> = {
  INFO: 'Инфо',
  WARNING: 'Внимание',
  CRITICAL: 'Критично',
  EVENT: 'Событие',
  RESCUE: 'Спасение',
  SYSTEM: 'Система',
};

export function RadioPanel({
  messages,
  sourceNames,
  onCollapse,
}: RadioPanelProps) {
  return (
    <section className="radio-panel" aria-labelledby="radio-title">
      <header className="radio-panel__header">
        <div>
          <p className="panel-kicker">Канал 04</p>
          <h2 id="radio-title">Рация</h2>
        </div>
        <button
          className="text-button"
          type="button"
          aria-label="Свернуть рацию"
          onClick={onCollapse}
        >
          Свернуть
        </button>
      </header>
      <ol
        id="radio-journal"
        className="radio-list"
        aria-label="Журнал сообщений"
        aria-live="polite"
      >
        {messages.length > 0 ? (
          messages.map((message) => (
            <li
              className={`radio-message radio-message--${message.category.toLowerCase()}`}
              key={message.id}
            >
              <span className="radio-message__meta">
                {CATEGORY_LABELS[message.category]}
                {message.objectId !== null && sourceNames[message.objectId]
                  ? ` · ${sourceNames[message.objectId]}`
                  : ''}{' '}
                · T+
                {Math.floor(message.gameMinute)}
              </span>
              <p>{message.text}</p>
            </li>
          ))
        ) : (
          <li className="radio-message radio-message--empty">
            Канал свободен. Новых сообщений нет.
          </li>
        )}
      </ol>
    </section>
  );
}
