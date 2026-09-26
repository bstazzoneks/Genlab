import { liveGeneService } from './live';
import { liveLiteratureService } from './liveLiterature';
import { liveVariantService } from './liveVariants';
import type { Gene, ScientificSource, Variant } from '../models/scientific';
import type { AcmgAssessment, AcmgCriterion, GeneLabInterpretation, NormalizedVariant, PopulationData, VariantEvidence, VariantKnowledgeFilters, VariantKnowledgeSearchResult } from '../models/variantKnowledge';

const localKey = 'genelab-variant-knowledge';
const notConnected: PopulationData = { population: 'Population frequency', status: 'NOT CONNECTED' };
const sourceFor = (name: string, identifier?: string, url?: string): ScientificSource => ({ id: `genelab-kb-${name.toLocaleLowerCase()}-${identifier ?? 'record'}`, name, category: name === 'GeneLab' ? 'user-provided' : 'curated-database', identifier, url, retrievedAt: new Date().toISOString() });
const readLocal = <T>(key: string, fallback: T): T => { try { if (typeof localStorage === 'undefined') return fallback; const parsed = JSON.parse(localStorage.getItem(key) ?? 'null'); return parsed === null ? fallback : parsed as T; } catch { return fallback; } };
const writeLocal = (key: string, value: unknown): void => { if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value)); };
const isVariantId = (query: string): boolean => /^(VCV|SCV|rs)\d+$/i.test(query.trim());
const inferType = (variant: Variant): string => { const raw = `${variant.variantType} ${variant.consequence ?? ''}`.toLocaleLowerCase(); if (raw.includes('splice')) return 'Splice variant'; if (raw.includes('deletion') || raw.includes('del')) return 'Deletion'; if (raw.includes('insertion') || raw.includes('ins')) return 'Insertion'; if (raw.includes('indel')) return 'Indel'; if (raw.includes('single nucleotide') || raw.includes('snv')) return 'SNV'; return variant.variantType || 'Unknown'; };
const normalize = (variant: Variant, gene?: Gene): NormalizedVariant => {
  const sources = [...variant.evidence, ...(gene?.sources ?? [])];
  const genome = variant.location?.assembly?.includes('38') ? 'GRCh38' : variant.location?.assembly?.includes('37') ? 'GRCh37' : 'Unknown';
  const evidence: VariantEvidence[] = variant.evidence.map((source, index) => ({ id: `${source.id}-${index}`, type: 'Clinical database record', source: source.name, identifier: source.identifier, url: source.url, date: source.retrievedAt, status: 'REAL SOURCE' }));
  return { key: `${variant.id}:${variant.geneId}`, gene, variant, transcript: variant.transcriptChange, genome, hgvsG: variant.genomicChange, hgvsC: variant.transcriptChange, hgvsP: variant.proteinChange, rsid: /^rs/i.test(variant.id) ? variant.id : undefined, phenotypes: variant.condition ? variant.condition.split(';').map((item) => item.trim()).filter(Boolean) : [], populationData: [notConnected], evidence, literature: [], acmg: [], interpretations: [], status: 'REAL SOURCE', sources };
};
const applyFilters = (records: NormalizedVariant[], filters: VariantKnowledgeFilters): NormalizedVariant[] => records.filter((record) => (!filters.genome || record.genome === filters.genome) && (!filters.gene || record.gene?.symbol.toLocaleLowerCase().includes(filters.gene.toLocaleLowerCase()) || record.variant.geneId === filters.gene) && (!filters.variantType || inferType(record.variant) === filters.variantType) && (!filters.clinicalSignificance || record.variant.clinicalSignificance === filters.clinicalSignificance) && (!filters.disease || record.phenotypes.some((item) => item.toLocaleLowerCase().includes(filters.disease!.toLocaleLowerCase()))) && (!filters.evidence || record.sources.some((source) => source.name.toLocaleLowerCase() === filters.evidence!.toLocaleLowerCase())));
const enrichLocal = (record: NormalizedVariant): NormalizedVariant => { const saved = readLocal<GeneLabInterpretation[]>(localKey, []).filter((item) => item.variantKey === record.key); const acmg = readLocal<AcmgAssessment[]>(`${localKey}-acmg-${record.key}`, []); return { ...record, interpretations: saved, acmg }; };

