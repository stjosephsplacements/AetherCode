/** Form entries as name -> values, the shape a draft is stored in. Files are dropped. */
export function draftFields(entries: Iterable<[string, FormDataEntryValue]>): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const [name, value] of entries) {
    if (typeof value === "string") (fields[name] ??= []).push(value);
  }
  return fields;
}
