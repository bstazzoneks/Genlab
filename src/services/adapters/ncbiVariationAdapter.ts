import type { ScientificSource, Variant } from '../../models/scientific';
import type { ServiceResult } from '../types';

const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const cacheTtl = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: ServiceResult<Variant> }>();

interface VariationSpdi { seq_id?: string; position?: number; deleted_sequence?: string; inserted_sequence?: string; }
interface VariationAllele { allele?: { spdi?: VariationSpdi }; }
interface VariationAssembly { assembly_name?: string; assembly_accession?: string; }
interface VariationPlacement {
  seq_id?: string;
  alleles?: VariationAllele[];
  placement_annot?: { seq_id_traits_by_assembly?: VariationAssembly[] };
}
interface NcbiVariationSnapshot { variant_type?: string; placements_with_allele?: VariationPlacement[]; merged_snapshot_data?: unknown[]; }
export interface NcbiVariationRecord { refsnp_id?: string | number; dbsnp1_merges?: unknown[]; primary_snapshot_data?: NcbiVariationSnapshot; }
export interface NcbiSnpSummary {
  uid?: string;
  snp_id?: number;
  spdi?: string;
  chr?: string;
  chrpos?: string;
  acc?: string;
  snp_class?: string;
  orig_build?: number;
  upd_build?: number;
}
interface NcbiSnpSummaryResponse { result?: { uids?: string[]; [id: string]: NcbiSnpSummary | string[] | undefined }; }

const sourceFor = (rsId: string, retrievedAt: string): ScientificSource => ({
  id: `dbsnp-${rsId}`, name: 'dbSNP', category: 'reference-database', identifier: rsId,
  url: `https://www.ncbi.nlm.nih.gov/snp/${encodeURIComponent(rsId)}`, dataUseUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/', retrievedAt,
  limitations: ['i18n:sourceLimit.dbsnpEutils'],
});
const failure = <T>(errorCode: ServiceResult<T>['errorCode'], message: string): ServiceResult<T> => ({ status: 'error', errorCode, message, dataMode: 'live' });
const asRsId = (value: string | number): string => `rs${String(value).replace(/^rs/i, '')}`;
const getMergeIds = (values: unknown[] = []): string[] => values.flatMap((value) => {
  if (typeof value === 'string' || typeof value === 'number') return [asRsId(value)];
  if (typeof value !== 'object' || value === null) return [];
  const record = value as Record<string, unknown>;
  const id = record.merged_rsid ?? record.refsnp_id ?? record.rsid ?? record.merged_id ?? record.id;
  return typeof id === 'string' || typeof id === 'number' ? [asRsId(id)] : [];
});

export const normalizeNcbiSnpSummary = (record: NcbiSnpSummary, requestedRsId: string, retrievedAt: string): Variant | undefined => {
  const returnedId = record.snp_id ?? record.uid;
  if (returnedId === undefined) return undefined;
  const rsId = asRsId(returnedId);
  const requested = asRsId(requestedRsId);
  const genomicPlacements = (record.spdi ?? '').split(',').flatMap((item) => {
    const [sequenceId, positionText, deletedSequence, insertedSequence] = item.split(':');
    const position = Number(positionText);
    if (!sequenceId || !Number.isInteger(position) || !deletedSequence || !insertedSequence) return [];
    const start = position + 1;
    return [{
      sequenceId,
      chromosome: record.chr,
      start,
      end: start + Math.max(0, deletedSequence.length - 1),
      referenceAllele: deletedSequence,
      alternateAlleles: deletedSequence === insertedSequence ? [] : [insertedSequence],
    }];
  });
  const distinctIds = rsId === requested ? [] : [requested];
  const firstPlacement = genomicPlacements.find((placement) => placement.alternateAlleles?.length) ?? genomicPlacements[0];
  return {
    id: rsId,
    rsIds: [rsId],
    requestedRsId: requested,
    geneId: '',
    variantType: record.snp_class ?? 'variant',
    referenceAllele: firstPlacement?.referenceAllele,
    alternateAllele: firstPlacement?.alternateAlleles?.[0],
    genomicPlacements,
    mergedRsIds: distinctIds,
    evidence: [sourceFor(rsId, retrievedAt)],
  };
};

