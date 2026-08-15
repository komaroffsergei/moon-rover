import { z } from 'zod';

export const schemaVersionSchema = z.literal(1);

export const kebabCaseIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'ID должен быть в kebab-case');

export function addUniqueIdCheck(
  values: ReadonlyArray<{ id: string }>,
  context: z.core.$RefinementCtx,
): void {
  const firstIndexById = new Map<string, number>();

  values.forEach(({ id }, index) => {
    const firstIndex = firstIndexById.get(id);
    if (firstIndex === undefined) {
      firstIndexById.set(id, index);
      return;
    }

    context.addIssue({
      code: 'custom',
      message: `ID ${id} уже используется в элементе ${firstIndex}`,
      path: [index, 'id'],
    });
  });
}
