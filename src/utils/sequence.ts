export interface SequenceAnalysis {
  sourceSequence?: string;
  length: number;
  gcPercentage: number;
  alphabet: 'DNA' | 'RNA' | 'protein' | 'unknown';
  transcription?: string;
  reverseComplement?: string;
  translation?: string;
  orfs?: OpenReadingFrame[];
  restrictionSites?: RestrictionSite[];
  primers?: PrimerCandidate[];
  nucleotideCounts?: Record<string, number>;
  ambiguousCount?: number;
  molecularWeightKDa?: number;
  shannonEntropy?: number;
  longestHomopolymer?: number;
}

export interface OpenReadingFrame {
  frame: number;
  start: number;
  end: number;
  protein: string;
}

export interface RestrictionSite {
  enzyme: string;
  recognitionSite: string;
  position: number;
}

export interface PrimerCandidate {
  direction: 'forward' | 'reverse';
  sequence: string;
  start: number;
  end: number;
  gcPercentage: number;
  meltingTemperature: number;
  warnings: string[];
}

export interface PrimerDesignOptions {
  length?: number;
  minGc?: number;
  maxGc?: number;
  minTm?: number;
  maxTm?: number;
}

export interface SequenceDifference {
  position: number;
  reference: string;
  query: string;
}

export interface SequenceComparison {
  referenceLength: number;
  queryLength: number;
  comparedLength: number;
  identityPercentage: number;
  differences: SequenceDifference[];
}

export type PopulationBand = 'common' | 'intermediate' | 'rare' | 'very-rare' | 'unknown';

export interface VariantObservation {
  chromosome?: string;
  identifier?: string;
  position: number;
  reference: string;
  alternate: string;
  alleleFrequency?: number;
  frequencyPercent: number;
  oneInEvery: number;
  classification: string;
  condition?: string;
  populationBand: PopulationBand;
}

export interface SequenceFileSummary {
  format: 'fasta' | 'vcf' | 'unknown';
  fileTypeLabel: string;
  geneCount: number;
  totalLength: number;
  variantCount: number;
  variants: VariantObservation[];
  populationSummary: string;
  pathogenicity: string;
  alleleFrequencyPercent: number;
  oneInEvery: number;
  recordCount?: number;
  gcPercentage?: number;
  ambiguousCount?: number;
  pathogenicVariantCount?: number;
  benignVariantCount?: number;
  chromosomeCount?: number;
  variantTypes?: Record<string, number>;
}

const dnaComplement: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' };
const codons: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L', TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S', TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W', CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L', CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q', CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R', ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T', AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K', AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V', GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A', GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

const nucleotideAlphabet = 'ACGTURYSWKMBDHVN';
const proteinAlphabet = 'ABCDEFGHIKLMNOPQRSTUVWYZX*';
const restrictionEnzymes: Array<Pick<RestrictionSite, 'enzyme' | 'recognitionSite'>> = [
  { enzyme: 'EcoRI', recognitionSite: 'GAATTC' },
  { enzyme: 'BamHI', recognitionSite: 'GGATCC' },
  { enzyme: 'HindIII', recognitionSite: 'AAGCTT' },
  { enzyme: 'PstI', recognitionSite: 'CTGCAG' },
  { enzyme: 'SmaI', recognitionSite: 'CCCGGG' },
];

export const cleanSequence = (sequence: string): string => sequence
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('>') && !line.trim().startsWith(';'))
  .join('')
  .toUpperCase()
  .replaceAll(/[\s0-9.\-]/g, '');
export const detectAlphabet = (sequence: string): SequenceAnalysis['alphabet'] => {
  const cleaned = cleanSequence(sequence);
  let nucleotide = Boolean(cleaned);
  let protein = Boolean(cleaned);
  let hasUracil = false;
  for (const symbol of cleaned) {
    if (!nucleotideAlphabet.includes(symbol)) nucleotide = false;
    if (!proteinAlphabet.includes(symbol)) protein = false;
    if (symbol === 'U') hasUracil = true;
  }
  if (nucleotide) return hasUracil ? 'RNA' : 'DNA';
  if (protein) return 'protein';
  return 'unknown';
};
export const calculateGcPercentage = (sequence: string): number => { const cleaned = cleanSequence(sequence); if (!cleaned.length) return 0; let gc = 0; for (const base of cleaned) if (base === 'G' || base === 'C') gc += 1; return Number(((gc / cleaned.length) * 100).toFixed(2)); };
export const transcribeDna = (sequence: string): string => cleanSequence(sequence).replaceAll('T', 'U');
export const reverseComplement = (sequence: string): string => { const cleaned = cleanSequence(sequence); let result = ''; for (let index = cleaned.length - 1; index >= 0; index -= 1) result += dnaComplement[cleaned[index]] ?? 'N'; return result; };
export const translateRna = (sequence: string): string => { const rna = cleanSequence(sequence).replaceAll('U', 'T'); let protein = ''; for (let index = 0; index + 2 < rna.length; index += 3) protein += codons[rna.slice(index, index + 3)] ?? 'X'; return protein; };

