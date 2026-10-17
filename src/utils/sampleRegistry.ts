import type { Sample, SampleHistoryEntry, SampleRegistry, SampleRegistryImportPreview, SampleStatus } from '../models/sample';
import type { SampleAnalysisMetadata } from '../models/sample';
import { parseDelimitedRows, serializeDelimitedRows } from './csv';

export const SAMPLE_REGISTRY_SCHEMA_VERSION = 1 as const;
export const MAX_SAMPLE_CUSTOM_FIELDS = 20;
export const MAX_SAMPLE_REGISTRY_BYTES = 2 * 1024 * 1024;
const storageKey = 'genelab-sample-registry-v1';

export type SampleRegistryErrorCode = 'unavailable' | 'corrupt' | 'too-large' | 'duplicate-id' | 'invalid-sample' | 'not-found';
export class SampleRegistryError extends Error {
  constructor(readonly code: SampleRegistryErrorCode) { super(code); this.name = 'SampleRegistryError'; }
}

const emptyRegistry = (): SampleRegistry => ({ schemaVersion: SAMPLE_REGISTRY_SCHEMA_VERSION, samples: [], issuedIds: [] });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const now = (): string => new Date().toISOString();
const newId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const normalizedId = (value: string): string => value.trim();
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validStatus = (value: unknown): value is SampleStatus => ['active', 'consumed', 'discarded'].includes(String(value));
const sampleTypes = ['tissue', 'blood', 'cell-line', 'plasmid', 'dna-extract', 'rna-extract', 'protein-extract', 'other'];

const isSample = (value: unknown): value is Sample => {
  if (!isObject(value)) return false;
  return typeof value.internalId === 'string' && Boolean(value.internalId.trim())
    && typeof value.organism === 'string' && sampleTypes.includes(String(value.sampleType))
    && validStatus(value.status) && typeof value.humanDerived === 'boolean'
    && Array.isArray(value.customFields) && value.customFields.length <= MAX_SAMPLE_CUSTOM_FIELDS
    && value.customFields.every((field) => isObject(field) && typeof field.field === 'string' && typeof field.value === 'string')
    && Array.isArray(value.history) && value.history.every((entry) => isObject(entry) && typeof entry.id === 'string' && typeof entry.timestamp === 'string' && typeof entry.note === 'string')
    && isObject(value.storage) && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
};

const assertSample = (sample: Sample): void => {
  if (!isSample(sample)) throw new SampleRegistryError('invalid-sample');
};

const persist = (registry: SampleRegistry): void => {
  const serialized = JSON.stringify(registry);
  if (new TextEncoder().encode(serialized).byteLength > MAX_SAMPLE_REGISTRY_BYTES) throw new SampleRegistryError('too-large');
  try { localStorage.setItem(storageKey, serialized); } catch { throw new SampleRegistryError('unavailable'); }
};

export const getSampleRegistry = (): SampleRegistry => {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return emptyRegistry();
    const parsed: unknown = JSON.parse(stored);
    if (!isObject(parsed) || parsed.schemaVersion !== SAMPLE_REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.samples) || !Array.isArray(parsed.issuedIds) || !parsed.issuedIds.every((id) => typeof id === 'string')) throw new SampleRegistryError('corrupt');
    if (!parsed.samples.every(isSample) || !parsed.issuedIds.every((id) => typeof id === 'string')) throw new SampleRegistryError('corrupt');
    return clone(parsed as unknown as SampleRegistry);
  } catch (error) {
    if (error instanceof SampleRegistryError) throw error;
    throw new SampleRegistryError('unavailable');
  }
};

