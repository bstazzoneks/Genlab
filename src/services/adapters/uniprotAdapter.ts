import type { Gene, Protein, ScientificSource } from '../../models/scientific';
import type { ServiceResult } from '../types';

const baseUrl = 'https://rest.uniprot.org/uniprotkb';

interface UniProtName { value?: string; }
interface UniProtGene { geneName?: UniProtName; synonyms?: UniProtName[]; }
interface UniProtCrossReference { database?: string; id?: string; properties?: Array<{ key?: string; value?: string }>; }
interface UniProtFeature { type?: string; description?: string; location?: { start?: { value?: number }; end?: { value?: number } }; }
interface UniProtComment {
  commentType?: string;
  texts?: Array<{ value?: string }>;
  subcellularLocations?: Array<{ location?: { value?: string } }>;
  isoforms?: Array<{ isoformIds?: string[]; name?: { value?: string } }>;
}
export interface UniProtRecord {
  primaryAccession?: string;
  uniProtkbId?: string;
  entryType?: string;
  organism?: { taxonId?: number };
  genes?: UniProtGene[];
  proteinDescription?: { recommendedName?: { fullName?: UniProtName }; submissionNames?: Array<{ fullName?: UniProtName }> };
  sequence?: { value?: string; length?: number; molWeight?: number };
  comments?: UniProtComment[];
  features?: UniProtFeature[];
  uniProtKBCrossReferences?: UniProtCrossReference[];
}

const failure = <T>(errorCode: ServiceResult<T>['errorCode'], message: string): ServiceResult<T> => ({ status: 'error', errorCode, message, dataMode: 'live' });
const sourceFor = (accession: string, retrievedAt: string): ScientificSource => ({
  id: `uniprot-${accession}`, name: 'UniProt', category: 'curated-database', identifier: accession,
  url: `https://www.uniprot.org/uniprotkb/${encodeURIComponent(accession)}`, retrievedAt,
  limitations: ['i18n:sourceLimit.uniprot'],
});
const text = (value: string | undefined): string | undefined => value?.trim() || undefined;
const xrefs = (record: UniProtRecord): UniProtCrossReference[] => record.uniProtKBCrossReferences ?? [];
const geneName = (record: UniProtRecord): string | undefined => text(record.genes?.[0]?.geneName?.value);
const sameId = (left: string, right: string): boolean => left.replace(/\.\d+$/, '').toLocaleLowerCase() === right.replace(/\.\d+$/, '').toLocaleLowerCase();

const exactIdentityMatch = (record: UniProtRecord, gene: Gene): boolean => {
  if (record.organism?.taxonId !== 9606) return false;
  const identifiers = [
    { database: 'GeneID', value: gene.externalIdentifiers.NCBI ?? gene.id },
    { database: 'Ensembl', value: gene.externalIdentifiers.Ensembl },
  ].filter((item): item is { database: string; value: string } => Boolean(item.value));
  if (identifiers.length) return identifiers.some(({ database, value }) => xrefs(record).some((xref) => {
    if (xref.database !== database) return false;
    if (xref.id && sameId(xref.id, value)) return true;
    if (database === 'Ensembl') return xref.properties?.some((property) => property.key === 'GeneId' && Boolean(property.value) && sameId(property.value!, value)) ?? false;
    return false;
  }));
  return geneName(record)?.toLocaleLowerCase() === gene.symbol.toLocaleLowerCase();
};

const crossReferenceUrl = (database: string, identifier: string): string | undefined => {
  if (database === 'PDB') return `https://www.rcsb.org/structure/${encodeURIComponent(identifier)}`;
  if (database === 'AlphaFoldDB') return `https://alphafold.ebi.ac.uk/entry/${encodeURIComponent(identifier)}`;
  if (database === 'Ensembl') return `https://www.ensembl.org/id/${encodeURIComponent(identifier)}`;
  if (database === 'RefSeq') return `https://www.ncbi.nlm.nih.gov/protein/${encodeURIComponent(identifier)}`;
  return undefined;
};

const goAspect = (term: string): 'molecular-function' | 'biological-process' | 'cellular-component' | undefined => {
  const aspect = term.slice(0, 2);
  return aspect === 'F:' ? 'molecular-function' : aspect === 'P:' ? 'biological-process' : aspect === 'C:' ? 'cellular-component' : undefined;
};
const evidenceSource = (code: string): NonNullable<Protein['goAnnotations']>[number]['evidenceSource'] => {
  if (code === 'IEA') return 'inferred-electronically';
  if (code === 'not-reported') return 'not-reported';
  return ['EXP', 'IDA', 'IPI', 'IMP', 'IGI', 'IEP', 'TAS', 'NAS', 'IC', 'ND', 'RCA'].includes(code) ? 'manually-curated' : 'other-inference';
};

