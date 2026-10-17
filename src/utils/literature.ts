import type { Publication } from '../models/scientific';

export type LiteratureSourceMode = 'pubmed' | 'europepmc' | 'both';
export type LiteratureArticleType = 'any' | 'review' | 'original';
export interface LiteratureFilters {
  source?: LiteratureSourceMode;
  yearFrom?: number;
  yearTo?: number;
  openAccessOnly?: boolean;
  articleType?: LiteratureArticleType;
  preprints?: 'include' | 'exclude';
}

const identifier = (publication: Publication, key: string): string | undefined => Object.entries(publication.identifiers).find(([name]) => name.toLocaleLowerCase() === key.toLocaleLowerCase())?.[1]?.toLocaleLowerCase();
const sharesIdentifier = (left: Publication, right: Publication): boolean => {
  const leftPmid = identifier(left, 'pmid') ?? (/^\d+$/.test(left.id) && left.source.name === 'PubMed' ? left.id.toLocaleLowerCase() : undefined);
  const rightPmid = identifier(right, 'pmid') ?? (/^\d+$/.test(right.id) && right.source.name === 'PubMed' ? right.id.toLocaleLowerCase() : undefined);
  const leftDoi = identifier(left, 'doi');
  const rightDoi = identifier(right, 'doi');
  return Boolean((leftPmid && rightPmid && leftPmid === rightPmid) || (leftDoi && rightDoi && leftDoi === rightDoi));
};

export const deduplicatePublications = (groups: Publication[][]): Publication[] => {
  const merged: Publication[] = [];
  groups.flat().forEach((publication) => {
    const existingIndex = merged.findIndex((item) => sharesIdentifier(item, publication));
    if (existingIndex < 0) {
      merged.push({ ...publication, sources: publication.sources ?? [publication.source] });
      return;
    }
    const existing = merged[existingIndex]!;
    const sources = [...(existing.sources ?? [existing.source]), ...(publication.sources ?? [publication.source])];
    merged[existingIndex] = {
      ...existing,
      identifiers: { ...existing.identifiers, ...publication.identifiers },
      sources: [...new Map(sources.map((source) => [source.id, source])).values()],
      abstract: existing.abstract ?? publication.abstract,
      isOpenAccess: existing.isOpenAccess ?? publication.isOpenAccess,
      citationCount: existing.citationCount ?? publication.citationCount,
      fullTextUrl: existing.fullTextUrl ?? publication.fullTextUrl,
      isPreprint: existing.isPreprint ?? publication.isPreprint,
      publicationTypes: existing.publicationTypes ?? publication.publicationTypes,
    };
  });
  return merged;
};

const matchesArticleType = (publication: Publication, selected: LiteratureArticleType): boolean => {
  if (selected === 'any') return true;
  if (!publication.publicationTypes?.length) return false;
  const types = publication.publicationTypes.map((type) => type.toLocaleLowerCase());
  const isReview = types.some((type) => type.includes('review'));
  if (selected === 'review') return isReview;
  return !isReview && types.some((type) => /original|research/.test(type));
};

export const filterPublications = (publications: Publication[], filters: LiteratureFilters): Publication[] => publications.filter((publication) => {
  if (filters.yearFrom !== undefined && (publication.year === undefined || publication.year < filters.yearFrom)) return false;
  if (filters.yearTo !== undefined && (publication.year === undefined || publication.year > filters.yearTo)) return false;
  if (filters.openAccessOnly && publication.isOpenAccess !== true) return false;
  if (!matchesArticleType(publication, filters.articleType ?? 'any')) return false;
  if (filters.preprints === 'exclude' && publication.isPreprint === true) return false;
  return true;
});