export const suggestSampleId = (): string => {
  const registry = getSampleRegistry();
  const used = new Set(registry.issuedIds.map((id) => id.toLocaleLowerCase()));
  let candidate = '';
  do { candidate = `SMP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
  while (used.has(candidate.toLocaleLowerCase()));
  return candidate;
};

const historyEntry = (action: SampleHistoryEntry['action'], note: string, details?: string, analysis?: SampleAnalysisMetadata): SampleHistoryEntry => ({ id: newId(), timestamp: now(), action, note: note.trim(), details, analysis });

export const createSample = (input: Omit<Sample, 'history' | 'createdAt' | 'updatedAt'>, note: string): Sample => {
  const registry = getSampleRegistry();
  const internalId = normalizedId(input.internalId);
  if (!internalId || registry.issuedIds.some((id) => id.toLocaleLowerCase() === internalId.toLocaleLowerCase())) throw new SampleRegistryError('duplicate-id');
  if (input.customFields.length > MAX_SAMPLE_CUSTOM_FIELDS) throw new SampleRegistryError('invalid-sample');
  const timestamp = now();
  const sample: Sample = {
    ...clone(input), internalId, customFields: input.customFields.slice(0, MAX_SAMPLE_CUSTOM_FIELDS),
    createdAt: timestamp, updatedAt: timestamp, history: [historyEntry('created', note || 'Sample registered')],
  };
  assertSample(sample);
  registry.samples.push(sample);
  registry.issuedIds.push(internalId);
  persist(registry);
  return clone(sample);
};

export const updateSample = (currentId: string, changes: Partial<Omit<Sample, 'history' | 'createdAt' | 'updatedAt'>>, note: string): Sample => {
  const registry = getSampleRegistry();
  const index = registry.samples.findIndex((sample) => sample.internalId === currentId);
  if (index < 0) throw new SampleRegistryError('not-found');
  const previous = registry.samples[index]!;
  const nextId = normalizedId(changes.internalId ?? previous.internalId);
  if (!nextId || (nextId.toLocaleLowerCase() !== currentId.toLocaleLowerCase() && registry.issuedIds.some((id) => id.toLocaleLowerCase() === nextId.toLocaleLowerCase()))) throw new SampleRegistryError('duplicate-id');
  if ((changes.customFields?.length ?? 0) > MAX_SAMPLE_CUSTOM_FIELDS) throw new SampleRegistryError('invalid-sample');
  const updated: Sample = {
    ...previous,
    ...clone(changes),
    internalId: nextId,
    storage: { ...previous.storage, ...(changes.storage ?? {}) },
    customFields: (changes.customFields ?? previous.customFields).slice(0, MAX_SAMPLE_CUSTOM_FIELDS),
    history: [...previous.history, historyEntry(changes.status && changes.status !== previous.status ? 'status-changed' : 'edited', note, changes.status && changes.status !== previous.status ? `${previous.status} -> ${changes.status}` : undefined)],
    updatedAt: now(),
  };
  assertSample(updated);
  registry.samples[index] = updated;
  if (nextId.toLocaleLowerCase() !== currentId.toLocaleLowerCase()) registry.issuedIds.push(nextId);
  persist(registry);
  return clone(updated);
};

export const linkAnalysisToSample = (sampleId: string, analysis: SampleAnalysisMetadata, note: string): Sample => {
  const registry = getSampleRegistry();
  const index = registry.samples.findIndex((sample) => sample.internalId === sampleId);
  if (index < 0) throw new SampleRegistryError('not-found');
  const previous = registry.samples[index]!;
  const updated: Sample = {
    ...previous,
    history: [...previous.history, historyEntry('analysis-linked', note, analysis.toolName, { ...analysis, sampleId })],
    updatedAt: now(),
  };
  registry.samples[index] = updated;
  persist(registry);
  return clone(updated);
};

export const exportSampleRegistryJson = (): string => JSON.stringify(getSampleRegistry(), null, 2);

const csvHeaders = ['rowType', 'schemaVersion', 'issuedIds', 'internalId', 'organism', 'taxonomyId', 'sampleType', 'collectionDate', 'collectedBy', 'sourceLocation', 'storage', 'protocol', 'protocolId', 'quantity', 'quantityUnit', 'qualityNotes', 'status', 'humanDerived', 'customFields', 'history', 'createdAt', 'updatedAt'];
export const exportSampleRegistryCsv = (): string => {
  const registry = getSampleRegistry();
  const rows: Array<Array<string | number | boolean | null | undefined>> = [csvHeaders, ['registry', registry.schemaVersion, JSON.stringify(registry.issuedIds)]];
  registry.samples.forEach((sample) => rows.push([
    'sample', registry.schemaVersion, '', sample.internalId, sample.organism, sample.taxonomyId, sample.sampleType,
    sample.collectionDate, sample.collectedBy, sample.sourceLocation, JSON.stringify(sample.storage), sample.protocol,
    sample.protocolId, sample.quantity, sample.quantityUnit, sample.qualityNotes, sample.status, sample.humanDerived,
    JSON.stringify(sample.customFields), JSON.stringify(sample.history), sample.createdAt, sample.updatedAt,
  ]));
  return serializeDelimitedRows(rows);
};

const parseJsonCell = <T>(value: string | undefined, fallback: T): T => value ? JSON.parse(value) as T : fallback;
export const previewSampleRegistryImport = (input: string, format: 'json' | 'csv' = 'json'): SampleRegistryImportPreview => {
  let imported: SampleRegistry;
  if (format === 'json') {
    const parsed: unknown = JSON.parse(input);
    if (!isObject(parsed) || parsed.schemaVersion !== SAMPLE_REGISTRY_SCHEMA_VERSION || !Array.isArray(parsed.samples) || !Array.isArray(parsed.issuedIds)) throw new SampleRegistryError('corrupt');
    imported = parsed as unknown as SampleRegistry;
  } else {
    const rows = parseDelimitedRows(input, ',');
    const headers = rows[0] ?? [];
    const position = new Map(headers.map((header, index) => [header, index]));
    const cell = (row: string[], key: string): string | undefined => { const index = position.get(key); return index === undefined ? undefined : row[index]; };
    const records = rows.slice(1);
    const meta = records.find((row) => cell(row, 'rowType') === 'registry');
    if (!meta || cell(meta, 'schemaVersion') !== String(SAMPLE_REGISTRY_SCHEMA_VERSION)) throw new SampleRegistryError('corrupt');
    const samples: Sample[] = records.filter((row) => cell(row, 'rowType') === 'sample').map((row) => ({
      internalId: cell(row, 'internalId') ?? '', organism: cell(row, 'organism') ?? '', taxonomyId: cell(row, 'taxonomyId'),
      sampleType: cell(row, 'sampleType') as Sample['sampleType'], collectionDate: cell(row, 'collectionDate'), collectedBy: cell(row, 'collectedBy'),
      sourceLocation: cell(row, 'sourceLocation'), storage: parseJsonCell(cell(row, 'storage'), {}), protocol: cell(row, 'protocol'), protocolId: cell(row, 'protocolId'),
      quantity: cell(row, 'quantity') ? Number(cell(row, 'quantity')) : undefined, quantityUnit: cell(row, 'quantityUnit'), qualityNotes: cell(row, 'qualityNotes'),
      status: cell(row, 'status') as SampleStatus, humanDerived: cell(row, 'humanDerived') === 'true',
      customFields: parseJsonCell(cell(row, 'customFields'), []), history: parseJsonCell(cell(row, 'history'), []),
      createdAt: cell(row, 'createdAt') ?? '', updatedAt: cell(row, 'updatedAt') ?? '',
    }));
    const issuedIds: unknown = parseJsonCell(cell(meta, 'issuedIds'), []);
    if (!Array.isArray(issuedIds) || !issuedIds.every((id) => typeof id === 'string')) throw new SampleRegistryError('corrupt');
    imported = { schemaVersion: SAMPLE_REGISTRY_SCHEMA_VERSION, samples, issuedIds };
  }
  const invalidSamples: SampleRegistryImportPreview['invalidSamples'] = [];
  const validSamples: Sample[] = [];
  imported.samples.forEach((sample, index) => {
    if (!isSample(sample)) invalidSamples.push({ index, reason: 'invalid-sample' });
    else validSamples.push(sample);
  });
  const current = getSampleRegistry();
  const occupied = new Set([...current.issuedIds, ...current.samples.map((sample) => sample.internalId)].map((id) => id.toLocaleLowerCase()));
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  const incomingSamples = validSamples.filter((sample) => {
    const id = sample.internalId.toLocaleLowerCase();
    if (occupied.has(id) || seen.has(id)) { duplicateIds.push(sample.internalId); return false; }
    seen.add(id);
    return true;
  });
  return { registry: imported, incomingSamples: clone(incomingSamples), duplicateIds: [...new Set(duplicateIds)], invalidSamples };
};

export const mergeSampleRegistryImport = (preview: SampleRegistryImportPreview): Sample[] => {
  const registry = getSampleRegistry();
  const occupied = new Set(registry.issuedIds.map((id) => id.toLocaleLowerCase()));
  const accepted = preview.incomingSamples.filter((sample) => !occupied.has(sample.internalId.toLocaleLowerCase()));
  accepted.forEach((sample) => {
    assertSample(sample);
    registry.samples.push(clone(sample));
    registry.issuedIds.push(sample.internalId);
  });
  preview.registry.issuedIds.forEach((id) => { if (!registry.issuedIds.some((current) => current.toLocaleLowerCase() === id.toLocaleLowerCase())) registry.issuedIds.push(id); });
  persist(registry);
  return clone(accepted);
};