/**
 * Resolve mock documents for GET /documents?vin=...
 * - Missing or invalid-length vin → returns default VIN's catalog (local curl without vin).
 * - Known 17-char VIN → that vehicle's documents only.
 * - Unknown 17-char VIN → empty (no documents for this vehicle).
 */
export function selectDocumentsForVin<T>(
  byVin: Record<string, T[]>,
  vinQuery: unknown,
  defaultVin: string,
): T[] {
  const raw = typeof vinQuery === "string" ? vinQuery.trim() : "";
  const vin = raw.length === 17 ? raw.toUpperCase() : "";

  if (!vin) {
    return [...(byVin[defaultVin] ?? [])];
  }

  const list = byVin[vin];
  return list ? [...list] : [];
}
