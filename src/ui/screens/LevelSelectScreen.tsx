import { formatRealClock } from '../components/formatters';

export interface LevelPresentation {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly riskLevel: 'low' | 'medium' | 'high' | 'extreme' | 'maximum';
  readonly riskChoiceCenterCount: number;
  readonly shiftDurationRealSeconds: number;
  readonly centerCount: number;
  readonly roverCount: number;
  readonly courierCount: number;
  readonly previewAsset: string;
}

interface LevelSelectScreenProps {
  readonly levels: readonly LevelPresentation[];
  readonly selectedLevelId: string;
  readonly onSelect: (levelId: string) => void;
  readonly onContinue: () => void;
}

const RISK_LABELS: Readonly<Record<LevelPresentation['riskLevel'], string>> = {
  low: 'Низкая сложность',
  medium: 'Средняя сложность',
  high: 'Высокая сложность',
  extreme: 'Экстремальная сложность',
  maximum: 'Максимальная сложность',
};

function verifiedMapsLabel(count: number): string {
  const modulo100 = count % 100;
  const modulo10 = count % 10;
  const noun =
    modulo100 >= 11 && modulo100 <= 14
      ? 'карт'
      : modulo10 === 1
        ? 'карта'
        : modulo10 >= 2 && modulo10 <= 4
          ? 'карты'
          : 'карт';
  return `Доступно ${count} проверенных ${noun}`;
}

export function LevelSelectScreen({
  levels,
  selectedLevelId,
  onSelect,
  onContinue,
}: LevelSelectScreenProps) {
  const level = levels.find(({ id }) => id === selectedLevelId) ?? levels.at(0);
  if (level === undefined) {
    throw new Error('Каталог уровней не может быть пустым');
  }

  return (
    <section className="preflight-screen" aria-labelledby="level-select-title">
      <header className="brand-bar">
        <div className="brand-mark" aria-hidden="true">
          ◐
        </div>
        <div>
          <p className="eyebrow">Лунный курьер</p>
          <h1 id="level-select-title">Выбор уровня</h1>
        </div>
        <p className="brand-bar__status">{verifiedMapsLabel(levels.length)}</p>
      </header>

      <div className="level-select-layout">
        <aside className="panel level-catalog" aria-label="Карты">
          <p className="panel-kicker">Каталог экспедиций</p>
          <div className="level-card-list">
            {levels.map((candidate) => {
              const selected = candidate.id === level.id;
              return (
                <button
                  key={candidate.id}
                  className={`level-card${selected ? ' level-card--selected' : ''}`}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(candidate.id)}
                >
                  <span className="level-card__index">
                    {String(candidate.ordinal).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>{candidate.title}</strong>
                    <small>{RISK_LABELS[candidate.riskLevel]}</small>
                  </span>
                  {selected ? (
                    <span className="status-chip status-chip--warning">
                      Выбрана
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className="panel-note">
            Все карты прошли проверку связности, риска и фиксированный smoke.
          </p>
        </aside>

        <div className="level-preview panel">
          <img
            key={level.id}
            src={level.previewAsset}
            alt="Лунная поверхность уровня"
          />
          <div className="level-preview__overlay">
            <span className="map-coordinate">
              {String(level.ordinal).padStart(2, '0')} //{' '}
              {level.riskLevel.toUpperCase()}
            </span>
            <strong>{level.title}</strong>
          </div>
        </div>

        <aside className="panel mission-card" aria-label="Параметры уровня">
          <p className="panel-kicker">Брифинг миссии</p>
          <h2>{level.title}</h2>
          <p>{level.description}</p>
          <dl className="metric-list">
            <div>
              <dt>Длительность</dt>
              <dd>{formatRealClock(level.shiftDurationRealSeconds * 1_000)}</dd>
            </div>
            <div>
              <dt>Центров</dt>
              <dd>{level.centerCount}</dd>
            </div>
            <div>
              <dt>Роверов</dt>
              <dd>{level.roverCount}</dd>
            </div>
          </dl>
          <div className="mission-objective">
            <span aria-hidden="true">◎</span>
            <div>
              <small>Главная цель</small>
              <p>{level.objective}</p>
            </div>
          </div>
          <button
            className="button button--primary"
            type="button"
            onClick={onContinue}
          >
            Продолжить к брифингу
          </button>
        </aside>
      </div>
    </section>
  );
}
