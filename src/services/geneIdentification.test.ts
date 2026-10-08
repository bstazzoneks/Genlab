import { describe, expect, it } from 'vitest';
import { identifySequence, unavailableGeneIdentification } from './geneIdentification';
import { renderGeneIdentificationResults } from '../components/sitePages';

const reference = 'ACGTTGCAAGTCCGATGCTAGCTGATCGTACCGTAGCTAGGCTAACGTAGCATGCTAGC';
const changeBase = (sequence: string, position: number): string => {
  const bases = [...sequence];
  bases[position] = bases[position] === 'A' ? 'C' : 'A';
  return bases.join('');
};

describe('gene identification from supplied references', () => {
  it('reports a high-confidence DNA reference match without treating the header as proof', () => {
    const longReference = reference.repeat(3);
    const result = identifySequence(`>gene=TESTGENE\n${longReference}`, longReference);

    expect(result.records[0]).toMatchObject({ moleculeType: 'DNA', confidence: 'HIGH', candidateLabel: 'TESTGENE', identityPercent: 100, coveragePercent: 100 });
    expect(result.records[0]?.reasons[0]).toContain('unverified input label');
    expect(result.records[0]?.variants).toEqual([]);
    expect(result.records[0]?.evidence[0]?.source).toBe('User-provided reference');
  });

  it('detects SNVs, insertions, and deletions only against a matching supplied reference', () => {
    const snv = identifySequence(changeBase(reference, 21), reference).records[0];
    const insertion = identifySequence(`${reference.slice(0, 25)}A${reference.slice(25)}`, reference).records[0];
    const deletion = identifySequence(`${reference.slice(0, 25)}${reference.slice(26)}`, reference).records[0];

    expect(snv?.confidence).toBe('MEDIUM');
    expect(snv?.variants).toContainEqual(expect.objectContaining({ type: 'SNV', nucleotideChange: expect.stringMatching(/^[ACGT]>[ACGT]$/) }));
    expect(insertion?.variants).toContainEqual(expect.objectContaining({ type: 'insertion', reference: '-', alternative: 'A' }));
    expect(insertion?.coveragePercent).toBeLessThan(100);
    expect(deletion?.variants).toContainEqual(expect.objectContaining({ type: 'deletion', alternative: '-' }));
    expect(deletion?.variants[0]).not.toHaveProperty('hgvs');
    expect(deletion?.variants[0]).not.toHaveProperty('predictedConsequence');
  });

  it('groups adjacent substitutions as an MNV', () => {
    const changed = [...reference];
    changed[25] = changed[25] === 'A' ? 'C' : 'A';
    changed[26] = changed[26] === 'A' ? 'C' : 'A';
    const result = identifySequence(changed.join(''), reference).records[0];

    expect(result?.variants).toContainEqual(expect.objectContaining({ type: 'MNV', reference: expect.any(String), alternative: expect.any(String) }));
  });

  it('recognizes RNA but does not send or mislabel sequences without a reference', () => {
    const rna = reference.replaceAll('T', 'U');
    const noReference = identifySequence(`>gene=TP53\n${rna}`);
    const matched = identifySequence(`>gene=TP53\n${rna}`, rna);

    expect(noReference.records[0]).toMatchObject({ moleculeType: 'RNA', confidence: 'NO_MATCH', variants: [] });
    expect(noReference.records[0]?.reasons[0]).toContain('No reference sequence');
    expect(matched.records[0]).toMatchObject({ moleculeType: 'RNA', confidence: 'MEDIUM', identityPercent: 100 });
  });

  it('keeps RNA notation when reporting a difference against an RNA reference', () => {
    const query = reference.replace('T', 'C');
    const rnaReference = reference.replaceAll('T', 'U');
    const rnaQuery = query.replaceAll('T', 'U');
    const result = identifySequence(rnaQuery, rnaReference).records[0];

    expect(result?.variants).toContainEqual(expect.objectContaining({ reference: 'U', alternative: 'C', nucleotideChange: 'U>C' }));
    expect(result?.alignedReference).toContain('U');
  });

  it('returns no match for proteins rather than applying nucleotide scoring', () => {
    const protein = 'MKWVTFISLLFLFSSAYSRGVFRR';
    expect(identifySequence(protein, protein).records[0]).toMatchObject({ moleculeType: 'protein', confidence: 'NO_MATCH', variants: [] });
  });

  it('keeps an explicit no-match result when local identification is unavailable', () => {
    const result = unavailableGeneIdentification(`>record\n${reference}`, 'Local alignment unavailable.');

    expect(result.records[0]).toMatchObject({ confidence: 'NO_MATCH', variants: [], reasons: ['Local alignment unavailable.'] });
  });

  it('renders an unknown match as NO MATCH and labels header symbols as unverified', () => {
    const result = identifySequence(`>gene=TP53\n${reference}`);
    const markup = renderGeneIdentificationResults(result);

    expect(markup).toContain('NO MATCH');
    expect(markup).toContain('TP53');
    expect(markup).toContain('unverified');
    expect(markup).toContain('No reference sequence was supplied');
    expect(markup).not.toContain('Possible gene: TP53');
    expect(markup).toContain('id="export-identification-json"');
    expect(markup).toContain('<details');
  });

  it('renders variant details with raw changes and explicit unavailable HGVS', () => {
    const result = identifySequence(changeBase(reference, 21), reference);
    const markup = renderGeneIdentificationResults(result);

    expect(markup).toContain('Differences against supplied reference');
    expect(markup).toContain('Original representation');
    expect(markup).toContain('HGVS');
    expect(markup).toContain('Consequence unknown');
    expect(markup).toContain('not a genomic coordinate');
  });

  it('handles unknown, invalid, too-short, and low-similarity sequences conservatively', () => {
    const invalid = identifySequence('J'.repeat(30), reference).records[0];
    const short = identifySequence('ATGCG', reference).records[0];
    const lowSimilarity = identifySequence('T'.repeat(reference.length), reference).records[0];

    expect(invalid).toMatchObject({ moleculeType: 'unknown', confidence: 'NO_MATCH', variants: [] });
    expect(short).toMatchObject({ confidence: 'NO_MATCH', variants: [] });
    expect(lowSimilarity?.confidence).toBe('NO_MATCH');
    expect(lowSimilarity?.variants).toEqual([]);
    expect(identifySequence(`>${'sequence'}\n${reference.replace('A', 'N')}`, reference).records[0]).toMatchObject({ confidence: 'NO_MATCH', variants: [] });
  });

  it('labels partial similarity as LOW and does not call its differences as variants', () => {
    const query = [...reference].map((base, index) => index < 15 ? (base === 'A' ? 'C' : 'A') : base).join('');
    const result = identifySequence(query, reference).records[0];

    expect(result?.confidence).toBe('LOW');
    expect(result?.variants).toEqual([]);
  });

  it('does not concatenate multiple reference records into a false match', () => {
    const result = identifySequence(reference, `>ref-one\n${reference}\n>ref-two\n${reference}`);

    expect(result.records[0]).toMatchObject({ confidence: 'NO_MATCH', variants: [] });
    expect(result.records[0]?.reasons[0]).toContain('exactly one reference');
  });

  it('returns one independent result for each FASTA record', () => {
    const changed = changeBase(reference, 10);
    const results = identifySequence(`>record-one\n${reference}\n>record-two\n${changed}`, reference);

    expect(results.records).toHaveLength(2);
    expect(results.records.map((record) => record.header)).toEqual(['record-one', 'record-two']);
    expect(results.records[0]?.variants).toEqual([]);
    expect(results.records[1]?.variants).toHaveLength(1);
    expect(identifySequence(`>record-one\n${reference}\n>record-two\n${changed}`, reference, 'TP53').records.map((record) => record.candidateLabel)).toEqual([undefined, undefined]);
  });

  it('annotates existing local calls and builds a sample-presence matrix from FASTA records', () => {
    const changed = changeBase(reference, 10);
    const result = identifySequence(`>sample-A\n${reference}\n>sample-B\n${changed}`, reference);
    const markup = renderGeneIdentificationResults(result);

    expect(result.records[1]?.variants[0]).toMatchObject({ consequence: 'unknown', externalAnnotation: { status: 'not-connected' }, normalization: { status: 'unchanged' } });
    expect(result.records[1]?.variants[0]?.evidence.map((item) => item.sourceType)).toEqual(['USER-PROVIDED', 'COMPUTED']);
    expect(result.sampleComparison?.[0]).toMatchObject({ sampleTotal: 2, sampleCount: 1, samplePrevalence: 0.5, presentIn: ['sample-B'], allSampleIds: ['sample-A', 'sample-B'] });
    expect(markup).toContain('Multi-sample variant matrix');
    expect(markup).toContain('Variant positions on supplied reference');
    expect(markup).toContain('data-variant-filter="type"');
  });

  it('preserves VCF INFO annotations as user-provided and does not claim external verification', () => {
    const vcf = '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n17\t43071077\trs123\tA\tG\t.\tPASS\tAF=0.01;CLNSIG=Pathogenic;CLNDN=Example_condition';
    const result = identifySequence(vcf);
    const variant = result.records[0]?.variants[0];
    const markup = renderGeneIdentificationResults(result);

    expect(result.records[0]).toMatchObject({ inputFormat: 'vcf', confidence: 'NO_MATCH' });
    expect(variant).toMatchObject({ chromosome: '17', position: 43071077, inputAnnotation: { identifier: 'rs123', classification: 'Pathogenic', reportedCondition: 'Example condition', alleleFrequency: 0.01, source: 'Uploaded VCF INFO' }, externalAnnotation: { status: 'not-queried' }, normalization: { status: 'unavailable' } });
    expect(variant?.populationFrequencies).toBeUndefined();
    expect(markup).toContain('Input VCF annotations');
    expect(markup).toContain('Look up this rsID in ClinVar');
    expect(markup).toContain('data-identifier="rs123"');
    expect(markup).toContain('not independently verified');
  });

  it('limits total work across many FASTA records', () => {
    const longReference = reference.repeat(8);
    const input = Array.from({ length: 6 }, (_, index) => `>record-${index + 1}\n${longReference}`).join('\n');
    const result = identifySequence(input, longReference);

    expect(result.records.slice(0, 4).every((record) => record.confidence === 'HIGH')).toBe(true);
    expect(result.records[4]).toMatchObject({ confidence: 'NO_MATCH', variants: [] });
    expect(result.records[4]?.reasons[0]).toContain('size limit');
  });
});