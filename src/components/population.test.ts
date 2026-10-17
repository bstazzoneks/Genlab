import { describe, expect, it } from 'vitest';
import type { PopulationFrequency, Variant } from '../models/scientific';
import { formatPopulationFrequency, renderPopulationResults, renderVariantDetailsWithPopulation } from './population';

const variant: Variant = { id: 'VCV000000001', geneId: '1', variantType: 'single nucleotide variant', evidence: [], rsIds: ['rs429358'] };
const dbSnp: Variant = { id: 'rs999', requestedRsId: 'rs123', geneId: '', variantType: 'snv', evidence: [], mergedRsIds: ['rs123'], genomicPlacements: [{ assemblyName: 'GRCh38.p14', sequenceId: 'NC_000019.10', start: 100, referenceAllele: 'T', alternateAlleles: ['C'] }] };
const frequency = (populationName: string, allele: string, value: number): PopulationFrequency => ({ populationName, sourceStudy: populationName.split(':')[0]!, allele, frequency: value, assembly: 'GRCh38', source: { id: populationName, name: 'Ensembl Variation', category: 'reference-database', identifier: `rs429358 · ${populationName} · ${allele}`, retrievedAt: '2026-01-01T00:00:00.000Z' } });

describe('population panels', () => {
  it('adds an explicit load control without changing existing variant fields', () => {
    const html = renderVariantDetailsWithPopulation(variant);
    expect(html).toContain('id="population-lookup-form"');
    expect(html).toContain('value="rs429358"');
    expect(html).toContain('VCV000000001');
  });

  it('prefills the submitted ClinVar rsID, including rs204887', () => {
    const html = renderVariantDetailsWithPopulation({ ...variant, rsIds: ['rs204887'] });
    expect(html).toContain('value="rs204887"');
  });

  it('shows merged IDs and keeps each population/allele row separate', () => {
    const html = renderPopulationResults('rs123', { status: 'ok', data: dbSnp, dataMode: 'live' }, { status: 'ok', data: [frequency('gnomADe:nfe', 'C', 0.15), frequency('1000GENOMES:ALL', 'C', 0.13)], dataMode: 'live' });
    expect(html).toContain('rs123');
    expect(html).toContain('rs999');
    expect(html).toContain('gnomADe:nfe');
    expect(html).toContain('1000GENOMES:ALL');
    expect(html).toContain('15%');
    expect(html).toContain('13%');
    expect(html).not.toContain('global frequency</td>');
  });

  it('formats common and extremely low frequencies without hiding reported precision', () => {
    expect(formatPopulationFrequency(1, 'en')).toBe('100%');
    expect(formatPopulationFrequency(9.258e-7, 'en')).toBe('0.00009258%');
    expect(formatPopulationFrequency(7.021e-7, 'en')).toBe('0.00007021%');
    const html = renderPopulationResults('rs587777682', { status: 'error', errorCode: 'unavailable' }, { status: 'ok', data: [frequency('gnomADe:nfe', 'G', 1), frequency('gnomADe:nfe', 'A', 9.258e-7)], dataMode: 'live' });
    expect(html).toContain('100%');
    expect(html).toContain('0.00009258%');
    expect(html).not.toContain('100.0000%');
  });

  it('labels a dbSNP request failure and frequency empty state', () => {
    const html = renderPopulationResults('rs123', { status: 'error', errorCode: 'unavailable' }, { status: 'ok', data: [], dataMode: 'live' });
    expect(html).toContain('dbSNP could not be reached from this browser');
    expect(html).toContain('No population frequency rows were reported');
  });
});