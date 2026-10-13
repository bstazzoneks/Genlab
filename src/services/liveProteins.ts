import type { Gene, Protein, ScientificSource } from '../models/scientific';
import { createQuickGoAdapter } from './adapters/quickgoAdapter';
import { createUniProtProteinAdapter } from './adapters/uniprotAdapter';
import type { ServiceResult } from './types';

const uniprot = createUniProtProteinAdapter();
const quickgo = createQuickGoAdapter();

const quickGoSource = (protein: Protein, retrievedAt: string, unavailable = false): ScientificSource => ({
  id: `quickgo-${protein.accession ?? protein.id}`,
  name: 'QuickGO',
  category: 'reference-database',
  identifier: `UniProtKB:${protein.accession ?? protein.id}`,
  url: `https://www.ebi.ac.uk/QuickGO/annotations?geneProductId=${encodeURIComponent(`UniProtKB:${protein.accession ?? protein.id}`)}`,
  retrievedAt,
  limitations: unavailable ? ['i18n:sourceLimit.quickgoUnavailable'] : ['i18n:sourceLimit.quickgo'],
});

export const liveProteinService = {
  async getProteinsForGene(gene: Gene): Promise<ServiceResult<Protein[]>> {
    const result = await uniprot.getProteinsForGene(gene);
    if (result.status !== 'ok' || !result.data) return result;
    const proteins = await Promise.all(result.data.map(async (protein) => {
      const retrievedAt = new Date().toISOString();
      const annotations = await quickgo.getAnnotationsForProtein(protein.accession ?? protein.id);
      if (annotations.status === 'ok' && annotations.data) {
        return {
          ...protein,
          goAnnotations: [...(protein.goAnnotations ?? []), ...annotations.data],
          sources: [...protein.sources, quickGoSource(protein, retrievedAt)],
        };
      }
      return { ...protein, sources: [...protein.sources, quickGoSource(protein, retrievedAt, true)] };
    }));
    return { status: 'ok', data: proteins, dataMode: 'live' };
  },
};