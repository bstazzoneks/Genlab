import type { NumericSeries, QpcrAggregate, QpcrColumnMapping, VcfFormatDefinition, VcfInfoDefinition, VcfVariantRecord } from '../models/fileImport';
import { parseDelimitedRows } from './csv';

export const computeFileSha256 = async (file: Blob): Promise<string> => {
  if (!globalThis.crypto?.subtle) throw new Error('checksum-unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export const MAX_POSITION_QUALITY_READS = 10_000;
const nucleotide = /^[ACGT]$/i;

export class FileParseError extends Error {
  constructor(readonly lineNumber: number, readonly reason: string) { super(`${reason} (line ${lineNumber})`); this.name = 'FileParseError'; }
}

export async function* streamTextLines(file: File, signal: AbortSignal, maxBytes: number, onProgress: (bytesRead: number) => void): AsyncGenerator<string> {
  let stream: ReadableStream<Uint8Array> = file.stream();
  if (file.name.toLocaleLowerCase().endsWith('.gz')) {
    if (!('DecompressionStream' in globalThis)) throw new Error('gzip-unsupported');
    stream = stream.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  }
  const reader = stream.getReader();
  const cancelReader = (): void => { void reader.cancel(); };
  signal.addEventListener('abort', cancelReader, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let bytesRead = 0;
  let linesRead = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('import-cancelled');
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) throw new Error('file-too-large');
      onProgress(bytesRead);
      pending += decoder.decode(value, { stream: true });
      let newline = pending.indexOf('\n');
      while (newline >= 0) {
        let line = pending.slice(0, newline);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        yield line;
        pending = pending.slice(newline + 1);
        linesRead += 1;
        if (linesRead % 2000 === 0) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
        newline = pending.indexOf('\n');
      }
    }
    if (signal.aborted) throw new Error('import-cancelled');
    pending += decoder.decode();
    if (pending.length) yield pending.endsWith('\r') ? pending.slice(0, -1) : pending;
  } catch (error) {
    if (error instanceof TypeError) throw new Error('invalid-utf8');
    throw error;
  } finally {
    signal.removeEventListener('abort', cancelReader);
    reader.releaseLock();
  }
}

export interface FastqStatistics {
  readCount: number;
  totalBases: number;
  minReadLength: number;
  meanReadLength: number;
  maxReadLength: number;
  gcPercent?: number;
  phredEncoding: 'phred33' | 'phred64' | 'undetermined';
  meanQuality?: number;
  fractionQ20?: number;
  fractionQ30?: number;
  readsWithN: number;
  meanQualityPerPosition?: number[];
  qualityReadCount?: number;
  positionStatsReadCount: number;
  firstRead?: { header: string; sequence: string };
  series: NumericSeries[];
}

export class FastqAccumulator {
  private record: string[] = [];
  private recordStart = 1;
  private lineNumber = 0;
  private readCount = 0;
  private totalBases = 0;
  private minReadLength = Number.POSITIVE_INFINITY;
  private maxReadLength = 0;
  private gcCount = 0;
  private readsWithN = 0;
  private rawQualitySum = 0;
  private qualityCount = 0;
  private qualityHistogram = new Uint32Array(128);
  private positionSums: number[] = [];
  private positionCounts: number[] = [];
  private firstRead?: { header: string; sequence: string };

  pushLine(line: string): void {
    this.lineNumber += 1;
    if (this.record.length === 0) {
      this.recordStart = this.lineNumber;
      if (!line.startsWith('@') || line.length < 2) throw new FileParseError(this.lineNumber, 'fastq-invalid-header');
      this.record.push(line);
      return;
    }
    const field = this.record.length;
    if (field === 1 && !line.length) throw new FileParseError(this.lineNumber, 'fastq-empty-sequence');
    if (field === 2 && !line.startsWith('+')) throw new FileParseError(this.lineNumber, 'fastq-invalid-separator');
    if (field === 3) {
      const sequence = this.record[1]!;
      if (line.length !== sequence.length) throw new FileParseError(this.lineNumber, 'fastq-quality-length-mismatch');
      this.addRead(this.record[0]!, sequence, line);
      this.record = [];
      return;
    }
    this.record.push(line);
  }

