import { formatRealClock } from '../components/formatters';
import type { LevelPresentation } from './LevelSelectScreen';

interface BriefingScreenProps {
  readonly level: LevelPresentation;
  readonly onBack: () => void;
  readonly onStart: () => void;
}

const RISK_LABELS: Readonly<Record<LevelPresentation['riskLevel'], string>> = {
  low: 'Низкий риск',
  medium: 'Средний риск',
  high: 'Высокий риск',
  extreme: 'Экстремальный риск',
  maximum: 'Максимальный риск',
};

function courierLabel(count: number): string {
  if (count === 2) return 'Два курьера';
  if (count === 3) return 'Три курьера';
  if (count === 4) return 'Четыре курьера';
  return `${count} курьеров`;
}

function centerLabel(count: number): string {
  if (count === 1) return '1 центр';
  if (count === 2 || count === 3 || count === 4) return `${count} центра`;
  return `${count} центров`;
}

export function BriefingScreen({
  level,
  onBack,
  onStart,
}: BriefingScreenProps) {
  return (
    <section className="preflight-screen" aria-labelledby="briefing-title">
      <header className="brand-bar">
        <div className="brand-mark" aria-hidden="true">
          ◐
        </div>
        <div>
          <p className="eyebrow">{level.title}</p>
          <h1 id="briefing-title">Брифинг миссии</h1>
        </div>
        <p className="brand-bar__status">
          Смена {formatRealClock(level.shiftDurationRealSeconds * 1_000)}
        </p>
      </header>

      <div className="briefing-layout">
        <aside className="panel briefing-copy">
          <p className="panel-kicker">Оперативная сводка</p>
          <h2>{level.title}</h2>
          <p>{level.description}</p>
          <div className="briefing-alert">
            <span aria-hidden="true">△</span>
            <div>
              <strong>{RISK_LABELS[level.riskLevel]}</strong>
              <p>
                {centerLabel(level.riskChoiceCenterCount)} с выбором риска:
                короткий опасный или длинный безопасный путь.
              </p>
            </div>
          </div>
          <div className="mission-objective">
            <span aria-hidden="true">◎</span>
            <div>
              <small>Цель смены</small>
              <p>{level.objective}</p>
            </div>
          </div>
        </aside>

        <div className="briefing-map panel">
          <img src={level.previewAsset} alt={`Обзор района ${level.title}`} />
          <div className="briefing-map__grid" aria-hidden="true" />
          <span className="briefing-map__marker briefing-map__marker--base">
            База
          </span>
          <span className="briefing-map__marker briefing-map__marker--centers">
            {centerLabel(level.centerCount)}
          </span>
        </div>

        <aside className="panel expedition-card">
          <p className="panel-kicker">Состав экспедиции</p>
          <h2>{level.roverCount} ровера</h2>
          <ul className="briefing-list">
            <li>
              <span aria-hidden="true">◆</span>
              <div>
                <strong>{courierLabel(level.courierCount)}</strong>
                <small>Смешанный груз и ручные маршруты</small>
              </div>
            </li>
            <li>
              <span aria-hidden="true">✦</span>
              <div>
                <strong>Ремонтный ровер</strong>
                <small>Ремонт, спасение и приём батареи</small>
              </div>
            </li>
            <li>
              <span aria-hidden="true">▤</span>
              <div>
                <strong>{centerLabel(level.centerCount)}</strong>
                <small>Кислород, пайки и оборудование</small>
              </div>
            </li>
          </ul>
          <div className="briefing-actions">
            <button className="button" type="button" onClick={onBack}>
              Назад
            </button>
            <button
              className="button button--primary"
              type="button"
              onClick={onStart}
            >
              Начать смену
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
