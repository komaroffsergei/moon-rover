import { describe, expect, it } from 'vitest';

import {
  createSimulationEngine,
  RADIO_EVENT_CODES,
  type DomainEvent,
  type RadioCatalog,
  type RoverDefinition,
} from '../src/simulation';
import {
  createRadioJournal,
  type RadioJournal,
} from '../src/simulation/radio/createRadioJournal';
import {
  makeSimulationConfig,
  standardCenter,
  standardRover,
} from './fixtures/simulation';

function makeCatalog(): RadioCatalog {
  const messages = Object.fromEntries(
    RADIO_EVENT_CODES.map((eventCode) => [
      eventCode,
      {
        category: 'INFO' as const,
        priority: 1 as const,
        templates: [`Сообщение ${eventCode}.`],
      },
    ]),
  ) as unknown as RadioCatalog['messages'];
  messages['oxygen.10'] = {
    category: 'CRITICAL',
    priority: 3,
    templates: ['Кислород критически низок.'],
  };
  messages['equipment.demand'] = {
    category: 'EVENT',
    priority: 2,
    templates: ['Потеряно оборудования: {amount}.'],
  };
  messages['center.request.oxygen'] = {
    category: 'WARNING',
    priority: 1,
    templates: ['Нужен кислород: {amount}.'],
  };
  messages['center.request.food'] = {
    category: 'WARNING',
    priority: 1,
    templates: ['Нужны пайки: {amount}.'],
  };
  messages['center.request.equipment'] = {
    category: 'WARNING',
    priority: 1,
    templates: ['Нужно оборудование: {amount}.'],
  };
  messages['rescue.battery.transferred'] = {
    category: 'RESCUE',
    priority: 2,
    templates: ['Передано заряда: {charge}.'],
  };
  messages['center.delivery.received'] = {
    category: 'INFO',
    priority: 1,
    templates: [
      'Поставка: O₂ {oxygen}, пайки {food}, оборудование {equipment}.',
    ],
  };
  messages['incident.meteor.courier'].templates = [
    'Требуется ремонтная бригада.',
  ];
  messages['incident.meteor.repair'].templates = ['Начато самовосстановление.'];
  messages['incident.crater.courier'].templates = ['Требуется помощь рядом.'];
  messages['incident.crater.repair'].templates = [
    'Бригада освобождается самостоятельно.',
  ];
  return { historyLimit: 100, messages };
}

function ingestNew(journal: RadioJournal, events: readonly DomainEvent[]) {
  const previousIds = new Set(journal.getMessages().map(({ id }) => id));
  journal.ingest(events);
  return journal
    .getMessages()
    .filter(({ id }) => !previousIds.has(id))
    .reverse();
}