export const normalizeNcbiVariationRecord = (record: NcbiVariationRecord, requestedRsId: string, retrievedAt: string): Variant | undefined => {
  if (record.refsnp_id === undefined) return undefined;
  const rsId = asRsId(record.refsnp_id);
  const snapshot = record.primary_snapshot_data;
  const genomicPlacements = (snapshot?.placements_with_allele ?? []).map((placement) => {
    const assembly = placement.placement_annot?.seq_id_traits_by_assembly?.find((item) => item.assembly_name || item.assembly_accession);
    const spdis = (placement.alleles ?? []).map((allele) => allele.allele?.spdi).filter((spdi): spdi is VariationSpdi => Boolean(spdi));
    const referenceAllele = spdis.find((spdi) => spdi.deleted_sequence !== spdi.inserted_sequence)?.deleted_sequence ?? spdis[0]?.deleted_sequence;
    const alternateAlleles = [...new Set(spdis.map((spdi) => spdi.inserted_sequence).filter((allele): allele is string => Boolean(allele && allele !== referenceAllele)))];
    const changedAllele = spdis.find((spdi) => spdi.deleted_sequence !== spdi.inserted_sequence);
    const start = changedAllele?.position === undefined ? undefined : changedAllele.position + 1;
    return {
      assemblyName: assembly?.assembly_name,
      assemblyAccession: assembly?.assembly_accession,
      sequenceId: placement.seq_id ?? changedAllele?.seq_id,
      start,
      end: start === undefined ? undefined : start + Math.max(0, (changedAllele?.deleted_sequence?.length ?? 1) - 1),
      referenceAllele,
      alternateAlleles,
    };
  });
  const merges = [...new Set([...getMergeIds(record.dbsnp1_merges), ...getMergeIds(snapshot?.merged_snapshot_data)].filter((item) => item !== rsId))];
  const firstPlacement = genomicPlacements[0];
  const referenceAllele = firstPlacement?.referenceAllele;
  const alternateAllele = firstPlacement?.alternateAlleles?.[0];
  return {
    id: rsId,
    rsIds: [rsId],
    requestedRsId: asRsId(requestedRsId),
    geneId: '',
    variantType: snapshot?.variant_type ?? 'variant',
    referenceAllele,
    alternateAllele,
    genomicPlacements,
    location: firstPlacement?.assemblyName && firstPlacement.sequenceId && firstPlacement.start !== undefined ? {
      assembly: firstPlacement.assemblyName,
      chromosome: firstPlacement.sequenceId,
      start: firstPlacement.start,
      end: firstPlacement.end,
    } : undefined,
    mergedRsIds: merges,
    evidence: [sourceFor(rsId, retrievedAt)],
  };
};

export const createNcbiVariationAdapter = (): {
  getVariant(rsId: string): Promise<ServiceResult<Variant>>;
} => ({
  async getVariant(input) {
    const requestedRsId = input.trim().toLocaleLowerCase();
    if (!/^rs\d+$/.test(requestedRsId)) return failure('not-found', 'A valid rsID is required.');
    const cached = cache.get(requestedRsId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`${baseUrl}/esummary.fcgi?db=snp&id=${encodeURIComponent(requestedRsId.slice(2))}&retmode=json`, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (response.status === 404) return failure('not-found', 'No dbSNP record was found for this rsID.');
      if (!response.ok) return failure(response.status === 429 ? 'rate-limited' : 'unavailable', 'NCBI dbSNP could not be reached.');
      const payload = await response.json() as NcbiSnpSummaryResponse;
      const uid = payload.result?.uids?.[0];
      if (!payload.result?.uids) return failure('malformed', 'NCBI dbSNP returned an unexpected response.');
      if (!uid) return failure('not-found', 'No dbSNP record was found for this rsID.');
      const record = payload.result[uid];
      if (!record || Array.isArray(record)) return failure('malformed', 'NCBI dbSNP returned an unexpected response.');
      if (String(record.snp_id ?? record.uid ?? '') !== uid) return failure('malformed', 'NCBI dbSNP returned a different record ID than requested.');
      const variant = normalizeNcbiSnpSummary(record, requestedRsId, new Date().toISOString());
      if (!variant) return failure('malformed', 'NCBI dbSNP returned an unexpected response.');
      const result = { status: 'ok' as const, data: variant, dataMode: 'live' as const };
      cache.set(requestedRsId, { expiresAt: Date.now() + cacheTtl, value: result });
      return result;
    } catch {
      return failure('unavailable', 'NCBI dbSNP could not be reached from this browser.');
    } finally {
      globalThis.clearTimeout(timeout);
    }
  },
});