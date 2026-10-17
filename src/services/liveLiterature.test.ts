import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveLiteratureService } from './liveLiterature';

afterEach(() => vi.restoreAllMocks());

const pubmedSummary = { result: { uids: ['987654'], '987654': { uid: '987654', title: 'Retrieved title', pubdate: '2024 Jan', authors: [{ name: 'Author A' }], articleids: [{ idtype: 'doi', value: '10.1000/shared' }] } } };
const europeRecord = { id: 'PMC123', source: 'PMC', pmid: '987654', pmcid: 'PMC123', doi: '10.1000/shared', title: 'Retrieved title', authorString: 'Author A', pubYear: '2024', isOpenAccess: 'Y', citedByCount: 5, pubType: 'research article', isPreprint: false };

describe('live literature service', () => {
  it('merges the same article from PubMed and Europe PMC while retaining both sources', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('europepmc')) return new Response(JSON.stringify({ resultList: { result: [europeRecord] } }), { status: 200 });
      if (url.includes('esearch.fcgi')) return new Response(JSON.stringify({ esearchresult: { idlist: ['987654'] } }), { status: 200 });
      return new Response(JSON.stringify(pubmedSummary), { status: 200 });
    });
    const result = await liveLiteratureService.searchPublications('shared-literature-test-2026', { source: 'both' });
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.sources?.map((source) => source.name)).toEqual(['PubMed', 'Europe PMC']);
    expect(result.data?.[0]).toMatchObject({ isOpenAccess: true, citationCount: 5, identifiers: { pmid: '987654', pmcid: 'PMC123', doi: '10.1000/shared' } });
  });

  it('returns PubMed results with a partial-source state when Europe PMC fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('europepmc')) return new Response('', { status: 503 });
      if (url.includes('esearch.fcgi')) return new Response(JSON.stringify({ esearchresult: { idlist: ['987654'] } }), { status: 200 });
      return new Response(JSON.stringify(pubmedSummary), { status: 200 });
    });
    const result = await liveLiteratureService.searchPublications('partial-literature-test-2026', { source: 'both' });
    expect(result).toMatchObject({ status: 'ok', message: 'partial', data: [{ source: { name: 'PubMed' } }] });
  });
});