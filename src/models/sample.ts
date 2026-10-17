export type SampleType = 'tissue' | 'blood' | 'cell-line' | 'plasmid' | 'dna-extract' | 'rna-extract' | 'protein-extract' | 'other';
export type SampleStatus = 'active' | 'consumed' | 'discarded';

export interface SampleCustomField {
  field: string;
  value: string;
}

export interface SampleStorageConditions {
  temperature?: string;
  location?: string;
  box?: string;
  position?: string;
}

export interface SampleHistoryEntry {
  id: string;
  timestamp: string;
  action: 'created' | 'edited' | 'status-changed' | 'analysis-linked';
  note: string;
  details?: string;
  analysis?: SampleAnalysisMetadata;
}

export interface SampleAnalysisMetadata {
  sampleId: string;
  fileName: string;
  fileSize: number;
  fileChecksum: string;
  geneLabVersion: string;
  toolName: string;
  parameters: Record<string, string | number | boolean | null>;
  importedAt: string;
}

export interface Sample {
  internalId: string;
  organism: string;
  taxonomyId?: string;
  sampleType: SampleType;
  collectionDate?: string;
  collectedBy?: string;
  sourceLocation?: string;
  storage: SampleStorageConditions;
  protocol?: string;
  protocolId?: string;
  quantity?: number;
  quantityUnit?: string;
  qualityNotes?: string;
  status: SampleStatus;
  humanDerived: boolean;
  customFields: SampleCustomField[];
  history: SampleHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SampleRegistry {
  schemaVersion: 1;
  samples: Sample[];
  issuedIds: string[];
}

export interface SampleRegistryImportPreview {
  registry: SampleRegistry;
  incomingSamples: Sample[];
  duplicateIds: string[];
  invalidSamples: Array<{ index: number; reason: string }>;
}