const findOrfsOnStrand = (sequence: string, strand: 1 | -1): OpenReadingFrame[] => {
  const results: OpenReadingFrame[] = [];
  for (let frame = 0; frame < 3; frame += 1) {
    const stops: number[] = [];
    let frameResults = 0;
    for (let index = frame; index + 2 < sequence.length; index += 3) {
      if (sequence.startsWith('TAA', index) || sequence.startsWith('TAG', index) || sequence.startsWith('TGA', index)) stops.push(index);
    }
    for (let start = frame; start + 2 < sequence.length && frameResults < 4; start += 3) {
      if (!sequence.startsWith('ATG', start)) continue;
      let low = 0;
      let high = stops.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (stops[middle] <= start) low = middle + 1;
        else high = middle;
      }
      const stop = stops[low];
      if (stop === undefined) continue;
      const protein = translateRna(sequence.slice(start, stop + 3));
      if (protein.length >= 3) {
        results.push({ frame: strand * (frame + 1), start: start + 1, end: stop + 3, protein });
        frameResults += 1;
      }
    }
  }
  return results;
};

export const findOpenReadingFrames = (sequence: string): OpenReadingFrame[] => {
  const cleaned = cleanSequence(sequence).replaceAll('U', 'T');
  return [...findOrfsOnStrand(cleaned, 1), ...findOrfsOnStrand(reverseComplement(cleaned), -1)];
};

export const findRestrictionSites = (sequence: string): RestrictionSite[] => {
  const cleaned = cleanSequence(sequence).replaceAll('U', 'T');
  return restrictionEnzymes.flatMap(({ enzyme, recognitionSite }) => {
    const sites: RestrictionSite[] = [];
    let position = cleaned.indexOf(recognitionSite);
    while (position >= 0) {
      sites.push({ enzyme, recognitionSite, position: position + 1 });
      position = cleaned.indexOf(recognitionSite, position + 1);
    }
    return sites;
  });
};

const calculateMeltingTemperature = (sequence: string): number => {
  const counts = sequence.match(/[ATGC]/g) ?? [];
  return 2 * (counts.filter((base) => base === 'A' || base === 'T').length) + 4 * (counts.filter((base) => base === 'G' || base === 'C').length);
};

const makePrimer = (sequence: string, direction: PrimerCandidate['direction'], start: number, end: number, options: Required<PrimerDesignOptions>): PrimerCandidate => {
  const gcPercentage = calculateGcPercentage(sequence);
  const meltingTemperature = calculateMeltingTemperature(sequence);
  const warnings: string[] = [];
  if (gcPercentage < options.minGc || gcPercentage > options.maxGc) warnings.push('gc-range');
  if (meltingTemperature < options.minTm || meltingTemperature > options.maxTm) warnings.push('tm-range');
  if (/(A{5,}|T{5,}|G{5,}|C{5,})/.test(sequence)) warnings.push('homopolymer');
  return { direction, sequence, start, end, gcPercentage, meltingTemperature, warnings };
};

export const designPrimers = (sequence: string, lengthOrOptions: number | PrimerDesignOptions = 20): PrimerCandidate[] => {
  const cleaned = cleanSequence(sequence).replaceAll('U', 'T');
  const options: Required<PrimerDesignOptions> = typeof lengthOrOptions === 'number'
    ? { length: lengthOrOptions, minGc: 40, maxGc: 60, minTm: 50, maxTm: 65 }
    : { length: 20, minGc: 40, maxGc: 60, minTm: 50, maxTm: 65, ...lengthOrOptions };
  if (!cleaned.length) return [];
  const primerLength = Math.min(options.length, cleaned.length);
  const forward = cleaned.slice(0, primerLength);
  const reverseStart = Math.max(cleaned.length - primerLength, 0);
  const reverse = reverseComplement(cleaned.slice(reverseStart));
  return [makePrimer(forward, 'forward', 1, primerLength, { ...options, length: primerLength }), makePrimer(reverse, 'reverse', reverseStart + 1, cleaned.length, { ...options, length: primerLength })];
};

