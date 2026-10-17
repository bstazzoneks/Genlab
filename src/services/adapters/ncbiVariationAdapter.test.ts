import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNcbiVariationAdapter, normalizeNcbiSnpSummary, normalizeNcbiVariationRecord } from './ncbiVariationAdapter';

const response = {
  refsnp_id: '999',
  dbsnp1_merges: ['123', { merged_rsid: 456 }],
  primary_snapshot_data: {
    variant_type: 'snv',
    placements_with_allele: [{
      seq_id: 'NC_000019.10',
      placement_annot: { seq_id_traits_by_assembly: [{ assembly_name: 'GRCh38.p14', assembly_accession: 'GCF_000001405.40' }] },
      alleles: [
        { allele: { spdi: { seq_id: 'NC_000019.10', position: 44908683, deleted_sequence: 'T', inserted_sequence: 'T' } } },
        { allele: { spdi: { seq_id: 'NC_000019.10', position: 44908683, deleted_sequence: 'T', inserted_sequence: 'C' } } },
      ],
    }],
  },
};

afterEach(() => vi.restoreAllMocks());

describe('NCBI Variation adapter', () => {
  it('normalizes placements, alleles, assembly and merged rsIDs without hiding them', () => {
    const variant = normalizeNcbiVariationRecord(response, 'rs123', '2026-01-01T00:00:00.000Z');
    expect(variant).toMatchObject({ id: 'rs999', requestedRsId: 'rs123', rsIds: ['rs999'], mergedRsIds: ['rs123', 'rs456'], variantType: 'snv', referenceAllele: 'T', alternateAllele: 'C' });
    expect(variant?.genomicPlacements?.[0]).toMatchObject({ assemblyName: 'GRCh38.p14', assemblyAccession: 'GCF_000001405.40', sequenceId: 'NC_000019.10', start: 44908684, end: 44908684 });
    expect(variant?.evidence[0]).toMatchObject({ name: 'dbSNP', identifier: 'rs999', retrievedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('normalizes NCBI E-utilities SPDI placements and keeps a redirected requested rsID explicit', () => {
    const variant = normalizeNcbiSnpSummary({
      uid: '999', snp_id: 999, chr: '6', chrpos: '6:32061449', acc: 'NC_000006.12', snp_class: 'dips',
      spdi: 'NC_000006.12:32061448:A:G,NC_000006.12:32061448:A:T', upd_build: 157,
    }, 'rs123', '2026-01-01T00:00:00.000Z');
    expect(variant).toMatchObject({ id: 'rs999', requestedRsId: 'rs123', mergedRsIds: ['rs123'], referenceAllele: 'A', alternateAllele: 'G', variantType: 'dips' });
    expect(variant?.genomicPlacements).toEqual([
      { sequenceId: 'NC_000006.12', chromosome: '6', start: 32061449, end: 32061449, referenceAllele: 'A', alternateAlleles: ['G'] },
      { sequenceId: 'NC_000006.12', chromosome: '6', start: 32061449, end: 32061449, referenceAllele: 'A', alternateAlleles: ['T'] },
    ]);
  });

  it('retrieves arbitrary rsIDs directly from CORS-enabled NCBI dbSNP E-utilities', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: {
      uids: ['204887'],
      '204887': { uid: '204887', snp_id: 204887, chr: '6', chrpos: '6:32061449', acc: 'NC_000006.12', spdi: 'NC_000006.12:32061448:A:G,NC_000006.12:32061448:A:T', snp_class: 'dips' },
    } }), { status: 200 }));
    const result = await createNcbiVariationAdapter().getVariant('rs204887');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('esummary.fcgi?db=snp&id=204887');
    expect(result).toMatchObject({ status: 'ok', data: { id: 'rs204887', requestedRsId: 'rs204887', genomicPlacements: [{ sequenceId: 'NC_000006.12', start: 32061449 }, { sequenceId: 'NC_000006.12', start: 32061449 }] } });
  });

  it('does not claim success for malformed payloads and distinguishes missing IDs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 404 }));
    await expect(createNcbiVariationAdapter().getVariant('rs123456789')).resolves.toMatchObject({ status: 'error', errorCode: 'malformed' });
    await expect(createNcbiVariationAdapter().getVariant('rs123456788')).resolves.toMatchObject({ status: 'error', errorCode: 'not-found' });
  });

  it('marks browser access unavailable when fetch is blocked by CORS', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(createNcbiVariationAdapter().getVariant('rs123456787')).resolves.toMatchObject({ status: 'error', errorCode: 'unavailable' });
  });

  it('rejects an E-utilities summary whose record ID disagrees with its UID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ result: { uids: ['123'], '123': { uid: '123', snp_id: 456 } } }), { status: 200 }));
    await expect(createNcbiVariationAdapter().getVariant('rs123')).resolves.toMatchObject({ status: 'error', errorCode: 'malformed' });
  });
});