describe('radio event formatting', () => {
  it('publishes one actionable center request when the shift starts', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 84;
    center.food.initial = 91;
    center.equipmentInitial = 72;
    const engine = createSimulationEngine(
      makeSimulationConfig({ centers: [center], radioCatalog: makeCatalog() }),
    );

    const started = engine.dispatch({ type: 'START_SHIFT' });

    expect(started).toEqual({
      ok: true,
      events: [
        {
          type: 'CENTER_DELIVERY_REQUESTED',
          centerId: center.id,
          resource: 'equipment',
          amount: 28,
          cell: center.cell,
          gameMinute: 0,
        },
      ],
    });
    expect(engine.getSnapshot().radioMessages).toEqual([
      expect.objectContaining({
        eventCode: 'center.request.equipment',
        objectId: center.id,
        sourceKind: 'CENTER',
        text: 'Нужно оборудование: 28.',
      }),
    ]);
  });

  it('formats a fractional delivery and prefers it to generic arrival', () => {
    const delivery = {
      type: 'CARGO_DELIVERED',
      roverId: 'courier-one',
      centerId: 'center-one',
      delivered: { oxygen: 1.26, food: 2.04, equipment: 3 },
      gameMinute: 20,
      cell: { column: 2, row: 3 },
    } as unknown as DomainEvent;
    const arrival: DomainEvent = {
      type: 'ROVER_ARRIVED',
      roverId: 'courier-one',
      gameMinute: 20,
      cell: { column: 2, row: 3 },
    };
    const preferredFirst = createRadioJournal(makeCatalog());
    const fallbackFirst = createRadioJournal(makeCatalog());

    preferredFirst.ingest([delivery]);
    preferredFirst.ingest([arrival]);
    fallbackFirst.ingest([arrival]);
    fallbackFirst.ingest([delivery]);

    expect(preferredFirst.getMessages()).toEqual(fallbackFirst.getMessages());
    expect(preferredFirst.getMessages()).toEqual([
      expect.objectContaining({
        eventCode: 'center.delivery.received',
        objectId: 'center-one',
        sourceKind: 'CENTER',
        text: 'Поставка: O₂ 1, пайки 2, оборудование 3.',
      }),
    ]);
  });

  it('keeps distinct deliveries by one rover in the same game minute', () => {
    const journal = createRadioJournal(makeCatalog());
    const first: DomainEvent = {
      type: 'CARGO_DELIVERED',
      roverId: 'courier-one',
      centerId: 'center-one',
      delivered: { oxygen: 2, food: 0, equipment: 0 },
      gameMinute: 20,
      cell: { column: 2, row: 3 },
    };
    const second: DomainEvent = {
      ...first,
      centerId: 'center-two',
      delivered: { oxygen: 0, food: 3, equipment: 0 },
      cell: { column: 3, row: 3 },
    };

    journal.ingest([first, second]);

    expect(journal.getMessages()).toHaveLength(2);
    expect(journal.getMessages().map(({ objectId }) => objectId)).toEqual([
      'center-two',
      'center-one',
    ]);
  });

  it('maps the complete resource and recovery threshold matrices', () => {
    const journal = createRadioJournal(makeCatalog());
    const thresholds = [50, 25, 10, 5, 1] as const;
    const events: DomainEvent[] = [
      ...thresholds.flatMap((threshold, index) => [
        {
          type: 'RESOURCE_THRESHOLD' as const,
          centerId: 'center-one',
          resource: 'oxygen' as const,
          threshold,
          cell: { column: 2, row: 3 },
          gameMinute: index,
        },
        {
          type: 'RESOURCE_THRESHOLD' as const,
          centerId: 'center-one',
          resource: 'food' as const,
          threshold,
          cell: { column: 2, row: 3 },
          gameMinute: index,
        },
      ]),
      ...[30, 20, 10, 5, 1].map((remainingGameMinutes, index) => ({
        type: 'RECOVERY_THRESHOLD' as const,
        centerId: 'center-one',
        remainingGameMinutes,
        cell: { column: 2, row: 3 },
        gameMinute: 10 + index,
      })),
    ];

    expect(
      ingestNew(journal, events).map(({ eventCode }) => eventCode),
    ).toEqual([
      'oxygen.50',
      'food.50',
      'oxygen.25',
      'food.25',
      'oxygen.10',
      'food.10',
      'oxygen.5',
      'food.5',
      'oxygen.1',
      'food.1',
      'recovery.30',
      'recovery.20',
      'recovery.10',
      'recovery.5',
      'recovery.1',
    ]);
  });

  it('maps oxygen/food and recovery thresholds without duplicating recovery start', () => {
    const journal = createRadioJournal(makeCatalog());
    const thresholdEvents: DomainEvent[] = [
      {
        type: 'RESOURCE_THRESHOLD',
        centerId: 'center-one',
        resource: 'oxygen',
        threshold: 50,
        gameMinute: 10,
        cell: { column: 2, row: 3 },
      },
      {
        type: 'RESOURCE_THRESHOLD',
        centerId: 'center-one',
        resource: 'food',
        threshold: 1,
        gameMinute: 20,
        cell: { column: 2, row: 3 },
      },
      {
        type: 'CENTER_RECOVERY_STARTED',
        centerId: 'center-one',
        gameMinute: 30,
        cell: { column: 2, row: 3 },
      },
      {
        type: 'RECOVERY_THRESHOLD',
        centerId: 'center-one',
        remainingGameMinutes: 30,
        gameMinute: 30,
        cell: { column: 2, row: 3 },
      },
      {
        type: 'RECOVERY_THRESHOLD',
        centerId: 'center-one',
        remainingGameMinutes: 1,
        gameMinute: 59,
        cell: { column: 2, row: 3 },
      },
    ];

    expect(ingestNew(journal, thresholdEvents)).toHaveLength(4);
    expect(journal.getMessages().map(({ eventCode }) => eventCode)).toEqual([
      'recovery.1',
      'recovery.30',
      'food.1',
      'oxygen.50',
    ]);
    expect(journal.getMessages()[0]).toMatchObject({
      objectId: 'center-one',
      cell: { column: 2, row: 3 },
      sourceKind: 'CENTER',
    });
  });

  it('maps incidents, rescue operations and system outcomes to at most one message each', () => {
    const journal = createRadioJournal(makeCatalog());
    const events: DomainEvent[] = [
      {
        type: 'INCIDENT_STARTED',
        roverId: 'courier-one',
        roverKind: 'courier',
        incidentKind: 'dustStorm',
        gameMinute: 1,
        cell: { column: 4, row: 5 },
      },
      {
        type: 'INCIDENT_STARTED',
        roverId: 'repair-one',
        roverKind: 'repair',
        incidentKind: 'meteorite',
        gameMinute: 2,
        cell: { column: 4, row: 6 },
      },
      {
        type: 'INCIDENT_RESOLVED',
        roverId: 'repair-one',
        incidentKind: 'meteorite',
        gameMinute: 12,
        cell: { column: 4, row: 6 },
      },
      {
        type: 'EMERGENCY_OPERATION_STARTED',
        operationKind: 'REPAIR',
        helperRoverId: 'repair-one',
        targetRoverId: 'courier-one',
        durationGameMinutes: 5,
        gameMinute: 13,
        cell: { column: 4, row: 5 },
      },
      {
        type: 'EMERGENCY_OPERATION_COMPLETED',
        operationKind: 'RESCUE',
        helperRoverId: 'courier-one',
        targetRoverId: 'repair-one',
        gameMinute: 16,
        cell: { column: 4, row: 6 },
      },
      {
        type: 'SHIFT_ENDED',
        outcome: 'VICTORY',
        gameMinute: 480,
      },
    ];

    const added = ingestNew(journal, events);
    expect(added).toHaveLength(events.length);
    expect(added.map(({ eventCode }) => eventCode)).toEqual([
      'incident.dust.courier',
      'incident.meteor.repair',
      'incident.meteor.resolved',
      'rescue.repair.started',
      'rescue.crater.completed',
      'system.shift.victory',
    ]);
    expect(added[3]).toMatchObject({
      objectId: 'repair-one',
      cell: { column: 4, row: 5 },
      sourceKind: 'EMERGENCY',
    });
    expect(added[4]).toMatchObject({
      objectId: 'courier-one',
      cell: { column: 4, row: 6 },
      sourceKind: 'EMERGENCY',
    });
    expect(added[5]).toMatchObject({
      objectId: null,
      cell: null,
      sourceKind: 'SYSTEM',
    });
  });

  it('gives couriers an actionable call and repair units a truthful self-recovery message', () => {
    const journal = createRadioJournal(makeCatalog());
    const cell = { column: 4, row: 5 };

    const added = ingestNew(journal, [
      {
        type: 'INCIDENT_STARTED',
        roverId: 'courier-one',
        roverKind: 'courier',
        incidentKind: 'meteorite',
        cell,
        gameMinute: 1,
      },
      {
        type: 'INCIDENT_STARTED',
        roverId: 'repair-one',
        roverKind: 'repair',
        incidentKind: 'meteorite',
        cell,
        gameMinute: 2,
      },
      {
        type: 'INCIDENT_STARTED',
        roverId: 'courier-one',
        roverKind: 'courier',
        incidentKind: 'crater',
        cell,
        gameMinute: 3,
      },
      {
        type: 'INCIDENT_STARTED',
        roverId: 'repair-one',
        roverKind: 'repair',
        incidentKind: 'crater',
        cell,
        gameMinute: 4,
      },
    ]);

    expect(added.map(({ eventCode, text }) => [eventCode, text])).toEqual([
      ['incident.meteor.courier', 'Требуется ремонтная бригада.'],
      ['incident.meteor.repair', 'Начато самовосстановление.'],
      ['incident.crater.courier', 'Требуется помощь рядом.'],
      ['incident.crater.repair', 'Бригада освобождается самостоятельно.'],
    ]);
  });

  it('renders only declared placeholders from validated content', () => {
    const journal = createRadioJournal(makeCatalog());
    const added = ingestNew(journal, [
      {
        type: 'EQUIPMENT_DEMAND',
        centerId: 'center-one',
        amount: 27,
        gameMinute: 30,
        cell: { column: 2, row: 3 },
      },
      {
        type: 'BATTERY_TRANSFERRED',
        donorRoverId: 'courier-one',
        repairRoverId: 'repair-one',
        transferredCharge: 73.5,
        discardedCharge: 0,
        gameMinute: 31,
        cell: { column: 4, row: 6 },
      },
    ]);

    expect(added.map(({ text }) => text)).toEqual([
      'Потеряно оборудования: 27.',
      'Передано заряда: 73.5.',
    ]);
    expect(added[1]).toMatchObject({
      objectId: 'repair-one',
      cell: { column: 4, row: 6 },
      sourceKind: 'EMERGENCY',
      category: 'RESCUE',
      priority: 2,
    });
  });

  it('uses only the first template without runtime randomness', () => {
    const catalog = makeCatalog();
    catalog.messages['oxygen.50'].templates = [
      'Первый вариант.',
      'Второй вариант.',
    ];
    const journal = createRadioJournal(catalog);

    expect(
      ingestNew(journal, [
        {
          type: 'RESOURCE_THRESHOLD',
          centerId: 'center-one',
          resource: 'oxygen',
          threshold: 50,
          cell: { column: 2, row: 3 },
          gameMinute: 10,
        },
      ])[0]?.text,
    ).toBe('Первый вариант.');
  });

  it('suppresses incident and battery events already represented by rescue messages', () => {
    const journal = createRadioJournal(makeCatalog());

    expect(
      ingestNew(journal, [
        {
          type: 'EMERGENCY_OPERATION_COMPLETED',
          operationKind: 'REPAIR',
          helperRoverId: 'repair-one',
          targetRoverId: 'courier-one',
          cell: { column: 4, row: 5 },
          gameMinute: 20,
        },
        {
          type: 'INCIDENT_RESOLVED',
          roverId: 'courier-one',
          incidentKind: 'meteorite',
          cell: { column: 4, row: 5 },
          gameMinute: 20,
        },
      ]).map(({ eventCode }) => eventCode),
    ).toEqual(['rescue.repair.completed']);

    expect(
      ingestNew(journal, [
        {
          type: 'BATTERY_TRANSFERRED',
          donorRoverId: 'courier-one',
          repairRoverId: 'repair-one',
          transferredCharge: 50,
          discardedCharge: 0,
          cell: { column: 4, row: 6 },
          gameMinute: 21,
        },
        {
          type: 'ROVER_OUT_OF_BATTERY',
          roverId: 'courier-one',
          cell: { column: 4, row: 5 },
          gameMinute: 21,
        },
      ]).map(({ eventCode }) => eventCode),
    ).toEqual(['rescue.battery.transferred']);

    expect(
      ingestNew(journal, [
        {
          type: 'EMERGENCY_OPERATION_COMPLETED',
          operationKind: 'RESCUE',
          helperRoverId: 'courier-one',
          targetRoverId: 'repair-one',
          cell: { column: 4, row: 6 },
          gameMinute: 22,
        },
        {
          type: 'INCIDENT_RESOLVED',
          roverId: 'repair-one',
          incidentKind: 'meteorite',
          cell: { column: 4, row: 6 },
          gameMinute: 22,
        },
      ]).map(({ eventCode }) => eventCode),
    ).toEqual(['rescue.crater.completed', 'incident.meteor.resolved']);
  });
});

