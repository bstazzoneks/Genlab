import type { DetectedVariantType, GeneIdentificationResult, MatchConfidence, MoleculeType, SequenceEvidence, SequenceMatchRecord } from '../models/geneIdentification';
import { cleanSequence, detectAlphabet, parseFastaData, summarizeSequenceFile } from '../utils/sequence';
import { alignNucleotideSequences, MAX_ALIGNMENT_CELLS, MAX_ALIGNMENT_LENGTH } from '../utils/sequenceAlignment';
import { detectVariantsFromAlignment } from './variantDetection';
import { annotateGeneIdentificationResult } from './variantAnnotation';

const minimumLength = 20;
const alignmentMethod = 'Global pairwise alignment (bioseq, nucleotide scoring)';
const limitations = [
  'A sequence match to a user-provided reference is not a database-backed gene identification.',
  'Coordinates, transcript, strand, HGVS, protein changes, and coding consequences require a verified reference annotation and are not inferred here.',
  'Queries are processed locally; no sequence is submitted to an external service. Alignment is limited to one million cells per analysis.',
];

const candidateFromHeader = (header: string, fallback?: string): string | undefined => {
  const explicit = header.match(/\b(?:gene|symbol|gene_name)[=: ]+([A-Za-z][A-Za-z0-9-]*)/i)?.[1]
    ?? header.match(/\|([A-Z0-9-]+)_HUMAN\b/i)?.[1];
  if (explicit) return explicit.toLocaleUpperCase();
  const firstToken = header.split(/[|,;\s]/)[0]?.replace(/^gene:/i, '');
  const reserved = ['SEQUENCE', 'GENE', 'TRANSCRIPT', 'PROTEIN', 'SAMPLE', 'UNKNOWN'];
  if (firstToken && /^[A-Z][A-Z0-9-]{1,14}$/.test(firstToken) && !reserved.includes(firstToken) && !/^(NM|NC|NR|NP|XM|XP|ENSG|ENST|CHR)\d/i.test(firstToken)) return firstToken;
  return fallback;
};

const confidenceFor = (identity: number, coverage: number, length: number): MatchConfidence => {
  if (length >= 100 && identity >= 98.5 && coverage >= 90) return 'HIGH';
  if (length >= 50 && identity >= 90 && coverage >= 80) return 'MEDIUM';
  if (length >= minimumLength && identity >= 70 && coverage >= 70) return 'LOW';
  return 'NO_MATCH';
};

const noMatch = (header: string, sequence: string, moleculeType: MoleculeType, candidateLabel: string | undefined, reason: string, timestamp: string): SequenceMatchRecord => ({
  header,
  moleculeType,
  sequenceLength: sequence.length,
  candidateLabel,
  confidence: 'NO_MATCH',
  variants: [],
  reasons: [reason],
  evidence: [{ sourceType: 'COMPUTED', source: 'Local analysis', method: reason, confidence: 'NO_MATCH', timestamp, limitations: [...limitations] }],
});