const normalizeGo = (reference: UniProtCrossReference, retrievedAt: string): NonNullable<Protein['goAnnotations']>[number] | undefined => {
  if (!reference.id?.startsWith('GO:')) return undefined;
  const term = text(reference.properties?.find((property) => property.key === 'GoTerm' || property.key === 'term')?.value);
  const evidenceValue = text(reference.properties?.find((property) => property.key === 'GoEvidenceType' || property.key === 'evidence')?.value);
  const aspect = term ? goAspect(term) : undefined;
  if (!term || !aspect) return undefined;
  const evidenceCode = evidenceValue?.split(':')[0] ?? 'not-reported';
  return {
    id: reference.id,
    term: term.slice(2),
    aspect,
    evidenceCode,
    evidenceSource: evidenceSource(evidenceCode),
    database: 'UniProt',
    category: 'curated-database',
    retrievedAt,
    limitations: ['i18n:sourceLimit.uniprotGo'],
    url: `https://amigo.geneontology.org/amigo/term/${encodeURIComponent(reference.id)}`,
  };
};

export const normalizeUniProtProtein = (record: UniProtRecord, gene: Gene, retrievedAt: string): Protein | undefined => {
  if (!record.primaryAccession || !exactIdentityMatch(record, gene)) return undefined;
  const accession = record.primaryAccession;
  const comments = record.comments ?? [];
  const functionDescription = comments.filter((comment) => comment.commentType === 'FUNCTION').flatMap((comment) => comment.texts ?? []).map((item) => text(item.value)).filter((item): item is string => Boolean(item)).join(' ');
  const subcellularLocation = comments.filter((comment) => comment.commentType === 'SUBCELLULAR LOCATION').flatMap((comment) => comment.subcellularLocations ?? []).map((item) => text(item.location?.value)).filter((item): item is string => Boolean(item));
  const isoforms = comments.filter((comment) => comment.commentType === 'ALTERNATIVE PRODUCTS').flatMap((comment) => comment.isoforms ?? []).flatMap((isoform) => (isoform.isoformIds ?? []).map((id) => ({ id, name: text(isoform.name?.value) })));
  const references = xrefs(record);
  const crossReferences = [...new Map(references.filter((reference) => ['PDB', 'AlphaFoldDB', 'Ensembl', 'RefSeq'].includes(reference.database ?? '') && reference.id).map((reference) => {
    const identifier = reference.database === 'Ensembl' ? reference.properties?.find((property) => property.key === 'GeneId')?.value ?? reference.id! : reference.id!;
    return [`${reference.database}:${identifier}`, { database: reference.database!, identifier, url: crossReferenceUrl(reference.database!, identifier) }];
  })).values()];
  const features = (record.features ?? []).flatMap((feature) => {
    const start = feature.location?.start?.value;
    const end = feature.location?.end?.value;
    return feature.type && Number.isInteger(start) && Number.isInteger(end) ? [{ type: feature.type, start: start!, end: end!, description: text(feature.description) }] : [];
  });
  const name = text(record.proteinDescription?.recommendedName?.fullName?.value) ?? text(record.proteinDescription?.submissionNames?.[0]?.fullName?.value) ?? accession;
  return {
    id: accession,
    accession,
    entryName: text(record.uniProtkbId),
    name,
    geneId: gene.id,
    organism: 'Homo sapiens',
    sequenceId: accession,
    aminoAcidLength: record.sequence?.length,
    massDaltons: record.sequence?.molWeight,
    canonicalSequence: text(record.sequence?.value),
    functionDescription: functionDescription || undefined,
    subcellularLocation: [...new Set(subcellularLocation)],
    features,
    isoforms,
    crossReferences,
    goAnnotations: references.filter((reference) => reference.database === 'GO').map((reference) => normalizeGo(reference, retrievedAt)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    sources: [sourceFor(accession, retrievedAt)],
  };
};

const requestJson = async <T>(url: string): Promise<ServiceResult<T>> => {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (response.status === 404) return failure('not-found', 'UniProt returned no protein record.');
    if (!response.ok) return failure(response.status === 429 ? 'rate-limited' : 'unavailable', 'UniProt could not be reached.');
    return { status: 'ok', data: await response.json() as T, dataMode: 'live' };
  } catch {
    return failure('network', 'UniProt could not be reached.');
  } finally {
    globalThis.clearTimeout(timeout);
  }
};

export const createUniProtProteinAdapter = (): {
  getProteinsForGene(gene: Gene): Promise<ServiceResult<Protein[]>>;
} => ({
  async getProteinsForGene(gene) {
    const query = `(gene_exact:${gene.symbol}) AND (organism_id:9606) AND (reviewed:true)`;
    const params = new URLSearchParams({ query, format: 'json', size: '500' });
    const result = await requestJson<{ results?: UniProtRecord[] }>(`${baseUrl}/search?${params.toString()}`);
    if (result.status !== 'ok' || !result.data) return result as ServiceResult<Protein[]>;
    if (!Array.isArray(result.data.results)) return failure('malformed', 'UniProt returned an unexpected response.');
    const retrievedAt = new Date().toISOString();
    const proteins = result.data.results.map((record) => normalizeUniProtProtein(record, gene, retrievedAt)).filter((protein): protein is Protein => Boolean(protein));
    return proteins.length ? { status: 'ok', data: proteins, dataMode: 'live' } : failure('not-found', 'No reviewed UniProt entry matched this exact human gene identity.');
  },
});