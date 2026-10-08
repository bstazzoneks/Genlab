import type { DetectedSequenceVariant, ExternalVariantAnnotationStatus, GeneIdentificationResult, ProteinImpact, SampleVariantSummary, SequenceMatchRecord, SequenceVariantConsequence, VariantEvidenceOrigin, VariantRepresentation } from '../models/geneIdentification';
import { cleanSequence, translateRna } from '../utils/sequence';
import type { VariantService } from './types';

export interface CodingVariantContext {
  /** Complete coding sequence, 5' to 3'. */
  completeCds: string;
  /** 1-based CDS base for REF calls; for insertions, count of preceding CDS bases. */
  position: number;
  reference: string;
  alternative: string;
  transcriptId?: string;
}

export interface CodingConsequenceResult {
  consequence: SequenceVariantConsequence;
  proteinImpact?: ProteinImpact;
  hgvsCoding?: string;
  hgvsProtein?: string;
  transcriptId?: string;
  evidenceOrigin: VariantEvidenceOrigin;
}

export interface SpliceBoundary {
  site: 'donor' | 'acceptor';
  canonicalStart: number;
  canonicalEnd: number;
  regionStart: number;
  regionEnd: number;
}

export interface DetectedVariantFilters {
  gene?: string;
  chromosome?: string;
  positionFrom?: number;
  positionTo?: number;
  type?: string;
  consequence?: string;
  reference?: string;
  alternative?: string;
  minimumSamplePrevalence?: number;
  confidence?: string;
  database?: string;
  sample?: string;
}

export interface FilteredDetectedVariant {
  record: SequenceMatchRecord;
  variant: DetectedSequenceVariant;
  sampleId: string;
}

const isUnambiguousDna = (sequence: string): boolean => /^[ACGT]+$/.test(sequence);
const asDna = (sequence: string): string => sequence.replaceAll('U', 'T');
const representationFor = (variant: DetectedSequenceVariant): VariantRepresentation => ({
  position: variant.position,
  coordinate: variant.type === 'insertion' ? 'boundary' : 'base',
  reference: variant.reference,
  alternative: variant.alternative,
});

export const normalizeDetectedVariant = (variant: DetectedSequenceVariant, referenceInput?: string): NonNullable<DetectedSequenceVariant['normalization']> => {
  const original = representationFor(variant);
  const unavailable = (method: string) => ({ status: 'unavailable' as const, original, method });
  if (!referenceInput) return unavailable('Reference sequence unavailable.');
  const referenceSequence = cleanSequence(referenceInput);
  const referenceDna = asDna(referenceSequence);
  if (!isUnambiguousDna(referenceDna)) return unavailable('Reference contains ambiguous bases.');

  let position = variant.position;
  let reference = variant.reference === '-' ? '' : variant.reference;
  let alternative = variant.alternative === '-' ? '' : variant.alternative;
  if (!isUnambiguousDna(asDna(reference + alternative))) return unavailable('Variant contains ambiguous alleles.');

  if (variant.type === 'insertion' && !reference) {
    if (!alternative || position < 0 || position > referenceSequence.length) return unavailable('Insertion boundary is outside the supplied reference.');
    while (position > 0 && asDna(referenceSequence[position - 1] ?? '') === asDna(alternative.at(-1) ?? '')) {
      alternative = `${alternative.at(-1)}${alternative.slice(0, -1)}`;
      position -= 1;
    }
    const shifted = position !== original.position;
    return { status: shifted ? 'left-normalized' : 'unchanged', original, normalized: { position, coordinate: 'boundary', reference: '-', alternative }, method: shifted ? 'Left-aligned in the supplied reference repeat context.' : 'No left shift was possible in the supplied reference context.' };
  }

  if (position < 1 || !reference || referenceDna.slice(position - 1, position - 1 + reference.length) !== asDna(reference)) {
    return unavailable('Variant reference allele does not match the supplied sequence at this position.');
  }

  if (variant.type === 'deletion' && !alternative) {
    while (position > 1 && asDna(referenceSequence[position - 2] ?? '') === asDna(reference.at(-1) ?? '')) {
      reference = `${reference.at(-1)}${reference.slice(0, -1)}`;
      position -= 1;
    }
    const shifted = position !== original.position;
    return { status: shifted ? 'left-normalized' : 'unchanged', original, normalized: { position, coordinate: 'base', reference, alternative: '-' }, type: 'deletion', method: shifted ? 'Left-aligned in the supplied reference repeat context.' : 'No left shift was possible in the supplied reference context.' };
  }
  if (!alternative) return unavailable('Alternate allele is incomplete.');

  const originalPosition = position;
  while (reference.length && alternative.length && asDna(reference[0]) === asDna(alternative[0])) {
    reference = reference.slice(1);
    alternative = alternative.slice(1);
    position += 1;
  }
  while (reference.length > 1 && alternative.length > 1 && asDna(reference.at(-1) ?? '') === asDna(alternative.at(-1) ?? '')) {
    reference = reference.slice(0, -1);
    alternative = alternative.slice(0, -1);
  }
  const minimized = position !== originalPosition || reference !== variant.reference || alternative !== variant.alternative;
  if (!reference && !alternative) return unavailable('The variant has no alternate sequence change after minimization.');
  if (!reference) return { status: 'minimized', original, normalized: { position: Math.max(0, position - 1), coordinate: 'boundary', reference: '-', alternative }, type: 'insertion', method: 'Removed shared prefix bases; represented as an insertion boundary.' };
  if (!alternative) return { status: 'minimized', original, normalized: { position, coordinate: 'base', reference, alternative: '-' }, type: 'deletion', method: 'Removed shared prefix bases; represented as a deletion.' };
  const type = reference.length > alternative.length ? 'deletion' : reference.length < alternative.length ? 'insertion' : reference.length === 1 ? 'SNV' : 'MNV';
  return { status: minimized ? 'minimized' : 'unchanged', original, normalized: { position, coordinate: 'base', reference, alternative }, type, method: minimized ? 'Removed shared prefix/suffix bases against the supplied reference.' : 'No common flanking bases could be trimmed.' };
};

