import fastqValid from '../data/fixtures/fastq-valid.fastq?raw';
import fastqMismatch from '../data/fixtures/fastq-length-mismatch.fastq?raw';
import fastqTruncated from '../data/fixtures/fastq-truncated.fastq?raw';
import vcfMulti from '../data/fixtures/vcf-multiallelic-symbolic.vcf?raw';
import vcfNoAssembly from '../data/fixtures/vcf-no-assembly.vcf?raw';
import qpcrUneven from '../data/fixtures/qpcr-uneven.csv?raw';
import qpcrDdct from '../data/fixtures/qpcr-ddct.csv?raw';
import { describe, expect, it } from 'vitest';
import { analyzeQpcrRows, computeFileSha256, FastqAccumulator, FileParseError, parseTableText, streamTextLines, VcfAccumulator } from './fileImport';

const lines = (text: string): string[] => text.replace(/\r?\n$/, '').split(/\r?\n/);
const fastq = (text: string): ReturnType<FastqAccumulator['finish']> => {
  const parser = new FastqAccumulator();
  lines(text).forEach((line) => parser.pushLine(line));
  return parser.finish();
};
const vcf = (text: string): ReturnType<VcfAccumulator['finish']> => {
  const parser = new VcfAccumulator();
  lines(text).forEach((line) => parser.pushLine(line));
  return parser.finish();
};

describe('streamable local file parsers', () => {
  it('computes FASTQ summary and bounded quality series without changing reads', () => {
    const result = fastq(fastqValid);
    expect(result).toMatchObject({ readCount: 3, totalBases: 11, minReadLength: 2, maxReadLength: 5, readsWithN: 1, phredEncoding: 'phred33', positionStatsReadCount: 3 });
    expect(result.meanReadLength).toBeCloseTo(11 / 3);
    expect(result.gcPercent).toBeCloseTo((6 / 11) * 100);
    expect(result.meanQuality).toBeCloseTo(240 / 11);
    expect(result.fractionQ20).toBeCloseTo(6 / 11);
    expect(result.firstRead).toEqual({ header: '@read-1 sample=S1', sequence: 'ACGTN' });
    const undetermined = new FastqAccumulator();
    ['@r', 'A', '+', '@'].forEach((line) => undetermined.pushLine(line));
    expect(undetermined.finish()).toMatchObject({ phredEncoding: 'undetermined', meanQuality: undefined, fractionQ20: undefined });
  });

  it('reports FASTQ quality mismatch and truncated records with line numbers', () => {
    expect(() => fastq(fastqMismatch)).toThrowError(new FileParseError(4, 'fastq-quality-length-mismatch'));
    expect(() => fastq(fastqTruncated)).toThrowError(new FileParseError(1, 'fastq-truncated-record'));
  });

  it('parses VCF multiallelic and symbolic ALT, raw genotypes, counts and Ts/Tv', () => {
    const result = vcf(vcfMulti);
    expect(result).toMatchObject({ fileformat: 'VCFv4.3', assembly: 'GRCh38', assemblyDeclared: true, sampleNames: ['SampleA', 'SampleB'] });
    expect(result.contigs[0]).toMatchObject({ id: '1', length: 248956422, fields: { assembly: 'GRCh38' } });
    expect(result.infoDefinitions[0]).toMatchObject({ id: 'AF', description: 'Per ALT frequency, local fixture' });
    expect(result.variants[0]).toMatchObject({ id: 'rs100', alternate: ['G', 'T'], info: { AF: '0.4,0.1' }, genotypes: [{ sample: 'SampleA', value: '0/1' }, { sample: 'SampleB', value: '1/2' }] });
    expect(result.variantCounts).toEqual({ snv: 2, insertion: 0, deletion: 0, other: 1 });
    expect(result.filterCounts).toEqual({ PASS: 1, q10: 1 });
    expect(result).toMatchObject({ transitions: 1, transversions: 1, tsTvRatio: 1 });
    expect(result.variants[1]?.alternate).toEqual(['<DEL>']);
  });

  it('does not invent an assembly when a VCF does not declare one', () => {
    const result = vcf(vcfNoAssembly);
    expect(result.assemblyDeclared).toBe(false);
    expect(result).not.toHaveProperty('assembly');
    expect(result.variants).toMatchObject([{ chromosome: '2', position: 7 }]);
  });

  it('keeps Undetermined Ct missing and calculates uneven replicate SD and opt-in delta-delta Ct', () => {
    const table = parseTableText(qpcrUneven);
    const rows = table.rows.map((values, index) => ({ values, lineNumber: index + 2 }));
    const result = analyzeQpcrRows(table.headers, rows, { mapping: { sample: 'sample', target: 'target', ct: 'Ct' }, threshold: 0.5, referenceGene: 'REF', controlSample: 'CTRL' });
    expect(result.missingCtCount).toBe(1);
    const sampleTarget = result.aggregates.find((item) => item.sample === 'S1' && item.target === 'TARGET');
    expect(sampleTarget).toMatchObject({ replicateCount: 2, meanCt: 25.5, exceedsThreshold: true, deltaDeltaCt: 1.5 });
    expect(sampleTarget?.deltaCt).toBeCloseTo(5.4);
    expect(result.aggregates.find((item) => item.sample === 'CTRL' && item.target === 'TARGET')?.deltaDeltaCt).toBe(0);
    expect(result.assumptions).toContain('100% amplification efficiency is assumed only for relative-quantification interpretation');
  });

  it('matches hand-calculated delta Ct and delta-delta Ct only when explicitly requested', () => {
    const table = parseTableText(qpcrDdct);
    const rows = table.rows.map((values, index) => ({ values, lineNumber: index + 2 }));
    const withoutNormalization = analyzeQpcrRows(table.headers, rows, { mapping: { sample: 'Sample', target: 'Target', ct: 'Ct' } });
    expect(withoutNormalization.aggregates.every((item) => item.deltaCt === undefined && item.deltaDeltaCt === undefined)).toBe(true);
    const normalized = analyzeQpcrRows(table.headers, rows, { mapping: { sample: 'Sample', target: 'Target', ct: 'Ct' }, referenceGene: 'REFERENCE', controlSample: 'CONTROL' });
    expect(normalized.aggregates.find((item) => item.sample === 'SAMPLE' && item.target === 'TARGET')).toMatchObject({ deltaCt: 5, deltaDeltaCt: 2 });
  });

  it('decompresses gzipped local input in a stream when browser compression APIs are present', async () => {
    if (!('CompressionStream' in globalThis) || !('DecompressionStream' in globalThis)) return;
    const source = new Blob([fastqValid]);
    const compressed = await new Response(source.stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    const file = new File([compressed], 'fixture.fastq.gz');
    const output: string[] = [];
    for await (const line of streamTextLines(file, new AbortController().signal, 1024 * 1024, () => undefined)) output.push(line);
    expect(output[0]).toBe('@read-1 sample=S1');
    expect(output).toContain('IIII');
  });

  it('computes a deterministic SHA-256 checksum with Web Crypto', async () => {
    const file = new Blob(['abc']);
    const first = await computeFileSha256(file);
    const second = await computeFileSha256(file);
    expect(first).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(second).toBe(first);
  });
});