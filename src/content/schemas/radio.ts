import { z } from 'zod';

import { hasUnexpectedRadioPlaceholder, RADIO_EVENT_CODES } from '../../domain';
import { schemaVersionSchema } from './common';

const radioCategorySchema = z.enum([
  'INFO',
  'WARNING',
  'CRITICAL',
  'EVENT',
  'RESCUE',
  'SYSTEM',
]);
const radioPrioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
const radioTemplateSchema = z
  .string()
  .min(1)
  .max(180)
  .refine((value) => value.trim().length > 0, 'Template не должен быть пустым');
const radioDefinitionSchema = z
  .object({
    category: radioCategorySchema,
    priority: radioPrioritySchema,
    templates: z.array(radioTemplateSchema).min(1),
  })
  .strict();
const radioEventCodeSchema = z.enum(RADIO_EVENT_CODES);

const radioMessagesSchema = z
  .record(radioEventCodeSchema, radioDefinitionSchema)
  .superRefine((messages, context) => {
    for (const eventCode of RADIO_EVENT_CODES) {
      messages[eventCode]?.templates.forEach((template, templateIndex) => {
        if (!hasUnexpectedRadioPlaceholder(eventCode, template)) return;
        context.addIssue({
          code: 'custom',
          path: [eventCode, 'templates', templateIndex],
          message: `Template ${eventCode} содержит недопустимый placeholder`,
        });
      });
    }
  });

export const radioContentSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    historyLimit: z.literal(100),
    messages: radioMessagesSchema,
  })
  .strict();

export type RadioContent = z.infer<typeof radioContentSchema>;