describe('bounded radio journal', () => {
  it('keeps correlated projection identical across ingest chunking and order', () => {
    const completed: DomainEvent = {
      type: 'EMERGENCY_OPERATION_COMPLETED',
      operationKind: 'REPAIR',
      helperRoverId: 'repair-one',
      targetRoverId: 'courier-one',
      cell: { column: 4, row: 5 },
      gameMinute: 20,
    };
    const resolved: DomainEvent = {
      type: 'INCIDENT_RESOLVED',
      roverId: 'courier-one',
      incidentKind: 'meteorite',
      cell: { column: 4, row: 5 },
      gameMinute: 20,
    };
    const preferredFirst = createRadioJournal(makeCatalog());
    const fallbackFirst = createRadioJournal(makeCatalog());

    preferredFirst.ingest([completed]);
    preferredFirst.ingest([resolved]);
    fallbackFirst.ingest([resolved]);
    fallbackFirst.ingest([completed]);

    expect(
      preferredFirst.getMessages().map(({ eventCode }) => eventCode),
    ).toEqual(['rescue.repair.completed']);
    expect(fallbackFirst.getMessages()).toEqual(preferredFirst.getMessages());
  });

  it.each([101, 0, -1, Number.NaN])(
    'rejects an unsafe public history limit %s',
    (historyLimit) => {
      const catalog = {
        ...makeCatalog(),
        historyLimit,
      } as unknown as RadioCatalog;

      expect(() => createRadioJournal(catalog)).toThrowError(RangeError);
    },
  );

  it('deduplicates the same event fingerprint but permits a later threshold episode', () => {
    const journal = createRadioJournal(makeCatalog());
    const first: DomainEvent = {
      type: 'RESOURCE_THRESHOLD',
      centerId: 'center-one',
      resource: 'oxygen',
      threshold: 10,
      gameMinute: 40,
      cell: { column: 2, row: 3 },
    };

    expect(ingestNew(journal, [first, structuredClone(first)])).toHaveLength(1);
    expect(ingestNew(journal, [{ ...first, gameMinute: 80 }])).toHaveLength(1);
    expect(journal.getMessages()).toHaveLength(2);
  });

  it('keeps the newest 100 messages and returns defensive snapshots', () => {
    const journal = createRadioJournal(makeCatalog());
    const events: DomainEvent[] = Array.from(
      { length: 101 },
      (_, gameMinute) => ({
        type: 'EQUIPMENT_DEMAND',
        centerId: 'center-one',
        amount: 20,
        gameMinute,
        cell: { column: 2, row: 3 },
      }),
    );

    journal.ingest(events);
    const external = journal.getMessages();
    expect(external).toHaveLength(100);
    expect(external[0]?.gameMinute).toBe(100);
    expect(external.at(-1)?.gameMinute).toBe(1);
    expect(Object.isFrozen(external[0])).toBe(true);
    (external as unknown[]).length = 0;
    expect(journal.getMessages()).toHaveLength(100);
  });
});

