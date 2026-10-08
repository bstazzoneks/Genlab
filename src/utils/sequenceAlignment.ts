import bioseq from 'bioseq';
import { cleanSequence } from './sequence';

export const MAX_ALIGNMENT_CELLS = 1_000_000;
export const MAX_ALIGNMENT_LENGTH = 10_000;

export interface NucleotideAlignment {
  seqA: string;
  seqB: string;
  score: number;
}

export const alignNucleotideSequences = (reference: string, query: string): NucleotideAlignment => {
  const referenceSequence = cleanSequence(reference).replaceAll('U', 'T');
  const querySequence = cleanSequence(query).replaceAll('U', 'T');
  if (!referenceSequence || !querySequence) throw new Error('alignment-empty-sequence');
  if (referenceSequence.length > MAX_ALIGNMENT_LENGTH || querySequence.length > MAX_ALIGNMENT_LENGTH || referenceSequence.length * querySequence.length > MAX_ALIGNMENT_CELLS) {
    throw new Error('alignment-too-large');
  }
  const result = bioseq.align(referenceSequence, querySequence, false);
  const [seqA, seqB] = bioseq.cigar2gaps(referenceSequence, querySequence, result.position, result.CIGAR);
  return { seqA, seqB, score: result.score };
};