import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { RadioMessage } from '../src/domain';
import { RadioPanel } from '../src/ui/panels/RadioPanel';

function message(gameMinute: number): RadioMessage {
  return {
    id: `message-${gameMinute}`,
    eventCode: 'rover.arrived',
    category: 'INFO',
    priority: 1,
    text: `Событие ${gameMinute}`,
    objectId: 'rover-one',
    cell: { column: 1, row: 0 },
    sourceKind: 'ROVER',
    gameMinute,
  };
}

describe('RadioPanel', () => {
  it('shows the complete newest-first journal with an explicit collapse control', () => {
    const markup = renderToStaticMarkup(
      <RadioPanel
        messages={[5, 4, 3, 2, 1].map(message)}
        sourceNames={{ 'rover-one': 'Луноход-1' }}
        onCollapse={vi.fn()}
      />,
    );

    for (const gameMinute of [5, 4, 3, 2, 1]) {
      expect(markup).toContain(`Событие ${gameMinute}`);
    }
    expect(markup).toContain('Инфо · Луноход-1 · T+5');
    expect(markup).toContain('aria-label="Свернуть рацию"');
    expect(markup).toContain('aria-label="Журнал сообщений"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup.indexOf('Событие 5')).toBeLessThan(
      markup.indexOf('Событие 4'),
    );
  });

  it('keeps an explicit empty state in the open drawer', () => {
    const markup = renderToStaticMarkup(
      <RadioPanel messages={[]} sourceNames={{}} onCollapse={vi.fn()} />,
    );

    expect(markup).toContain('Канал свободен. Новых сообщений нет.');
  });
});
