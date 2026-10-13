import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Gene } from '../../models/scientific';
import { createHgncAdapter, normalizeHgncRecord } from './hgncAdapter';

const gene: Gene = { id: '7157', symbol: 'TP53', name: 'tumor protein p53', organism: 'Homo sapiens', aliases: [], transcripts: [], proteins: [], externalIdentifiers: { NCBI: '7157' }, sources: [] };
const hgncRecord = { hgnc_id: 'HGNC:11998', symbol: 'TP53', name: 'tumor protein p53', prev_symbol: ['P53'], alias_symbol: ['BCC7'], locus_type: 'gene with protein product', location: '17p13.1', entrez_id: '7157', ensembl_gene_id: 'ENSG00000141510', uniprot_ids: ['P04637'] };

afterEach(() => vi.restoreAllMocks());

describe('HGNC adapter', () => {
  it('normalizes nomenclature and cross-references', () => {
    const result = normalizeHgncRecord(hgncRecord, '2026-01-01T00:00:00.000Z');
    expect(result).toMatchObject({ hgncId: 'HGNC:11998', approvedSymbol: 'TP53', previousSymbols: ['P53'], aliasSymbols: ['BCC7'], locusType: 'gene with protein product', chromosomalLocation: '17p13.1' });
    expect(result?.crossReferences).toMatchObject({ 'NCBI Gene': ['7157'], Ensembl: ['ENSG00000141510'], UniProt: ['P04637'] });
    expect(result?.source).toMatchObject({ name: 'HGNC', identifier: 'HGNC:11998', retrievedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('retrieves an exact HGNC gene record and resolves only exact prior symbols', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ response: { docs: [hgncRecord] } }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ response: { docs: [hgncRecord] } }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ response: { docs: [{ ...hgncRecord, prev_symbol: ['OLD'], alias_symbol: ['P53'], hgnc_id: 'HGNC:OTHER', symbol: 'OTHER' }, { ...hgncRecord, prev_symbol: ['P53X'], alias_symbol: [], hgnc_id: 'HGNC:NEAR', symbol: 'NEAR' }] } }), { status: 200 }));
    const adapter = createHgncAdapter();
    await expect(adapter.getForGene(gene)).resolves.toMatchObject({ status: 'ok', data: { approvedSymbol: 'TP53' } });
    const resolution = await adapter.resolvePreviousSymbol('P53');
    expect(resolution.data?.map((item) => item.approvedSymbol)).toEqual(['TP53', 'OTHER']);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/search/prev_symbol/P53');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/search/alias_symbol/P53');
  });

  it('returns typed errors for unavailable and malformed responses', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(createHgncAdapter().getForGene(gene)).resolves.toMatchObject({ status: 'error', errorCode: 'unavailable' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 200 }));
    await expect(createHgncAdapter().getForGene(gene)).resolves.toMatchObject({ status: 'error', errorCode: 'malformed' });
  });
});