const calculateSequenceMetrics = (sequence: string): Pick<SequenceAnalysis, 'nucleotideCounts' | 'ambiguousCount' | 'molecularWeightKDa' | 'shannonEntropy' | 'longestHomopolymer'> => {
  const counts: Record<string, number> = { A: 0, C: 0, G: 0, T: 0, N: 0 };
  let ambiguousCount = 0;
  let longestHomopolymer = 0;
  let currentRun = 0;
  let previousBase = '';
  for (const base of sequence) {
    counts[base] = (counts[base] ?? 0) + 1;
    if (!'ACGT'.includes(base)) ambiguousCount += 1;
    currentRun = base === previousBase ? currentRun + 1 : 1;
    longestHomopolymer = Math.max(longestHomopolymer, currentRun);
    previousBase = base;
  }
  const length = sequence.length || 1;
  const entropy = Object.values(counts).filter(Boolean).reduce((total, count) => { const probability = count / length; return total - probability * Math.log2(probability); }, 0);
  return { nucleotideCounts: counts, ambiguousCount, molecularWeightKDa: Number(((sequence.length * 0.33)).toFixed(2)), shannonEntropy: Number(entropy.toFixed(3)), longestHomopolymer };
};

export const compareSequences = (reference: string, query: string): SequenceComparison => {
  const referenceValue = cleanSequence(reference);
  const queryValue = cleanSequence(query);
  const comparedLength = Math.max(referenceValue.length, queryValue.length);
  const differences: SequenceDifference[] = [];
  let matches = 0;
  for (let index = 0; index < comparedLength; index += 1) {
    const referenceBase = referenceValue[index] ?? '-';
    const queryBase = queryValue[index] ?? '-';
    if (referenceBase === queryBase) matches += 1;
    else differences.push({ position: index + 1, reference: referenceBase, query: queryBase });
  }
  return { referenceLength: referenceValue.length, queryLength: queryValue.length, comparedLength, identityPercentage: comparedLength ? Number(((matches / comparedLength) * 100).toFixed(2)) : 0, differences };
};

export const analyzeSequence = (sequence: string, primerOptions: number | PrimerDesignOptions = 20): SequenceAnalysis => { const cleaned = cleanSequence(sequence); const alphabet = detectAlphabet(cleaned); if (alphabet === 'DNA') return { sourceSequence: sequence, length: cleaned.length, gcPercentage: calculateGcPercentage(cleaned), alphabet, transcription: transcribeDna(cleaned), reverseComplement: reverseComplement(cleaned), translation: translateRna(cleaned), orfs: findOpenReadingFrames(cleaned), restrictionSites: findRestrictionSites(cleaned), primers: designPrimers(cleaned, primerOptions), ...calculateSequenceMetrics(cleaned) }; if (alphabet === 'RNA') return { sourceSequence: sequence, length: cleaned.length, gcPercentage: calculateGcPercentage(cleaned), alphabet, translation: translateRna(cleaned), ...calculateSequenceMetrics(cleaned.replaceAll('U', 'T')) }; return { sourceSequence: sequence, length: cleaned.length, gcPercentage: 0, alphabet };
};

export const resolveLabAnalysis = (input: string, comparisonSequence = '', primerOptions: number | PrimerDesignOptions = 20, fileSummary?: SequenceFileSummary): { analysis: SequenceAnalysis; comparison?: SequenceComparison; summary?: SequenceFileSummary } => {
  const analysis = analyzeSequence(input, primerOptions);
  const comparison = comparisonSequence.trim() ? compareSequences(input, comparisonSequence) : undefined;
  const summary = input.trim() ? summarizeSequenceFile(input) : fileSummary;
  return { analysis, comparison, summary };
};

const parseFastaRecords = (input: string): Array<{ header: string; sequence: string }> => {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const records: Array<{ header: string; sequence: string }> = [];
  let current: { header: string; sequence: string } | undefined;

  for (const line of lines) {
    if (line.startsWith('>')) {
      if (current) records.push(current);
      current = { header: line.slice(1).trim(), sequence: '' };
      continue;
    }
    if (!current) {
      current = { header: 'sequence', sequence: '' };
    }
    current.sequence += cleanSequence(line);
  }

  if (current) records.push(current);
  return records;
};