function repairRover(): RoverDefinition {
  return {
    ...structuredClone(standardRover),
    id: 'repair-unit',
    name: 'Ремонт-1',
    archetypeId: 'repair',
    kind: 'repair',
    initialCell: { column: 1, row: 0 },
    cargoCapacity: 0,
    batteryInitial: 0,
    initialCargo: { oxygen: 0, food: 0, equipment: 0 },
  };
}

function donorRover(): RoverDefinition {
  return {
    ...structuredClone(standardRover),
    id: 'donor',
    name: 'Донор',
    initialCell: { column: 1, row: 1 },
    batteryInitial: 70,
  };
}

describe('radio engine integration', () => {
  it('rejects undeclared placeholders even through direct engine config', () => {
    const config = makeSimulationConfig();
    config.radioCatalog = makeCatalog();
    config.radioCatalog.messages['oxygen.50'].templates = ['{generatedText}'];

    expect(() => createSimulationEngine(config)).toThrowError(RangeError);
  });

  it('records advance events in the public snapshot with source metadata', () => {
    const center = structuredClone(standardCenter);
    center.oxygen.initial = 50.01;
    center.oxygen.depletionGameMinutes = 180;
    const config = makeSimulationConfig({ centers: [center] });
    config.radioCatalog = makeCatalog();
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    engine.advance(100);
    expect(engine.getSnapshot().radioMessages[0]).toMatchObject({
      eventCode: 'oxygen.50',
      objectId: standardCenter.id,
      cell: standardCenter.cell,
      sourceKind: 'CENTER',
    });
  });

  it('records messages emitted by a confirmed command', () => {
    const config = makeSimulationConfig({
      rovers: [repairRover(), donorRover()],
    });
    config.radioCatalog = makeCatalog();
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });

    expect(
      engine.dispatch({
        type: 'CONFIRM_BATTERY_TRANSFER',
        donorRoverId: 'donor',
        repairRoverId: 'repair-unit',
      }).ok,
    ).toBe(true);
    expect(
      engine.getSnapshot().radioMessages.map(({ eventCode }) => eventCode),
    ).toEqual(['rescue.battery.transferred']);
    expect(engine.getSnapshot().radioMessages[0]).toMatchObject({
      text: 'Передано заряда: 70.',
      objectId: 'repair-unit',
      cell: { column: 1, row: 0 },
    });
  });

  it('keeps a rover event cell historical after the rover moves farther', () => {
    const center = structuredClone(standardCenter);
    center.cell = { column: 2, row: 0 };
    center.oxygen.depletionGameMinutes = 10_000;
    center.food.depletionGameMinutes = 10_000;
    const config = makeSimulationConfig({ centers: [center] });
    config.radioCatalog = makeCatalog();
    config.incidentRules.profiles[0]!.cellChance = 1;
    config.routingMap = {
      ...config.routingMap,
      cells: config.routingMap.cells.map((cell) => ({
        ...cell,
        effectiveCellChance: 1,
      })),
    };
    config.equipmentDemand.firstEligibleGameMinute = 10_000;
    const engine = createSimulationEngine(config);
    engine.dispatch({ type: 'START_SHIFT' });
    engine.dispatch({
      type: 'ASSIGN_ROVER_ROUTE',
      roverId: standardRover.id,
      steps: [
        { column: 1, row: 0 },
        { column: 2, row: 0 },
      ],
      goal: { kind: 'CENTER', centerId: center.id },
    });

    engine.advance(20_000);
    expect(
      engine
        .getSnapshot()
        .radioMessages.find(
          ({ eventCode }) => eventCode === 'incident.dust.courier',
        ),
    ).toMatchObject({ cell: { column: 1, row: 0 } });
    expect(engine.getSnapshot().rovers[0]).toMatchObject({
      cell: { column: 2, row: 0 },
    });
  });
});
