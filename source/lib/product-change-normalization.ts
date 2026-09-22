export function semanticProductChangeValue(key: string, value: unknown): unknown {
  if (key === 'conditionNotes' || key === 'knownDefects') return value == null ? '' : String(value);
  return Array.isArray(value) ? value : value === '' ? null : value;
}

export function storedProductChangeValue(key: string, value: unknown): unknown {
  const semanticValue = semanticProductChangeValue(key, value);
  return Array.isArray(semanticValue)
    ? JSON.stringify(semanticValue)
    : typeof semanticValue === 'boolean'
      ? (semanticValue ? 1 : 0)
      : semanticValue;
}

export function productChangeHasDifference(key: string, previous: unknown, value: unknown): boolean {
  return JSON.stringify(previous) !== JSON.stringify(semanticProductChangeValue(key, value));
}