  private addRead(header: string, sequence: string, quality: string): void {
    if (sequence.length !== quality.length) throw new FileParseError(this.lineNumber, 'fastq-quality-length-mismatch');
    this.readCount += 1;
    this.totalBases += sequence.length;
    this.minReadLength = Math.min(this.minReadLength, sequence.length);
    this.maxReadLength = Math.max(this.maxReadLength, sequence.length);
    if (/[Nn]/.test(sequence)) this.readsWithN += 1;
    for (const base of sequence) if (base.toLocaleUpperCase() === 'G' || base.toLocaleUpperCase() === 'C') this.gcCount += 1;
    if (!this.firstRead) this.firstRead = { header, sequence };
    for (let index = 0; index < quality.length; index += 1) {
      const code = quality.charCodeAt(index);
      if (code < 33 || code > 126) throw new FileParseError(this.lineNumber, 'fastq-invalid-quality-character');
      if (code < this.qualityHistogram.length) this.qualityHistogram[code] += 1;
      this.rawQualitySum += code;
      this.qualityCount += 1;
      if (this.readCount <= MAX_POSITION_QUALITY_READS) {
        this.positionSums[index] = (this.positionSums[index] ?? 0) + code;
        this.positionCounts[index] = (this.positionCounts[index] ?? 0) + 1;
      }
    }
  }

  finish(): FastqStatistics {
    if (this.record.length) throw new FileParseError(this.recordStart, 'fastq-truncated-record');
    let minCode = 127;
    let maxCode = 0;
    for (let code = 0; code < this.qualityHistogram.length; code += 1) {
      if (this.qualityHistogram[code]) { minCode = Math.min(minCode, code); maxCode = Math.max(maxCode, code); }
    }
    const encoding = this.qualityCount === 0 ? 'undetermined' : minCode < 64 && maxCode <= 74 ? 'phred33' : minCode > 74 && maxCode <= 104 ? 'phred64' : 'undetermined';
    const offset = encoding === 'phred33' ? 33 : encoding === 'phred64' ? 64 : undefined;
    let meanQuality: number | undefined;
    let fractionQ20: number | undefined;
    let fractionQ30: number | undefined;
    let meanQualityPerPosition: number[] | undefined;
    if (offset !== undefined && this.qualityCount) {
      meanQuality = (this.rawQualitySum / this.qualityCount) - offset;
      let q20 = 0;
      let q30 = 0;
      for (let code = 0; code < this.qualityHistogram.length; code += 1) {
        if (code - offset >= 20) q20 += this.qualityHistogram[code]!;
        if (code - offset >= 30) q30 += this.qualityHistogram[code]!;
      }
      fractionQ20 = q20 / this.qualityCount;
      fractionQ30 = q30 / this.qualityCount;
      meanQualityPerPosition = this.positionSums.map((sum, index) => sum / this.positionCounts[index]! - offset);
    }
    const gcPercent = this.totalBases ? this.gcCount / this.totalBases * 100 : undefined;
    const statistics: FastqStatistics = {
      readCount: this.readCount,
      totalBases: this.totalBases,
      minReadLength: this.readCount ? this.minReadLength : 0,
      meanReadLength: this.readCount ? this.totalBases / this.readCount : 0,
      maxReadLength: this.maxReadLength,
      gcPercent,
      phredEncoding: encoding,
      meanQuality,
      fractionQ20,
      fractionQ30,
      readsWithN: this.readsWithN,
      meanQualityPerPosition,
      qualityReadCount: offset === undefined ? undefined : this.readCount,
      positionStatsReadCount: Math.min(this.readCount, MAX_POSITION_QUALITY_READS),
      firstRead: this.firstRead,
      series: [
        { label: 'Read length', unit: 'bases', categories: ['minimum', 'mean', 'maximum'], values: this.readCount ? [this.minReadLength, this.totalBases / this.readCount, this.maxReadLength] : [] },
        { label: 'Mean quality by position', unit: 'Phred score', categories: meanQualityPerPosition?.map((_, index) => String(index + 1)), values: meanQualityPerPosition ?? [] },
      ],
    };
    return statistics;
  }
}