const aminoAcidNames: Record<string, string> = { A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys', Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile', L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro', S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val', '*': 'Ter' };
const aminoAcidProperties: Record<string, string> = {
  A: 'small, non-polar, neutral', R: 'large, basic, polar', N: 'medium, polar, neutral', D: 'small, acidic, polar', C: 'small, polar, neutral', Q: 'medium, polar, neutral', E: 'medium, acidic, polar', G: 'very small, non-polar, neutral', H: 'medium, basic, polar', I: 'large, non-polar, neutral', L: 'large, non-polar, neutral', K: 'large, basic, polar', M: 'large, non-polar, neutral', F: 'large, aromatic, non-polar, neutral', P: 'small, non-polar, neutral', S: 'small, polar, neutral', T: 'medium, polar, neutral', W: 'very large, aromatic, non-polar, neutral', Y: 'large, aromatic, polar, neutral', V: 'medium, non-polar, neutral', '*': 'stop signal',
};

const aminoAcidName = (symbol: string): string | undefined => aminoAcidNames[symbol];

const codingHgvsForIndel = (context: CodingVariantContext, cds: string): string | undefined => {
  if (!context.transcriptId) return undefined;
  const reference = asDna(context.reference === '-' ? '' : context.reference);
  const alternative = asDna(context.alternative === '-' ? '' : context.alternative);
  if (reference && !alternative) {
    const end = context.position + reference.length - 1;
    return reference.length === 1 ? `c.${context.position}del` : `c.${context.position}_${end}del`;
  }
  if (!reference && alternative && context.position > 0 && context.position < cds.length) {
    const duplicateStart = context.position - alternative.length;
    if (duplicateStart >= 0 && cds.slice(duplicateStart, context.position) === alternative) return `c.${duplicateStart + 1}_${context.position}dup`;
    return `c.${context.position}_${context.position + 1}ins${alternative}`;
  }
  return undefined;
};

