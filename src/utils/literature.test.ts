import { describe, expect, it } from 'vitest';
import type { Publication } from '../models/scientific';
import { deduplicatePublications, filterPublications } from './literature';

const pubmedSource = { id: 'pubmed-1', name: 'PubMed', category: 'primary-literature' as const, identifier: '1', retrievedAt: '2026-01-01T00:00:00.000Z' };
const europeSource = { id: 'europepmc-1', name: 'Europe PMC', category: 'primary-literature' as const, identifier: '1', retrievedAt: '2026-01-01T00:00:00.000Z' };
const publication = (overrides: Partial<Publication> = {}): Publication => ({ id: '1', title: 'Retrieved record', authors: [], identifiers: { pmid: '1', doi: '10.1/example' }, source: pubmedSource, ...overrides });

describe('literature merge and filters', () => {
  it('deduplicates by PMID or DOI and retains both source records', () => {
    const merged = deduplicatePublications([[publication()], [publication({ id: 'EPMC1', source: europeSource, sources: [europeSource], identifiers: { pmcid: 'PMC1', doi: '10.1/example' }, isOpenAccess: true, citationCount: 9 })]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources?.map((source) => source.name)).toEqual(['PubMed', 'Europe PMC']);
    expect(merged[0]).toMatchObject({ identifiers: { pmid: '1', pmcid: 'PMC1', doi: '10.1/example' }, isOpenAccess: true, citationCount: 9 });
  });

  it('filters by year, OA, article type and preprint without calculating frequencies or labels', () => {
    const records = [
      publication({ id: 'review', year: 2023, isOpenAccess: true, isPreprint: false, publicationTypes: ['review', 'journal article'] }),
      publication({ id: 'research', year: 2024, isOpenAccess: true, isPreprint: false, publicationTypes: ['research article'] }),
      publication({ id: 'preprint', year: 2024, isOpenAccess: false, isPreprint: true, publicationTypes: ['research article'] }),
      publication({ id: 'unknown', year: 2024 }),
      publication({ id: 'generic-article', year: 2024, publicationTypes: ['journal article'] }),
    ];
    const filtered = filterPublications(records, { yearFrom: 2024, yearTo: 2024, openAccessOnly: true, articleType: 'original', preprints: 'exclude' });
    expect(filtered.map((item) => item.id)).toEqual(['research']);
    expect(filterPublications(records, { articleType: 'review' }).map((item) => item.id)).toEqual(['review']);
    expect(filterPublications([records[4]!], { articleType: 'original' })).toEqual([]);
  });
});