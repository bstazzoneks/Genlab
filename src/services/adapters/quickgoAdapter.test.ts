import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuickGoAdapter, normalizeQuickGoAnnotations } from './quickgoAdapter';

afterEach(() => vi.restoreAllMocks());

describe('QuickGO adapter', () => {
  it('normalizes aspect and evidence while keeping each annotation independent', () => {
    const annotations = normalizeQuickGoAnnotations([
      { goId: 'GO:0005634', goName: 'nucleus', goAspect: 'C', evidenceCode: 'IDA' },
      { goId: 'GO:0003677', goName: 'DNA binding', goAspect: 'F', evidenceCode: 'IEA' },
    ]);
    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toMatchObject({ aspect: 'cellular-component', evidenceSource: 'manually-curated', database: 'QuickGO' });
    expect(annotations[1]).toMatchObject({ aspect: 'molecular-function', evidenceSource: 'inferred-electronically', evidenceCode: 'IEA' });
  });

  it('uses QuickGO goEvidence and complete aspect names without inventing a term label', () => {
    expect(normalizeQuickGoAnnotations([{ goId: 'GO:0008285', goName: null, goAspect: 'biological_process', goEvidence: 'ISS', evidenceCode: 'ECO:0000250' }], '2026-01-01T00:00:00.000Z')).toMatchObject([
      { id: 'GO:0008285', term: 'GO:0008285', aspect: 'biological-process', evidenceCode: 'ISS', evidenceSource: 'other-inference', database: 'QuickGO', category: 'reference-database', retrievedAt: '2026-01-01T00:00:00.000Z', limitations: ['i18n:sourceLimit.quickgoGo'] },
    ]);
  });

  it('requests annotations for the accession and maps QuickGO failures', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ goId: 'GO:0005634', goName: 'nucleus', goAspect: 'C', evidenceCode: 'IDA' }] }), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 429 }));
    await expect(createQuickGoAdapter().getAnnotationsForProtein('P04637')).resolves.toMatchObject({ status: 'ok', data: [{ id: 'GO:0005634' }] });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('UniProtKB%3AP04637');
    await expect(createQuickGoAdapter().getAnnotationsForProtein('P04637')).resolves.toMatchObject({ status: 'error', errorCode: 'rate-limited' });
  });
});