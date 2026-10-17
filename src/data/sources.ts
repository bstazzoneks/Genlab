import type { ScientificSource } from '../models/scientific';

export const plannedSources: ScientificSource[] = [
  { id: 'ncbi', name: 'NCBI Gene', category: 'reference-database', url: 'https://www.ncbi.nlm.nih.gov/gene/', limitations: ['Connected for human gene search and summary records in Phase 2.5.'] },
  { id: 'pubmed', name: 'PubMed', category: 'primary-literature', url: 'https://pubmed.ncbi.nlm.nih.gov/', limitations: ['Connected for on-demand search and summaries. Abstract retrieval remains limited in the static client.'] },
  { id: 'clinvar', name: 'ClinVar', category: 'curated-database', url: 'https://www.ncbi.nlm.nih.gov/clinvar/', limitations: ['Clinical assertions are database submissions that require careful interpretation and may change over time. Connected for on-demand variant retrieval.'] },
  { id: 'dbsnp', name: 'dbSNP', category: 'reference-database', url: 'https://www.ncbi.nlm.nih.gov/snp/', dataUseUrl: 'https://www.ncbi.nlm.nih.gov/home/about/policies/', limitations: ['i18n:sourceLimit.dbsnpEutils'] },
  { id: 'ensembl', name: 'Ensembl', category: 'reference-database', url: 'https://www.ensembl.org/', limitations: ['Connected as best-effort gene detail enrichment in Phase 2.5.'] },
  { id: 'uniprot', name: 'UniProt', category: 'curated-database', url: 'https://www.uniprot.org/', limitations: ['i18n:sourceLimit.uniprot'] },
  { id: 'europepmc', name: 'Europe PMC', category: 'primary-literature', url: 'https://europepmc.org/', dataUseUrl: 'https://europepmc.org/TermsOfUse', limitations: ['i18n:sourceLimit.europepmc'] },
  { id: 'hgnc', name: 'HGNC', category: 'curated-database', url: 'https://www.genenames.org/', limitations: ['i18n:sourceLimit.hgnc'] },
  { id: 'quickgo', name: 'QuickGO', category: 'reference-database', url: 'https://www.ebi.ac.uk/QuickGO/', limitations: ['i18n:sourceLimit.quickgo'] },
  { id: 'ensembl-variation', name: 'Ensembl Variation', category: 'reference-database', url: 'https://rest.ensembl.org/documentation/info/variation_id', dataUseUrl: 'https://www.ensembl.org/info/about/legal/disclaimer.html', limitations: ['i18n:sourceLimit.ensemblFrequency'] },
  { id: 'local-file-analysis', name: 'Local file analysis', category: 'user-provided', limitations: ['i18n:sourceLimit.localFiles'] },
];