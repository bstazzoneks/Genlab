import { resolveLabAnalysis } from '../utils/sequence';
import type { PrimerDesignOptions, SequenceFileSummary } from '../utils/sequence';
import { geneIdentificationService, unavailableGeneIdentification } from '../services/geneIdentification';
import type { FileImportResult, QpcrColumnMapping, TableImportResult, VcfImportResult, VcfVariantRecord } from '../models/fileImport';
import type { SampleAnalysisMetadata } from '../models/sample';
import { computeFileSha256, FastqAccumulator, parseTableText, analyzeQpcrRows, VcfAccumulator, streamTextLines, type VcfStatistics } from '../utils/fileImport';
import { GENE_LAB_VERSION } from '../data/version';

interface SequenceRequest {
  id: number;
  input: string;
  comparison: string;
  primerOptions: PrimerDesignOptions;
  fileSummary?: SequenceFileSummary;
  geneHint?: string;
}

interface ImportFileRequest {
  kind: 'import-file';
  id: number;
  file: File;
  sampleId: string;
  maxStreamBytes: number;
  maxCsvBytes: number;
}
interface AnalyzeQpcrRequest {
  kind: 'analyze-qpcr';
  id: number;
  table: TableImportResult;
  mapping: QpcrColumnMapping;
  threshold: number;
  referenceGene?: string;
  controlSample?: string;
}
interface CancelImportRequest { kind: 'cancel-import'; id: number; }
interface VcfPageRequest {
  kind: 'vcf-page'; id: number; importId: string; pageIndex: number; pageSize: number;
  filters: { chromosome?: string; position?: string; id?: string; reference?: string; alternate?: string };
}
type WorkerMessage = SequenceRequest | ImportFileRequest | AnalyzeQpcrRequest | CancelImportRequest | VcfPageRequest;
interface WorkerResult {
  id: number;
  kind?: 'progress' | 'import-result' | 'import-error' | 'import-cancelled' | 'vcf-page-result';
  progress?: { bytesRead: number; totalBytes: number; stage: 'parsing' | 'checksum' };
  result?: unknown;
  rows?: VcfVariantRecord[];
  pageIndex?: number;
  pageCount?: number;
  totalCount?: number;
  error?: string;
  lineNumber?: number;
}

const activeImports = new Map<number, AbortController>();
const vcfResults = new Map<string, VcfStatistics>();
const vcfPageSize = 50;
const getFileFormat = (name: string): 'fastq' | 'vcf' | 'table' | undefined => {
  const normalized = name.toLocaleLowerCase().replace(/\.gz$/, '');
  if (/\.(fastq|fq)$/.test(normalized)) return 'fastq';
  if (/\.vcf$/.test(normalized)) return 'vcf';
  if (/\.(csv|tsv)$/.test(normalized)) return 'table';
  return undefined;
};

const buildMetadata = async (file: File, sampleId: string, toolName: string, parameters: Record<string, string | number | boolean | null>, signal: AbortSignal, report: (stage: 'parsing' | 'checksum', bytesRead: number) => void): Promise<SampleAnalysisMetadata> => {
  if (signal.aborted) throw new Error('import-cancelled');
  report('checksum', file.size);
  const checksum = await computeFileSha256(file);
  if (signal.aborted) throw new Error('import-cancelled');
  return { sampleId, fileName: file.name, fileSize: file.size, fileChecksum: checksum, geneLabVersion: GENE_LAB_VERSION, toolName, parameters, importedAt: new Date().toISOString() };
};

const handleFileImport = async (request: ImportFileRequest): Promise<void> => {
  const controller = new AbortController();
  activeImports.set(request.id, controller);
  const file = request.file;
  const format = getFileFormat(file.name);
  const maxBytes = format === 'table' ? request.maxCsvBytes : request.maxStreamBytes;
  const respondProgress = (stage: 'parsing' | 'checksum', bytesRead: number): void => self.postMessage({ id: request.id, kind: 'progress', progress: { bytesRead, totalBytes: stage === 'parsing' && file.name.toLocaleLowerCase().endsWith('.gz') ? 0 : file.size, stage } } satisfies WorkerResult);
  try {
    if (!format) throw new Error('unsupported-format');
    if (!request.sampleId) throw new Error('sample-required');
    if (file.size > maxBytes) throw new Error('file-too-large');
    vcfResults.clear();
    const id = globalThis.crypto?.randomUUID?.() ?? `IMPORT-${Date.now().toString(36)}`;
    if (format === 'fastq') {
      const parser = new FastqAccumulator();
      for await (const line of streamTextLines(file, controller.signal, maxBytes, (bytes) => respondProgress('parsing', bytes))) parser.pushLine(line);
      const stats = parser.finish();
      const metadata = await buildMetadata(file, request.sampleId, 'FASTQ summary', { positionStatsReadLimit: 10_000, dataModified: false }, controller.signal, respondProgress);
      const fullResult: FileImportResult = { id, format, fileName: file.name, fileSize: file.size, sampleId: request.sampleId, metadata, ...stats };
      self.postMessage({ id: request.id, kind: 'import-result', result: fullResult } satisfies WorkerResult);
      return;
    }
    if (format === 'vcf') {
      const parser = new VcfAccumulator();
      for await (const line of streamTextLines(file, controller.signal, maxBytes, (bytes) => respondProgress('parsing', bytes))) parser.pushLine(line);
      const stats = parser.finish();
      vcfResults.set(id, stats);
      const metadata = await buildMetadata(file, request.sampleId, 'VCF summary', { dataModified: false, alleleCounts: 'counted per ALT allele' }, controller.signal, respondProgress);
      const fullResult: VcfImportResult = { id, format, fileName: file.name, fileSize: file.size, sampleId: request.sampleId, metadata, ...stats, variants: stats.variants.slice(0, vcfPageSize), variantTotal: stats.variants.length, filteredVariantCount: stats.variants.length, pageIndex: 0, pageCount: Math.max(1, Math.ceil(stats.variants.length / vcfPageSize)), pageSize: vcfPageSize };
      self.postMessage({ id: request.id, kind: 'import-result', result: fullResult } satisfies WorkerResult);
      return;
    }
    let text = '';
    for await (const line of streamTextLines(file, controller.signal, maxBytes, (bytes) => respondProgress('parsing', bytes))) text += `${line}\n`;
    const table = parseTableText(text);
    const metadata = await buildMetadata(file, request.sampleId, 'Local delimited-table import', { delimiter: table.delimiter === '\t' ? 'tab' : 'comma', dataModified: false }, controller.signal, respondProgress);
    const fullResult: FileImportResult = { id, format: 'table', fileName: file.name, fileSize: file.size, sampleId: request.sampleId, metadata, ...table };
    self.postMessage({ id: request.id, kind: 'import-result', result: fullResult } satisfies WorkerResult);
  } catch (error) {
    const parseError = error as Error & { lineNumber?: number; reason?: string };
    self.postMessage({ id: request.id, kind: parseError.message === 'import-cancelled' ? 'import-cancelled' : 'import-error', error: parseError.reason ?? parseError.message ?? 'import-failed', lineNumber: parseError.lineNumber } satisfies WorkerResult);
  } finally {
    activeImports.delete(request.id);
  }
};

