import { createPubmedAdapter } from './adapters/pubmedAdapter';
import { createEuropePmcAdapter } from './adapters/europePmcAdapter';
import { deduplicatePublications, filterPublications, type LiteratureFilters } from '../utils/literature';
import type { Publication } from '../models/scientific';
import type { ServiceResult } from './types';

const pubmed = createPubmedAdapter();
const europePmc = createEuropePmcAdapter();
const errorOnly = (result: ServiceResult<Publication[]>): ServiceResult<Publication[]> => ({ status: result.status, errorCode: result.errorCode, message: result.message, dataMode: result.dataMode });

export const liveLiteratureService = {
	async searchPublications(query: string, filters: LiteratureFilters = {}): Promise<ServiceResult<Publication[]>> {
		const source = filters.source ?? 'pubmed';
		if (source === 'pubmed') {
			const result = await pubmed.searchPublications(query);
			return result.status === 'ok' ? { ...result, data: filterPublications(result.data ?? [], filters) } : result;
		}
		if (source === 'europepmc') {
			const result = await europePmc.searchPublications(query);
			return result.status === 'ok' ? { ...result, data: filterPublications(result.data ?? [], filters) } : result;
		}
		const [pubmedResult, europePmcResult] = await Promise.all([pubmed.searchPublications(query), europePmc.searchPublications(query)]);
		const groups = [pubmedResult, europePmcResult].flatMap((result) => result.status === 'ok' && result.data ? [result.data] : []);
		if (!groups.length) return errorOnly(pubmedResult.status !== 'ok' ? pubmedResult : europePmcResult);
		const publications = filterPublications(deduplicatePublications(groups), filters);
		return {
			status: 'ok',
			data: publications,
			dataMode: 'live',
			message: pubmedResult.status !== 'ok' || europePmcResult.status !== 'ok' ? 'partial' : undefined,
		};
	},
};
