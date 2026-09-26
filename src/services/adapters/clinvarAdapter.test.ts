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
});