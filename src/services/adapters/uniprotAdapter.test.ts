import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Gene } from '../../models/scientific';
import { createUniProtProteinAdapter, normalizeUniProtProtein, type UniProtRecord } from './uniprotAdapter';

const gene: Gene = { id: '7157', symbol: 'TP53', name: 'cellular tumor antigen p53', organism: 'Homo sapiens', aliases: [], transcripts: [], proteins: [], externalIdentifiers: { NCBI: '7157' }, sources: [] };
const record: UniProtRecord = {
  primaryAccession: 'P04637', uniProtkbId: 'P53_HUMAN', organism: { taxonId: 9606 }, genes: [{ geneName: { value: 'TP53' } }],
  proteinDescription: { recommendedName: { fullName: { value: 'Cellular tumor antigen p53' } } },
  sequence: { value: 'MEEPQSDPSV', length: 10, molWeight: 11800 },
  comments: [
    { commentType: 'FUNCTION', texts: [{ value: 'Acts as a tumor suppressor.' }] },
    { commentType: 'SUBCELLULAR LOCATION', subcellularLocations: [{ location: { value: 'Nucleus' } }] },
    { commentType: 'ALTERNATIVE PRODUCTS', isoforms: [{ isoformIds: ['P04637-2'], name: { value: 'Isoform 2' } }] },
  ],
  features: [{ type: 'DNA binding', location: { start: { value: 100 }, end: { value: 200 } }, description: 'Core domain' }],
  uniProtKBCrossReferences: [
    { database: 'GeneID', id: '7157' }, { database: 'PDB', id: '1TUP' },
    { database: 'GO', id: 'GO:0003700', properties: [{ key: 'GoTerm', value: 'F:DNA-binding transcription factor activity' }, { key: 'GoEvidenceType', value: 'IEA:UniProtKB-KW' }] },
  ],
};

afterEach(() => vi.restoreAllMocks());

describe('UniProt protein adapter', () => {
  it('normalizes reviewed protein details and GO evidence', () => {
    const protein = normalizeUniProtProtein(record, gene, '2026-01-01T00:00:00.000Z');
    expect(protein).toMatchObject({ accession: 'P04637', entryName: 'P53_HUMAN', aminoAcidLength: 10, massDaltons: 11800, canonicalSequence: 'MEEPQSDPSV' });
    expect(protein?.features).toEqual([{ type: 'DNA binding', start: 100, end: 200, description: 'Core domain' }]);
    expect(protein?.isoforms?.[0]?.id).toBe('P04637-2');
    expect(protein?.goAnnotations?.[0]).toMatchObject({ id: 'GO:0003700', evidenceCode: 'IEA', evidenceSource: 'inferred-electronically', database: 'UniProt', category: 'curated-database', retrievedAt: '2026-01-01T00:00:00.000Z', limitations: ['i18n:sourceLimit.uniprotGo'] });
    expect(protein?.sources[0]).toMatchObject({ name: 'UniProt', identifier: 'P04637', retrievedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('rejects a same-symbol record with a conflicting stable gene ID', () => {
    const wrongIdentity = { ...record, uniProtKBCrossReferences: [{ database: 'GeneID', id: '9999' }] };
    expect(normalizeUniProtProtein(wrongIdentity, gene, '2026-01-01T00:00:00.000Z')).toBeUndefined();
  });

  it('matches and normalizes an Ensembl gene ID stored on transcript cross-references', () => {
    const ensemblGene = { ...gene, id: 'ENSG00000141510', externalIdentifiers: { Ensembl: 'ENSG00000141510' } };
    const ensemblRecord = { ...record, uniProtKBCrossReferences: [{ database: 'Ensembl', id: 'ENST00000269305.9', properties: [{ key: 'GeneId', value: 'ENSG00000141510.20' }] }] };
    const protein = normalizeUniProtProtein(ensemblRecord, ensemblGene, '2026-01-01T00:00:00.000Z');
    expect(protein?.geneId).toBe('ENSG00000141510');
    expect(protein?.crossReferences).toContainEqual(expect.objectContaining({ database: 'Ensembl', identifier: 'ENSG00000141510.20' }));
  });

  it('searches reviewed human entries and returns only exact identity matches', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ results: [record, { ...record, primaryAccession: 'Q99999', uniProtKBCrossReferences: [{ database: 'GeneID', id: '9999' }] }] }), { status: 200 }));
    const result = await createUniProtProteinAdapter().getProteinsForGene(gene);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('reviewed%3Atrue');
    expect(result.data?.map((protein) => protein.accession)).toEqual(['P04637']);
  });

  it('reports HTTP and malformed-response errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 429 }));
    await expect(createUniProtProteinAdapter().getProteinsForGene(gene)).resolves.toMatchObject({ status: 'error', errorCode: 'rate-limited' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ unexpected: [] }), { status: 200 }));
    await expect(createUniProtProteinAdapter().getProteinsForGene(gene)).resolves.toMatchObject({ status: 'error', errorCode: 'malformed' });
  });
});