import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BriefingScreen } from '../src/ui/screens/BriefingScreen';
import {
  LevelSelectScreen,
  type LevelPresentation,
} from '../src/ui/screens/LevelSelectScreen';

const level: LevelPresentation = {
  id: 'shackleton-rift',
  ordinal: 2,
  title: 'Разлом Шеклтона',
  description: 'Крупная зона перекрывает прямые подходы к двум центрам.',
  objective: 'Не допустить истощения центров',
  riskLevel: 'medium',
  riskChoiceCenterCount: 2,
  shiftDurationRealSeconds: 480,
  centerCount: 3,
  roverCount: 3,
  courierCount: 2,
  previewAsset: '/assets/maps/shackleton/background.webp',
};

const levels: readonly LevelPresentation[] = [
  {
    ...level,
    id: 'tycho-basin',
    ordinal: 1,
    title: 'Кратер Тихо',
    riskLevel: 'low',
    riskChoiceCenterCount: 1,
    centerCount: 2,
    roverCount: 3,
    previewAsset: '/assets/maps/tycho/background.webp',
  },
  level,
  {
    ...level,
    id: 'tranquility-sea',
    ordinal: 3,
    title: 'Море Спокойствия',
    riskLevel: 'high',
    riskChoiceCenterCount: 3,
    centerCount: 4,
    roverCount: 4,
    courierCount: 3,
    previewAsset: '/assets/maps/tranquility/background.webp',
  },
  {
    ...level,
    id: 'south-pole-relay',
    ordinal: 4,
    title: 'Южный полюс',
    riskLevel: 'extreme',
    riskChoiceCenterCount: 3,
    centerCount: 5,
    roverCount: 5,
    courierCount: 4,
    previewAsset: '/assets/maps/south-pole/background.webp',
  },
  {
    ...level,
    id: 'aitken-labyrinth',
    ordinal: 5,
    title: 'Лабиринт Эйткена',
    riskLevel: 'maximum',
    riskChoiceCenterCount: 3,
    centerCount: 6,
    roverCount: 6,
    courierCount: 5,
    previewAsset: '/assets/maps/aitken/background.webp',
  },
];

describe('dispatcher preflight screens', () => {
  it('renders a data-driven level selector without invented economy or chat', () => {
    const markup = renderToStaticMarkup(
      <LevelSelectScreen
        levels={levels}
        selectedLevelId={level.id}
        onSelect={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    expect(markup).toContain('<h1 id="level-select-title">Выбор уровня</h1>');
    expect(markup).toContain('Доступно 5 проверенных карт');
    expect(markup.match(/<button class="level-card/g)).toHaveLength(5);
    expect(markup).toContain('Кратер Тихо');
    expect(markup).toContain('Разлом Шеклтона');
    expect(markup).toContain('Море Спокойствия');
    expect(markup).toContain('Южный полюс');
    expect(markup).toContain('Лабиринт Эйткена');
    expect(markup).toContain('08:00');
    expect(markup).toContain('Центров</dt><dd>3');
    expect(markup.match(/<img /g)).toHaveLength(1);
    expect(markup).toContain(level.previewAsset);
    expect(markup).not.toContain('/assets/maps/tycho/background.webp');
    expect(markup).not.toMatch(/валют|склад|чат/i);
  });

  it('keeps briefing objective and expedition facts grounded in runtime data', () => {
    const markup = renderToStaticMarkup(
      <BriefingScreen level={level} onBack={vi.fn()} onStart={vi.fn()} />,
    );

    expect(markup).toContain('<h1 id="briefing-title">Брифинг миссии</h1>');
    expect(markup).toContain(level.objective);
    expect(markup).toContain('3 центра');
    expect(markup).toContain('Два курьера');
    expect(markup).toContain('2 центра с выбором риска');
    expect(markup).toContain('Начать смену');
    expect(markup).not.toContain('автоматический маршрут');
  });
});
