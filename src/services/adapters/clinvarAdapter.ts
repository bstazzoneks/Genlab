import type { GenomicLocation, ScientificSource, Variant } from '../../models/scientific';
import type { ServiceResult, VariantService } from '../types';

const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const cacheTtl = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: ServiceResult<Variant[]> }>();

interface ClinvarSearchResponse { esearchresult?: { idlist?: string[] }; }
interface ClinvarLocation { assembly_name?: string; chr?: string; start?: string; stop?: string; assembly_acc_ver?: string; }
interface ClinvarXref { db?: string; id?: string; db_name?: string; db_source?: string; db_id?: string; }
interface ClinvarVariation { variation_name?: string; cdna_change?: string; variation_loc?: ClinvarLocation[]; variant_type?: string; canonical_spdi?: string; variation_xrefs?: ClinvarXref[]; }
interface ClinvarRecord { uid?: string; accession?: string; variation_set?: ClinvarVariation[]; variation_xrefs?: ClinvarXref[]; germline_classification?: { description?: string; review_status?: string; trait_set?: Array<{ trait_name?: string }>; }; genes?: Array<{ geneid?: string; symbol?: string }>; molecular_consequence_list?: string[]; protein_change?: string; }
interface ClinvarSummaryResponse { result?: { uids?: string[]; [id: string]: ClinvarRecord | string[] | undefined }; }

const cleanTraits = (traits: Array<{ trait_name?: string }> | undefined): string[] => [...new Set((traits ?? [])
  .map((trait) => trait.trait_name?.trim())
  .filter((name): name is string => Boolean(name))
  .filter((name) => !/^(not specified|not provided|not available|unknown|unclassified|other|see .*|not applicable)$/i.test(name))
  .filter((name) => !/^(?:[A-Z0-9-]+[- ]?)?related disorder$/i.test(name))
  .filter((name) => !/^variant of unknown significance$/i.test(name)))];
const hasDiseaseAssociatedClassification = (classification?: string): boolean => (classification ?? '').toLocaleLowerCase().split(/[;,|/]/).some((value) => ['pathogenic', 'likely pathogenic', 'risk factor'].includes(value.trim()));

