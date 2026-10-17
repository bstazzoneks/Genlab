import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnsemblVariationAdapter, normalizeEnsemblPopulationFrequencies } from './ensemblVariationAdapter';

afterEach(() => vi.restoreAllMocks());

describe('Ensembl Variation adapter', () => {
  it('keeps source populations separate and does not derive sample size', () => {
    const frequencies = normalizeEnsemblPopulationFrequencies({
      name: 'rs429358', mappings: [{ assembly_name: 'GRCh38' }], populations: [
        { population: 'gnomADe:nfe', allele: 'C', frequency: 0.1514, allele_count: 164927 },
        { population: '1000GENOMES:ALL', allele: 'C', frequency: 0.139, allele_count: 139 },
      ],
    }, 'rs429358', '2026-01-01T00:00:00.000Z');
    expect(frequencies).toHaveLength(2);
    expect(frequencies.map((item) => item.sourceStudy)).toEqual(['gnomADe', '1000GENOMES']);
    expect(frequencies.map((item) => item.frequency)).toEqual([0.1514, 0.139]);
    expect(frequencies[0]).toMatchObject({ populationName: 'gnomADe:nfe', alleleCount: 164927, assembly: 'GRCh38', sampleSize: undefined });
    expect(frequencies.every((item) => item.source.retrievedAt === '2026-01-01T00:00:00.000Z')).toBe(true);
  });

  it('returns empty results and typed service errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ name: 'rs123456786', populations: [], mappings: [] }), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(createEnsemblVariationAdapter().getPopulationFrequencies('rs123456786')).resolves.toMatchObject({ status: 'ok', data: [] });
    await expect(createEnsemblVariationAdapter().getPopulationFrequencies('rs123456785')).resolves.toMatchObject({ status: 'error', errorCode: 'unavailable' });
  });

  it('loads rs204887 populations from the Ensembl Variation response shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      name: 'rs204887', mappings: [{ assembly_name: 'GRCh38' }], populations: [
        { population: 'gnomADe:amr', allele: 'A', frequency: 0.2849, allele_count: 12740 },
        { population: 'gnomADe:amr', allele: 'G', frequency: 0.7151, allele_count: 31970 },
      ],
    }), { status: 200 }));
    const result = await createEnsemblVariationAdapter().getPopulationFrequencies('rs204887');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/rs204887?pops=1');
    expect(result.data).toHaveLength(2);
    expect(result.data?.map((row) => row.frequency)).toEqual([0.2849, 0.7151]);
    expect(result.data?.every((row) => row.populationName === 'gnomADe:amr' && row.assembly === 'GRCh38')).toBe(true);
  });

  it('does not show population alleles that disagree with Ensembl placements', () => {
    const frequencies = normalizeEnsemblPopulationFrequencies({
      name: 'rs550001', mappings: [{ assembly_name: 'GRCh38', allele_string: 'A/G' }], populations: [
        { population: 'study:cohort', allele: 'G', frequency: 0.2 },
        { population: 'study:cohort', allele: 'Z', frequency: 0.8 },
      ],
    }, 'rs550001', '2026-01-01T00:00:00.000Z');
    expect(frequencies.map((item) => item.allele)).toEqual(['G']);
  });
});