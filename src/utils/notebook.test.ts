import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteExperiment, getExperiments, saveExperiment } from './notebook';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('local lab notebook', () => {
  it('removes legacy account ownership while preserving experiment data', () => {
    values.set('genelab-experiments', JSON.stringify([{
      id: 'EXP-LEGACY',
      title: 'Sequence analysis',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      ownerEmail: 'researcher@example.org',
      sequence: 'ATGC',
      notes: 'Keep this note',
      tags: ['DNA'],
      references: [{ kind: 'analysis', id: 'A1', label: 'Local result' }],
      dataPoints: [{ label: 'GC', value: '50%' }],
    }]));

    expect(getExperiments()).toMatchObject([{ id: 'EXP-LEGACY', sequence: 'ATGC', notes: 'Keep this note' }]);
    expect(JSON.parse(values.get('genelab-experiments') ?? '[]')[0]).not.toHaveProperty('ownerEmail');
  });

  it('creates and deletes experiments locally', () => {
    const experiment = saveExperiment({ title: 'Local test', notes: '', tags: [], references: [], dataPoints: [] });

    expect(getExperiments()).toContainEqual(expect.objectContaining({ id: experiment.id, title: 'Local test' }));
    deleteExperiment(experiment.id);
    expect(getExperiments()).toEqual([]);
  });
});