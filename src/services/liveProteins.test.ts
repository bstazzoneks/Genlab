import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Gene } from '../models/scientific';
import { liveProteinService } from './liveProteins';

const gene: Gene = { id: '7157', symbol: 'TP53', name: 'tumor protein p53', organism: 'Homo sapiens', aliases: [], transcripts: [], proteins: [], externalIdentifiers: { NCBI: '7157' }, sources: [] };
const uniProtRecord = {
  primaryAccession: 'P04637', uniProtkbId: 'P53_HUMAN', organism: { taxonId: 9606 }, genes: [{ geneName: { value: 'TP53' } }],
  proteinDescription: { recommendedName: { fullName: { value: 'Cellular tumor antigen p53' } } }, sequence: { value: 'MEEPQ', length: 5 },
  uniProtKBCrossReferences: [{ database: 'GeneID', id: '7157' }, { database: 'GO', id: 'GO:0005634', properties: [{ key: 'term', value: 'C:nucleus' }, { key: 'evidence', value: 'IDA:UniProtKB' }] }],
};

afterEach(() => vi.restoreAllMocks());

describe('live protein service', () => {
  it('keeps UniProt and QuickGO annotations distinct, including duplicate terms', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [uniProtRecord] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ goId: 'GO:0005634', goName: 'nucleus', goAspect: 'C', evidenceCode: 'IEA' }] }), { status: 200 }));
    const result = await liveProteinService.getProteinsForGene(gene);
    expect(result.data?.[0]?.goAnnotations).toHaveLength(2);
    expect(result.data?.[0]?.goAnnotations?.map((annotation) => annotation.database)).toEqual(['UniProt', 'QuickGO']);
    expect(result.data?.[0]?.sources.map((source) => source.name)).toEqual(['UniProt', 'QuickGO']);
  });

  it('preserves a valid UniProt protein when QuickGO is unavailable', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [uniProtRecord] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const result = await liveProteinService.getProteinsForGene(gene);
    expect(result).toMatchObject({ status: 'ok', data: [{ accession: 'P04637' }] });
    expect(result.data?.[0]?.goAnnotations).toHaveLength(1);
    expect(result.data?.[0]?.sources[1]?.limitations).toContain('i18n:sourceLimit.quickgoUnavailable');
  });
});