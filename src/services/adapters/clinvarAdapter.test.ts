import { describe, expect, it, vi } from 'vitest';
import { createClinvarVariantAdapter } from './clinvarAdapter';

describe('ClinVar variant adapter', () => {
  it('loads and normalizes variants for an arbitrary NCBI Gene ID', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('esearch.fcgi')) return new Response(JSON.stringify({ esearchresult: { idlist: ['4887781'] } }), { status: 200 });
      const payload = { result: { uids: ['4887781'], '4887781': {
        uid: '4887781', accession: 'VCV004887781', variation_set: [{ cdna_change: 'NM_001365276.2(TNXB):c.6841+3G>A', canonical_spdi: 'NC_000006.12:32064817:C:T', variant_type: 'single nucleotide variant', variation_loc: [{ assembly_name: 'GRCh38', chr: '6', start: '32064818', stop: '32064818' }] }],
        germline_classification: { description: 'Uncertain significance', review_status: 'criteria provided, single submitter', trait_set: [{ trait_name: 'not specified' }] }, genes: [{ geneid: '7148', symbol: 'TNXB' }], molecular_consequence_list: ['intron variant'],
      } } };
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const result = await createClinvarVariantAdapter().getVariantsForGene('7148');
    expect(result).toMatchObject({ status: 'ok', dataMode: 'live' });
    expect(result.data?.[0]).toMatchObject({ id: 'VCV004887781', geneId: '7148', consequence: 'intron variant', clinicalSignificance: 'Uncertain significance' });
    expect(result.data?.[0]?.evidence[0]).toMatchObject({ name: 'ClinVar', identifier: 'VCV004887781' });
    fetchMock.mockRestore();
  });

  it('returns an empty result without substituting another gene', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ esearchresult: { idlist: [] } }), { status: 200 }));
    const result = await createClinvarVariantAdapter().getVariantsForGene('999999999');
    expect(result).toMatchObject({ status: 'ok', data: [], dataMode: 'live' });
    fetchMock.mockRestore();
  });

  it('resolves a real dbSNP rsID through ClinVar search', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('esearch.fcgi')) {
        expect(decodeURIComponent(url)).toContain('rs123456[All Fields]');
        return new Response(JSON.stringify({ esearchresult: { idlist: ['700001'] } }), { status: 200 });
      }
      const payload = { result: { uids: ['700001'], '700001': {
        uid: '700001', accession: 'VCV000700001', variation_set: [{ variant_type: 'single nucleotide variant', canonical_spdi: 'NC_000001.11:100:C:T', variation_loc: [{ assembly_name: 'GRCh38', chr: '1', start: '101', stop: '101' }] }],
        germline_classification: { description: 'Pathogenic', review_status: 'criteria provided, multiple submitters', trait_set: [{ trait_name: 'Example condition' }] }, genes: [{ geneid: '1', symbol: 'GENE1' }],
      } } };
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const result = await createClinvarVariantAdapter().getVariant('rs123456');
    expect(result).toMatchObject({ status: 'ok', dataMode: 'live' });
    expect(result.data).toMatchObject({ id: 'VCV000700001', clinicalSignificance: 'Pathogenic', condition: 'Example condition' });
    fetchMock.mockRestore();
  });

  it('opens the exact VCV record after rsID search when ClinVar does not index the accession', async () => {
    const record = {
      uid: '710009', accession: 'VCV000710009',
      variation_set: [{ variation_name: 'rs890123', canonical_spdi: 'NC_000001.11:100:A:G', variant_type: 'single nucleotide variant', variation_loc: [{ assembly_name: 'GRCh38', chr: '1', start: '101', stop: '101' }] }],
      genes: [{ geneid: '1', symbol: 'GENE1' }],
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('esearch.fcgi')) {
        if (decodeURIComponent(url).includes('rs890123[All Fields]')) return new Response(JSON.stringify({ esearchresult: { idlist: ['710009'] } }), { status: 200 });
        return new Response(JSON.stringify({ esearchresult: { idlist: [] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: { uids: ['710009'], '710009': record } }), { status: 200 });
    });
    const adapter = createClinvarVariantAdapter();
    const searchResult = await adapter.getVariant('rs890123');
    expect(searchResult).toMatchObject({ status: 'ok', data: { id: 'VCV000710009', geneId: '1', rsIds: ['rs890123'] } });
    await expect(adapter.getVariant(searchResult.data!.id)).resolves.toMatchObject({ status: 'ok', data: { id: 'VCV000710009', genomicChange: 'NC_000001.11:100:A:G' } });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not substitute another ClinVar record when a VCV UID fallback disagrees', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => String(input).includes('esearch.fcgi')
      ? new Response(JSON.stringify({ esearchresult: { idlist: [] } }), { status: 200 })
      : new Response(JSON.stringify({ result: { uids: ['710010'], '710010': { uid: '710010', accession: 'VCV000710010' } } }), { status: 200 }));
    await expect(createClinvarVariantAdapter().getVariant('VCV000710009')).resolves.toMatchObject({ status: 'error', errorCode: 'not-found' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retains dbSNP rsIDs supplied by ClinVar for optional population lookup', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('esearch.fcgi')) return new Response(JSON.stringify({ esearchresult: { idlist: ['700002'] } }), { status: 200 });
      return new Response(JSON.stringify({ result: { uids: ['700002'], '700002': {
        uid: '700002', accession: 'VCV000700002', variation_set: [{ variant_type: 'single nucleotide variant', variation_name: 'rs429358', variation_xrefs: [{ db: 'dbSNP', id: 'rs429358' }, { db: 'dbSNP', id: '7654321' }] }],
        genes: [{ geneid: '7157', symbol: 'APOE' }],
      } } }), { status: 200 });
    });
    const result = await createClinvarVariantAdapter().getVariant('VCV000700002');
    expect(result.data?.rsIds).toEqual(['rs429358', 'rs7654321']);
    fetchMock.mockRestore();
  });

  it('reads dbSNP cross-references in the live ClinVar db_source/db_id shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('esearch.fcgi')) return new Response(JSON.stringify({ esearchresult: { idlist: ['261159'] } }), { status: 200 });
      return new Response(JSON.stringify({ result: { uids: ['261159'], '261159': {
        uid: '261159', accession: 'VCV000261159', variation_set: [{ variation_name: 'NM_001365276.2(TNXB):c.7440T>C', variation_xrefs: [{ db_source: 'dbSNP', db_id: '204887' }] }],
        genes: [{ geneid: '7148', symbol: 'TNXB' }],
      } } }), { status: 200 });
    });
    const result = await createClinvarVariantAdapter().getVariant('VCV000261159');
    expect(result.data?.rsIds).toEqual(['rs204887']);
    fetchMock.mockRestore();
  });
});