const failure = <T>(errorCode: ServiceResult<T>['errorCode'], message: string): ServiceResult<T> => ({ status: 'error', errorCode, message, dataMode: 'live' });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const sourceFor = (record: ClinvarRecord, retrievedAt: string): ScientificSource => ({ id: `clinvar-${record.uid ?? record.accession ?? 'record'}`, name: 'ClinVar', category: 'curated-database', identifier: record.accession, url: record.uid ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${encodeURIComponent(record.uid)}/` : undefined, retrievedAt, limitations: ['Clinical interpretations are database submissions and may change over time.'] });

const fetchJson = async <T>(url: string, signal: AbortSignal): Promise<T> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (response.status === 429) throw new Error('RATE_LIMITED');
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json() as Promise<T>;
};

const withTimeout = async <T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
  try { return await request(controller.signal); } finally { globalThis.clearTimeout(timeout); }
};

const normalize = (record: ClinvarRecord, geneId: string, retrievedAt: string): Variant | undefined => {
  const variation = record.variation_set?.[0];
  const location = variation?.variation_loc?.find((item) => item.assembly_name === 'GRCh38') ?? variation?.variation_loc?.[0];
  if (!record.accession && !record.uid) return undefined;
  const source = sourceFor(record, retrievedAt);
  const start = location?.start ? Number(location.start) : undefined;
  const end = location?.stop ? Number(location.stop) : start;
  const genomicLocation: GenomicLocation | undefined = location?.chr ? { assembly: location.assembly_name ?? location.assembly_acc_ver ?? 'ClinVar assembly', chromosome: location.chr, start, end } : undefined;
  const resolvedGeneId = geneId || record.genes?.[0]?.geneid || '';
  const dbSnpIds = [...(record.variation_set ?? []).flatMap((item) => item.variation_xrefs ?? []), ...(record.variation_xrefs ?? [])]
    .filter((xref) => /dbsnp/i.test(`${xref.db_source ?? ''} ${xref.db ?? ''} ${xref.db_name ?? ''}`))
    .map((xref) => xref.db_id ?? xref.id)
    .filter((item): item is string => Boolean(item && (/^rs\d+$/i.test(item) || /^\d+$/.test(item))))
    .map((item) => (item.toLocaleLowerCase().startsWith('rs') ? item.toLocaleLowerCase() : `rs${item}`));
  const namedRsIds = (record.variation_set ?? []).map((item) => item.variation_name)
    .filter((item): item is string => Boolean(item && /^rs\d+$/i.test(item)))
    .map((item) => item.toLocaleLowerCase());
  const rsIds = [...new Set([...namedRsIds, ...dbSnpIds])];
  return {
    id: record.accession ?? `VCV${record.uid}`,
    geneId: resolvedGeneId,
    genomicChange: variation?.canonical_spdi,
    location: genomicLocation,
    transcriptChange: variation?.cdna_change,
    proteinChange: record.protein_change,
    variantType: variation?.variant_type ?? 'variant',
    consequence: record.molecular_consequence_list?.[0],
    clinicalSignificance: record.germline_classification?.description,
    reviewStatus: record.germline_classification?.review_status,
    condition: hasDiseaseAssociatedClassification(record.germline_classification?.description) ? cleanTraits(record.germline_classification?.trait_set).join('; ') || undefined : undefined,
    rsIds: rsIds.length ? rsIds : undefined,
    evidence: [source],
  };
};

const summarize = async (ids: string[], geneId: string, signal: AbortSignal): Promise<ServiceResult<Variant[]>> => {
  const retrievedAt = new Date().toISOString();
  const payload = await fetchJson<ClinvarSummaryResponse>(`${baseUrl}/esummary.fcgi?db=clinvar&id=${ids.join(',')}&retmode=json`, signal);
  if (!payload.result?.uids || !isRecord(payload.result)) return failure('malformed', 'ClinVar returned an unexpected response.');
  const variants = payload.result.uids.map((id) => payload.result?.[id]).filter((value): value is ClinvarRecord => isRecord(value)).map((record) => normalize(record, geneId, retrievedAt)).filter((variant): variant is Variant => Boolean(variant));
  return { status: 'ok', data: variants, dataMode: 'live' };
};

export const createClinvarVariantAdapter = (): VariantService => ({
  async getVariantsForGene(geneId) {
    const key = `clinvar:gene:${geneId}`;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const result: ServiceResult<Variant[]> = await withTimeout(async (signal): Promise<ServiceResult<Variant[]>> => {
        const term = encodeURIComponent(`${geneId}[GeneID]`);
        const search = await fetchJson<ClinvarSearchResponse>(`${baseUrl}/esearch.fcgi?db=clinvar&term=${term}&retmode=json&retmax=100`, signal);
        const ids = search.esearchresult?.idlist;
        if (!ids) return failure<Variant[]>('malformed', 'ClinVar returned an unexpected response.');
        if (!ids.length) return { status: 'ok', data: [], dataMode: 'live' };
        return summarize(ids, geneId, signal);
      });
      cache.set(key, { expiresAt: Date.now() + cacheTtl, value: result });
      return result;
    } catch (error) {
      return failure(error instanceof Error && error.message === 'RATE_LIMITED' ? 'rate-limited' : 'network', 'ClinVar could not be reached.');
    }
  },
  async getVariant(id) {
    try {
      return await withTimeout(async (signal) => {
        const accession = id.toLocaleUpperCase();
        const vcvAccession = /^VCV\d+(?:\.\d+)?$/.test(accession) ? accession.split('.')[0] : undefined;
        const term = /^RS\d+$/i.test(id) ? `${id}[All Fields]` : `${accession}[Accession]`;
        const search = await fetchJson<ClinvarSearchResponse>(`${baseUrl}/esearch.fcgi?db=clinvar&term=${encodeURIComponent(term)}&retmode=json&retmax=1`, signal);
        const searchedIds = search.esearchresult?.idlist;
        if (!searchedIds) return failure<Variant>('malformed', 'ClinVar returned an unexpected response.');
        const numericVcvId = vcvAccession?.slice(3).replace(/^0+/, '') || (vcvAccession ? '0' : undefined);
        const ids = searchedIds.length ? searchedIds : numericVcvId ? [numericVcvId] : [];
        const result: ServiceResult<Variant[]> = ids.length ? await summarize(ids, '', signal) : { status: 'ok', data: [], dataMode: 'live' };
        if (result.status !== 'ok') return { status: result.status, errorCode: result.errorCode, message: result.message, dataMode: result.dataMode };
        const variant = vcvAccession ? result.data?.find((item) => item.id.toLocaleUpperCase() === vcvAccession) : result.data?.[0];
        return variant ? { status: 'ok', data: variant, dataMode: 'live' as const } : failure<Variant>('not-found', 'No ClinVar variant record was found for this exact identifier.');
      });
    } catch (error) {
      return failure(error instanceof Error && error.message === 'RATE_LIMITED' ? 'rate-limited' : 'network', 'ClinVar could not be reached.');
    }
  },
});