const inferPopulationBand = (alleleFrequency?: number): PopulationBand => {
  if (alleleFrequency === undefined) return 'unknown';
  if (alleleFrequency >= 0.05) return 'common';
  if (alleleFrequency >= 0.01) return 'intermediate';
  if (alleleFrequency >= 0.001) return 'rare';
  return 'very-rare';
};

const parseClinicalSignificance = (info: string): string => {
  const value = info.match(/(?:^|;)CLNSIG=([^;]+)/i)?.[1]?.split(/[|,]/)[0]?.replaceAll('_', ' ').trim();
  return value || 'Not classified in input';
};

const parseClinicalCondition = (info: string, classification: string): string | undefined => {
  if (!classification.toLocaleLowerCase().split(/[;,|/]/).some((value) => ['pathogenic', 'likely pathogenic', 'risk factor'].includes(value.trim()))) return undefined;
  const raw = info.match(/(?:^|;)CLNDN=([^;]+)/i)?.[1];
  if (!raw) return undefined;
  const values = raw.split(/[|,]/).map((value) => {
    try { return decodeURIComponent(value).replaceAll('_', ' ').trim(); } catch { return value.replaceAll('_', ' ').trim(); }
  }).filter((value) => value && !/^(not specified|not provided|unknown|unclassified)$/i.test(value) && !/^(?:[A-Z0-9-]+[- ]?)?related disorder$/i.test(value));
  return [...new Set(values)].join('; ') || undefined;
};

const parseAlleleFrequency = (info: string): number | undefined => {
  const matches = [
    /(?:^|;)AF=([^;]+)/i,
    /(?:^|;)AFR=([^;]+)/i,
    /(?:^|;)MAX_AF=([^;]+)/i,
    /(?:^|;)ALLELE_FREQUENCY=([^;]+)/i,
  ].map((pattern) => info.match(pattern)?.[1]).find((value): value is string => Boolean(value));

  if (!matches) return undefined;
  const numericValues = matches.split(',').map((value) => Number.parseFloat(value)).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  return numericValues.length ? Math.max(...numericValues) : undefined;
};

const summarizeVariantLine = (line: string): VariantObservation | undefined => {
  if (!line || line.startsWith('#')) return undefined;
  const columns = line.split(/\s+/);
  if (columns.length < 8) return undefined;
  const [chromosomeValue, positionValue, identifierValue, reference, alternate] = columns;
  if (!positionValue || !reference || !alternate) return undefined;

  const position = Number.parseInt(positionValue, 10);
  if (!Number.isInteger(position) || position < 1) return undefined;
  const info = columns.slice(7).join(' ');
  const alleleFrequency = parseAlleleFrequency(info);
  const frequencyPercent = alleleFrequency === undefined ? 0 : Number((alleleFrequency * 100).toFixed(4));
  const oneInEvery = alleleFrequency && alleleFrequency > 0 ? Math.max(1, Math.round(1 / alleleFrequency)) : 0;
  const classification = parseClinicalSignificance(info);
  return {
    chromosome: chromosomeValue && chromosomeValue !== '.' ? chromosomeValue : undefined,
    identifier: identifierValue && identifierValue !== '.' ? identifierValue : undefined,
    position,
    reference,
    alternate,
    alleleFrequency,
    frequencyPercent,
    oneInEvery,
    classification,
    condition: parseClinicalCondition(info, classification),
    populationBand: inferPopulationBand(alleleFrequency),
  };
};

