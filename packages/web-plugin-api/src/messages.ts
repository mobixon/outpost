/** Nested translation messages. */
export interface LocaleMessages {
  [key: string]: string | LocaleMessages;
}

/**
 * Keys present in `reference` but missing (or of a different shape) in `candidate`, as dotted
 * paths such as `about.title`. Handy in tests that keep translations complete.
 */
export function findMissingMessageKeys(
  reference: LocaleMessages,
  candidate: LocaleMessages,
  prefix = '',
): string[] {
  const missing: string[] = [];
  for (const [key, value] of Object.entries(reference)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const other = candidate[key];
    if (typeof value === 'string') {
      if (typeof other !== 'string') missing.push(path);
    } else if (other === undefined || typeof other === 'string') {
      missing.push(path);
    } else {
      missing.push(...findMissingMessageKeys(value, other, path));
    }
  }
  return missing;
}