export interface VcfHeaderData {
  fileformat?: string;
  reference?: string;
  assembly?: string;
  contigs: Array<{ id: string; length?: number; fields: Record<string, string> }>;
  infoDefinitions: VcfInfoDefinition[];
  formatDefinitions: VcfFormatDefinition[];
  sampleNames: string[];
}
export interface VcfStatistics extends VcfHeaderData {
  variants: VcfVariantRecord[];
  variantCounts: { snv: number; insertion: number; deletion: number; other: number };
  filterCounts: Record<string, number>;
  transitions: number;
  transversions: number;
  tsTvRatio?: number;
  assemblyDeclared: boolean;
  series: NumericSeries[];
}

const parseMetaFields = (value: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  const expression = /(?:^|,)([^=,]+)=((?:"(?:[^"]|"")*")|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(value))) fields[match[1]!.trim()] = (match[2] ?? '').replace(/^"|"$/g, '').replaceAll('""', '"');
  return fields;
};

const classifyAllele = (reference: string, alternate: string): 'snv' | 'insertion' | 'deletion' | 'other' => {
  if (!nucleotide.test(reference) || !nucleotide.test(alternate)) return 'other';
  if (reference.length === 1 && alternate.length === 1) return 'snv';
  if (reference.length < alternate.length) return 'insertion';
  if (reference.length > alternate.length) return 'deletion';
  return 'other';
};
const isTransition = (reference: string, alternate: string): boolean => ['A>G', 'G>A', 'C>T', 'T>C'].includes(`${reference.toLocaleUpperCase()}>${alternate.toLocaleUpperCase()}`);

export class VcfAccumulator {
  private lineNumber = 0;
  private sawColumnHeader = false;
  private header: VcfHeaderData = { contigs: [], infoDefinitions: [], formatDefinitions: [], sampleNames: [] };
  private variants: VcfVariantRecord[] = [];
  private variantCounts = { snv: 0, insertion: 0, deletion: 0, other: 0 };
  private filterCounts: Record<string, number> = {};
  private transitions = 0;
  private transversions = 0;

  pushLine(line: string): void {
    this.lineNumber += 1;
    if (!line) return;
    if (line.startsWith('##fileformat=')) { this.header.fileformat = line.slice('##fileformat='.length); return; }
    if (line.startsWith('##reference=')) { this.header.reference = line.slice('##reference='.length); return; }
    if (line.startsWith('##assembly=')) { this.header.assembly = line.slice('##assembly='.length); return; }
    if (line.startsWith('##contig=<') && line.endsWith('>')) {
      const fields = parseMetaFields(line.slice(10, -1));
      if (fields.ID) this.header.contigs.push({ id: fields.ID, length: fields.length ? Number(fields.length) : undefined, fields });
      return;
    }
    if ((line.startsWith('##INFO=<') || line.startsWith('##FORMAT=<')) && line.endsWith('>')) {
      const type = line.startsWith('##INFO=<') ? 'INFO' : 'FORMAT';
      const fields = parseMetaFields(line.slice(type === 'INFO' ? 8 : 10, -1));
      if (fields.ID) {
        const definition = { id: fields.ID, number: fields.Number, type: fields.Type, description: fields.Description };
        if (type === 'INFO') this.header.infoDefinitions.push(definition);
        else this.header.formatDefinitions.push(definition);
      }
      return;
    }
    if (line.startsWith('##')) return;
    if (line.startsWith('#CHROM\t')) {
      const columns = line.split('\t');
      if (columns.length < 8) throw new FileParseError(this.lineNumber, 'vcf-invalid-column-header');
      this.header.sampleNames = columns.length > 9 ? columns.slice(9) : [];
      this.sawColumnHeader = true;
      return;
    }
    if (line.startsWith('#')) return;
    if (!this.sawColumnHeader) throw new FileParseError(this.lineNumber, 'vcf-data-before-column-header');
    const fields = line.split('\t');
    if (fields.length < 8) throw new FileParseError(this.lineNumber, 'vcf-too-few-columns');
    const position = Number(fields[1]);
    if (!fields[0] || !Number.isSafeInteger(position) || position < 1 || !fields[3] || !fields[4]) throw new FileParseError(this.lineNumber, 'vcf-invalid-variant-row');
    if (this.header.sampleNames.length && fields.length < 9 + this.header.sampleNames.length) throw new FileParseError(this.lineNumber, 'vcf-missing-sample-columns');
    const alternates = fields[4]!.split(',');
    const info: Record<string, string | true> = {};
    if (fields[7] !== '.' && fields[7] !== '') for (const item of fields[7]!.split(';')) {
      if (!item) continue;
      const separator = item.indexOf('=');
      info[separator < 0 ? item : item.slice(0, separator)] = separator < 0 ? true : item.slice(separator + 1);
    }
    const formatKeys = fields[8]?.split(':') ?? [];
    const gtIndex = formatKeys.indexOf('GT');
    const genotypes = this.header.sampleNames.map((sample, index) => {
      const rawSample = fields[index + 9] ?? '';
      return { sample, value: gtIndex >= 0 ? rawSample.split(':')[gtIndex] ?? '' : rawSample };
    });
    this.variants.push({ lineNumber: this.lineNumber, chromosome: fields[0]!, position, id: fields[2] ?? '.', reference: fields[3]!, alternate: alternates, quality: fields[5] ?? '.', filter: fields[6] ?? '.', info, genotypes });
    const filters = fields[6] === '.' || fields[6] === '' ? ['.'] : fields[6]!.split(';');
    filters.forEach((filter) => { this.filterCounts[filter] = (this.filterCounts[filter] ?? 0) + 1; });
    alternates.forEach((alternate) => {
      const type = classifyAllele(fields[3]!, alternate);
      this.variantCounts[type] += 1;
      if (type === 'snv') {
        if (isTransition(fields[3]!, alternate)) this.transitions += 1;
        else this.transversions += 1;
      }
    });
  }