export const summarizeSequenceFile = (input: string): SequenceFileSummary => {
  const content = input.trim();
  if (!content) {
    return { format: 'unknown', fileTypeLabel: 'Unknown', geneCount: 0, totalLength: 0, variantCount: 0, variants: [], populationSummary: 'No sequence content was loaded.', pathogenicity: 'Insignificant / uncertain', alleleFrequencyPercent: 0, oneInEvery: 0 };
  }

  const vcfLines = content.split(/\r?\n/).filter((line) => line.startsWith('#CHROM') || (!line.startsWith('#') && /\s+[ACGTN]+\s+[ACGTN]+/i.test(line)));
  if (content.includes('#CHROM') || vcfLines.length > 1) {
    const variants = content.split(/\r?\n/).map((line) => summarizeVariantLine(line)).filter((variant): variant is VariantObservation => Boolean(variant));
    const strongest = variants.reduce((current, variant) => {
      const frequency = variant.alleleFrequency ?? 0;
      return current === undefined || frequency < (current.alleleFrequency ?? 0) ? variant : current;
    }, variants[0]);

    const summaryText = variants.length
      ? `VCF file with ${variants.length} variant call${variants.length === 1 ? '' : 's'}; the most frequent allele is ${strongest?.alleleFrequency ? (strongest.alleleFrequency * 100).toFixed(2) : '0.00'}% in the population.`
      : 'VCF file loaded but no valid variant rows were detected.';

    const classifications = [...new Set(variants.map((variant) => variant.classification).filter((value) => value !== 'Not classified in input'))];
    const reportedConditions = [...new Set(variants.map((variant) => variant.condition).filter((condition): condition is string => Boolean(condition)))];
    const pathogenicity = [classifications.join('; '), reportedConditions.length ? `Conditions supplied in VCF: ${reportedConditions.join('; ')}` : ''].filter(Boolean).join('; ') || 'No clinical classification annotation in this VCF.';

    const variantTypes = variants.reduce<Record<string, number>>((counts, variant) => { const type = variant.reference.length === variant.alternate.length ? 'SNV / substitution' : variant.reference.length < variant.alternate.length ? 'Insertion' : 'Deletion'; counts[type] = (counts[type] ?? 0) + 1; return counts; }, {});
    return {
      format: 'vcf',
      fileTypeLabel: 'VCF',
      geneCount: 0,
      totalLength: variants.reduce((total, variant) => total + Math.max(1, variant.position), 0),
      variantCount: variants.length,
      variants,
      populationSummary: summaryText,
      pathogenicity,
      alleleFrequencyPercent: strongest?.frequencyPercent ?? 0,
      oneInEvery: strongest?.oneInEvery ?? 0,
      recordCount: variants.length,
      pathogenicVariantCount: variants.filter((variant) => /^(pathogenic|likely pathogenic)(?:\b|\/)/i.test(variant.classification)).length,
      benignVariantCount: variants.filter((variant) => /^(benign|likely benign)(?:\b|\/)/i.test(variant.classification)).length,
      chromosomeCount: new Set(content.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter((chromosome) => chromosome && chromosome !== '#CHROM' && !chromosome.startsWith('#'))).size,
      variantTypes,
    };
  }

  const fastaRecords = parseFastaRecords(content);
  if (fastaRecords.length) {
    const sequences = fastaRecords.map((record) => record.sequence).filter((sequence) => sequence.length > 0);
    let ambiguousCount = 0;
    let gcCount = 0;
    let nucleotideCount = 0;
    for (const sequence of sequences) {
      for (const base of sequence) {
        nucleotideCount += 1;
        if (base === 'G' || base === 'C') gcCount += 1;
        if (/[RYSWKMBDHVN]/.test(base)) ambiguousCount += 1;
      }
    }

    return {
      format: 'fasta',
      fileTypeLabel: 'FASTA',
      geneCount: fastaRecords.length,
      totalLength: sequences.reduce((total, sequence) => total + sequence.length, 0),
      variantCount: 0,
      variants: [],
      populationSummary: 'FASTA contains sequence data, not variant calls. No variants are inferred from ambiguous bases.',
      pathogenicity: 'No clinical classification data is present in FASTA sequence data.',
      alleleFrequencyPercent: 0,
      oneInEvery: 0,
      recordCount: sequences.length,
      gcPercentage: nucleotideCount ? Number(((gcCount / nucleotideCount) * 100).toFixed(2)) : 0,
      ambiguousCount,
    };
  }

  return {
    format: 'unknown',
    fileTypeLabel: 'Unknown',
    geneCount: 0,
    totalLength: content.length,
    variantCount: 0,
    variants: [],
    populationSummary: 'Sequence content could not be parsed as FASTA or VCF.',
    pathogenicity: 'Insignificant / uncertain',
    alleleFrequencyPercent: 0,
    oneInEvery: 0,
  };
};

export const parseSequenceFile = (input: string): SequenceFileSummary => summarizeSequenceFile(input);

export const parseFastaData = (input: string): Array<{ header: string; sequence: string }> => parseFastaRecords(input);