const identifyRecord = (header: string, sequenceInput: string, referenceInput: string, fallbackCandidate: string | undefined, timestamp: string, remainingCells: number): SequenceMatchRecord => {
  const sequence = cleanSequence(sequenceInput);
  const reference = cleanSequence(referenceInput);
  const moleculeType = detectAlphabet(sequence);
  const candidateLabel = candidateFromHeader(header, fallbackCandidate);
  if (moleculeType === 'unknown') return noMatch(header, sequence, moleculeType, candidateLabel, 'The sequence contains an unsupported or invalid alphabet.', timestamp);
  if (sequence.length < minimumLength) return noMatch(header, sequence, moleculeType, candidateLabel, `The query is shorter than ${minimumLength} residues and is not specific enough for matching.`, timestamp);
  if (!reference) return noMatch(header, sequence, moleculeType, candidateLabel, 'No reference sequence was supplied; no gene match or variants can be established.', timestamp);

  const referenceType = detectAlphabet(reference);
  if (referenceType === 'unknown') return noMatch(header, sequence, moleculeType, candidateLabel, 'The reference sequence contains an unsupported or invalid alphabet.', timestamp);
  if (moleculeType === 'protein' || referenceType === 'protein') return noMatch(header, sequence, moleculeType, candidateLabel, 'Protein matching is unavailable locally because a protein substitution matrix or BLASTP result is not available.', timestamp);
  if (referenceType !== moleculeType && !(referenceType === 'DNA' && moleculeType === 'RNA') && !(referenceType === 'RNA' && moleculeType === 'DNA')) {
    return noMatch(header, sequence, moleculeType, candidateLabel, 'The query and reference molecule types are incompatible.', timestamp);
  }
  if (!/^[ACGTU]+$/.test(sequence) || !/^[ACGTU]+$/.test(reference)) {
    return noMatch(header, sequence, moleculeType, candidateLabel, 'Ambiguous nucleotide symbols prevent an exact local identity and variant assessment.', timestamp);
  }

  if (sequence.length > MAX_ALIGNMENT_LENGTH || reference.length > MAX_ALIGNMENT_LENGTH || sequence.length * reference.length > remainingCells) {
    return noMatch(header, sequence, moleculeType, candidateLabel, 'The comparison exceeds the local alignment size limit; no variants were inferred.', timestamp);
  }

  const alignment = alignNucleotideSequences(reference, sequence);
  const displayedAlignment = referenceType === 'RNA'
    ? { ...alignment, seqA: alignment.seqA.replaceAll('T', 'U'), seqB: alignment.seqB.replaceAll('T', 'U') }
    : alignment;
  let matches = 0;
  let alignedQueryBases = 0;
  for (let index = 0; index < alignment.seqA.length; index += 1) {
    if (alignment.seqA[index] !== '-' && alignment.seqB[index] !== '-') alignedQueryBases += 1;
    if (alignment.seqA[index] !== '-' && alignment.seqA[index] === alignment.seqB[index]) matches += 1;
  }
  const identityPercent = alignment.seqA.length ? Number((matches / alignment.seqA.length * 100).toFixed(2)) : 0;
  const coveragePercent = sequence.length ? Number((alignedQueryBases / sequence.length * 100).toFixed(2)) : 0;
  const confidence = confidenceFor(identityPercent, coveragePercent, sequence.length);
  const evidence: SequenceEvidence[] = [
    { sourceType: 'USER-PROVIDED', source: 'User-provided reference', method: 'Reference sequence supplied locally by the user.', value: 'Reference used for local comparison.', confidence, timestamp, limitations: [...limitations] },
    { sourceType: 'COMPUTED', source: 'GeneLab local alignment', method: alignmentMethod, identityPercent, coveragePercent, confidence, timestamp, limitations: [...limitations] },
  ];
  const reasons = confidence === 'NO_MATCH'
    ? ['The local alignment did not meet the minimum identity and coverage thresholds.']
    : candidateLabel
      ? [`Sequence similarity was measured against the supplied reference. “${candidateLabel}” is an unverified input label, not an independently identified gene.`]
      : ['Sequence similarity was measured against the supplied reference; no gene annotation was provided.'];
  const variants = confidence === 'HIGH' || confidence === 'MEDIUM'
    ? detectVariantsFromAlignment(alignment.seqA, alignment.seqB, evidence)
    : [];
  if (referenceType === 'RNA') variants.forEach((variant) => {
    variant.reference = variant.reference.replaceAll('T', 'U');
    variant.alternative = variant.alternative.replaceAll('T', 'U');
    variant.nucleotideChange = variant.nucleotideChange.replaceAll('T', 'U');
  });

  return {
    header,
    moleculeType,
    sequenceLength: sequence.length,
    referenceLength: reference.length,
    candidateLabel,
    confidence,
    identityPercent,
    coveragePercent,
    alignmentScore: alignment.score,
    alignedReference: displayedAlignment.seqA,
    alignedQuery: displayedAlignment.seqB,
    variants,
    reasons,
    evidence,
  };
};