export const predictCodingConsequence = (context: CodingVariantContext): CodingConsequenceResult => {
  const cds = asDna(cleanSequence(context.completeCds));
  const reference = asDna(context.reference === '-' ? '' : context.reference);
  const alternative = asDna(context.alternative === '-' ? '' : context.alternative);
  const unknown: CodingConsequenceResult = { consequence: 'unknown', evidenceOrigin: 'PREDICTED', transcriptId: context.transcriptId };
  if (!isUnambiguousDna(cds) || cds.length < 6 || cds.length % 3 !== 0 || !cds.startsWith('ATG') || !['TAA', 'TAG', 'TGA'].includes(cds.slice(-3)) || translateRna(cds.slice(0, -3)).includes('*') || !reference && !alternative || context.position < 0) return unknown;

  const zeroBasedStart = reference ? context.position - 1 : context.position;
  if (zeroBasedStart < 0 || zeroBasedStart > cds.length || cds.slice(zeroBasedStart, zeroBasedStart + reference.length) !== reference) return unknown;
  const alteredCds = `${cds.slice(0, zeroBasedStart)}${alternative}${cds.slice(zeroBasedStart + reference.length)}`;
  const lengthDifference = alternative.length - reference.length;
  if (lengthDifference % 3 !== 0) return { ...unknown, consequence: 'frameshift', hgvsCoding: codingHgvsForIndel(context, cds) };
  if (lengthDifference > 0) return { ...unknown, consequence: 'in-frame insertion', hgvsCoding: codingHgvsForIndel(context, cds) };
  if (lengthDifference < 0) return { ...unknown, consequence: 'in-frame deletion', hgvsCoding: codingHgvsForIndel(context, cds) };

  const codonIndex = Math.floor(zeroBasedStart / 3);
  const lastAffectedCodon = Math.floor(Math.max(zeroBasedStart, zeroBasedStart + reference.length - 1) / 3);
  if (codonIndex !== lastAffectedCodon) return unknown;
  const codonStart = codonIndex * 3;
  const referenceCodon = cds.slice(codonStart, codonStart + 3);
  const alteredCodon = alteredCds.slice(codonStart, codonStart + 3);
  if (referenceCodon.length !== 3 || alteredCodon.length !== 3) return unknown;
  const referenceAminoAcid = translateRna(referenceCodon);
  const alteredAminoAcid = translateRna(alteredCodon);
  if (referenceAminoAcid === 'X' || alteredAminoAcid === 'X') return unknown;

  let consequence: SequenceVariantConsequence = 'missense';
  if (referenceAminoAcid === alteredAminoAcid) consequence = 'synonymous';
  else if (codonIndex === 0 && referenceCodon === 'ATG' && alteredCodon !== 'ATG') consequence = 'start-loss';
  else if (referenceAminoAcid === '*' && alteredAminoAcid !== '*') consequence = 'stop-loss';
  else if (alteredAminoAcid === '*') consequence = 'nonsense';

  const aminoAcidPosition = codonIndex + 1;
  const referenceName = aminoAcidName(referenceAminoAcid);
  const alteredName = aminoAcidName(alteredAminoAcid);
  const proteinImpact: ProteinImpact = {
    referenceCodon,
    alteredCodon,
    referenceAminoAcid: referenceName,
    alteredAminoAcid: alteredName,
    codonPosition: (zeroBasedStart % 3) + 1,
    aminoAcidPosition,
    biochemicalChange: `${referenceName} (${aminoAcidProperties[referenceAminoAcid]}) to ${alteredName} (${aminoAcidProperties[alteredAminoAcid]})`,
  };
  let hgvsCoding: string | undefined;
  let hgvsProtein: string | undefined;
  if (context.transcriptId && reference.length === 1 && alternative.length === 1) {
    hgvsCoding = `c.${context.position}${context.reference}>${context.alternative}`;
    hgvsProtein = consequence === 'synonymous' ? `p.(${referenceName}${aminoAcidPosition}=)` : `p.(${referenceName}${aminoAcidPosition}${alteredName})`;
    proteinImpact.hgvsProtein = hgvsProtein;
  }
  return { consequence, proteinImpact, hgvsCoding, hgvsProtein, transcriptId: context.transcriptId, evidenceOrigin: 'PREDICTED' };
};

export const classifySpliceProximity = (position: number, boundaries: SpliceBoundary[]): SequenceVariantConsequence => {
  if (!Number.isInteger(position) || position < 1) return 'unknown';
  if (boundaries.some((boundary) => position >= boundary.canonicalStart && position <= boundary.canonicalEnd)) return 'splice-site';
  if (boundaries.some((boundary) => position >= boundary.regionStart && position <= boundary.regionEnd)) return 'splice-region';
  return 'unknown';
};

export const getVariantComparisonKey = (variant: DetectedSequenceVariant): string => {
  const normalized = variant.normalization?.normalized;
  if (normalized) return `${normalized.coordinate}:${normalized.position}:${normalized.reference}>${normalized.alternative}`;
  return `${variant.type}:${variant.position}:${variant.reference}>${variant.alternative}`;
};

