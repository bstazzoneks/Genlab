import type { Publication, ScientificSource } from '../../models/scientific';
import type { ServiceResult } from '../types';

const baseUrl = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const cacheTtl = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: ServiceResult<Publication[]> }>();

interface EuropePmcFullTextLink { url?: string; availability?: string; availabilityCode?: string; documentStyle?: string; site?: string; }
interface EuropePmcRecord {
  id?: string; source?: string; pmid?: string; pmcid?: string; doi?: string; title?: string;
  authorString?: string; journalTitle?: string; pubYear?: string; firstPublicationDate?: string;
  abstractText?: string; isOpenAccess?: 'Y' | 'N' | string; citedByCount?: number;
  pubType?: string; isPreprint?: 'Y' | 'N' | boolean; fullTextUrlList?: { fullTextUrl?: EuropePmcFullTextLink[] };
}
interface EuropePmcResponse { resultList?: { result?: EuropePmcRecord[] }; }

const sourceFor = (record: EuropePmcRecord, retrievedAt: string): ScientificSource => {
  const identifier = record.pmid ?? record.pmcid ?? record.doi ?? record.id ?? '';
  return { id: `europepmc-${record.source ?? 'record'}-${identifier}`, name: 'Europe PMC', category: 'primary-literature', identifier, url: `https://europepmc.org/article/${encodeURIComponent(record.source ?? 'MED')}/${encodeURIComponent(record.id ?? identifier)}`, dataUseUrl: 'https://europepmc.org/TermsOfUse', retrievedAt, limitations: ['i18n:sourceLimit.europepmc'] };
};

export const normalizeEuropePmcRecord = (record: EuropePmcRecord, retrievedAt: string): Publication | undefined => {
  if (!record.pmid && !record.pmcid && !record.doi && !record.id) return undefined;
  const identifiers: Record<string, string> = {};
  if (record.pmid) identifiers.pmid = record.pmid;
  if (record.pmcid) identifiers.pmcid = record.pmcid;
  if (record.doi) identifiers.doi = record.doi;
  const source = sourceFor(record, retrievedAt);
  const isOpenAccess = record.isOpenAccess === 'Y';
  const fullTextUrl = isOpenAccess ? record.fullTextUrlList?.fullTextUrl?.find((item) => item.url && (item.availabilityCode?.toLocaleUpperCase() === 'OA' || item.availability?.toLocaleUpperCase() === 'OPEN ACCESS'))?.url : undefined;
  const isPreprint = typeof record.isPreprint === 'boolean' ? record.isPreprint : record.isPreprint === 'Y' ? true : record.isPreprint === 'N' ? false : undefined;
  return {
    id: record.pmid ?? record.pmcid ?? record.doi ?? record.id ?? '',
    title: record.title ?? '',
    authors: record.authorString?.split(',').map((author) => author.trim()).filter(Boolean) ?? [],
    journal: record.journalTitle,
    year: Number(record.pubYear ?? record.firstPublicationDate?.slice(0, 4)) || undefined,
    abstract: record.abstractText,
    identifiers,
    url: source.url,
    source,
    sources: [source],
    isOpenAccess: record.isOpenAccess === 'Y' ? true : record.isOpenAccess === 'N' ? false : undefined,
    citationCount: record.citedByCount,
    fullTextUrl,
    isPreprint,
    publicationTypes: record.pubType?.split(';').map((type) => type.trim()).filter(Boolean),
  };
};

export const createEuropePmcAdapter = (): {
  searchPublications(query: string): Promise<ServiceResult<Publication[]>>;
} => ({
  async searchPublications(query) {
    const normalized = query.trim();
    if (!normalized) return { status: 'ok', data: [], dataMode: 'live' };
    const cached = cache.get(normalized.toLocaleLowerCase());
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
    try {
      const params = new URLSearchParams({ query: normalized, format: 'json', resultType: 'core', pageSize: '25' });
      const response = await fetch(`${baseUrl}?${params.toString()}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) return { status: 'error', errorCode: response.status === 429 ? 'rate-limited' : 'unavailable', message: 'Europe PMC could not be reached.', dataMode: 'live' };
      const payload = await response.json() as EuropePmcResponse;
      if (!Array.isArray(payload.resultList?.result)) return { status: 'error', errorCode: 'malformed', message: 'Europe PMC returned an unexpected response.', dataMode: 'live' };
      const retrievedAt = new Date().toISOString();
      const data = payload.resultList.result.map((record) => normalizeEuropePmcRecord(record, retrievedAt)).filter((publication): publication is Publication => Boolean(publication));
      const result = { status: 'ok' as const, data, dataMode: 'live' as const };
      cache.set(normalized.toLocaleLowerCase(), { expiresAt: Date.now() + cacheTtl, value: result });
      return result;
    } catch {
      return { status: 'error', errorCode: 'network', message: 'Europe PMC could not be reached.', dataMode: 'live' };
    } finally {
      globalThis.clearTimeout(timeout);
    }
  },
});