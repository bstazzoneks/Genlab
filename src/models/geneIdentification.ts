export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NO_MATCH';
export type MoleculeType = 'DNA' | 'RNA' | 'protein' | 'unknown';
export type DetectedVariantType = 'SNV' | 'MNV' | 'substitution' | 'insertion' | 'deletion' | 'unknown';
export type VariantEvidenceOrigin = 'COMPUTED' | 'DATABASE' | 'USER-PROVIDED' | 'PREDICTED';
export type SequenceVariantConsequence = 'intergenic' | 'intronic' | 'exonic' | 'UTR' | 'synonymous' | 'missense' | 'nonsense' | 'start-loss' | 'stop-loss' | 'frameshift' | 'in-frame insertion' | 'in-frame deletion' | 'splice-region' | 'splice-site' | 'unknown';

export interface SequenceEvidence {
  sourceType?: VariantEvidenceOrigin;
  source: string;
  database?: string;
  sourceUrl?: string;
  method: string;
  value?: string;
  identityPercent?: number;
  coveragePercent?: number;
  confidence?: MatchConfidence;
  timestamp: string;
  retrievedAt?: string;
  limitations: string[];
}

export interface VariantRepresentation {
  position: number;
  coordinate: 'base' | 'boundary' | 'input-vcf';
  reference: string;
  alternative: string;
}

export interface VariantNormalization {
  status: 'left-normalized' | 'minimized' | 'unchanged' | 'unavailable';
  original: VariantRepresentation;
  normalized?: VariantRepresentation;
  type?: DetectedVariantType;
  method?: string;
}

export interface ProteinImpact {
  referenceCodon?: string;
  alteredCodon?: string;
  referenceAminoAcid?: string;
  alteredAminoAcid?: string;
  codonPosition?: number;
  aminoAcidPosition?: number;
  hgvsProtein?: string;
  biochemicalChange?: string;
}

export interface SampleVariantSummary {
  variantKey: string;
  variant: DetectedSequenceVariant;
  allSampleIds: string[];
  presentIn: string[];
  sampleCount: number;
  sampleTotal: number;
  samplePrevalence: number;
}

export interface PopulationAlleleFrequency {
  alleleFrequency: number;
  population?: string;
  source: string;
  identifier?: string;
  retrievedAt: string;
}

export interface ExternalVariantAnnotationStatus {
  status: 'not-connected' | 'not-queried' | 'error' | 'no-match' | 'matched';
  database?: string;
  message?: string;
  identifiers?: string[];
  sourceUrl?: string;
  classification?: string;
  reviewStatus?: string;
  reportedAssociation?: string;
  retrievedAt?: string;
  evidence?: SequenceEvidence[];
}

export interface InputVariantAnnotation {
  identifier?: string;
  classification?: string;
  reportedCondition?: string;
  alleleFrequency?: number;
  source: string;
}

export interface DetectedSequenceVariant {
  position: number;
  reference: string;
  alternative: string;
  type: DetectedVariantType;
  nucleotideChange: string;
  normalization?: VariantNormalization;
  chromosome?: string;
  gene?: string;
  transcript?: string;
  strand?: '+' | '-';
  hgvsGenomic?: string;
  hgvsCoding?: string;
  hgvsProtein?: string;
  rsId?: string;
  consequence?: SequenceVariantConsequence;
  proteinImpact?: ProteinImpact;
  externalAnnotation?: ExternalVariantAnnotationStatus;
  confidence?: MatchConfidence;
  populationFrequencies?: PopulationAlleleFrequency[];
  inputAnnotation?: InputVariantAnnotation;
  sampleIds?: string[];
  samplePrevalence?: number;
  hgvs?: string;
  proteinChange?: string;
  predictedConsequence?: string;
  evidence: SequenceEvidence[];
}

export interface SequenceMatchRecord {
  header: string;
  inputFormat?: 'fasta' | 'vcf';
  moleculeType: MoleculeType;
  sequenceLength: number;
  referenceLength?: number;
  candidateLabel?: string;
  confidence: MatchConfidence;
  identityPercent?: number;
  coveragePercent?: number;
  alignmentScore?: number;
  alignedReference?: string;
  alignedQuery?: string;
  variants: DetectedSequenceVariant[];
  reasons: string[];
  evidence: SequenceEvidence[];
}

export interface GeneIdentificationResult {
  generatedAt: string;
  records: SequenceMatchRecord[];
  sampleComparison?: SampleVariantSummary[];
  limitations: string[];
}