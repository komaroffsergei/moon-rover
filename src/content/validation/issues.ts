import type { z } from 'zod';

export interface ValidationIssue {
  code: string;
  path: string;
  message: string;
}

function appendPath(path: string, segment: PropertyKey): string {
  if (typeof segment === 'number') {
    return `${path}[${segment}]`;
  }

  const value = String(segment);
  return /^[A-Za-z_$][\w$]*$/.test(value)
    ? `${path}.${value}`
    : `${path}[${JSON.stringify(value)}]`;
}

export function formatJsonPath(segments: ReadonlyArray<PropertyKey>): string {
  return segments.reduce(appendPath, '$');
}

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: 'schema.invalid',
    path: formatJsonPath(issue.path),
    message: issue.message,
  }));
}

export class ContentValidationError extends Error {
  readonly issues: ValidationIssue[];
  readonly source: string;

  constructor(source: string, issues: ValidationIssue[]) {
    const details = issues
      .map(({ code, path, message }) => `[${code}] ${path}: ${message}`)
      .join('\n');
    super(`Контент ${source} не прошёл валидацию:\n${details}`);
    this.name = 'ContentValidationError';
    this.source = source;
    this.issues = issues;
  }
}
