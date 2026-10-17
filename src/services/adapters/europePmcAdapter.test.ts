import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEuropePmcAdapter, normalizeEuropePmcRecord } from './europePmcAdapter';

afterEach(() => vi.restoreAllMocks());

describe('Europe PMC adapter', () => {
  it('normalizes identifiers, OA links, citation counts, preprint and source provenance', () => {
    const publication = normalizeEuropePmcRecord({
      id: 'PMC123', source: 'PMC', pmid: '987654', pmcid: 'PMC123', doi: '10.1000/example', title: 'Retrieved title',
      authorString: 'Author A, Author B', journalTitle: 'Example Journal', pubYear: '2024', isOpenAccess: 'Y',
      citedByCount: 17, pubType: 'research article', isPreprint: 'N',
      fullTextUrlList: { fullTextUrl: [{ url: 'https://doi.example/subscription', availability: 'Subscription required', availabilityCode: 'S' }, { url: 'https://pmc.example/full', availability: 'Open access', availabilityCode: 'OA' }] },
    }, '2026-01-01T00:00:00.000Z');
    if (!publication) throw new Error('Expected a normalized Europe PMC record.');
    expect(publication).toMatchObject({ id: '987654', year: 2024, isOpenAccess: true, citationCount: 17, fullTextUrl: 'https://pmc.example/full', isPreprint: false, publicationTypes: ['research article'] });
    expect(publication.identifiers).toEqual({ pmid: '987654', pmcid: 'PMC123', doi: '10.1000/example' });
    expect(publication.source).toMatchObject({ name: 'Europe PMC', identifier: '987654', retrievedAt: '2026-01-01T00:00:00.000Z', dataUseUrl: 'https://europepmc.org/TermsOfUse' });
  });

  it('never exposes a full text URL when the record is not openly available', () => {
    const publication = normalizeEuropePmcRecord({ id: '42', isOpenAccess: 'N', fullTextUrlList: { fullTextUrl: [{ url: 'https://example/full', availability: 'Open access', availabilityCode: 'OA' }] } }, '2026-01-01T00:00:00.000Z');
    if (!publication) throw new Error('Expected a normalized Europe PMC record.');
    expect(publication.isOpenAccess).toBe(false);
    expect(publication.fullTextUrl).toBeUndefined();
  });

  it('returns empty results and typed HTTP/malformed failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ resultList: { result: [] } }), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const adapter = createEuropePmcAdapter();
    await expect(adapter.searchPublications('epmc-empty-test-2026')).resolves.toMatchObject({ status: 'ok', data: [] });
    await expect(adapter.searchPublications('epmc-http-test-2026')).resolves.toMatchObject({ status: 'error', errorCode: 'unavailable' });
    await expect(adapter.searchPublications('epmc-malformed-test-2026')).resolves.toMatchObject({ status: 'error', errorCode: 'malformed' });
  });
});