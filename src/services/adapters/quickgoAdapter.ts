import type { Protein } from '../../models/scientific';
import type { ServiceResult } from '../types';

const baseUrl = 'https://www.ebi.ac.uk/QuickGO/services/annotation/search';
interface QuickGoResult { goId?: string; goName?: string | null; goAspect?: string; evidenceCode?: string; goEvidence?: string; geneProductId?: string; }
interface QuickGoResponse { results?: QuickGoResult[]; numberOfHits?: number; }
type GoAnnotation = NonNullable<Protein['goAnnotations']>[number];

const failure = (errorCode: ServiceResult<GoAnnotation[]>['errorCode'], message: string): ServiceResult<GoAnnotation[]> => ({ status: 'error', errorCode, message, dataMode: 'live' });
const aspectOf = (aspect: string | undefined): GoAnnotation['aspect'] | undefined => {
  if (aspect === 'F' || aspect === 'molecular_function') return 'molecular-function';
  if (aspect === 'P' || aspect === 'biological_process') return 'biological-process';
  if (aspect === 'C' || aspect === 'cellular_component') return 'cellular-component';
  return undefined;
};
const evidenceSource = (code: string): GoAnnotation['evidenceSource'] => {
  if (code === 'IEA') return 'inferred-electronically';
  if (code === 'not-reported') return 'not-reported';
  return ['EXP', 'IDA', 'IPI', 'IMP', 'IGI', 'IEP', 'TAS', 'NAS', 'IC', 'ND', 'RCA'].includes(code) ? 'manually-curated' : 'other-inference';
};

export const normalizeQuickGoAnnotations = (results: QuickGoResult[], retrievedAt = new Date().toISOString()): GoAnnotation[] => results.flatMap((record) => {
  const aspect = aspectOf(record.goAspect);
  if (!record.goId || !aspect) return [];
  const evidenceCode = record.goEvidence ?? record.evidenceCode ?? 'not-reported';
  return [{
    id: record.goId,
    term: record.goName ?? record.goId,
    aspect,
    evidenceCode,
    evidenceSource: evidenceSource(evidenceCode),
    database: 'QuickGO',
    category: 'reference-database',
    retrievedAt,
    limitations: ['i18n:sourceLimit.quickgoGo'],
    url: `https://amigo.geneontology.org/amigo/term/${encodeURIComponent(record.goId)}`,
  }];
});

export const createQuickGoAdapter = (): {
  getAnnotationsForProtein(accession: string): Promise<ServiceResult<GoAnnotation[]>>;
} => ({
  async getAnnotationsForProtein(accession) {
    const params = new URLSearchParams({ geneProductId: `UniProtKB:${accession}`, taxonId: '9606', limit: '500', includeFields: 'goName' });
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${baseUrl}?${params.toString()}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (response.status === 404) return failure('not-found', 'QuickGO returned no annotations.');
      if (!response.ok) return failure(response.status === 429 ? 'rate-limited' : 'unavailable', 'QuickGO could not be reached.');
      const payload = await response.json() as QuickGoResponse;
      if (!Array.isArray(payload.results)) return failure('malformed', 'QuickGO returned an unexpected response.');
      return { status: 'ok', data: normalizeQuickGoAnnotations(payload.results, new Date().toISOString()), dataMode: 'live' };
    } catch {
      return failure('network', 'QuickGO could not be reached.');
    } finally {
      globalThis.clearTimeout(timeout);
    }
  },
});