import type { Gene, Publication, ScientificSource, Variant } from './scientific';

export type KnowledgeDataStatus = 'REAL SOURCE' | 'DEMO DATA' | 'USER-ENTERED DATA' | 'NOT CONNECTED';
export type KnowledgeVariantType = 'SNV' | 'MNV' | 'Insertion' | 'Deletion' | 'Indel' | 'CNV' | 'Structural variant' | 'Splice variant' | 'Unknown';
export type AcmgCriterion = 'PVS1' | 'PS1' | 'PS2' | 'PS3' | 'PS4' | 'PM1' | 'PM2' | 'PM3' | 'PM4' | 'PM5' | 'PP1' | 'PP3' | 'PP5' | 'BA1' | 'BS1' | 'BS2' | 'BS3' | 'BS4' | 'BP1' | 'BP2' | 'BP3' | 'BP4' | 'BP5' | 'BP6' | 'BP7';

export interface PopulationData { population: string; alleleFrequency?: number; alleleCount?: number; alleleNumber?: number; source?: ScientificSource; status: KnowledgeDataStatus; }
export interface VariantEvidence { id: string; type: string; source: string; title?: string; date?: string; strength?: string; identifier?: string; url?: string; notes?: string; status: KnowledgeDataStatus; }
export interface AcmgAssessment { criterion: AcmgCriterion; status: 'Not assessed' | 'Supporting' | 'Against'; evidence?: string; source?: string; notes?: string; updatedAt?: string; }
export interface GeneLabInterpretation { id: string; variantKey: string; status: 'Draft' | 'Under review' | 'Reviewed' | 'Archived'; curator?: string; date: string; notes: string; source: ScientificSource; }
export interface NormalizedVariant { key: string; gene?: Gene; variant: Variant; transcript?: string; genome: 'GRCh37' | 'GRCh38' | 'Unknown'; hgvsG?: string; hgvsC?: string; hgvsP?: string; rsid?: string; phenotypes: string[]; populationData: PopulationData[]; evidence: VariantEvidence[]; literature: Publication[]; acmg: AcmgAssessment[]; interpretations: GeneLabInterpretation[]; status: KnowledgeDataStatus; sources: ScientificSource[]; }
export interface VariantKnowledgeFilters { genome?: string; gene?: string; variantType?: string; clinicalSignificance?: string; disease?: string; evidence?: string; }
export interface VariantKnowledgeSearchResult { status: 'ok' | 'empty' | 'error'; query: string; records: NormalizedVariant[]; message?: string; sourceStatus: KnowledgeDataStatus; }