export const identifySequence = (input: string, referenceInput = '', fallbackCandidate?: string): GeneIdentificationResult => {
  const generatedAt = new Date().toISOString();
  const summary = summarizeSequenceFile(input);
  if (summary.format === 'vcf') {
    const variants = summary.variants.map((observation) => {
      const type: DetectedVariantType = observation.alternate.includes(',') ? 'unknown' : observation.reference.length < observation.alternate.length ? 'insertion' : observation.reference.length > observation.alternate.length ? 'deletion' : observation.reference.length === 1 ? 'SNV' : 'MNV';
      const evidence: SequenceEvidence[] = [{ sourceType: 'USER-PROVIDED', source: 'Uploaded VCF INFO', method: 'Read from the supplied VCF row; not independently validated.', value: `CLNSIG=${observation.classification}; CLNDN=${observation.condition ?? ''}; AF=${observation.alleleFrequency ?? ''}`, confidence: 'LOW', timestamp: generatedAt, limitations: ['VCF annotations are user-provided and not independently verified.', 'No reference assembly or transcript was resolved for normalization or HGVS.'] }];
      return {
        position: observation.position,
        reference: observation.reference,
        alternative: observation.alternate,
        type,
        nucleotideChange: `${observation.reference}>${observation.alternate}`,
        chromosome: observation.chromosome,
        confidence: 'LOW' as const,
        normalization: { status: 'unavailable' as const, original: { position: observation.position, coordinate: 'input-vcf' as const, reference: observation.reference, alternative: observation.alternate }, method: 'VCF position retained as supplied; no assembly-matched reference sequence was provided.' },
        inputAnnotation: { identifier: observation.identifier, classification: observation.classification, reportedCondition: observation.condition, alleleFrequency: observation.alleleFrequency, source: 'Uploaded VCF INFO' },
        externalAnnotation: { status: 'not-queried' as const, message: 'VCF INFO values are shown as supplied; no external coordinate lookup was attempted.' },
        evidence,
      };
    });
    const record = noMatch('VCF', '', 'unknown', fallbackCandidate, 'VCF calls are displayed as supplied annotations; gene identity was not inferred.', generatedAt);
    return { generatedAt, records: [{ ...record, inputFormat: 'vcf', variants }], limitations: [...limitations] };
  }
  const inputRecords = parseFastaData(input);
  const referenceRecords = parseFastaData(referenceInput);
  if (referenceRecords.length > 1) {
    return { generatedAt, records: inputRecords.map((record) => noMatch(record.header, cleanSequence(record.sequence), detectAlphabet(record.sequence), candidateFromHeader(record.header, inputRecords.length === 1 ? fallbackCandidate : undefined), 'Provide exactly one reference sequence; multiple references are not combined.', generatedAt)), limitations: [...limitations] };
  }
  const reference = referenceRecords[0]?.sequence ?? referenceInput;
  const referenceLength = cleanSequence(reference).length;
  let remainingCells = MAX_ALIGNMENT_CELLS;
  const records = inputRecords.map((record) => {
    const sequenceLength = cleanSequence(record.sequence).length;
    const identified = identifyRecord(record.header, record.sequence, reference, inputRecords.length === 1 ? fallbackCandidate : undefined, generatedAt, remainingCells);
    if (identified.alignmentScore !== undefined) remainingCells -= sequenceLength * referenceLength;
    return identified;
  });
  const result: GeneIdentificationResult = { generatedAt, records, limitations: [...limitations] };
  return annotateGeneIdentificationResult(result, new Map(records.map((record) => [record.header, reference])));
};

export const unavailableGeneIdentification = (input: string, reason: string): GeneIdentificationResult => {
  const generatedAt = new Date().toISOString();
  const records = parseFastaData(input).map((record) => noMatch(record.header, cleanSequence(record.sequence), detectAlphabet(record.sequence), undefined, reason, generatedAt));
  return { generatedAt, records, limitations: [...limitations] };
};

export const geneIdentificationService = { identify: identifySequence };