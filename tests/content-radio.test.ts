import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ContentValidationError,
  loadRadioContent,
  parseJsonText,
  type RadioContent,
} from '../src/content';
import { RADIO_EVENT_CODES } from '../src/simulation';

async function readRadioExample(): Promise<unknown> {
  const path = resolve('contracts/examples/radio.ru.json');
  return parseJsonText(await readFile(path, 'utf8'), path);
}

describe('radio content contract', () => {
  it('loads every required eventCode with category, priority and bounded templates', async () => {
    const content = loadRadioContent(await readRadioExample());

    expect(Object.keys(content.messages).sort()).toEqual(
      [...RADIO_EVENT_CODES].sort(),
    );
    expect(content.historyLimit).toBe(100);
    for (const definition of Object.values(content.messages)) {
      expect(definition.category).toMatch(
        /^(INFO|WARNING|CRITICAL|EVENT|RESCUE|SYSTEM)$/,
      );
      expect([0, 1, 2, 3]).toContain(definition.priority);
      expect(definition.templates.length).toBeGreaterThan(0);
      expect(
        definition.templates.every(
          (template) => template.length >= 1 && template.length <= 180,
        ),
      ).toBe(true);
    }
  });

  it('keeps the censored one-percent noise in JSON content', async () => {
    const content = loadRadioContent(await readRadioExample());

    expect(content.messages['oxygen.1'].templates.join(' ')).toContain(
      '[помехи]',
    );
    expect(content.messages['food.1'].templates.join(' ')).toContain(
      '[помехи]',
    );
  });

  it('keeps entity callouts concise and written from the speaker perspective', async () => {
    const content = loadRadioContent(await readRadioExample());
    const entityDefinitions = Object.entries(content.messages).filter(
      ([eventCode]) => !eventCode.startsWith('system.'),
    );

    expect(
      entityDefinitions.every(([, definition]) =>
        definition.templates.every((template) => template.length <= 96),
      ),
    ).toBe(true);
    expect(content.messages['center.request.oxygen'].templates[0]).toBe(
      'Нам нужен кислород: {amount} ед.',
    );
    expect(content.messages['incident.meteor.courier'].templates[0]).toBe(
      'В меня попал метеорит. Нужна ремонтная бригада.',
    );
    expect(content.messages['incident.meteor.repair'].templates[0]).toBe(
      'Метеорит повредил меня. Запускаю самовосстановление.',
    );
    expect(content.messages['rescue.repair.started'].templates[0]).toBe(
      'Начинаю ремонт курьера. Мне нужно 5 минут.',
    );
  });

  it.each([
    [
      'invalid history limit',
      (content: RadioContent) => {
        Object.assign(content, { historyLimit: 99 });
      },
    ],
    [
      'missing event code',
      (content: RadioContent) => {
        delete (content.messages as Partial<RadioContent['messages']>)[
          'food.50'
        ];
      },
    ],
    [
      'unknown event code',
      (content: RadioContent) => {
        Object.assign(content.messages, {
          'unknown.event': {
            category: 'INFO',
            priority: 1,
            templates: ['Лишний код.'],
          },
        });
      },
    ],
    [
      'invalid category',
      (content: RadioContent) => {
        Object.assign(content.messages['oxygen.50'], { category: 'CHAT' });
      },
    ],
    [
      'invalid priority',
      (content: RadioContent) => {
        Object.assign(content.messages['oxygen.50'], { priority: 4 });
      },
    ],
    [
      'oversized template',
      (content: RadioContent) => {
        content.messages['oxygen.50'].templates[0] = 'x'.repeat(181);
      },
    ],
    [
      'whitespace-only template',
      (content: RadioContent) => {
        content.messages['oxygen.50'].templates[0] = '   ';
      },
    ],
    [
      'empty templates',
      (content: RadioContent) => {
        content.messages['oxygen.50'].templates.length = 0;
      },
    ],
    [
      'extra definition field',
      (content: RadioContent) => {
        Object.assign(content.messages['oxygen.50'], { chatInput: true });
      },
    ],
    [
      'unknown placeholder',
      (content: RadioContent) => {
        content.messages['oxygen.50'].templates[0] = '{generatedText}';
      },
    ],
  ] as const)('rejects %s', async (_label, mutate) => {
    const valid = loadRadioContent(await readRadioExample());
    const invalid = structuredClone(valid);
    mutate(invalid);

    expect(() => loadRadioContent(invalid)).toThrowError(
      ContentValidationError,
    );
  });

  it('publishes metadata and the complete eventCode set in JSON Schema', async () => {
    const schema = parseJsonText(
      await readFile(resolve('contracts/radio.schema.json'), 'utf8'),
    );

    expect(schema).toMatchObject({
      required: ['schemaVersion', 'historyLimit', 'messages'],
      properties: {
        historyLimit: { const: 100 },
        messages: {
          additionalProperties: false,
          required: expect.arrayContaining([...RADIO_EVENT_CODES]),
          properties: {
            'oxygen.50': { $ref: '#/$defs/messageDefinition' },
            'equipment.demand': {
              $ref: '#/$defs/amountMessageDefinition',
            },
            'center.delivery.received': {
              $ref: '#/$defs/deliveryMessageDefinition',
            },
            'rescue.battery.transferred': {
              $ref: '#/$defs/chargeMessageDefinition',
            },
          },
        },
      },
      $defs: {
        messageDefinitionBase: {
          properties: {
            category: {
              enum: [
                'INFO',
                'WARNING',
                'CRITICAL',
                'EVENT',
                'RESCUE',
                'SYSTEM',
              ],
            },
            priority: { enum: [0, 1, 2, 3] },
            templates: {
              items: { type: 'string', minLength: 1, maxLength: 180 },
            },
          },
        },
        messageDefinition: {
          allOf: expect.arrayContaining([
            {
              properties: {
                templates: {
                  items: { not: { pattern: '[{}]' } },
                },
              },
            },
          ]),
        },
        amountMessageDefinition: {
          allOf: expect.arrayContaining([
            {
              properties: {
                templates: {
                  items: { pattern: '^(?:[^{}]|\\{amount\\})+$' },
                },
              },
            },
          ]),
        },
        chargeMessageDefinition: {
          allOf: expect.arrayContaining([
            {
              properties: {
                templates: {
                  items: { pattern: '^(?:[^{}]|\\{charge\\})+$' },
                },
              },
            },
          ]),
        },
        deliveryMessageDefinition: {
          allOf: expect.arrayContaining([
            {
              properties: {
                templates: {
                  items: {
                    pattern:
                      '^(?:[^{}]|\\{oxygen\\}|\\{food\\}|\\{equipment\\})+$',
                  },
                },
              },
            },
          ]),
        },
      },
    });
  });
});