export const summarizeVariantsAcrossSamples = (records: SequenceMatchRecord[]): SampleVariantSummary[] => {
  const eligibleRecords = records.filter((record) => record.confidence === 'HIGH' || record.confidence === 'MEDIUM');
  if (eligibleRecords.length < 2) return [];
  const sampleIds = eligibleRecords.map((record, index) => record.header || `sample-${index + 1}`);
  const uniqueSampleIds = sampleIds.map((id, index) => sampleIds.indexOf(id) === index ? id : `${id} (${index + 1})`);
  const summaries = new Map<string, SampleVariantSummary>();
  eligibleRecords.forEach((record, recordIndex) => {
    for (const variant of record.variants) {
      const key = getVariantComparisonKey(variant);
      const current = summaries.get(key);
      if (current) current.presentIn.push(uniqueSampleIds[recordIndex]);
      else summaries.set(key, { variantKey: key, variant, allSampleIds: uniqueSampleIds, presentIn: [uniqueSampleIds[recordIndex]], sampleCount: 0, sampleTotal: eligibleRecords.length, samplePrevalence: 0 });
    }
  });
  for (const summary of summaries.values()) {
    summary.presentIn = [...summary.presentIn];
    summary.sampleCount = summary.presentIn.length;
    summary.samplePrevalence = summary.sampleCount / summary.sampleTotal;
    summary.variant.sampleIds = summary.presentIn;
    summary.variant.samplePrevalence = summary.samplePrevalence;
  }
  eligibleRecords.forEach((record) => record.variants.forEach((variant) => {
    const summary = summaries.get(getVariantComparisonKey(variant));
    if (summary) {
      variant.sampleIds = summary.presentIn;
      variant.samplePrevalence = summary.samplePrevalence;
    }
  }));
  return [...summaries.values()].sort((left, right) => left.variant.position - right.variant.position);
};

export const filterDetectedVariants = (records: SequenceMatchRecord[], filters: DetectedVariantFilters = {}): FilteredDetectedVariant[] => records.flatMap((record, index) => {
  const sampleId = record.header || `sample-${index + 1}`;
  return record.variants.filter((variant) => {
    const position = variant.normalization?.normalized?.position ?? variant.position;
    const gene = variant.gene ?? record.candidateLabel ?? '';
    const confidence = variant.confidence ?? variant.evidence.find((item) => item.sourceType === 'COMPUTED')?.confidence;
    const database = variant.externalAnnotation?.database ?? variant.evidence.find((item) => item.database)?.database ?? '';
    return (!filters.gene || gene.toLocaleLowerCase().includes(filters.gene.toLocaleLowerCase()))
      && (!filters.chromosome || variant.chromosome?.toLocaleLowerCase() === filters.chromosome.toLocaleLowerCase())
      && (filters.positionFrom === undefined || position >= filters.positionFrom)
      && (filters.positionTo === undefined || position <= filters.positionTo)
      && (!filters.type || (variant.normalization?.type ?? variant.type) === filters.type)
      && (!filters.consequence || (variant.consequence ?? 'unknown') === filters.consequence)
      && (!filters.reference || variant.reference.toLocaleLowerCase().includes(filters.reference.toLocaleLowerCase()))
      && (!filters.alternative || variant.alternative.toLocaleLowerCase().includes(filters.alternative.toLocaleLowerCase()))
      && (filters.minimumSamplePrevalence === undefined || (variant.samplePrevalence ?? 0) >= filters.minimumSamplePrevalence)
      && (!filters.confidence || confidence === filters.confidence)
      && (!filters.database || database.toLocaleLowerCase().includes(filters.database.toLocaleLowerCase()))
      && (!filters.sample || sampleId.toLocaleLowerCase().includes(filters.sample.toLocaleLowerCase()));
  }).map((variant) => ({ record, variant, sampleId }));
});

export interface VariantAnnotationAdapter {
  database: string;
  annotate(variant: DetectedSequenceVariant): Promise<ExternalVariantAnnotationStatus>;
}

export const variantAnnotationProviders: readonly VariantAnnotationAdapter[] = [];
const externalAnnotationCache = new Map<string, { expiresAt: number; value: ExternalVariantAnnotationStatus }>();
const externalAnnotationCacheTtl = 5 * 60 * 1000;