  finish(): VcfStatistics {
    if (!this.sawColumnHeader) throw new FileParseError(Math.max(1, this.lineNumber), 'vcf-missing-column-header');
    const assembly = this.header.assembly ?? this.header.contigs.find((contig) => contig.fields.assembly)?.fields.assembly;
    return {
      ...this.header,
      ...(assembly ? { assembly } : {}),
      variants: this.variants,
      variantCounts: this.variantCounts,
      filterCounts: this.filterCounts,
      transitions: this.transitions,
      transversions: this.transversions,
      tsTvRatio: this.transversions ? this.transitions / this.transversions : undefined,
      assemblyDeclared: Boolean(assembly),
      series: [
        ...Object.entries(this.variantCounts).map(([label, value]) => ({ label: `ALT alleles: ${label}`, unit: 'ALT alleles', categories: [label], values: [value] })),
        ...Object.entries(this.filterCounts).map(([label, value]) => ({ label: `FILTER ${label}`, unit: 'records', categories: [label], values: [value] })),
      ],
    };
  }
}

export interface TableData { delimiter: ',' | '\t'; headers: string[]; rows: string[][]; series: NumericSeries[]; }
export const parseTableText = (input: string): TableData => {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter: ',' | '\t' = firstLine.includes('\t') && (!firstLine.includes(',') || firstLine.split('\t').length > firstLine.split(',').length) ? '\t' : ',';
  const rows = parseDelimitedRows(input, delimiter);
  const headers = rows[0] ?? [];
  if (!headers.length) throw new FileParseError(1, 'table-missing-header');
  const dataRows = rows.slice(1);
  for (let index = 0; index < dataRows.length; index += 1) if (dataRows[index]!.length !== headers.length) throw new FileParseError(index + 2, 'table-column-count-mismatch');
  const series = headers.map((header, column) => {
    const values = dataRows.map((row) => Number(row[column])).filter(Number.isFinite);
    return values.length === dataRows.length && values.length ? { label: header, unit: 'user-supplied', categories: dataRows.map((_, index) => String(index + 2)), values } : undefined;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return { delimiter, headers, rows: dataRows, series };
};

export interface QpcrInputRow { lineNumber: number; values: string[]; }
export interface QpcrAnalysisOptions {
  mapping: QpcrColumnMapping;
  threshold?: number;
  referenceGene?: string;
  controlSample?: string;
}
export interface QpcrAnalysis {
  aggregates: QpcrAggregate[];
  missingCtCount: number;
  threshold: number;
  assumptions: string[];
  series: NumericSeries[];
}

export const analyzeQpcrRows = (headers: string[], rows: QpcrInputRow[], options: QpcrAnalysisOptions): QpcrAnalysis => {
  const required = [options.mapping.sample, options.mapping.target, options.mapping.ct];
  if (required.some((header) => !headers.includes(header))) throw new FileParseError(1, 'qpcr-missing-column-mapping');
  const indices = { sample: headers.indexOf(options.mapping.sample), target: headers.indexOf(options.mapping.target), ct: headers.indexOf(options.mapping.ct) };
  const groups = new Map<string, { sample: string; target: string; cts: number[] }>();
  let missingCtCount = 0;
  for (const row of rows) {
    const sample = row.values[indices.sample]?.trim() ?? '';
    const target = row.values[indices.target]?.trim() ?? '';
    const rawCt = row.values[indices.ct]?.trim() ?? '';
    if (!sample || !target) throw new FileParseError(row.lineNumber, 'qpcr-missing-sample-or-target');
    const key = `${sample}\u0000${target}`;
    const group = groups.get(key) ?? { sample, target, cts: [] };
    groups.set(key, group);
    if (!rawCt || /^undetermined$/i.test(rawCt)) { missingCtCount += 1; continue; }
    const ct = Number(rawCt);
    if (!Number.isFinite(ct) || ct < 0) throw new FileParseError(row.lineNumber, 'qpcr-invalid-ct');
    group.cts.push(ct);
  }
  const threshold = options.threshold ?? 0.5;
  if (!Number.isFinite(threshold) || threshold < 0) throw new FileParseError(1, 'qpcr-invalid-sd-threshold');
  const aggregates: QpcrAggregate[] = [...groups.values()].map((group) => {
    const meanCt = group.cts.length ? group.cts.reduce((sum, ct) => sum + ct, 0) / group.cts.length : undefined;
    const standardDeviation = group.cts.length > 1 && meanCt !== undefined ? Math.sqrt(group.cts.reduce((sum, ct) => sum + ((ct - meanCt) ** 2), 0) / (group.cts.length - 1)) : undefined;
    return { sample: group.sample, target: group.target, replicateCount: group.cts.length, meanCt, standardDeviation, exceedsThreshold: standardDeviation !== undefined && standardDeviation > threshold };
  });
  if (options.referenceGene && options.controlSample) {
    const ref = options.referenceGene;
    const control = options.controlSample;
    const controlReference = aggregates.find((item) => item.sample === control && item.target === ref)?.meanCt;
    for (const aggregate of aggregates) {
      const referenceCt = aggregates.find((item) => item.sample === aggregate.sample && item.target === ref)?.meanCt;
      if (referenceCt === undefined || aggregate.meanCt === undefined) continue;
      aggregate.deltaCt = aggregate.meanCt - referenceCt;
      if (controlReference !== undefined) {
        const controlTarget = aggregates.find((item) => item.sample === control && item.target === aggregate.target)?.meanCt;
        if (controlTarget !== undefined) aggregate.deltaDeltaCt = aggregate.deltaCt - (controlTarget - controlReference);
      }
    }
  }
  return {
    aggregates,
    missingCtCount,
    threshold,
    assumptions: options.referenceGene && options.controlSample ? ['deltaCt = mean Ct(target) - mean Ct(reference gene) within each sample', 'deltaDeltaCt = deltaCt(sample) - deltaCt(control sample)', '100% amplification efficiency is assumed only for relative-quantification interpretation'] : [],
    series: [
      { label: 'Mean Ct', unit: 'cycles', categories: aggregates.filter((item) => item.meanCt !== undefined).map((item) => `${item.sample} · ${item.target}`), values: aggregates.flatMap((item) => item.meanCt === undefined ? [] : [item.meanCt]) },
      { label: 'Replicate SD', unit: 'cycles', categories: aggregates.filter((item) => item.standardDeviation !== undefined).map((item) => `${item.sample} · ${item.target}`), values: aggregates.flatMap((item) => item.standardDeviation === undefined ? [] : [item.standardDeviation]) },
      { label: 'Delta Ct', unit: 'cycles', categories: aggregates.filter((item) => item.deltaCt !== undefined).map((item) => `${item.sample} · ${item.target}`), values: aggregates.flatMap((item) => item.deltaCt === undefined ? [] : [item.deltaCt]) },
      { label: 'Delta-delta Ct', unit: 'cycles', categories: aggregates.filter((item) => item.deltaDeltaCt !== undefined).map((item) => `${item.sample} · ${item.target}`), values: aggregates.flatMap((item) => item.deltaDeltaCt === undefined ? [] : [item.deltaDeltaCt]) },
    ],
  };
};