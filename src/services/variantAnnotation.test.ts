import { describe, expect, it, vi } from 'vitest';
import type { DetectedSequenceVariant, SequenceEvidence, SequenceMatchRecord } from '../models/geneIdentification';
import { annotateDetectedVariant, annotateVariantWithProvider, clearVariantAnnotationCache, classifySpliceProximity, createClinVarIdentifierAdapter, filterDetectedVariants, normalizeDetectedVariant, predictCodingConsequence, summarizeVariantsAcrossSamples, variantAnnotationProviders } from './variantAnnotation';

const evidence: SequenceEvidence[] = [{ sourceType: 'COMPUTED', source: 'test alignment', method: 'synthetic test', confidence: 'HIGH', timestamp: '2026-01-01T00:00:00.000Z', limitations: [] }];
const makeVariant = (overrides: Partial<DetectedSequenceVariant> = {}): DetectedSequenceVariant => ({ position: 5, reference: 'A', alternative: 'T', type: 'SNV', nucleotideChange: 'A>T', evidence, ...overrides });
const makeRecord = (header: string, variants: DetectedSequenceVariant[], confidence: SequenceMatchRecord['confidence'] = 'HIGH'): SequenceMatchRecord => ({ header, moleculeType: 'DNA', sequenceLength: 60, confidence, variants, reasons: [], evidence });

