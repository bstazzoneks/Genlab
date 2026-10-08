import type { DetectedSequenceVariant, SequenceEvidence } from '../models/geneIdentification';

const isUnambiguous = (sequence: string): boolean => /^[ACGT]+$/.test(sequence);

export const detectVariantsFromAlignment = (reference: string, query: string, evidence: SequenceEvidence[]): DetectedSequenceVariant[] => {
  if (reference.length !== query.length) throw new Error('alignment-length-mismatch');
  const variants: DetectedSequenceVariant[] = [];
  let referencePosition = 0;
  let index = 0;

  while (index < reference.length) {
    const referenceBase = reference[index];
    const queryBase = query[index];
    if (referenceBase === queryBase) {
      if (referenceBase !== '-') referencePosition += 1;
      index += 1;
      continue;
    }

    const start = index;
    const startPosition = referencePosition + 1;
    if (referenceBase === '-') {
      while (index < reference.length && reference[index] === '-' && query[index] !== '-') index += 1;
      const alternative = query.slice(start, index).replaceAll('-', '');
      if (isUnambiguous(alternative)) variants.push({ position: referencePosition, reference: '-', alternative, type: 'insertion', nucleotideChange: `ins${alternative}`, evidence });
      continue;
    }

    if (queryBase === '-') {
      while (index < reference.length && query[index] === '-' && reference[index] !== '-') {
        referencePosition += 1;
        index += 1;
      }
      const deleted = reference.slice(start, index).replaceAll('-', '');
      if (isUnambiguous(deleted)) variants.push({ position: startPosition, reference: deleted, alternative: '-', type: 'deletion', nucleotideChange: `del${deleted}`, evidence });
      continue;
    }

    while (index < reference.length && reference[index] !== '-' && query[index] !== '-' && reference[index] !== query[index]) {
      index += 1;
      referencePosition += 1;
    }
    const referenceAllele = reference.slice(start, index);
    const alternateAllele = query.slice(start, index);
    if (isUnambiguous(referenceAllele) && isUnambiguous(alternateAllele)) {
      const type = referenceAllele.length === 1 ? 'SNV' : 'MNV';
      variants.push({ position: startPosition, reference: referenceAllele, alternative: alternateAllele, type, nucleotideChange: `${referenceAllele}>${alternateAllele}`, evidence });
    }
  }
  return variants;
};