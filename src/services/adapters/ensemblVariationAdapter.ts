import type { PopulationFrequency, ScientificSource } from '../../models/scientific';
import type { ServiceResult } from '../types';

const baseUrl = 'https://rest.ensembl.org/variation/human';
const cacheTtl = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: ServiceResult<PopulationFrequency[]> }>();

interface EnsemblPopulation { population?: string; allele?: string; frequency?: number; allele_count?: number; sample_size?: number; }
interface EnsemblMapping { assembly_name?: string; allele_string?: string; }
export interface EnsemblVariationRecord { name?: string; populations?: EnsemblPopulation[]; mappings?: EnsemblMapping[]; }

const failure = <T>(errorCode: ServiceResult<T>['errorCode'], message: string): ServiceResult<T> => ({ status: 'error', errorCode, message, dataMode: 'live' });
const sourceFor = (rsId: string, population: string, allele: string, retrievedAt: string): ScientificSource => ({
  id: `ensembl-variation-${rsId}-${population}-${allele}`, name: 'Ensembl Variation', category: 'reference-database',
  identifier: `${rsId} · ${population} · ${allele}`, url: `https://www.ensembl.org/Homo_sapiens/Variation/Explore?v=${encodeURIComponent(rsId)}`,
  dataUseUrl: 'https://www.ensembl.org/info/about/legal/disclaimer.html', retrievedAt,
  limitations: ['i18n:sourceLimit.ensemblFrequency'],
});

export const normalizeEnsemblPopulationFrequencies = (record: EnsemblVariationRecord, rsId: string, retrievedAt: string): PopulationFrequency[] => {
  const mapping = record.mappings?.find((item) => item.assembly_name);
  const assembly = mapping?.assembly_name;
  const mappedAlleles = mapping?.allele_string?.split('/').filter(Boolean);
  return (record.populations ?? []).flatMap((population) => {
    if (!population.population || !population.allele || typeof population.frequency !== 'number' || !Number.isFinite(population.frequency) || population.frequency < 0 || population.frequency > 1) return [];
    if (mappedAlleles?.length && !mappedAlleles.includes(population.allele)) return [];
    const populationName = population.population;
    const sourceStudy = populationName.includes(':') ? populationName.slice(0, populationName.indexOf(':')) : populationName;
    return [{
      populationName,
      sourceStudy,
      allele: population.allele,
      frequency: population.frequency,
      alleleCount: population.allele_count,
      sampleSize: population.sample_size,
      assembly,
      source: sourceFor(rsId, populationName, population.allele, retrievedAt),
    }];
  });
};

export const createEnsemblVariationAdapter = (): {
  getPopulationFrequencies(rsId: string): Promise<ServiceResult<PopulationFrequency[]>>;
} => ({
  async getPopulationFrequencies(input) {
    const rsId = input.trim().toLocaleLowerCase();
    if (!/^rs\d+$/.test(rsId)) return failure('not-found', 'A valid rsID is required.');
    const cached = cache.get(rsId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${baseUrl}/${encodeURIComponent(rsId)}?pops=1`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (response.status === 404) return failure('not-found', 'Ensembl returned no population frequency data for this rsID.');
      if (!response.ok) return failure(response.status === 429 ? 'rate-limited' : 'unavailable', 'Ensembl Variation could not be reached.');
      const record = await response.json() as EnsemblVariationRecord;
      if (!record.name || !Array.isArray(record.populations)) return failure('malformed', 'Ensembl Variation returned an unexpected response.');
      if (record.name.toLocaleLowerCase() !== rsId) return failure('malformed', 'Ensembl Variation returned a different rsID than requested.');
      const result = { status: 'ok' as const, data: normalizeEnsemblPopulationFrequencies(record, rsId, new Date().toISOString()), dataMode: 'live' as const };
      cache.set(rsId, { expiresAt: Date.now() + cacheTtl, value: result });
      return result;
    } catch {
      return failure('network', 'Ensembl Variation could not be reached.');
    } finally {
      globalThis.clearTimeout(timeout);
    }
  },
});