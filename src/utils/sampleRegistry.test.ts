import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import duplicateRegistryFixture from '../data/fixtures/sample-registry-duplicate.json';
import invalidRegistryFixture from '../data/fixtures/sample-registry-invalid.json';
import type { Sample } from '../models/sample';
import { createSample, exportSampleRegistryCsv, exportSampleRegistryJson, getSampleRegistry, linkAnalysisToSample, MAX_SAMPLE_CUSTOM_FIELDS, MAX_SAMPLE_REGISTRY_BYTES, mergeSampleRegistryImport, previewSampleRegistryImport, SampleRegistryError, updateSample } from './sampleRegistry';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;
const sampleInput = (internalId: string): Omit<Sample, 'history' | 'createdAt' | 'updatedAt'> => ({
  internalId, organism: 'Homo sapiens', taxonomyId: '9606', sampleType: 'dna-extract',
  storage: { temperature: '-80 C', location: 'Freezer A', box: 'B4', position: 'A1' },
  status: 'active', humanDerived: true, customFields: [{ field: 'batch', value: 'X1' }],
});

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('local sample registry', () => {
  it('appends creation, edit, status and linked-analysis events without mutating old history', () => {
    const created = createSample(sampleInput('SMP-001'), 'Collected');
    const edited = updateSample(created.internalId, { qualityNotes: 'Reviewed', status: 'consumed' }, 'Extraction complete');
    const metadata = { sampleId: edited.internalId, fileName: 'reads.fastq', fileSize: 42, fileChecksum: 'abc123', geneLabVersion: '0.1.0', toolName: 'FASTQ summary', parameters: { positionReadLimit: 100 }, importedAt: '2026-01-01T00:00:00.000Z' };
    linkAnalysisToSample(edited.internalId, metadata, 'FASTQ analysis linked');
    const history = getSampleRegistry().samples[0]?.history ?? [];
    expect(history.map((entry) => entry.action)).toEqual(['created', 'status-changed', 'analysis-linked']);
    expect(history[1]).toMatchObject({ note: 'Extraction complete', details: 'active -> consumed' });
    expect(history[2]?.analysis).toEqual(metadata);
    expect(created.history).toHaveLength(1);
  });

  it('never reuses an ID after it has been edited', () => {
    createSample(sampleInput('SMP-OLD'), 'Created');
    updateSample('SMP-OLD', { internalId: 'SMP-NEW' }, 'Corrected label');
    expect(() => createSample(sampleInput('SMP-OLD'), 'Try reuse')).toThrowError(SampleRegistryError);
    expect(getSampleRegistry().issuedIds).toEqual(['SMP-OLD', 'SMP-NEW']);
  });

  it('previews duplicate IDs and merges only new samples without overwriting', () => {
    const current = createSample(sampleInput('SMP-EXISTING'), 'Existing');
    const preview = previewSampleRegistryImport(JSON.stringify(duplicateRegistryFixture));
    expect(preview.duplicateIds).toEqual(['SMP-EXISTING']);
    expect(preview.incomingSamples.map((sample) => sample.internalId)).toEqual(['SMP-NEW']);
    expect(mergeSampleRegistryImport(preview).map((sample) => sample.internalId)).toEqual(['SMP-NEW']);
    expect(getSampleRegistry().samples.find((sample) => sample.internalId === 'SMP-EXISTING')?.history).toEqual(current.history);
    expect(getSampleRegistry().issuedIds).toContain('SMP-NEW');
  });

  it('previews valid records while reporting invalid rows for review', () => {
    const preview = previewSampleRegistryImport(JSON.stringify(invalidRegistryFixture));
    expect(preview.incomingSamples.map((sample) => sample.internalId)).toEqual(['SMP-VALID']);
    expect(preview.invalidSamples).toEqual([{ index: 1, reason: 'invalid-sample' }]);
  });

  it('round-trips a schema-versioned CSV including custom data and history', () => {
    createSample(sampleInput('SMP-CSV'), 'Local fixture');
    const csv = exportSampleRegistryCsv();
    values.clear();
    const preview = previewSampleRegistryImport(csv, 'csv');
    expect(preview.incomingSamples[0]).toMatchObject({ internalId: 'SMP-CSV', customFields: [{ field: 'batch', value: 'X1' }], history: [{ note: 'Local fixture' }] });
  });

  it('rejects too many custom fields and does not persist past the configured size cap', () => {
    const fields = Array.from({ length: MAX_SAMPLE_CUSTOM_FIELDS + 1 }, (_, index) => ({ field: `f${index}`, value: 'v' }));
    expect(() => createSample({ ...sampleInput('SMP-FIELDS'), customFields: fields }, 'Too many')).toThrowError(SampleRegistryError);
  });

  it('rejects a registry write that exceeds the 2 MiB application limit', () => {
    expect(() => createSample({ ...sampleInput('SMP-LARGE'), customFields: [{ field: 'payload', value: 'x'.repeat(MAX_SAMPLE_REGISTRY_BYTES) }] }, 'Too large')).toThrowError(expect.objectContaining({ code: 'too-large' }));
    expect(getSampleRegistry().samples).toEqual([]);
  });

  it('exports a JSON registry with an explicit schema version', () => {
    createSample(sampleInput('SMP-JSON'), 'Local');
    expect(JSON.parse(exportSampleRegistryJson())).toMatchObject({ schemaVersion: 1, issuedIds: ['SMP-JSON'] });
  });
});