describe('variant annotation and normalization', () => {
  it('minimizes shared bases and preserves the original representation', () => {
    const result = normalizeDetectedVariant(makeVariant({ position: 1, reference: 'ATG', alternative: 'AG', type: 'MNV', nucleotideChange: 'ATG>AG' }), 'ATG');

    expect(result).toMatchObject({ status: 'minimized', original: { position: 1, reference: 'ATG', alternative: 'AG' }, normalized: { position: 2, coordinate: 'base', reference: 'TG', alternative: 'G' }, type: 'deletion' });
  });

  it('left-aligns insertions and deletions within repeat context', () => {
    const insertion = normalizeDetectedVariant(makeVariant({ position: 3, reference: '-', alternative: 'A', type: 'insertion', nucleotideChange: 'insA' }), 'AAAAA');
    const deletion = normalizeDetectedVariant(makeVariant({ position: 4, reference: 'A', alternative: '-', type: 'deletion', nucleotideChange: 'delA' }), 'AAAAA');

    expect(insertion).toMatchObject({ status: 'left-normalized', normalized: { position: 0, coordinate: 'boundary', reference: '-', alternative: 'A' } });
    expect(deletion).toMatchObject({ status: 'left-normalized', normalized: { position: 1, coordinate: 'base', reference: 'A', alternative: '-' } });
  });

  it('minimizes VCF-style padded insertion and deletion alleles', () => {
    const insertion = normalizeDetectedVariant(makeVariant({ position: 1, reference: 'A', alternative: 'AT', type: 'insertion', nucleotideChange: 'A>AT' }), 'ATG');
    const deletion = normalizeDetectedVariant(makeVariant({ position: 1, reference: 'AT', alternative: 'A', type: 'deletion', nucleotideChange: 'AT>A' }), 'ATG');

    expect(insertion).toMatchObject({ status: 'minimized', normalized: { position: 1, coordinate: 'boundary', reference: '-', alternative: 'T' }, type: 'insertion' });
    expect(deletion).toMatchObject({ status: 'minimized', normalized: { position: 2, coordinate: 'base', reference: 'T', alternative: '-' }, type: 'deletion' });
  });

  it('does not normalize against a mismatching or missing reference', () => {
    expect(normalizeDetectedVariant(makeVariant(), 'CCCC').status).toBe('unavailable');
    expect(normalizeDetectedVariant(makeVariant(), 'CCCC').normalized).toBeUndefined();
    expect(normalizeDetectedVariant(makeVariant()).normalized).toBeUndefined();
  });

  it('predicts missense and emits coding/protein HGVS only with an explicit transcript', () => {
    const result = predictCodingConsequence({ completeCds: 'ATGGAATAA', position: 5, reference: 'A', alternative: 'T', transcriptId: 'NM_TEST.1' });

    expect(result).toMatchObject({ consequence: 'missense', hgvsCoding: 'c.5A>T', hgvsProtein: 'p.(Glu2Val)', transcriptId: 'NM_TEST.1', evidenceOrigin: 'PREDICTED' });
    expect(result.proteinImpact).toMatchObject({ referenceCodon: 'GAA', alteredCodon: 'GTA', referenceAminoAcid: 'Glu', alteredAminoAcid: 'Val', codonPosition: 2, aminoAcidPosition: 2 });
    expect(result.proteinImpact?.biochemicalChange).toContain('non-polar');
  });

  it('emits coding HGVS for indels and duplications only with transcript context', () => {
    const deletion = predictCodingConsequence({ completeCds: 'ATGGAATAA', position: 4, reference: 'GAA', alternative: '-', transcriptId: 'NM_TEST.1' });
    const insertion = predictCodingConsequence({ completeCds: 'ATGGAATAA', position: 3, reference: '-', alternative: 'GCT', transcriptId: 'NM_TEST.1' });
    const duplication = predictCodingConsequence({ completeCds: 'ATGGAATAA', position: 6, reference: '-', alternative: 'AA', transcriptId: 'NM_TEST.1' });
    const withoutTranscript = predictCodingConsequence({ completeCds: 'ATGGAATAA', position: 4, reference: 'GAA', alternative: '-' });

    expect(deletion).toMatchObject({ consequence: 'in-frame deletion', hgvsCoding: 'c.4_6del' });
    expect(insertion).toMatchObject({ consequence: 'in-frame insertion', hgvsCoding: 'c.3_4insGCT' });
    expect(duplication).toMatchObject({ consequence: 'frameshift', hgvsCoding: 'c.5_6dup' });
    expect(withoutTranscript.hgvsCoding).toBeUndefined();
  });

  it.each([
    ['synonymous', 6, 'A', 'G', 'synonymous'],
    ['nonsense', 4, 'G', 'T', 'nonsense'],
    ['start loss', 1, 'A', 'C', 'start-loss'],
    ['stop loss', 7, 'T', 'C', 'stop-loss'],
    ['frameshift', 4, 'G', '-', 'frameshift'],
    ['in-frame deletion', 4, 'GAA', '-', 'in-frame deletion'],
    ['in-frame insertion', 3, '-', 'GCT', 'in-frame insertion'],
  ])('classifies %s from a complete synthetic CDS', (_name, position, reference, alternative, expected) => {
    const result = predictCodingConsequence({ completeCds: 'ATGGAATAA', position: Number(position), reference: String(reference), alternative: String(alternative), transcriptId: 'NM_TEST.1' });
    expect(result.consequence).toBe(expected);
  });

  it('returns unknown consequence when transcript/CDS context is unavailable or inconsistent', () => {
    const annotation = annotateDetectedVariant(makeVariant(), 'ATGGAATAA');
    expect(annotation).toMatchObject({ consequence: 'unknown', externalAnnotation: { status: 'not-connected' } });
    expect(annotation.hgvsCoding).toBeUndefined();
    expect(annotation.hgvsProtein).toBeUndefined();
    const inconsistent = predictCodingConsequence({ completeCds: 'ATGGAATAA', position: 5, reference: 'C', alternative: 'T' });
    expect(inconsistent.consequence).toBe('unknown');
    expect(inconsistent.hgvsCoding).toBeUndefined();
    expect(predictCodingConsequence({ completeCds: 'ATGGAATA', position: 5, reference: 'A', alternative: 'T' }).consequence).toBe('unknown');
  });

  it('classifies explicit splice windows without claiming functional effect', () => {
    const boundary = [{ site: 'donor' as const, canonicalStart: 10, canonicalEnd: 11, regionStart: 8, regionEnd: 15 }];
    expect(classifySpliceProximity(10, boundary)).toBe('splice-site');
    expect(classifySpliceProximity(13, boundary)).toBe('splice-region');
    expect(classifySpliceProximity(22, boundary)).toBe('unknown');
  });

  it('reports sample presence separately from population allele frequency', () => {
    const shared = annotateDetectedVariant(makeVariant(), 'ATGGAATAA');
    const unique = annotateDetectedVariant(makeVariant({ position: 6, reference: 'A', alternative: 'G', nucleotideChange: 'A>G' }), 'ATGGAATAA');
    const summary = summarizeVariantsAcrossSamples([makeRecord('sample-A', [shared]), makeRecord('sample-B', [shared, unique]), makeRecord('sample-C', [])]);

    expect(summary).toHaveLength(2);
    expect(summary.find((item) => item.sampleCount === 2)).toMatchObject({ sampleTotal: 3, samplePrevalence: 2 / 3, allSampleIds: ['sample-A', 'sample-B', 'sample-C'], presentIn: ['sample-A', 'sample-B'] });
    expect(summary.find((item) => item.sampleCount === 1)).toMatchObject({ samplePrevalence: 1 / 3, allSampleIds: ['sample-A', 'sample-B', 'sample-C'], presentIn: ['sample-B'] });
    expect(shared).not.toHaveProperty('populationFrequencies');
  });

  it('does not count unmatched samples as variant-negative samples', () => {
    const variant = annotateDetectedVariant(makeVariant(), 'ATGGAATAA');
    const summary = summarizeVariantsAcrossSamples([makeRecord('matched-A', [variant]), makeRecord('unknown-B', [], 'NO_MATCH')]);

    expect(summary).toEqual([]);
    expect(variant.samplePrevalence).toBeUndefined();
  });

  it('combines supported filters and leaves unavailable chromosome values unmatched', () => {
    const variant = annotateDetectedVariant(makeVariant({ candidateLabel: undefined } as Partial<DetectedSequenceVariant>), 'ATGGAATAA');
    const records = [makeRecord('sample-A', [variant])];

    expect(filterDetectedVariants(records, { type: 'SNV', reference: 'A', alternative: 'T', confidence: 'HIGH' })).toHaveLength(1);
    expect(filterDetectedVariants(records, { chromosome: '17' })).toHaveLength(0);
  });

  it('does not invent connected database providers or identifiers', () => {
    const annotation = annotateDetectedVariant(makeVariant(), 'ATGGAATAA');

    expect(variantAnnotationProviders).toEqual([]);
    expect(annotation.externalAnnotation).toMatchObject({ status: 'not-connected' });
    expect(annotation.rsId).toBeUndefined();
    expect(annotation.chromosome).toBeUndefined();
  });

  it('queries ClinVar only by an explicit rsID and caches returned database evidence', async () => {
    clearVariantAnnotationCache();
    const service = { getVariant: vi.fn().mockResolvedValue({ status: 'ok', data: { id: 'VCV000001', geneId: '1', variantType: 'single nucleotide variant', clinicalSignificance: 'Uncertain significance', reviewStatus: 'criteria provided', evidence: [{ id: 'clinvar-1', name: 'ClinVar', category: 'curated-database', identifier: 'VCV000001', url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/1/', retrievedAt: '2026-01-01T00:00:00.000Z' }] } }) };
    const provider = createClinVarIdentifierAdapter(service);
    const variant = makeVariant({ inputAnnotation: { identifier: 'rs123', classification: 'Pathogenic', source: 'Uploaded VCF INFO' } });

    const first = await annotateVariantWithProvider(variant, provider);
    const second = await annotateVariantWithProvider(variant, provider);

    expect(service.getVariant).toHaveBeenCalledOnce();
    expect(service.getVariant).toHaveBeenCalledWith('rs123');
    expect(first.externalAnnotation).toMatchObject({ status: 'matched', database: 'ClinVar', identifiers: ['VCV000001'], classification: 'Uncertain significance', reviewStatus: 'criteria provided' });
    expect(first.externalAnnotation?.sourceUrl).toContain('clinvar');
    expect(first.evidence.at(-1)).toMatchObject({ sourceType: 'DATABASE', database: 'ClinVar' });
    expect(second.evidence.filter((item) => item.database === 'ClinVar')).toHaveLength(1);
    expect(second.externalAnnotation?.status).toBe('matched');
  });

  it('distinguishes ClinVar no-match, unavailable, and missing-ID states', async () => {
    const noMatch = createClinVarIdentifierAdapter({ getVariant: vi.fn().mockResolvedValue({ status: 'error', errorCode: 'not-found', message: 'No record.' }) });
    const unavailable = createClinVarIdentifierAdapter({ getVariant: vi.fn().mockResolvedValue({ status: 'error', errorCode: 'network', message: 'Service unavailable.' }) });
    const notQueriedService = { getVariant: vi.fn() };
    const notQueried = createClinVarIdentifierAdapter(notQueriedService);

    expect((await noMatch.annotate(makeVariant({ inputAnnotation: { identifier: 'rs404', source: 'Uploaded VCF INFO' } }))).status).toBe('no-match');
    expect((await unavailable.annotate(makeVariant({ inputAnnotation: { identifier: 'rs500', source: 'Uploaded VCF INFO' } }))).status).toBe('error');
    expect((await notQueried.annotate(makeVariant())).status).toBe('not-queried');
    expect(notQueriedService.getVariant).not.toHaveBeenCalled();
  });
});