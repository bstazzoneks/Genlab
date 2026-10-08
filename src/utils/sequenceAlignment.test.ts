import { describe, expect, it } from 'vitest';
import { alignNucleotideSequences } from './sequenceAlignment';

describe('local nucleotide alignment', () => {
  it('aligns identical and substituted nucleotide sequences', () => {
    const exact = alignNucleotideSequences('ATGCCGTTAAGC', 'ATGCCGTTAAGC');
    const substituted = alignNucleotideSequences('ATGCCGTTAAGC', 'ATGTCGTTAAGC');

    expect(exact).toMatchObject({ seqA: 'ATGCCGTTAAGC', seqB: 'ATGCCGTTAAGC' });
    expect(substituted.seqA.length).toBe(substituted.seqB.length);
    expect(substituted.seqA).toContain('C');
    expect(substituted.seqB).toContain('T');
  });

  it('places insertions and deletions in alignment gap columns', () => {
    const reference = 'ACGTTGCAAGTC';
    const insertion = alignNucleotideSequences(reference, 'ACGTTAGCAAGTC');
    const deletion = alignNucleotideSequences(reference, 'ACGTTCAAGTC');

    expect(insertion.seqA).toContain('-');
    expect(deletion.seqB).toContain('-');
    expect(insertion.seqA.length).toBe(insertion.seqB.length);
    expect(deletion.seqA.length).toBe(deletion.seqB.length);
  });

  it('normalizes RNA U to T for nucleotide alignment', () => {
    expect(alignNucleotideSequences('AUGCCG', 'ATGCCG')).toMatchObject({ seqA: 'ATGCCG', seqB: 'ATGCCG' });
  });

  it('rejects empty or computationally excessive comparisons', () => {
    expect(() => alignNucleotideSequences('', 'ATGC')).toThrow('alignment-empty-sequence');
    expect(() => alignNucleotideSequences('A'.repeat(1001), 'C'.repeat(1000))).toThrow('alignment-too-large');
  });
});