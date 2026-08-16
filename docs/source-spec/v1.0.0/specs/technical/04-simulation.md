# Чистая симуляция

```ts
interface SimulationEngine {
  getSnapshot(): GameSnapshot;
  dispatch(command: GameCommand): CommandResult;
  advance(realMilliseconds: number): readonly DomainEvent[];
}
```

- получает валидированный уровень, balance и seed;
- детерминирован;
- наружу выдаёт readonly snapshot;
- команда атомарна или возвращает типизированную ошибку;
- не читает Date.now, DOM и таймеры;
- задержки моделируются числовыми остатками времени.

## Порядок fixed step

1. уменьшить операции/задержки;
2. продвинуть роверы;
3. списать батарею при входе;
4. проверить событие клетки;
5. обработать прибытие/разгрузку;
6. уменьшить ресурсы центров;
7. применить equipment demand;
8. обновить пороги/recovery;
9. проверить поражение;
10. на конце смены проверить победу.
