import type { SequenceAnalysis, SequenceComparison } from './sequence';

export interface ExperimentRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sequence?: string;
  comparisonSequence?: string;
  analysis?: SequenceAnalysis;
  comparison?: SequenceComparison;
  notes: string;
  tags: string[];
  references: NotebookReference[];
  dataPoints: NotebookDataPoint[];
}

export interface NotebookDataPoint {
  label: string;
  value: string;
}

export interface NotebookReference {
  kind: 'gene' | 'variant' | 'publication' | 'analysis';
  id: string;
  label: string;
  url?: string;
  data?: unknown;
}

const storageKey = 'genelab-experiments';

const readExperiments = (): ExperimentRecord[] => {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(value)) return [];
    const experiments = value.map((item) => {
      const { ownerEmail: _ownerEmail, ...experiment } = item as ExperimentRecord & { ownerEmail?: string };
      return normalizeExperiment(experiment);
    });
    if (value.some((item) => typeof item === 'object' && item !== null && 'ownerEmail' in item)) writeExperiments(experiments);
    return experiments;
  } catch {
    return [];
  }
};

const writeExperiments = (experiments: ExperimentRecord[]): void => localStorage.setItem(storageKey, JSON.stringify(experiments));
const normalizeExperiment = (experiment: ExperimentRecord): ExperimentRecord => ({ ...experiment, tags: experiment.tags ?? [], references: experiment.references ?? [], dataPoints: experiment.dataPoints ?? [] });

export const getExperiments = (): ExperimentRecord[] => readExperiments().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const saveExperiment = (experiment: Omit<ExperimentRecord, 'id' | 'createdAt' | 'updatedAt'>): ExperimentRecord => {
  const now = new Date().toISOString();
  const record: ExperimentRecord = { ...experiment, references: experiment.references ?? [], dataPoints: (experiment.dataPoints ?? []).slice(0, 20), id: `EXP-${Date.now().toString(36).toUpperCase()}`, createdAt: now, updatedAt: now };
  writeExperiments([record, ...readExperiments()]);
  return record;
};

export const deleteExperiment = (id: string): void => writeExperiments(readExperiments().filter((experiment) => experiment.id !== id));