export const createClinVarIdentifierAdapter = (service: Pick<VariantService, 'getVariant'>): VariantAnnotationAdapter => ({
  database: 'ClinVar',
  async annotate(variant) {
    const identifier = variant.inputAnnotation?.identifier ?? variant.rsId;
    if (!identifier || !/^rs\d+$/i.test(identifier)) return { status: 'not-queried', database: 'ClinVar', message: 'A VCF rsID is required; coordinates are not used.' };
    const cacheKey = identifier.toLocaleUpperCase();
    const cached = externalAnnotationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const result = await service.getVariant(identifier);
      if (result.status !== 'ok' || !result.data) {
        const value: ExternalVariantAnnotationStatus = result.status === 'error' && result.errorCode === 'not-found'
          ? { status: 'no-match', database: 'ClinVar', message: 'ClinVar returned no record for the supplied rsID.' }
          : { status: 'error', database: 'ClinVar', message: result.message ?? 'ClinVar could not be queried; the result is not a no-match.' };
        if (value.status === 'no-match') externalAnnotationCache.set(cacheKey, { expiresAt: Date.now() + externalAnnotationCacheTtl, value });
        return value;
      }
      const source = result.data.evidence[0];
      const retrievedAt = source?.retrievedAt ?? new Date().toISOString();
      const evidence = result.data.evidence.map((item) => ({ sourceType: 'DATABASE' as const, source: item.name, database: 'ClinVar', sourceUrl: item.url, method: `ClinVar E-utilities lookup by supplied identifier ${identifier}.`, value: `${result.data?.id ?? ''}${result.data?.clinicalSignificance ? ` · ${result.data.clinicalSignificance}` : ''}`, timestamp: retrievedAt, retrievedAt, limitations: item.limitations ?? ['Database-reported annotation; not an independent clinical interpretation.'] }));
      const value: ExternalVariantAnnotationStatus = { status: 'matched', database: 'ClinVar', identifiers: [result.data.id], sourceUrl: source?.url, classification: result.data.clinicalSignificance, reviewStatus: result.data.reviewStatus, reportedAssociation: result.data.condition, retrievedAt, evidence };
      externalAnnotationCache.set(cacheKey, { expiresAt: Date.now() + externalAnnotationCacheTtl, value });
      return value;
    } catch {
      return { status: 'error', database: 'ClinVar', message: 'ClinVar could not be queried; the result is not a no-match.' };
    }
  },
});

export const annotateVariantWithProvider = async (variant: DetectedSequenceVariant, provider: VariantAnnotationAdapter): Promise<DetectedSequenceVariant> => {
  const externalAnnotation = await provider.annotate(variant);
  const retainedEvidence = variant.evidence.filter((item) => item.sourceType !== 'DATABASE' || item.database !== provider.database);
  return { ...variant, externalAnnotation, evidence: externalAnnotation.evidence ? [...retainedEvidence, ...externalAnnotation.evidence] : retainedEvidence };
};

export const clearVariantAnnotationCache = (identifier?: string): void => {
  if (identifier) externalAnnotationCache.delete(identifier.toLocaleUpperCase());
  else externalAnnotationCache.clear();
};

export const annotateDetectedVariant = (variant: DetectedSequenceVariant, referenceSequence?: string, codingContext?: CodingVariantContext): DetectedSequenceVariant => {
  const coding = codingContext ? predictCodingConsequence(codingContext) : undefined;
  const consequenceEvidence = coding && coding.consequence !== 'unknown' ? [{ sourceType: 'PREDICTED' as const, source: 'GeneLab coding sequence analysis', method: 'Codon translation against an explicitly supplied complete CDS.', value: coding.consequence, confidence: variant.confidence ?? variant.evidence[0]?.confidence ?? 'LOW', timestamp: new Date().toISOString(), limitations: ['Computational consequence only; not clinical interpretation.', 'HGVS coding/protein requires transcript context.'] }] : [];
  return {
    ...variant,
    normalization: normalizeDetectedVariant(variant, referenceSequence),
    consequence: coding?.consequence ?? variant.consequence ?? 'unknown',
    proteinImpact: coding?.proteinImpact ?? variant.proteinImpact,
    hgvsCoding: coding?.hgvsCoding ?? variant.hgvsCoding,
    hgvsProtein: coding?.hgvsProtein ?? variant.hgvsProtein,
    transcript: coding?.transcriptId ?? variant.transcript,
    confidence: variant.confidence ?? variant.evidence.find((item) => item.sourceType === 'COMPUTED')?.confidence ?? variant.evidence[0]?.confidence,
    externalAnnotation: variant.externalAnnotation ?? { status: 'not-connected', message: 'No external lookup was attempted: this call has no verified genomic coordinate or database identifier.' },
    evidence: [...variant.evidence, ...consequenceEvidence],
  };
};

export const annotateGeneIdentificationResult = (result: GeneIdentificationResult, referenceByHeader: Map<string, string>): GeneIdentificationResult => {
  const records = result.records.map((record) => ({
    ...record,
    variants: record.variants.map((variant) => annotateDetectedVariant(variant, referenceByHeader.get(record.header))),
  }));
  return { ...result, records, sampleComparison: summarizeVariantsAcrossSamples(records) };
};

export const variantAnnotationService = {
  normalize: normalizeDetectedVariant,
  predictCoding: predictCodingConsequence,
  classifySpliceProximity,
  annotate: annotateDetectedVariant,
  filter: filterDetectedVariants,
  summarizeSamples: summarizeVariantsAcrossSamples,
  providers: variantAnnotationProviders,
  createClinVarIdentifierAdapter,
  clearCache: clearVariantAnnotationCache,
};