const handleVcfPage = (request: VcfPageRequest): void => {
  const result = vcfResults.get(request.importId);
  if (!result) {
    self.postMessage({ id: request.id, kind: 'import-error', error: 'vcf-result-expired' } satisfies WorkerResult);
    return;
  }
  const filters = Object.fromEntries(Object.entries(request.filters).map(([key, value]) => [key, value?.trim().toLocaleLowerCase()]).filter((entry): entry is [string, string] => Boolean(entry[1]))) as VcfPageRequest['filters'];
  const matching = result.variants.filter((row) =>
    (!filters.chromosome || row.chromosome.toLocaleLowerCase().includes(filters.chromosome.toLocaleLowerCase()))
    && (!filters.position || String(row.position).includes(filters.position))
    && (!filters.id || row.id.toLocaleLowerCase().includes(filters.id.toLocaleLowerCase()))
    && (!filters.reference || row.reference.toLocaleLowerCase().includes(filters.reference.toLocaleLowerCase()))
    && (!filters.alternate || row.alternate.join(',').toLocaleLowerCase().includes(filters.alternate.toLocaleLowerCase())));
  const pageSize = Math.max(1, Math.min(request.pageSize, 200));
  const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
  const pageIndex = Math.max(0, Math.min(request.pageIndex, pageCount - 1));
  self.postMessage({ id: request.id, kind: 'vcf-page-result', rows: matching.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize), pageIndex, pageCount, totalCount: matching.length } satisfies WorkerResult);
};

const handleQpcrAnalysis = (request: AnalyzeQpcrRequest): void => {
  try {
    const rows = request.table.rows.map((values, index) => ({ values, lineNumber: index + 2 }));
    const result = analyzeQpcrRows(request.table.headers, rows, { mapping: request.mapping, threshold: request.threshold, referenceGene: request.referenceGene, controlSample: request.controlSample });
    const qpcrResult: FileImportResult = {
      id: request.table.id, format: 'qpcr', fileName: request.table.fileName, fileSize: request.table.fileSize, sampleId: request.table.sampleId,
      metadata: { ...request.table.metadata, toolName: 'qPCR summary', parameters: { ...request.table.metadata.parameters, mapping: JSON.stringify(request.mapping), standardDeviationThreshold: request.threshold, referenceGene: request.referenceGene ?? null, controlSample: request.controlSample ?? null } },
      headers: request.table.headers, rows: request.table.rows, mapping: request.mapping, missingCtCount: result.missingCtCount,
      standardDeviationThreshold: result.threshold, referenceGene: request.referenceGene, controlSample: request.controlSample,
      assumptions: result.assumptions, aggregates: result.aggregates, series: result.series,
    };
    self.postMessage({ id: request.id, kind: 'import-result', result: qpcrResult } satisfies WorkerResult);
  } catch (error) {
    const parseError = error as Error & { lineNumber?: number; reason?: string };
    self.postMessage({ id: request.id, kind: 'import-error', error: parseError.reason ?? parseError.message ?? 'qpcr-analysis-failed', lineNumber: parseError.lineNumber } satisfies WorkerResult);
  }
};

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  const request = event.data;
  if ('kind' in request) {
    if (request.kind === 'cancel-import') { activeImports.get(request.id)?.abort(); return; }
    if (request.kind === 'import-file') { void handleFileImport(request); return; }
    if (request.kind === 'analyze-qpcr') { handleQpcrAnalysis(request); return; }
    handleVcfPage(request);
    return;
  }
  try {
    const analysis = resolveLabAnalysis(request.input, request.comparison, request.primerOptions, request.fileSummary);
    let identification;
    try {
      identification = geneIdentificationService.identify(request.input, request.comparison, request.geneHint);
    } catch {
      identification = unavailableGeneIdentification(request.input, 'Local gene identification could not be completed; the sequence analysis results remain available.');
    }
    self.postMessage({ id: request.id, result: { ...analysis, identification } });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'sequence-analysis-failed' });
  }
});
