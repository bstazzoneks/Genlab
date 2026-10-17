export type EvidenceCategory =
  | 'primary-literature'
  | 'curated-database'
  | 'reference-database'
  | 'computational-prediction'
  | 'ai-explanation'
  | 'user-provided';

export interface ScientificSource {
  id: string;
  name: string;
  category: EvidenceCategory;
  identifier?: string;
  url?: string;
  dataUseUrl?: string;
  retrievedAt?: string;
  limitations?: string[];
}

export interface GenomicLocation {
  assembly: string;
  chromosome: string;
  start?: number;
  end?: number;
  strand?: '+' | '-';
}

export interface Transcript {
  id: string;
  geneId: string;
  source: ScientificSource;
  status?: string;
  name?: string;
}

export interface Gene {
  id: string;
  symbol: string;
  name: string;
  organism: string;
  chromosome?: string;
  location?: GenomicLocation;
  description?: string;
  geneType?: string;
  mapLocation?: string;
  recordStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  designations?: string[];
  genomicAccessions?: string[];
  aliases: string[];
  transcripts: Transcript[];
  proteins: Protein[];
  externalIdentifiers: Record<string, string>;
  sources: ScientificSource[];
}

export interface Variant {
  id: string;
  geneId: string;
  genomicChange?: string;
  location?: GenomicLocation;
  referenceAllele?: string;
  alternateAllele?: string;
  transcriptChange?: string;
  proteinChange?: string;
  variantType: string;
  consequence?: string;
  clinicalSignificance?: string;
  reviewStatus?: string;
  submitters?: string[];
  condition?: string;
  frequency?: string;
  rsIds?: string[];
  requestedRsId?: string;
  mergedRsIds?: string[];
  genomicPlacements?: Array<{
    assemblyName?: string;
    assemblyAccession?: string;
    sequenceId?: string;
    chromosome?: string;
    start?: number;
    end?: number;
    referenceAllele?: string;
    alternateAlleles?: string[];
    strand?: '+' | '-';
  }>;
  evidence: ScientificSource[];
}

export interface PopulationFrequency {
  populationName: string;
  sourceStudy: string;
  allele: string;
  frequency: number;
  alleleCount?: number;
  sampleSize?: number;
  assembly?: string;
  source: ScientificSource;
}

export interface Protein {
  id: string;
  name: string;
  geneId: string;
  organism: string;
  sequenceId?: string;
  aminoAcidLength?: number;
  functionDescription?: string;
  accession?: string;
  entryName?: string;
  massDaltons?: number;
  canonicalSequence?: string;
  isoforms?: Array<{ id: string; name?: string }>;
  subcellularLocation?: string[];
  features?: Array<{ type: string; start: number; end: number; description?: string }>;
  crossReferences?: Array<{ database: string; identifier: string; url?: string }>;
  goAnnotations?: Array<{
    id: string;
    term: string;
    aspect: 'molecular-function' | 'biological-process' | 'cellular-component';
    evidenceCode: string;
    evidenceSource: 'manually-curated' | 'inferred-electronically' | 'other-inference' | 'not-reported';
    database: 'UniProt' | 'QuickGO';
    category: 'curated-database' | 'reference-database';
    retrievedAt: string;
    limitations: string[];
    url: string;
  }>;
  sources: ScientificSource[];
}

export interface Phenotype {
  id: string;
  name: string;
  description?: string;
  sources: ScientificSource[];
}

export interface Publication {
  id: string;
  title: string;
  authors: string[];
  journal?: string;
  year?: number;
  abstract?: string;
  identifiers: Record<string, string>;
  url?: string;
  source: ScientificSource;
  sources?: ScientificSource[];
  isOpenAccess?: boolean;
  citationCount?: number;
  fullTextUrl?: string;
  isPreprint?: boolean;
  publicationTypes?: string[];
}

export interface Sequence {
  id: string;
  alphabet: 'DNA' | 'RNA' | 'protein';
  value: string;
  source?: ScientificSource;
}

export interface AnalysisResult<T = unknown> {
  operation: string;
  input: string;
  value: T;
  generatedAt: string;
  limitations: string[];
}