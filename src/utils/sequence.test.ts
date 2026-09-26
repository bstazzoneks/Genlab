import { describe, expect, it } from 'vitest';
import { analyzeSequence, calculateGcPercentage, compareSequences, designPrimers, findOpenReadingFrames, findRestrictionSites, reverseComplement, summarizeSequenceFile, transcribeDna, translateRna } from './sequence';

describe('sequence analysis', () => {
  it('calculates DNA metrics and transformations', () => {
    expect(calculateGcPercentage('ATGC')).toBe(50);
    expect(transcribeDna('ATGC')).toBe('AUGC');
    expect(reverseComplement('ATGC')).toBe('GCAT');
    expect(translateRna('AUGGCC')).toBe('MA');
  });

  it('returns structured results and rejects unknown alphabets', () => {
    expect(analyzeSequence('ATGCCG')).toMatchObject({ alphabet: 'DNA', length: 6, gcPercentage: 66.67 });
    expect(analyzeSequence('123')).toMatchObject({ alphabet: 'unknown', length: 0 });
  });

  it('accepts FASTA headers and multiline DNA sequences', () => {
    expect(analyzeSequence('>SHANK3 transcript\nATGCCG\nTTAA')).toMatchObject({ alphabet: 'DNA', length: 10 });
  });

  it('recognizes protein sequences with extended amino-acid symbols', () => {
    expect(analyzeSequence('>SHANK3 protein\nMKWVTFISLLFLFSSAYSRGVFRR\n')).toMatchObject({ alphabet: 'protein', length: 24 });
    expect(analyzeSequence('ACDEFGHIKLMNPQRSTVWYBXZOU')).toMatchObject({ alphabet: 'protein' });
  });

  it('recognizes ambiguous nucleotide FASTA sequences', () => {
    expect(analyzeSequence('>sequence\nATGNNRY')).toMatchObject({ alphabet: 'DNA', length: 7 });
  });

  it('finds ORFs, restriction sites, and primer candidates', () => {
    const sequence = 'ATGAAAGAATTCGGATCCTAA';
    expect(findOpenReadingFrames(sequence)).toContainEqual(expect.objectContaining({ frame: 1, start: 1 }));
    expect(findRestrictionSites(sequence).map((site) => site.enzyme)).toEqual(['EcoRI', 'BamHI']);
    expect(designPrimers(sequence, 8)).toHaveLength(2);
    expect(analyzeSequence(sequence).restrictionSites).toHaveLength(2);
    expect(analyzeSequence(sequence, { length: 8, minGc: 0, maxGc: 100, minTm: 0, maxTm: 100 }).primers?.every((primer) => primer.warnings.length === 0)).toBe(true);
  });

  it('compares sequences and reports positional differences', () => {
    expect(compareSequences('ATGC', 'ATTC')).toMatchObject({ comparedLength: 4, identityPercentage: 75, differences: [{ position: 3, reference: 'G', query: 'T' }] });
  });

  it('summarizes FASTA without treating ambiguous bases as variants and reads VCF annotations', () => {
    const fastaSummary = summarizeSequenceFile('>BRCA1\nATGNNR\n');
    expect(fastaSummary.format).toBe('fasta');
    expect(fastaSummary.variantCount).toBe(0);
    expect(fastaSummary.variants).toHaveLength(0);
    expect(fastaSummary.ambiguousCount).toBe(3);
    expect(fastaSummary.populationSummary).toMatch(/not variant calls/i);

    const vcfSummary = summarizeSequenceFile('##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n1\t100\t.\tA\tT\t.\tPASS\tAF=0.002;CLNSIG=Pathogenic;CLNDN=Cystic_fibrosis\n1\t200\t.\tC\tG\t.\tPASS\tAF=0.47;CLNSIG=Likely_benign;CLNDN=not_specified');
    expect(vcfSummary.format).toBe('vcf');
    expect(vcfSummary.variantCount).toBe(2);
    expect(vcfSummary.variants[0].alleleFrequency).toBeLessThan(0.05);
    expect(vcfSummary.pathogenicity).toMatch(/pathogenic|insignificant|benign/i);
    expect(vcfSummary.variants[0].classification).toBe('Pathogenic');
    expect(vcfSummary.variants[0].condition).toBe('Cystic fibrosis');
    expect(vcfSummary.variants[1].condition).toBeUndefined();
    expect(vcfSummary.pathogenicity).toContain('Cystic fibrosis');
  });

  it('does not derive clinical classifications from consequence or rarity alone', () => {
    const summary = summarizeSequenceFile('##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n1\t100\t.\tA\tT\t.\tPASS\tAF=0.00001;CSQ=stop_gained');
    expect(summary.variants[0].classification).toBe('Not classified in input');
    expect(summary.pathogenicity).toMatch(/No clinical classification annotation/i);
  });
});
