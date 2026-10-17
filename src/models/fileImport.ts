import type { SampleAnalysisMetadata } from './sample';

export type ImportedFileFormat = 'fastq' | 'vcf' | 'qpcr' | 'table';

export interface NumericSeries {
  label: string;
  unit: string;
  values: number[];
  categories?: string[];
}

export interface FileImportBase {
  id: string;
  format: ImportedFileFormat;
  fileName: string;
  fileSize: number;
  sampleId: string;
  metadata: SampleAnalysisMetadata;
  series: NumericSeries[];
}

export interface FastqImportResult extends FileImportBase {
  format: 'fastq';
  readCount: number;
  totalBases: number;
  minReadLength: number;
  meanReadLength: number;
  maxReadLength: number;
  gcPercent?: number;
  phredEncoding: 'phred33' | 'phred64' | 'undetermined';
  meanQuality?: number;
  fractionQ20?: number;
  fractionQ30?: number;
  readsWithN: number;
  meanQualityPerPosition?: number[];
  qualityReadCount?: number;
  positionStatsReadCount: number;
  firstRead?: { header: string; sequence: string };
}

export interface VcfInfoDefinition { id: string; number?: string; type?: string; description?: string; }
export interface VcfFormatDefinition { id: string; number?: string; type?: string; description?: string; }
export interface VcfVariantRecord {
  lineNumber: number;
  chromosome: string;
  position: number;
  id: string;
  reference: string;
  alternate: string[];
  quality: string;
  filter: string;
  info: Record<string, string | true>;
  genotypes: Array<{ sample: string; value: string }>;
}

export interface VcfImportResult extends FileImportBase {
  format: 'vcf';
  fileformat?: string;
  reference?: string;
  assembly?: string;
  contigs: Array<{ id: string; length?: number; fields: Record<string, string> }>;
  infoDefinitions: VcfInfoDefinition[];
  formatDefinitions: VcfFormatDefinition[];
  sampleNames: string[];
  variants: VcfVariantRecord[];
  variantTotal?: number;
  filteredVariantCount?: number;
  pageIndex?: number;
  pageCount?: number;
  pageSize?: number;
  selectedInfoFields?: string[];
  variantCounts: { snv: number; insertion: number; deletion: number; other: number };
  filterCounts: Record<string, number>;
  transitions: number;
  transversions: number;
  tsTvRatio?: number;
  assemblyDeclared: boolean;
}

export interface QpcrColumnMapping {
  sample: string;
  target: string;
  ct: string;
  well?: string;
  replicate?: string;
  plate?: string;
}

export interface QpcrAggregate {
  sample: string;
  target: string;
  replicateCount: number;
  meanCt?: number;
  standardDeviation?: number;
  exceedsThreshold: boolean;
  deltaCt?: number;
  deltaDeltaCt?: number;
}

export interface QpcrImportResult extends FileImportBase {
  format: 'qpcr';
  headers: string[];
  rows: string[][];
  mapping: QpcrColumnMapping;
  missingCtCount: number;
  standardDeviationThreshold: number;
  referenceGene?: string;
  controlSample?: string;
  assumptions: string[];
  aggregates: QpcrAggregate[];
}

export interface TableImportResult extends FileImportBase {
  format: 'table';
  delimiter: ',' | '\t';
  headers: string[];
  rows: string[][];
}

export type FileImportResult = FastqImportResult | VcfImportResult | QpcrImportResult | TableImportResult;