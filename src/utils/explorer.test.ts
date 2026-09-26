import { describe, expect, it } from 'vitest';
import { demoGenes, demoVariants } from '../data/demo';
import { renderLabLoadingPage, renderLabPage, renderLabVcfConditions } from '../components/sitePages';
import { renderVariantTable } from '../components/explorer';
import { filterVariants, normalizeSearch, searchGenes, sortVariantsByPosition } from './explorer';
import { analyzeSequence, resolveLabAnalysis, summarizeSequenceFile } from './sequence';

describe('explorer data transformations', () => {
  it('normalizes user search input', () => {
    expect(normalizeSearch('  DEMO1 ')).toBe('demo1');
  });

  it('searches symbols, names, aliases, and identifiers', () => {
    expect(searchGenes(demoGenes, 'example_alpha')).toHaveLength(1);
    expect(searchGenes(demoGenes, 'DEMO-GENE-BETA')[0]?.symbol).toBe('DEMO2');
    expect(searchGenes(demoGenes, 'unknown')).toHaveLength(0);
  });

  it('filters variants without inventing missing classifications', () => {
    expect(filterVariants(demoVariants, { type: 'SNV' })).toHaveLength(1);
    expect(filterVariants(demoVariants, { consequence: 'frameshift' })[0]?.id).toBe('DEMO-VAR-002');
    expect(filterVariants(demoVariants, { significance: 'Pathogenic' })).toHaveLength(0);
  });

  it('sorts variants by available genomic position', () => {
    expect(sortVariantsByPosition([...demoVariants]).map((variant) => variant.id)).toEqual(['DEMO-VAR-001', 'DEMO-VAR-002']);
  });

  it('adds only disease-associated ClinVar conditions to the existing variant table', () => {
    const pathogenic = { ...demoVariants[0], clinicalSignificance: 'Pathogenic', condition: 'Cystic fibrosis' };
    const uncertain = { ...demoVariants[1], clinicalSignificance: 'Uncertain significance', condition: 'not specified' };
    const table = renderVariantTable([pathogenic, uncertain]);
    expect(table).toContain('Cystic fibrosis');
    expect(table).toContain('Symptom-level details are not available');
    expect(table).not.toContain('not specified');
    expect(table.match(/<th scope="col">/g)).toHaveLength(5);
  });

  it('shows a loading state while the laboratory is analyzing a sequence', () => {
    const page = renderLabLoadingPage({ length: 22, minGc: 40, maxGc: 60, minTm: 55, maxTm: 65 }, 'ATGCGTACGTAGC', 'TACGATCG');
    expect(page).toContain('role="status"');
    expect(page).toContain('Loading scientific record...');
    expect(page).toContain('Analyzing sequence...');
    expect(page).toContain('ATGCGTACGTAGC');
    expect(page).toContain('TACGATCG');
  });

  it('resolves a lab analysis result without leaving the page stuck in loading', () => {
    const result = resolveLabAnalysis('ATGCGTACGTAGC', 'TACGATCG', { length: 22, minGc: 40, maxGc: 60, minTm: 55, maxTm: 65 });
    expect(result.analysis.alphabet).toBe('DNA');
    expect(result.analysis.length).toBeGreaterThan(0);
    expect(result.analysis.primers?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(['fasta', 'unknown']).toContain(result.summary?.format ?? '');
    expect(result.summary?.totalLength ?? 0).toBeGreaterThan(0);
  });

  it('renders at least ten lab data panels and no variant list for FASTA ambiguity alone', () => {
    const summary = summarizeSequenceFile('>BRCA1\nATGNNR\n');
    const page = renderLabPage(analyzeSequence('ATGAAATAA'), false, undefined, summary);
    expect((page.match(/class="data-panel analysis-block"/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(page).not.toContain('Position 1:');
    expect(renderLabVcfConditions(summary)).toBe('');
  });

  it('shows per-variant disease terms only for clinically annotated VCF records', () => {
    const summary = summarizeSequenceFile('##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n1\t100\t.\tA\tT\t.\tPASS\tCLNSIG=Pathogenic;CLNDN=Cystic_fibrosis\n1\t200\t.\tC\tG\t.\tPASS\tCLNSIG=Likely_benign;CLNDN=not_specified');
    const page = renderLabVcfConditions(summary);
    expect(page).toContain('Cystic fibrosis');
    expect(page).not.toContain('not specified');
    expect(page).toContain('Symptom-level descriptions are not supplied');
  });
});