export const searchVariantKnowledge = async (query: string, filters: VariantKnowledgeFilters = {}): Promise<VariantKnowledgeSearchResult> => {
  const normalized = query.trim();
  if (!normalized) return { status: 'empty', query, records: [], sourceStatus: 'NOT CONNECTED', message: 'Enter a gene, variant identifier, HGVS expression, or genomic coordinate.' };
  if (isVariantId(normalized)) {
    const result = await liveVariantService.getVariant(normalized);
    if (result.status !== 'ok' || !result.data) return { status: 'error', query, records: [], sourceStatus: 'REAL SOURCE', message: result.message ?? 'ClinVar did not return a record.' };
    const gene = result.data.geneId ? await liveGeneService.getGene(result.data.geneId) : undefined;
    let record = enrichLocal(normalize(result.data, gene?.data));
    const literature = await liveLiteratureService.searchPublications(`${gene?.data?.symbol ?? ''} ${result.data.id}`.trim());
    if (literature.status === 'ok') record = { ...record, literature: literature.data ?? [] };
    return { status: 'ok', query, records: applyFilters([record], filters), sourceStatus: 'REAL SOURCE' };
  }
  if (/^(NM_|NC_|chr|\d+:|[A-Z]{2}_)/i.test(normalized)) return { status: 'empty', query, records: [], sourceStatus: 'NOT CONNECTED', message: 'HGVS and coordinate resolution is not connected yet; no clinical record was invented.' };
  const genes = await liveGeneService.search(normalized);
  if (genes.status !== 'ok' || !genes.data?.length) return { status: 'error', query, records: [], sourceStatus: 'REAL SOURCE', message: genes.message ?? 'NCBI Gene did not return a matching record.' };
  const records: NormalizedVariant[] = [];
  for (const gene of genes.data.slice(0, 3)) {
    const variants = await liveVariantService.getVariantsForGene(gene.id);
    if (variants.status === 'ok') records.push(...(variants.data ?? []).map((variant) => enrichLocal(normalize(variant, gene))));
  }
  return { status: records.length ? 'ok' : 'empty', query, records: applyFilters(records, filters), sourceStatus: 'REAL SOURCE', message: records.length ? undefined : 'ClinVar returned no variants for the selected gene.' };
};

export const getVariantKnowledge = async (id: string): Promise<VariantKnowledgeSearchResult> => searchVariantKnowledge(id);
export const addGeneLabInterpretation = (record: Omit<GeneLabInterpretation, 'id' | 'date' | 'source'>): GeneLabInterpretation => { const value: GeneLabInterpretation = { ...record, id: `GL-${Date.now()}`, date: new Date().toISOString(), source: sourceFor('GeneLab', 'LOCAL-KNOWLEDGE-BASE') }; const records = readLocal<GeneLabInterpretation[]>(localKey, []); writeLocal(localKey, [value, ...records]); return value; };
export const saveAcmgAssessment = (variantKey: string, assessment: AcmgAssessment[]): void => writeLocal(`${localKey}-acmg-${variantKey}`, assessment);
export const getAcmgCriteria = (): AcmgCriterion[] => ['PVS1', 'PS1', 'PS2', 'PS3', 'PS4', 'PM1', 'PM2', 'PM3', 'PM4', 'PM5', 'PP1', 'PP3', 'PP5', 'BA1', 'BS1', 'BS2', 'BS3', 'BS4', 'BP1', 'BP2', 'BP3', 'BP4', 'BP5', 'BP6', 'BP7'];
export const getVariantType = inferType;
export const getNotConnectedPopulationData = (): PopulationData => ({ ...notConnected });
export const getNotConnectedSources = (): string[] => ['ClinGen', 'gnomAD', 'dbSNP', 'OMIM', 'HGMD Professional'];
export const getGeneLabSource = (): ScientificSource => sourceFor('GeneLab', 'LOCAL-KNOWLEDGE-BASE');
export const getUserEvidenceSource = (): ScientificSource => sourceFor('GeneLab', 'USER-ENTERED-EVIDENCE');
export const getSourceStatus = (record: NormalizedVariant): string => record.status;
