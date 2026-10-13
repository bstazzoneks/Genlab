import type { Gene } from '../../models/scientific';
import type { GeneNomenclature } from '../../models/nomenclature';
import type { ServiceResult } from '../types';

const baseUrl = 'https://rest.genenames.org';

interface HgncDocument {
  hgnc_id?: string;
  symbol?: string;
  name?: string;
  prev_symbol?: string[] | string;
  alias_symbol?: string[] | string;
  locus_type?: string;
  location?: string;
  entrez_id?: string;
  ensembl_gene_id?: string;
  uniprot_ids?: string[] | string;
  omim_id?: string[] | string;
  vega_id?: string;
}
interface HgncResponse { response?: { docs?: HgncDocument[]; numFound?: number }; }

const failure = <T>(errorCode: ServiceResult<T>['errorCode'], message: string): ServiceResult<T> => ({ status: 'error', errorCode, message, dataMode: 'live' });
const propagateFailure = <T>(result: ServiceResult<unknown>): ServiceResult<T> => ({ status: result.status, errorCode: result.errorCode, message: result.message, dataMode: result.dataMode });
const asList = (value: string[] | string | undefined): string[] => value === undefined ? [] : Array.isArray(value) ? value : value.split('|').map((item) => item.trim()).filter(Boolean);
const sourceFor = (hgncId: string, retrievedAt: string) => ({
  id: `hgnc-${hgncId}`, name: 'HGNC', category: 'curated-database' as const, identifier: hgncId,
  url: `https://www.genenames.org/data/gene-symbol-report/#!/hgnc_id/${encodeURIComponent(hgncId.replace(/^HGNC:/, ''))}`,
  retrievedAt, limitations: ['i18n:sourceLimit.hgnc'],
});

export const normalizeHgncRecord = (record: HgncDocument, retrievedAt: string): GeneNomenclature | undefined => {
  if (!record.hgnc_id || !record.symbol || !record.name) return undefined;
  const crossReferences: Record<string, string[]> = {};
  const add = (database: string, values: string[] | string | undefined): void => {
    const normalized = asList(values);
    if (normalized.length) crossReferences[database] = normalized;
  };
  add('NCBI Gene', record.entrez_id);
  add('Ensembl', record.ensembl_gene_id);
  add('UniProt', record.uniprot_ids);
  add('OMIM', record.omim_id);
  add('VEGA', record.vega_id);
  return {
    hgncId: record.hgnc_id,
    approvedSymbol: record.symbol,
    approvedName: record.name,
    previousSymbols: asList(record.prev_symbol),
    aliasSymbols: asList(record.alias_symbol),
    locusType: record.locus_type,
    chromosomalLocation: record.location,
    crossReferences,
    source: sourceFor(record.hgnc_id, retrievedAt),
  };
};

const request = async (url: string): Promise<ServiceResult<HgncDocument[]>> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (response.status === 404) return failure('not-found', 'HGNC returned no nomenclature record.');
    if (!response.ok) return failure(response.status === 429 ? 'rate-limited' : 'unavailable', 'HGNC could not be reached.');
    const payload = await response.json() as HgncResponse;
    if (!Array.isArray(payload.response?.docs)) return failure('malformed', 'HGNC returned an unexpected response.');
    return { status: 'ok', data: payload.response.docs, dataMode: 'live' };
  } catch {
    return failure('network', 'HGNC could not be reached.');
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

const matchesGene = (record: HgncDocument, gene: Gene): boolean => {
  const identifiers = [
    { record: record.entrez_id, gene: gene.externalIdentifiers.NCBI ?? (/^\d+$/.test(gene.id) ? gene.id : undefined) },
    { record: record.ensembl_gene_id, gene: gene.externalIdentifiers.Ensembl ?? (/^ENSG\d+/i.test(gene.id) ? gene.id : undefined) },
  ].filter((item): item is { record: string; gene: string } => Boolean(item.record && item.gene));
  return identifiers.length ? identifiers.some((item) => item.record.toLocaleLowerCase() === item.gene.toLocaleLowerCase()) : record.symbol?.toLocaleLowerCase() === gene.symbol.toLocaleLowerCase();
};

export const createHgncAdapter = (): {
  getForGene(gene: Gene): Promise<ServiceResult<GeneNomenclature>>;
  resolvePreviousSymbol(query: string): Promise<ServiceResult<GeneNomenclature[]>>;
} => ({
  async getForGene(gene) {
    const hgncId = gene.externalIdentifiers.HGNC;
    const path = hgncId ? `/fetch/hgnc_id/${encodeURIComponent(hgncId.startsWith('HGNC:') ? hgncId : `HGNC:${hgncId}`)}` : `/fetch/symbol/${encodeURIComponent(gene.symbol)}`;
    const result = await request(`${baseUrl}${path}`);
    if (result.status !== 'ok' || !result.data) return propagateFailure(result);
    const retrievedAt = new Date().toISOString();
    const record = result.data.find((item) => matchesGene(item, gene));
    const nomenclature = record ? normalizeHgncRecord(record, retrievedAt) : undefined;
    return nomenclature ? { status: 'ok', data: nomenclature, dataMode: 'live' } : failure('not-found', 'No exact HGNC identity matched this gene.');
  },
  async resolvePreviousSymbol(query) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return failure('not-found', 'No previous symbol was supplied.');
    const encoded = encodeURIComponent(normalizedQuery);
    const [previous, aliases] = await Promise.all([
      request(`${baseUrl}/search/prev_symbol/${encoded}`),
      request(`${baseUrl}/search/alias_symbol/${encoded}`),
    ]);
    const successful = [previous, aliases].filter((result): result is ServiceResult<HgncDocument[]> & { data: HgncDocument[] } => result.status === 'ok' && Boolean(result.data));
    if (!successful.length) return propagateFailure(previous.status === 'error' ? previous : aliases);
    const retrievedAt = new Date().toISOString();
    const records = [...new Map(successful.flatMap((result) => result.data).filter((item) => [...asList(item.prev_symbol), ...asList(item.alias_symbol)].some((symbol) => symbol.toLocaleLowerCase() === normalizedQuery.toLocaleLowerCase())).map((record) => [record.hgnc_id ?? `${record.symbol}:${record.name}`, record])).values()];
    const matches = records.map((record) => normalizeHgncRecord(record, retrievedAt)).filter((record): record is GeneNomenclature => Boolean(record));
    return matches.length ? { status: 'ok', data: matches, dataMode: 'live' } : failure('not-found', 'HGNC returned no exact previous-symbol match.');
  },
});