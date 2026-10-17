import './styles/main.css';
import './styles/protein.css';
import './styles/population.css';
import './styles/literature.css';
import './styles/sample-import.css';
import { getLocale, setLocale, t } from './i18n';
import { renderGeneDetailsWithNomenclature, renderProteinExplorerPage, renderSearchPage, renderSearchPageWithAliasSuggestions, renderVariantExplorer } from './components/explorer';
import { renderPopulationLoading, renderPopulationResults, renderVariantDetailsWithPopulation } from './components/population';
import { renderSampleRegistryPage } from './components/samples';
import { renderFileImportPageWithProgressIds, renderVcfPageRows, renderVcfTableHead } from './components/fileImport';
import { bindCustomFieldsEditor, readCustomFields } from './components/customFields';
import { bindVariantAssessment, bindVariantKnowledgeSearch, renderVariantAssessmentPage, renderVariantKnowledgePage } from './components/variantKnowledge';
import { renderAboutPage, renderAssistantPage, renderGeneComparisonPage, renderGeneIdentificationResults, renderLabGeneContext, renderLabLoadingPage, renderLabPage, renderLabVcfConditions, renderLiteraturePage, renderNotebookPageWithSamples, renderSourcesPage, renderWorkspaceSelectionWithNotes } from './components/sitePages';
import { demoGeneService, demoVariantService, applyVariantFilters } from './services/demo';
import { liveGeneService } from './services/live';
import { liveVariantService } from './services/liveVariants';
import { liveDbSnpService } from './services/liveDbSnp';
import { livePopulationService } from './services/livePopulation';
import { liveProteinService } from './services/liveProteins';
import { createHgncAdapter } from './services/adapters/hgncAdapter';
import { liveLiteratureService } from './services/liveLiterature';
import SequenceAnalysisWorker from './workers/sequence.worker?worker';
import { compareSequences, type PrimerDesignOptions, type SequenceAnalysis, type SequenceFileSummary } from './utils/sequence';
import { addHistoryEntry, getHistory, getSavedItems, isSaved, setNote, toggleSaved, type SavedItemKind } from './utils/workspace';
import { deleteExperiment, getExperiments, saveExperiment, type NotebookDataPoint, type NotebookReference } from './utils/notebook';
import { getVariantKnowledge, searchVariantKnowledge } from './services/variantKnowledge';
import type { GeneIdentificationResult } from './models/geneIdentification';
import { annotateVariantWithProvider, clearVariantAnnotationCache, createClinVarIdentifierAdapter, filterDetectedVariants, getVariantComparisonKey, type DetectedVariantFilters } from './services/variantAnnotation';
import { serializeGeneIdentificationCsv } from './utils/variantExport';
import { createSample, exportSampleRegistryCsv, exportSampleRegistryJson, getSampleRegistry, linkAnalysisToSample, mergeSampleRegistryImport, previewSampleRegistryImport, SampleRegistryError, suggestSampleId, updateSample } from './utils/sampleRegistry';
import type { Sample, SampleRegistryImportPreview, SampleStatus, SampleType } from './models/sample';
import type { FileImportResult, QpcrColumnMapping } from './models/fileImport';

type Route = { kind: 'home' | 'genes' | 'gene' | 'proteins' | 'samples' | 'imports' | 'variants' | 'variant' | 'variant-explorer' | 'variant-assessment' | 'literature' | 'lab' | 'assistant' | 'about' | 'sources' | 'saved' | 'compare' | 'notebook' | 'planned'; id?: string; sub?: string; query: URLSearchParams };
const clearLegacyAccountStorage = (): void => { try { ['genelab-local-accounts', 'genelab-local-session', 'genelab-cloud-token', 'genelab-cloud-account'].forEach((key) => localStorage.removeItem(key)); } catch { /* Storage may be unavailable in restricted browser contexts. */ } };
clearLegacyAccountStorage();
type PlannedRoute = 'literature' | 'lab' | 'assistant' | 'about' | 'sources' | 'variants';

const plannedRoutes: Record<PlannedRoute, string> = { literature: 'literature', lab: 'lab', assistant: 'assistant', about: 'about', sources: 'sources', variants: 'variants' };
const hgncAdapter = createHgncAdapter();
const navItems: Array<{ route: string; key: Parameters<typeof t>[0] }> = [
  { route: '', key: 'nav.home' }, { route: 'genes', key: 'nav.genes' }, { route: 'proteins', key: 'nav.proteins' }, { route: 'variants', key: 'nav.variants' }, { route: 'variant-explorer', key: 'nav.variantExplorer' },
  { route: 'literature', key: 'nav.literature' }, { route: 'lab', key: 'nav.lab' }, { route: 'imports', key: 'nav.imports' }, { route: 'samples', key: 'nav.samples' }, { route: 'assistant', key: 'nav.assistant' }, { route: 'saved', key: 'nav.saved' }, { route: 'notebook', key: 'nav.notebook' },
  { route: 'about', key: 'nav.about' }, { route: 'sources', key: 'nav.sources' },
];

const parseRoute = (): Route => {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, search = ''] = raw.split('?');
  const segments = path.split('/').filter(Boolean);
  const query = new URLSearchParams(search);
  if (!segments.length) return { kind: 'home', query };
  if (segments[0] === 'genes') return { kind: 'genes', query };
  if (segments[0] === 'gene' && segments[1]) return { kind: 'gene', id: decodeURIComponent(segments[1]), query };
  if (segments[0] === 'proteins') return { kind: 'proteins', query };
  if (segments[0] === 'samples') return { kind: 'samples', id: segments[1] && segments[1] !== 'new' ? decodeURIComponent(segments[1]) : segments[1], sub: segments[2], query };
  if (segments[0] === 'imports') return { kind: 'imports', query };
  if (segments[0] === 'variants') return { kind: 'variants', query };
  if (segments[0] === 'variant' && segments[1]) return { kind: 'variant', id: decodeURIComponent(segments[1]), query };
  if (segments[0] === 'variant-explorer') return { kind: 'variant-explorer', query };
  if (segments[0] === 'variant-assessment' && segments[1]) return { kind: 'variant-assessment', id: decodeURIComponent(segments[1]), query };
  if (['literature', 'lab', 'assistant', 'about', 'sources', 'saved', 'compare', 'notebook'].includes(segments[0])) return { kind: segments[0] as Route['kind'], query };
  if (plannedRoutes[segments[0] as PlannedRoute]) return { kind: 'planned', id: segments[0], query };
  return { kind: 'home', query };
};

const activePath = (route: Route): string => route.kind === 'home' ? '' : route.kind === 'gene' ? 'genes' : route.kind === 'variant' || route.kind === 'variants' ? 'variants' : route.id ?? route.kind;
const renderNav = (route: Route): string => navItems.map(({ route: path, key }) => `<a class="nav-link ${activePath(route) === path ? 'is-active' : ''}" href="#/${path}" ${activePath(route) === path ? 'aria-current="page"' : ''}>${t(key)}</a>`).join('');

const renderHome = (): string => `<section class="hero" aria-labelledby="home-title"><div class="hero-copy"><p class="eyebrow">${t('home.eyebrow')} <span class="status-chip">${t('home.status')}</span></p><h1 id="home-title">${t('home.title')}</h1><p class="hero-description">${t('home.description')}</p><form class="search-form" id="search-form" role="search"><label class="sr-only" for="global-search">${t('home.searchPlaceholder')}</label><input id="global-search" name="query" type="search" placeholder="${t('home.searchPlaceholder')}" /><button type="submit">${t('home.searchAction')} <span aria-hidden="true">-&gt;</span></button></form></div><div class="hero-mark" aria-hidden="true"><span>G</span><span>A</span><span>T</span><span>C</span></div></section><section class="workflow" aria-labelledby="workflow-title"><div class="section-heading"><p class="eyebrow">01 / ${t('home.workflow')}</p><h2 id="workflow-title">${t('home.workflowDescription')}</h2></div><ol class="workflow-list">${(['search', 'explore', 'analyze', 'evidence', 'interpret'] as const).map((step, index) => `<li><span>0${index + 1}</span><strong>${t(`workflow.${step}`)}</strong></li>`).join('')}</ol></section><aside class="notice" aria-labelledby="notice-title"><div><p class="eyebrow">${t('home.noticeTitle')}</p><p id="notice-title">${t('home.notice')}</p></div><span class="notice-icon" aria-hidden="true">i</span></aside><section class="coming-next"><p class="eyebrow">${t('explorer.comingNext')}</p><p>${t('explorer.comingNextText')}</p></section>`;

const renderPlanned = (route: string): string => `<section class="placeholder" aria-labelledby="placeholder-title"><p class="eyebrow">${t(navItems.find((item) => item.route === route)?.key ?? 'nav.home')}</p><h1 id="placeholder-title">${t('status.planned')}</h1><p>${t('page.comingSoon')}</p><a class="text-link" href="#/">${t('page.backHome')} -&gt;</a></section>`;
const renderLoading = (): string => `<section class="state-panel" role="status"><span class="loader" aria-hidden="true"></span><p>${t('explorer.loading')}</p></section>`;
const escapeText = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const renderError = (errorCode?: 'network' | 'not-found' | 'rate-limited' | 'malformed' | 'unavailable', requested?: string): string => { const message = errorCode === 'not-found' ? (requested ? t('explorer.notFoundFor').replace('{gene}', escapeText(requested)) : t('explorer.notFound')) : errorCode === 'rate-limited' ? t('explorer.rateLimited') : t('explorer.fetchError'); return `<section class="state-panel error-state" role="alert"><p>${message}</p><a class="text-link" href="#/genes">${t('nav.genes')} -&gt;</a></section>`; };

const renderShell = (route: Route): void => {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<header class="site-header"><a class="brand" href="#/"><span class="brand-mark">GL</span><span><strong>GeneLab</strong><small>${t('brand.tagline')}</small></span></a><nav class="desktop-nav" aria-label="${t('nav.primary')}">${renderNav(route)}</nav><div class="header-actions"><button class="icon-button" id="language-toggle" type="button" aria-label="${t('language.switch')}">${getLocale().toUpperCase()}</button><button class="icon-button" id="theme-toggle" type="button" aria-label="${t('theme.toggle')}">◐</button></div></header><main id="page-content">${route.kind === 'home' ? renderHome() : route.kind === 'planned' ? renderPlanned(route.id ?? '') : renderLoading()}</main><footer><span>GeneLab</span><span>${t('footer.phase')}</span></footer>`;
  document.documentElement.lang = getLocale();
  document.querySelector<HTMLButtonElement>('#language-toggle')?.addEventListener('click', () => { setLocale(getLocale() === 'en' ? 'es' : 'en'); render(); });
  document.querySelector<HTMLButtonElement>('#theme-toggle')?.addEventListener('click', () => document.documentElement.classList.toggle('dark'));
  document.querySelector<HTMLFormElement>('#search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const query = new FormData(event.currentTarget as HTMLFormElement).get('query')?.toString() ?? ''; window.location.hash = `#/genes?q=${encodeURIComponent(query)}`; });
};

const bindGeneSearch = (): void => document.querySelector<HTMLFormElement>('#gene-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const query = new FormData(event.currentTarget as HTMLFormElement).get('query')?.toString() ?? ''; window.location.hash = `#/genes?q=${encodeURIComponent(query)}`; });
const bindProteinSearch = (): void => document.querySelector<HTMLFormElement>('#protein-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const query = new FormData(event.currentTarget as HTMLFormElement).get('query')?.toString() ?? ''; window.location.hash = `#/proteins?q=${encodeURIComponent(query)}`; });
let pendingProteinSequence: string | undefined;
const bindProteinToLab = (protein: import('./models/scientific').Protein): void => {
  document.querySelector<HTMLButtonElement>('#protein-to-lab')?.addEventListener('click', () => {
    if (!protein.canonicalSequence) return;
    pendingProteinSequence = `>protein:${protein.accession ?? protein.id} ${protein.name}\n${protein.canonicalSequence}`;
    const query = new URLSearchParams({ protein: protein.accession ?? protein.id, gene: protein.geneId });
    window.location.hash = `#/lab?${query.toString()}`;
  });
};
const bindGeneProteinLink = (gene: import('./models/scientific').Gene): void => {
  const actions = document.querySelector<HTMLElement>('.record-actions');
  if (!actions) return;
  const link = document.createElement('a');
  link.className = 'action-link';
  link.href = `#/proteins?gene=${encodeURIComponent(gene.id)}`;
  link.textContent = t('protein.viewProtein');
  actions.append(link);
};
const bindGeneLiteratureLink = (gene: import('./models/scientific').Gene): void => {
  const actions = document.querySelector<HTMLElement>('.record-actions');
  if (!actions) return;
  const link = document.createElement('a');
  link.className = 'action-link';
  link.href = `#/literature?${new URLSearchParams({ q: gene.symbol, source: 'pubmed' }).toString()}`;
  link.textContent = t('literature.related');
  actions.append(link);
};
const bindVariantFilters = (geneId: string): void => document.querySelector<HTMLFormElement>('#variant-filters')?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const type = data.get('type')?.toString() ?? ''; const consequence = data.get('consequence')?.toString() ?? ''; const significance = data.get('significance')?.toString() ?? ''; const transcript = data.get('transcript')?.toString() ?? ''; window.location.hash = `#/variants?gene=${encodeURIComponent(geneId)}&type=${encodeURIComponent(type)}&consequence=${encodeURIComponent(consequence)}&significance=${encodeURIComponent(significance)}&transcript=${encodeURIComponent(transcript)}`; });
const bindVariantSearch = (): void => { const form = document.querySelector<HTMLFormElement>('#variant-search-form'); const input = document.querySelector<HTMLInputElement>('#variant-query'); if (!form || !input) return; form.addEventListener('submit', (event) => { event.preventDefault(); const query = input.value.trim(); if (query) window.location.hash = `#/variants?q=${encodeURIComponent(query)}`; }); };
const bindVariantPopulationLookup = (): void => {
  const form = document.querySelector<HTMLFormElement>('#population-lookup-form');
  const input = document.querySelector<HTMLInputElement>('#population-rsid');
  const result = document.querySelector<HTMLElement>('#population-results');
  if (!form || !input || !result) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rsId = input.value.trim().toLocaleLowerCase();
    if (!/^rs\d+$/.test(rsId)) { input.setCustomValidity(t('population.invalidRsId')); input.reportValidity(); return; }
    input.setCustomValidity('');
    const requestId = latestRequestId;
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (button) button.disabled = true;
    result.innerHTML = renderPopulationLoading();
    const [dbSnp, frequencies] = await Promise.all([
      liveDbSnpService.getVariant(rsId),
      livePopulationService.getPopulationFrequencies(rsId),
    ]);
    if (requestId !== latestRequestId) return;
    result.innerHTML = renderPopulationResults(rsId, dbSnp, frequencies);
    if (button) button.disabled = false;
  });
};
const bindLiteratureSearch = (publications: import('./models/scientific').Publication[] = []): void => {
  document.querySelector<HTMLFormElement>('#literature-search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    const params = new URLSearchParams();
    const query = values.get('query')?.toString().trim() ?? '';
    const source = values.get('source')?.toString() ?? 'pubmed';
    const yearFrom = values.get('yearFrom')?.toString() ?? '';
    const yearTo = values.get('yearTo')?.toString() ?? '';
    const articleType = values.get('articleType')?.toString() ?? 'any';
    const preprints = values.get('preprints')?.toString() ?? 'include';
    if (query) params.set('q', query);
    params.set('source', source);
    if (yearFrom) params.set('yearFrom', yearFrom);
    if (yearTo) params.set('yearTo', yearTo);
    if (values.get('openAccessOnly')) params.set('openAccessOnly', '1');
    if (articleType !== 'any') params.set('articleType', articleType);
    if (preprints !== 'include') params.set('preprints', preprints);
    window.location.hash = `#/literature?${params.toString()}`;
  });
  document.querySelector<HTMLButtonElement>('#export-literature')?.addEventListener('click', () => downloadJson('genelab-bibliography.json', publications.map((publication) => ({ title: publication.title, authors: publication.authors, journal: publication.journal, year: publication.year, identifiers: publication.identifiers, url: publication.url, sources: publication.sources ?? [publication.source], isOpenAccess: publication.isOpenAccess, citationCount: publication.citationCount, fullTextUrl: publication.fullTextUrl, isPreprint: publication.isPreprint, publicationTypes: publication.publicationTypes }))));
};
const downloadJson = (filename: string, value: unknown): void => { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); };
const downloadIdentificationCsv = (result: GeneIdentificationResult): void => {
  const blob = new Blob([serializeGeneIdentificationCsv(result)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'genelab-identification.csv';
  link.click();
  URL.revokeObjectURL(url);
};
const bindGeneIdentificationExports = (result: GeneIdentificationResult): void => {
  document.querySelector<HTMLButtonElement>('#export-identification-json')?.addEventListener('click', () => downloadJson('genelab-identification.json', result));
  document.querySelector<HTMLButtonElement>('#export-identification-csv')?.addEventListener('click', () => downloadIdentificationCsv(result));
};
const bindVariantAnnotationFilters = (result: GeneIdentificationResult): void => {
  const controls = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-variant-filter]')];
  if (!controls.length) return;
  const applyFilters = (): void => {
    const value = (name: string): string => controls.find((control) => control.dataset.variantFilter === name)?.value.trim() ?? '';
    const number = (name: string): number | undefined => value(name) === '' ? undefined : Number(value(name));
    const filters: DetectedVariantFilters = {
      gene: value('gene') || undefined,
      chromosome: value('chromosome') || undefined,
      positionFrom: number('positionFrom'),
      positionTo: number('positionTo'),
      type: value('type') || undefined,
      consequence: value('consequence') || undefined,
      reference: value('reference') || undefined,
      alternative: value('alternative') || undefined,
      minimumSamplePrevalence: number('minimumSamplePrevalence'),
      confidence: value('confidence') || undefined,
      database: value('database') || undefined,
      sample: value('sample') || undefined,
    };
    const matching = filterDetectedVariants(result.records, filters);
    const allowedRows = new Set(matching.map(({ record, variant }) => `${result.records.indexOf(record)}:${record.variants.indexOf(variant)}`));
    const allowedKeys = new Set(matching.map(({ variant }) => getVariantComparisonKey(variant)));
    document.querySelectorAll<HTMLTableRowElement>('[data-variant-row]').forEach((row) => { row.hidden = !allowedRows.has(`${row.dataset.recordIndex}:${row.dataset.variantIndex}`); });
    document.querySelectorAll<HTMLElement>('[data-matrix-variant-key]').forEach((row) => { row.hidden = !allowedKeys.has(row.dataset.matrixVariantKey ?? ''); });
    document.querySelectorAll<HTMLElement>('[data-map-variant-key]').forEach((marker) => { marker.hidden = !allowedKeys.has(marker.dataset.mapVariantKey ?? ''); });
  };
  controls.forEach((control) => control.addEventListener('input', applyFilters));
  document.querySelector<HTMLButtonElement>('#clear-variant-filters')?.addEventListener('click', () => { controls.forEach((control) => { control.value = ''; }); applyFilters(); });
};
const bindVariantAnnotationRefresh = (result: GeneIdentificationResult): void => {
  document.querySelectorAll<HTMLButtonElement>('.refresh-variant-annotation').forEach((button) => button.addEventListener('click', async () => {
    const identifier = button.dataset.identifier;
    const record = result.records[Number(button.dataset.recordIndex)];
    const variantIndex = Number(button.dataset.variantIndex);
    const variant = record?.variants[variantIndex];
    if (!identifier || !variant || !record) return;
    button.disabled = true;
    clearVariantAnnotationCache(identifier);
    record.variants[variantIndex] = await annotateVariantWithProvider(variant, createClinVarIdentifierAdapter(liveVariantService));
    const panel = document.querySelector<HTMLElement>('.identification-results');
    if (!panel) return;
    panel.outerHTML = renderGeneIdentificationResults(result);
    bindGeneIdentificationExports(result);
    bindVariantAnnotationFilters(result);
    bindVariantAnnotationRefresh(result);
  }));
};
const readSequenceFile = async (file: File): Promise<string> => { if (file.name.toLocaleLowerCase().endsWith('.gz')) { if (!('DecompressionStream' in globalThis)) throw new Error('gzip-unsupported'); const stream = file.stream().pipeThrough(new DecompressionStream('gzip')); return new Response(stream).text(); } return file.text(); };
const maxLabInputCharacters = 5_000_000;
const escapeHtml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const compactLabMarkup = (markup: string, analysis: SequenceAnalysis): string => [analysis.transcription, analysis.reverseComplement, analysis.translation]
  .filter((value): value is string => value !== undefined && value.length > 2500)
  .reduce((html, value) => html.replaceAll(escapeHtml(value), `${escapeHtml(value.slice(0, 2000))}\n... preview truncated (${value.length.toLocaleString()} characters)`), markup);
const geneHintFromInput = (input: string): string | undefined => {
  const vcfInfo = input.split(/\r?\n/).find((line) => !line.startsWith('#') && line.trim());
  const vcfGene = vcfInfo?.match(/(?:^|;)GENEINFO=([A-Za-z][A-Za-z0-9-]*)/i)?.[1];
  if (vcfGene) return vcfGene;
  const fastaHeaders = input.split(/\r?\n/).filter((line) => line.startsWith('>'));
  if (fastaHeaders.length > 1) return undefined;
  const header = fastaHeaders[0]?.slice(1).trim();
  if (!header) return undefined;
  const ensemblGeneId = header.match(/\bENSG\d+(?:\.\d+)?\b/i)?.[0];
  if (ensemblGeneId) return ensemblGeneId.toLocaleUpperCase();
  const explicitGene = header.match(/\b(?:gene|symbol|gene_name)[=: ]+([A-Za-z][A-Za-z0-9-]*)/i)?.[1];
  if (explicitGene) return explicitGene;
  const uniprotGene = header.match(/\|([A-Z0-9-]+)_HUMAN\b/i)?.[1];
  if (uniprotGene) return uniprotGene;
  const firstToken = header.split(/[|,;\s]/)[0]?.replace(/^gene:/i, '');
  return firstToken && /^[A-Z][A-Z0-9-]{1,14}$/.test(firstToken) && !/^(NM|NC|NR|NP|XM|XP|ENSG|ENST|CHR)\d/i.test(firstToken) ? firstToken : undefined;
};
const geneHintFromFileName = (fileName: string): string | undefined => {
  const baseName = fileName.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? '';
  const candidate = baseName.match(/^([A-Za-z][A-Za-z0-9-]{1,14})(?=$|[_ .-])/i)?.[1]?.toLocaleUpperCase();
  return candidate && !['SEQUENCE', 'GENE', 'TRANSCRIPT', 'PROTEIN', 'SAMPLE', 'UNKNOWN'].includes(candidate) ? candidate : undefined;
};
let labAnalysisRequestId = 0;
type LabWorkerResult = ReturnType<typeof import('./utils/sequence').resolveLabAnalysis> & { identification: GeneIdentificationResult };
const analyzeInWorker = (input: string, comparison: string, primerOptions: PrimerDesignOptions, fileSummary?: SequenceFileSummary, geneHint?: string): Promise<LabWorkerResult> => new Promise((resolve, reject) => {
  const worker = new SequenceAnalysisWorker();
  const id = ++labAnalysisRequestId;
  worker.addEventListener('message', (event: MessageEvent<{ id: number; result?: LabWorkerResult; error?: string }>) => {
    if (event.data.id !== id) return;
    worker.terminate();
    if (event.data.result) resolve(event.data.result);
    else reject(new Error(event.data.error ?? 'sequence-analysis-failed'));
  });
  worker.addEventListener('error', () => { worker.terminate(); reject(new Error('sequence-analysis-worker-failed')); }, { once: true });
  worker.postMessage({ id, input, comparison, primerOptions, fileSummary, geneHint });
});
const bindLab = (_analysis?: SequenceAnalysis, sequence = '', comparisonSequence = '', _comparison?: ReturnType<typeof compareSequences>, fileSummary?: SequenceFileSummary, _primerOptions: PrimerDesignOptions = {}, geneHint?: string): void => {
  const form = document.querySelector<HTMLFormElement>('#sequence-form');
  const fileInput = document.querySelector<HTMLInputElement>('#sequence-file');
  let activeGeneHint = geneHint;

  if (form && form.dataset.labBound === 'true') return;
  if (form) {
    form.dataset.labBound = 'true';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit?.disabled) return;
      if (submit) submit.disabled = true;
      const formData = new FormData(form);
      const routeRequestId = latestRequestId;
      const input = formData.get('sequence')?.toString() || sequence;
      const nextGeneHint = geneHintFromInput(input) ?? activeGeneHint;
      const nextComparisonSequence = formData.get('comparison')?.toString() || comparisonSequence;
      const nextPrimerOptions: PrimerDesignOptions = { length: Number(formData.get('primerLength')) || 20, minGc: Number(formData.get('minGc')) || 0, maxGc: Number(formData.get('maxGc')) || 100, minTm: Number(formData.get('minTm')) || 0, maxTm: Number(formData.get('maxTm')) || 100 };
      const target = document.querySelector<HTMLDivElement>('#page-content');
      if (!target) return;
      if (input.length > maxLabInputCharacters) {
        target.innerHTML = renderLabPage(undefined, true, undefined, undefined, nextPrimerOptions);
        const error = target.querySelector<HTMLElement>('[role="alert"]');
        if (error) error.textContent = t('lab.inputTooLarge');
        bindLab(undefined, '', nextComparisonSequence, undefined, undefined, nextPrimerOptions);
        return;
      }
      target.innerHTML = renderLabLoadingPage(nextPrimerOptions, input, nextComparisonSequence);
      try {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
        const result = await analyzeInWorker(input, nextComparisonSequence, nextPrimerOptions, fileSummary, nextGeneHint);
        if (routeRequestId !== latestRequestId) return;
        const nextAnalysis = result.analysis;
        const nextComparison = result.comparison;
        const nextSummary = result.summary;
        const geneHint = nextGeneHint;
        let detectedGene: import('./models/scientific').Gene | undefined;
        let clinvarVariants: import('./models/scientific').Variant[] = [];
        if (geneHint) {
          const geneResult = await liveGeneService.getGene(geneHint);
          if (geneResult.status === 'ok' && geneResult.data) {
            detectedGene = geneResult.data;
            const variantResult = await liveVariantService.getVariantsForGene(detectedGene.id);
            if (variantResult.status === 'ok') clinvarVariants = variantResult.data ?? [];
          }
        }
        if (routeRequestId !== latestRequestId) return;
        const page = compactLabMarkup(renderLabPage(nextAnalysis.alphabet === 'unknown' ? undefined : nextAnalysis, nextAnalysis.alphabet === 'unknown', nextComparison, nextSummary, nextPrimerOptions), nextAnalysis);
        const closingSection = page.lastIndexOf('</section>');
        const labContext = `${renderGeneIdentificationResults(result.identification)}${renderLabGeneContext(geneHint, detectedGene, clinvarVariants)}${renderLabVcfConditions(nextSummary)}`;
        target.innerHTML = closingSection < 0 ? page : `${page.slice(0, closingSection)}${labContext}${page.slice(closingSection)}`;
        bindGeneIdentificationExports(result.identification);
        bindVariantAnnotationFilters(result.identification);
        bindVariantAnnotationRefresh(result.identification);
        bindLab(nextAnalysis, input, nextComparisonSequence, nextComparison, nextSummary, nextPrimerOptions, nextGeneHint);
      } catch {
        target.innerHTML = renderLabPage(undefined, true, undefined, fileSummary, nextPrimerOptions);
        bindLab(undefined, input, nextComparisonSequence, undefined, fileSummary, nextPrimerOptions);
      }
    });
  }

  if (fileInput && fileInput.dataset.labBound === 'true') return;
  if (fileInput) {
    fileInput.dataset.labBound = 'true';
    fileInput.addEventListener('change', async (event) => {
      const files = [...((event.currentTarget as HTMLInputElement).files ?? [])];
      if (!files.length) return;
      let text = '';
      try {
        text = (await Promise.all(files.map(readSequenceFile))).join('\n');
      } catch {
        const target = document.querySelector<HTMLDivElement>('#page-content');
        if (target) target.innerHTML = renderLabPage(undefined, true, undefined, fileSummary, _primerOptions);
        bindLab(undefined, '', comparisonSequence, undefined, fileSummary, _primerOptions);
        return;
      }
      const textarea = document.querySelector<HTMLTextAreaElement>('#sequence-input');
      if (textarea) {
        textarea.value = text;
        textarea.addEventListener('input', () => { activeGeneHint = undefined; }, { once: true });
      }
      const fileGeneHints = files.length === 1 && (text.match(/^>/gm)?.length ?? 0) < 2 && !text.includes('#CHROM')
        ? files.map((file) => geneHintFromFileName(file.name)).filter((hint): hint is string => Boolean(hint))
        : [];
      activeGeneHint = new Set(fileGeneHints).size === 1 ? fileGeneHints[0] : undefined;

      const fileName = files.map((file) => file.name).join(', ');
      const uploadStatus = document.querySelector<HTMLElement>('#sequence-file-status');
      if (uploadStatus) uploadStatus.textContent = `${fileName} · ${text.length.toLocaleString()} characters loaded`;
      const currentFileInput = event.currentTarget as HTMLInputElement;
      currentFileInput.value = '';
    }, true);
  }
};
const bindAssistant = (): void => document.querySelector<HTMLFormElement>('#assistant-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const query = new FormData(event.currentTarget as HTMLFormElement).get('query')?.toString() ?? ''; window.location.hash = `#/assistant?q=${encodeURIComponent(query)}`; });
const bindWorkspaceAction = (kind: SavedItemKind, id: string, label: string, subtitle: string, exportData?: unknown): void => { const host = document.querySelector<HTMLElement>('.record-actions') ?? document.querySelector<HTMLElement>('.record-heading'); if (!host) return; const button = document.createElement('button'); button.className = 'action-button'; button.type = 'button'; const update = (): void => { button.textContent = isSaved(kind, id) ? t('workspace.saved') : t('workspace.save'); }; update(); button.addEventListener('click', () => { toggleSaved({ kind, id, label, subtitle }); update(); }); host.append(button); if (exportData) { const exportButton = document.createElement('button'); exportButton.className = 'action-button'; exportButton.type = 'button'; exportButton.textContent = t('workspace.export'); exportButton.addEventListener('click', () => downloadJson(`genelab-${kind}-${id}.json`, exportData)); host.append(exportButton); const notebookButton = document.createElement('button'); notebookButton.className = 'action-button'; notebookButton.type = 'button'; notebookButton.textContent = t('notebook.addReference'); notebookButton.addEventListener('click', () => { saveExperiment({ title: `${t(`workspace.${kind}`)}: ${label}`, notes: '', tags: [], references: [{ kind, id, label, data: exportData as NotebookReference['data'] }], dataPoints: [] }); notebookButton.textContent = t('notebook.saved'); }); host.append(notebookButton); } };
const bindCompareSelection = (): void => document.querySelector<HTMLFormElement>('#compare-selection-form')?.addEventListener('submit', (event) => { event.preventDefault(); const ids = new FormData(event.currentTarget as HTMLFormElement).getAll('gene').map((value) => value.toString()); if (ids.length < 4) { window.alert(t('workspace.compareMinimum')); return; } window.location.hash = `#/compare?ids=${encodeURIComponent(ids.join(','))}`; });
const bindWorkspaceNotes = (): void => document.querySelectorAll<HTMLButtonElement>('.save-note').forEach((button) => button.addEventListener('click', () => { const kind = button.dataset.noteKind as SavedItemKind; const id = button.dataset.noteId ?? ''; const note = document.querySelector<HTMLTextAreaElement>(`[data-note-kind="${kind}"][data-note-id="${id}"]`); if (!note) return; setNote(kind, id, note.value); button.textContent = t('workspace.noteSaved'); }));
const bindNotebook = (): void => { bindCustomFieldsEditor(); document.querySelector<HTMLFormElement>('#notebook-entry-form')?.addEventListener('submit', (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); const references: NotebookReference[] = (values.get('references')?.toString() ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const [kindValue, idValue, ...labelParts] = line.split('|'); const kind = ['gene', 'variant', 'publication', 'analysis'].includes(kindValue) ? kindValue as NotebookReference['kind'] : 'analysis'; return { kind, id: idValue || labelParts.join('|'), label: labelParts.join('|') || idValue || line }; }); const dataPoints: NotebookDataPoint[] = (values.get('dataPoints')?.toString() ?? '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 20).map((line, index) => { const separator = line.indexOf('|'); return separator >= 0 ? { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() } : { label: `${t('notebook.data')} ${index + 1}`, value: line }; }); saveExperiment({ title: values.get('title')?.toString().trim() || t('notebook.defaultTitle'), notes: values.get('notes')?.toString() ?? '', tags: [], references, dataPoints, sampleIds: values.getAll('sampleIds').map((value) => value.toString()), customFields: readCustomFields(values) }); render(); }); document.querySelectorAll<HTMLButtonElement>('.delete-experiment').forEach((button) => button.addEventListener('click', async () => { const id = button.dataset.experimentId; if (id && window.confirm(t('notebook.confirmDelete'))) { deleteExperiment(id); render(); } })); document.querySelectorAll<HTMLButtonElement>('.export-experiment').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.experimentId; const experiment = getExperiments().find((item) => item.id === id); if (experiment) downloadJson(`genelab-${experiment.id}.json`, experiment); })); };
const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
const getLiveGeneWithRetry = async (id: string): Promise<Awaited<ReturnType<typeof liveGeneService.getGene>>> => {
  let result = await liveGeneService.getGene(id);
  for (let attempt = 0; attempt < 2 && result.status === 'error' && ['network', 'rate-limited', 'unavailable'].includes(result.errorCode ?? ''); attempt += 1) {
    await wait(500 * (attempt + 1));
    result = await liveGeneService.getGene(id);
  }
  return result;
};
const getVariantWithGeneFallback = async (service: import('./services/types').VariantService, variantId: string, geneId?: string): Promise<Awaited<ReturnType<typeof service.getVariant>>> => {
  const direct = await service.getVariant(variantId);
  if (direct.status === 'ok' || !geneId) return direct;
  const related = await service.getVariantsForGene(geneId);
  const found = related.data?.find((variant) => variant.id.toLocaleLowerCase() === variantId.toLocaleLowerCase());
  return found ? { status: 'ok', data: found, dataMode: related.dataMode } : direct;
};
let latestRequestId = 0;
let pendingSampleRegistryPreview: SampleRegistryImportPreview | undefined;
let fileImportWorker: InstanceType<typeof SequenceAnalysisWorker> | undefined;
let fileImportRequestId = 0;
let activeFileImportRequestId = 0;
let selectedLocalFile: File | undefined;
let currentFileImportResult: FileImportResult | undefined;
let currentFileProgress: { bytesRead: number; totalBytes: number; stage: 'parsing' | 'checksum' } | undefined;
let currentFileImportError: string | undefined;
let currentImportSampleId = '';
let currentVcfFilters: { chromosome?: string; position?: string; id?: string; reference?: string; alternate?: string } = {};
let currentVcfInfoFields: string[] | undefined;
let pendingImportedSequence: string | undefined;

const downloadTextFile = (filename: string, contents: string, contentType: string): void => {
  const blob = new Blob([contents], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const sampleRegistryErrorMessage = (error: unknown): string => {
  if (!(error instanceof SampleRegistryError)) return t('sample.error.invalidImport');
  const keys: Record<InstanceType<typeof SampleRegistryError>['code'], Parameters<typeof t>[0]> = {
    unavailable: 'sample.error.storageUnavailable', corrupt: 'sample.error.corruptRegistry', 'too-large': 'sample.error.registryTooLarge',
    'duplicate-id': 'sample.error.duplicateId', 'invalid-sample': 'sample.error.invalidSample', 'not-found': 'sample.error.notFound',
  };
  return t(keys[error.code]);
};

const renderSamplesRoute = (route: Route, error?: string): void => {
  const target = document.querySelector<HTMLDivElement>('#page-content');
  if (!target) return;
  try {
    const registry = getSampleRegistry();
    const mode: 'list' | 'new' | 'detail' | 'edit' = route.id === 'new' ? 'new' : route.sub === 'edit' ? 'edit' : route.id ? 'detail' : 'list';
    target.innerHTML = renderSampleRegistryPage(registry, {
      mode, sampleId: mode === 'edit' ? route.id : mode === 'detail' ? route.id : undefined,
      query: route.query.get('query') ?? '', type: route.query.get('type') ?? '', status: route.query.get('status') ?? '', organism: route.query.get('organism') ?? '',
      suggestedId: suggestSampleId(), importPreview: pendingSampleRegistryPreview, error,
    });
    bindSampleRegistryPage(registry, route, mode);
  } catch (registryError) {
    target.innerHTML = renderSampleRegistryPage({ schemaVersion: 1, samples: [], issuedIds: [] }, { mode: 'list', suggestedId: '', error: sampleRegistryErrorMessage(registryError) });
  }
};

const bindSampleRegistryPage = (registry: ReturnType<typeof getSampleRegistry>, route: Route, mode: 'list' | 'new' | 'detail' | 'edit'): void => {
  bindCustomFieldsEditor();
  document.querySelector<HTMLFormElement>('#sample-filter-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const params = new URLSearchParams();
    for (const key of ['query', 'type', 'status', 'organism']) { const value = values.get(key)?.toString().trim(); if (value) params.set(key, value); }
    window.location.hash = `#/samples${params.size ? `?${params.toString()}` : ''}`;
  });
  document.querySelector<HTMLButtonElement>('#sample-export-json')?.addEventListener('click', () => downloadJson('genelab-samples.json', JSON.parse(exportSampleRegistryJson())));
  document.querySelector<HTMLButtonElement>('#sample-export-csv')?.addEventListener('click', () => downloadTextFile('genelab-samples.csv', exportSampleRegistryCsv(), 'text/csv;charset=utf-8'));
  document.querySelector<HTMLInputElement>('#sample-registry-import')?.addEventListener('change', async (event) => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { renderSamplesRoute(route, t('sample.error.importTooLarge')); return; }
    try {
      const format = file.name.toLocaleLowerCase().endsWith('.csv') ? 'csv' : 'json';
      pendingSampleRegistryPreview = previewSampleRegistryImport(await file.text(), format);
      renderSamplesRoute(route);
    } catch (error) { renderSamplesRoute(route, sampleRegistryErrorMessage(error)); }
  });
  document.querySelector<HTMLButtonElement>('#sample-merge-import')?.addEventListener('click', () => {
    if (!pendingSampleRegistryPreview) return;
    try {
      mergeSampleRegistryImport(pendingSampleRegistryPreview);
      pendingSampleRegistryPreview = undefined;
      render();
    } catch (error) { renderSamplesRoute(route, sampleRegistryErrorMessage(error)); }
  });
  const humanFlag = document.querySelector<HTMLInputElement>('#sample-human-derived');
  humanFlag?.addEventListener('change', () => { const reminder = document.querySelector<HTMLElement>('#human-derived-reminder'); if (reminder) reminder.hidden = !humanFlag.checked; });
  document.querySelector<HTMLFormElement>('#sample-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const values = new FormData(form);
    const sampleInput = {
      internalId: values.get('internalId')?.toString() ?? '',
      organism: values.get('organism')?.toString().trim() ?? '',
      taxonomyId: values.get('taxonomyId')?.toString().trim() || undefined,
      sampleType: values.get('sampleType')?.toString() as SampleType,
      collectionDate: values.get('collectionDate')?.toString() || undefined,
      collectedBy: values.get('collectedBy')?.toString().trim() || undefined,
      sourceLocation: values.get('sourceLocation')?.toString().trim() || undefined,
      storage: { temperature: values.get('storageTemperature')?.toString().trim() || undefined, location: values.get('storageLocation')?.toString().trim() || undefined, box: values.get('storageBox')?.toString().trim() || undefined, position: values.get('storagePosition')?.toString().trim() || undefined },
      protocol: values.get('protocol')?.toString().trim() || undefined,
      protocolId: values.get('protocolId')?.toString().trim() || undefined,
      quantity: values.get('quantity')?.toString() ? Number(values.get('quantity')) : undefined,
      quantityUnit: values.get('quantityUnit')?.toString().trim() || undefined,
      qualityNotes: values.get('qualityNotes')?.toString().trim() || undefined,
      status: values.get('status')?.toString() as SampleStatus,
      humanDerived: values.get('humanDerived') === 'true',
      customFields: readCustomFields(values),
    };
    const note = values.get('historyNote')?.toString().trim() ?? '';
    try {
      const originalId = form.dataset.originalId;
      const sample = mode === 'edit' && originalId ? updateSample(originalId, sampleInput, note) : createSample(sampleInput, note);
      pendingSampleRegistryPreview = undefined;
      window.location.hash = `#/samples/${encodeURIComponent(sample.internalId)}`;
    } catch (error) {
      const message = sampleRegistryErrorMessage(error);
      const output = document.querySelector<HTMLElement>('#sample-form-error');
      if (output) { output.hidden = false; output.textContent = message; }
    }
  });
  if (mode === 'detail' && route.id && !registry.samples.some((sample) => sample.internalId === route.id)) {
    const target = document.querySelector<HTMLDivElement>('#page-content');
    if (target) target.innerHTML = renderSampleRegistryPage(registry, { mode: 'list', suggestedId: suggestSampleId(), error: t('sample.error.notFound') });
  }
};

const renderImportsRoute = (): void => {
  const target = document.querySelector<HTMLDivElement>('#page-content');
  if (!target) return;
  try {
    const samples = getSampleRegistry().samples;
    target.innerHTML = renderFileImportPageWithProgressIds(samples, {
      result: currentFileImportResult, progress: currentFileProgress, error: currentFileImportError,
      selectedFile: selectedLocalFile ? { name: selectedLocalFile.name, size: selectedLocalFile.size, format: getFileFormatLabel(selectedLocalFile.name) } : undefined,
      selectedSampleId: currentImportSampleId, vcfFilters: currentVcfFilters,
    });
    bindFileImportPage(samples);
  } catch (error) {
    currentFileImportError = sampleRegistryErrorMessage(error);
    target.innerHTML = renderFileImportPageWithProgressIds([], { error: currentFileImportError });
    bindFileImportPage([]);
  }
};

const getFileFormatLabel = (name: string): string => {
  const normalized = name.toLocaleLowerCase().replace(/\.gz$/, '');
  return /\.(fastq|fq)$/.test(normalized) ? 'FASTQ' : normalized.endsWith('.vcf') ? 'VCF' : /\.(csv|tsv)$/.test(normalized) ? 'CSV/TSV' : t('fileImport.unsupported');
};

const workerFileError = (error: string, lineNumber?: number): string => {
  const key = `fileImport.error.${error}` as Parameters<typeof t>[0];
  const message = t(key);
  return lineNumber ? `${message} · ${t('fileImport.line')} ${lineNumber}` : message;
};

const ensureFileImportWorker = (): InstanceType<typeof SequenceAnalysisWorker> => {
  if (fileImportWorker) return fileImportWorker;
  const worker = new SequenceAnalysisWorker();
  fileImportWorker = worker;
  worker.addEventListener('message', (event: MessageEvent<{ id: number; kind?: string; progress?: { bytesRead: number; totalBytes: number; stage: 'parsing' | 'checksum' }; result?: unknown; rows?: import('./models/fileImport').VcfVariantRecord[]; pageIndex?: number; pageCount?: number; totalCount?: number; error?: string; lineNumber?: number }>) => {
    const message = event.data;
    if (message.id !== activeFileImportRequestId) return;
    if (message.kind === 'progress' && message.progress) {
      currentFileProgress = message.progress;
      const progress = document.querySelector<HTMLProgressElement>('#file-import-progress');
      const label = document.querySelector<HTMLElement>('#file-import-progress-label');
      const stage = document.querySelector<HTMLElement>('.import-progress p');
      if (progress) {
        if (message.progress.totalBytes) { progress.max = message.progress.totalBytes; progress.value = Math.min(message.progress.bytesRead, message.progress.totalBytes); }
        else { progress.removeAttribute('max'); progress.removeAttribute('value'); }
      }
      if (label) label.textContent = message.progress.totalBytes ? `${message.progress.bytesRead.toLocaleString()} / ${message.progress.totalBytes.toLocaleString()} bytes` : `${t('fileImport.bytesRead')}: ${message.progress.bytesRead.toLocaleString()} bytes`;
      if (stage) stage.textContent = t(`fileImport.stage.${message.progress.stage}`);
      return;
    }
    if (message.kind === 'vcf-page-result' && currentFileImportResult?.format === 'vcf' && message.rows) {
      currentFileImportResult = { ...currentFileImportResult, variants: message.rows, pageIndex: message.pageIndex ?? 0, pageCount: message.pageCount ?? 1, filteredVariantCount: message.totalCount ?? 0 };
      currentFileProgress = undefined;
      renderImportsRoute();
      return;
    }
    if (message.kind === 'import-result' && message.result) {
      currentFileImportResult = message.result as FileImportResult;
      currentFileProgress = undefined;
      currentFileImportError = undefined;
      currentVcfFilters = {};
      currentVcfInfoFields = currentFileImportResult.format === 'vcf' ? currentFileImportResult.infoDefinitions.slice(0, 4).map((definition) => definition.id) : undefined;
      try { linkAnalysisToSample(currentFileImportResult.sampleId, currentFileImportResult.metadata, t('fileImport.analysisLinkedNote')); }
      catch (error) { currentFileImportError = sampleRegistryErrorMessage(error); }
      renderImportsRoute();
      return;
    }
    currentFileProgress = undefined;
    if (message.kind === 'import-cancelled') currentFileImportError = t('fileImport.error.import-cancelled');
    else currentFileImportError = workerFileError(message.error ?? 'unknown', message.lineNumber);
    renderImportsRoute();
  });
  worker.addEventListener('error', () => {
    fileImportWorker?.terminate();
    fileImportWorker = undefined;
    currentFileProgress = undefined;
    currentFileImportError = t('fileImport.error.worker-failed');
    renderImportsRoute();
  }, { once: true });
  return worker;
};

const requestVcfPage = (pageIndex: number): void => {
  if (currentFileImportResult?.format !== 'vcf') return;
  const worker = ensureFileImportWorker();
  const id = ++fileImportRequestId;
  activeFileImportRequestId = id;
  currentFileProgress = { bytesRead: 0, totalBytes: 0, stage: 'parsing' };
  renderImportsRoute();
  worker.postMessage({ kind: 'vcf-page', id, importId: currentFileImportResult.id, pageIndex, pageSize: currentFileImportResult.pageSize ?? 50, filters: currentVcfFilters });
};

const bindFileImportPage = (_samples: Sample[]): void => {
  const fileInput = document.querySelector<HTMLInputElement>('#import-file');
  const fileStatus = document.querySelector<HTMLElement>('#file-selection-status');
  const dropzone = document.querySelector<HTMLElement>('#file-dropzone');
  const selectFile = (file?: File): void => {
    if (!file) return;
    selectedLocalFile = file;
    currentFileImportResult = undefined;
    currentFileImportError = undefined;
    document.querySelector<HTMLElement>('.file-import-results')?.remove();
    if (fileStatus) fileStatus.textContent = `${file.name} · ${file.size.toLocaleString()} bytes · ${getFileFormatLabel(file.name)}`;
  };
  document.querySelector<HTMLSelectElement>('#file-sample')?.addEventListener('change', (event) => {
    currentImportSampleId = (event.currentTarget as HTMLSelectElement).value;
    renderImportsRoute();
  });
  fileInput?.addEventListener('change', () => selectFile(fileInput.files?.[0]));
  dropzone?.addEventListener('dragover', (event) => { event.preventDefault(); dropzone.classList.add('is-dragging'); });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'));
  dropzone?.addEventListener('drop', (event) => { event.preventDefault(); dropzone.classList.remove('is-dragging'); selectFile((event as DragEvent).dataTransfer?.files?.[0]); });
  dropzone?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput?.click(); } });
  document.querySelector<HTMLFormElement>('#file-import-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const file = selectedLocalFile;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const sampleId = values.get('sampleId')?.toString() ?? '';
    if (!file || !sampleId) { currentFileImportError = t(file ? 'fileImport.error.sample-required' : 'fileImport.error.no-file'); renderImportsRoute(); return; }
    const format = getFileFormatLabel(file.name);
    const csv = format === 'CSV/TSV';
    const maxMb = Number(values.get(csv ? 'maxCsvMb' : 'maxStreamMb')) || (csv ? 10 : 200);
    const maxBytes = maxMb * 1024 * 1024;
    if (file.size > maxBytes) { currentFileImportError = t('fileImport.error.file-too-large'); renderImportsRoute(); return; }
    currentImportSampleId = sampleId;
    currentFileImportResult = undefined;
    currentFileImportError = undefined;
    currentFileProgress = { bytesRead: 0, totalBytes: file.size, stage: 'parsing' };
    const worker = ensureFileImportWorker();
    const id = ++fileImportRequestId;
    activeFileImportRequestId = id;
    renderImportsRoute();
    worker.postMessage({ kind: 'import-file', id, file, sampleId, maxStreamBytes: Number(values.get('maxStreamMb')) * 1024 * 1024 || 200 * 1024 * 1024, maxCsvBytes: Number(values.get('maxCsvMb')) * 1024 * 1024 || 10 * 1024 * 1024 });
  });
  document.querySelector<HTMLButtonElement>('#cancel-file-import')?.addEventListener('click', () => { if (fileImportWorker && activeFileImportRequestId) fileImportWorker.postMessage({ kind: 'cancel-import', id: activeFileImportRequestId }); });
  document.querySelector<HTMLFormElement>('#qpcr-mapping-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (currentFileImportResult?.format !== 'table') return;
    const values = new FormData(event.currentTarget as HTMLFormElement);
    const optional = (name: string): string | undefined => values.get(name)?.toString() || undefined;
    const mapping: QpcrColumnMapping = { sample: optional('sample') ?? '', target: optional('target') ?? '', ct: optional('ct') ?? '', well: optional('well'), replicate: optional('replicate'), plate: optional('plate') };
    const referenceGene = optional('referenceGene');
    const controlSample = optional('controlSample');
    const worker = ensureFileImportWorker();
    const id = ++fileImportRequestId;
    activeFileImportRequestId = id;
    currentFileProgress = { bytesRead: 0, totalBytes: 0, stage: 'parsing' };
    renderImportsRoute();
    worker.postMessage({ kind: 'analyze-qpcr', id, table: currentFileImportResult, mapping, threshold: Number(values.get('threshold')) || 0.5, referenceGene, controlSample });
  });
  document.querySelector<HTMLFormElement>('#vcf-filters')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget as HTMLFormElement);
    currentVcfFilters = Object.fromEntries(['chromosome', 'position', 'id', 'reference', 'alternate'].flatMap((key) => { const value = values.get(key)?.toString().trim(); return value ? [[key, value]] : []; }));
    requestVcfPage(0);
  });
  document.querySelector<HTMLButtonElement>('#vcf-prev')?.addEventListener('click', () => requestVcfPage(Math.max(0, (currentFileImportResult?.format === 'vcf' ? currentFileImportResult.pageIndex ?? 0 : 0) - 1)));
  document.querySelector<HTMLButtonElement>('#vcf-next')?.addEventListener('click', () => requestVcfPage((currentFileImportResult?.format === 'vcf' ? currentFileImportResult.pageIndex ?? 0 : 0) + 1));
  document.querySelectorAll<HTMLInputElement>('[data-vcf-info-field]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    if (currentFileImportResult?.format !== 'vcf') return;
    currentVcfInfoFields = [...document.querySelectorAll<HTMLInputElement>('[data-vcf-info-field]:checked')].map((input) => input.value).slice(0, 4);
    currentFileImportResult = { ...currentFileImportResult, selectedInfoFields: currentVcfInfoFields };
    const table = document.querySelector<HTMLTableElement>('.vcf-table-section table');
    const head = table?.querySelector('thead');
    const body = table?.querySelector('tbody');
    if (head && body) { head.innerHTML = renderVcfTableHead(currentFileImportResult, currentVcfInfoFields); body.innerHTML = renderVcfPageRows(currentFileImportResult.variants, currentVcfInfoFields); }
  }));
  document.querySelector<HTMLButtonElement>('#send-first-read')?.addEventListener('click', () => {
    if (currentFileImportResult?.format !== 'fastq' || !currentFileImportResult.firstRead) return;
    pendingImportedSequence = `${currentFileImportResult.firstRead.header}\n${currentFileImportResult.firstRead.sequence}`;
    window.location.hash = `#/lab?sample=${encodeURIComponent(currentFileImportResult.sampleId)}`;
  });
  document.querySelector<HTMLButtonElement>('#save-import-to-notebook')?.addEventListener('click', () => {
    if (!currentFileImportResult) return;
    saveExperiment({ title: `${currentFileImportResult.fileName} · ${t('fileImport.results')}`, notes: '', tags: [], sampleIds: [currentFileImportResult.sampleId], references: [{ kind: 'analysis', id: currentFileImportResult.metadata.fileChecksum, label: currentFileImportResult.fileName, data: currentFileImportResult }], dataPoints: [] });
    currentFileImportError = t('fileImport.notebookSaved');
    renderImportsRoute();
  });
};

const renderVariantGene = async (target: HTMLDivElement, requestId: number, route: Route, gene: import('./models/scientific').Gene, demoMode: boolean, directVariant?: import('./models/scientific').Variant): Promise<void> => {
  const variants = directVariant ? { data: [directVariant] } : await (demoMode ? demoVariantService : liveVariantService).getVariantsForGene(gene.id);
  const filtered = applyVariantFilters(variants.data ?? [], { type: route.query.get('type') || undefined, consequence: route.query.get('consequence') || undefined, significance: route.query.get('significance') || undefined, transcript: route.query.get('transcript') || undefined });
  if (requestId !== latestRequestId) return;
  target.innerHTML = renderVariantExplorer(gene, filtered, route.query.get('type') ?? '', route.query.get('consequence') ?? '', demoMode ? 'demo' : 'live', route.query.get('q') ?? '', false, route.query.get('significance') ?? '', route.query.get('transcript') ?? '');
  bindVariantFilters(gene.id);
  bindVariantSearch();
};

const resolveHgncSuggestions = async (query: string, existingGenes: import('./models/scientific').Gene[]): Promise<import('./components/explorer').HgncAliasSuggestion[]> => {
  const result = await hgncAdapter.resolvePreviousSymbol(query);
  if (result.status !== 'ok' || !result.data) return [];
  const suggestions: import('./components/explorer').HgncAliasSuggestion[] = [];
  for (const nomenclature of result.data) {
    const ncbiId = nomenclature.crossReferences['NCBI Gene']?.[0];
    const ensemblId = nomenclature.crossReferences.Ensembl?.[0];
    let gene: import('./models/scientific').Gene | undefined;
    const identifier = ncbiId ?? ensemblId;
    if (identifier) {
      const resolved = await liveGeneService.getGene(identifier);
      if (resolved.status === 'ok' && resolved.data?.symbol.toLocaleLowerCase() === nomenclature.approvedSymbol.toLocaleLowerCase()) gene = resolved.data;
    }
    if (!gene) {
      const searched = await liveGeneService.search(nomenclature.approvedSymbol);
      gene = searched.data?.find((candidate) => candidate.symbol.toLocaleLowerCase() === nomenclature.approvedSymbol.toLocaleLowerCase());
    }
    if (gene && !suggestions.some((item) => item.gene.id === gene!.id)) suggestions.push({ query, gene, nomenclature });
  }
  return suggestions.filter((suggestion) => !existingGenes.some((gene) => gene.id === suggestion.gene.id && gene.symbol.toLocaleLowerCase() === query.toLocaleLowerCase()));
};

const loadContent = async (route: Route, requestId: number): Promise<void> => {
  const target = document.querySelector<HTMLDivElement>('#page-content');
  if (!target) return;
  const demoMode = route.query.get('demo') === '1';
  const geneService = demoMode ? demoGeneService : liveGeneService;
  if (route.kind === 'samples') { renderSamplesRoute(route); return; }
  if (route.kind === 'imports') { renderImportsRoute(); return; }
  if (route.kind === 'genes') {
    const query = route.query.get('q') ?? '';
    const result = await geneService.search(query);
    if (requestId !== latestRequestId) return;
    if (result.status !== 'ok') { target.innerHTML = renderError(result.errorCode, query); bindGeneSearch(); return; }
    const genes = result.data ?? [];
    const suggestions = !demoMode && query.trim() ? await resolveHgncSuggestions(query, genes) : [];
    if (requestId !== latestRequestId) return;
    target.innerHTML = suggestions.length ? renderSearchPageWithAliasSuggestions(genes, query, suggestions) : renderSearchPage(genes, query, result.dataMode ?? 'live');
    bindGeneSearch();
    return;
  }
  if (route.kind === 'proteins') {
    const query = route.query.get('q')?.trim() ?? '';
    let gene: import('./models/scientific').Gene | undefined;
    let candidates: import('./models/scientific').Gene[] = [];
    let failed = false;
    const geneId = route.query.get('gene');
    if (geneId) {
      const result = await liveGeneService.getGene(geneId);
      if (requestId !== latestRequestId) return;
      if (result.status === 'ok') gene = result.data;
      else { target.innerHTML = renderProteinExplorerPage(query, undefined, [], [], undefined, true); bindProteinSearch(); return; }
    } else if (query) {
      const search = await liveGeneService.search(query);
      if (requestId !== latestRequestId) return;
      failed = search.status !== 'ok';
      const matches = search.data ?? [];
      const exact = matches.filter((item) => item.symbol.toLocaleLowerCase() === query.toLocaleLowerCase() || item.id.toLocaleLowerCase() === query.toLocaleLowerCase() || item.externalIdentifiers.Ensembl?.toLocaleLowerCase() === query.toLocaleLowerCase());
      candidates = exact.length ? exact : matches;
      if (candidates.length === 1) {
        const result = await liveGeneService.getGene(candidates[0]!.id);
        if (requestId !== latestRequestId) return;
        if (result.status === 'ok') gene = result.data;
        else failed = true;
      }
    }
    let proteins: import('./models/scientific').Protein[] = [];
    if (gene) {
      const result = await liveProteinService.getProteinsForGene(gene);
      if (requestId !== latestRequestId) return;
      proteins = result.data ?? [];
      failed = result.status !== 'ok';
    }
    target.innerHTML = renderProteinExplorerPage(query, gene, gene ? [] : candidates, proteins, route.query.get('accession') ?? undefined, failed);
    bindProteinSearch();
    const selected = proteins.find((protein) => protein.accession === route.query.get('accession') || protein.id === route.query.get('accession'));
    if (selected) bindProteinToLab(selected);
    return;
  }
  if (route.kind === 'variant-explorer') { const query = route.query.get('q')?.trim() ?? ''; const result = query ? await searchVariantKnowledge(query, { genome: route.query.get('genome') || undefined, variantType: route.query.get('variantType') || undefined }) : undefined; if (requestId !== latestRequestId) return; target.innerHTML = renderVariantKnowledgePage(result); bindVariantKnowledgeSearch((nextQuery, filters) => { const params = new URLSearchParams({ q: nextQuery }); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); window.location.hash = `#/variant-explorer?${params.toString()}`; }); return; }
  if (route.kind === 'variant-assessment' && route.id) { const result = await getVariantKnowledge(route.id); if (requestId !== latestRequestId) return; const record = result.records[0]; if (!record) { target.innerHTML = renderVariantKnowledgePage(result); bindVariantKnowledgeSearch((query) => { window.location.hash = `#/variant-explorer?q=${encodeURIComponent(query)}`; }); return; } target.innerHTML = renderVariantAssessmentPage(record); bindVariantAssessment(record, () => render()); return; }
  if (route.kind === 'variants') { const geneId = route.query.get('gene'); const query = route.query.get('q')?.trim() ?? ''; if (geneId) { const result = await geneService.getGene(geneId); if (requestId !== latestRequestId) return; if (result.status !== 'ok' || !result.data) { target.innerHTML = renderError(result.errorCode, geneId); return; } await renderVariantGene(target, requestId, route, result.data, demoMode); return; } if (query) { const variantQuery = /^(VCV|SCV|rs|DEMO-VAR)/i.test(query); if (variantQuery) { const variant = await (demoMode ? demoVariantService : liveVariantService).getVariant(query); if (variant.status === 'ok' && variant.data) { const gene = await (demoMode ? demoGeneService : liveGeneService).getGene(variant.data.geneId); if (gene.status === 'ok' && gene.data) { await renderVariantGene(target, requestId, route, gene.data, demoMode, variant.data); return; } } } const search = await geneService.search(query); const candidate = search.data?.find((item) => item.symbol.toLocaleLowerCase() === query.toLocaleLowerCase() || item.id.toLocaleLowerCase() === query.toLocaleLowerCase()) ?? (search.data?.length === 1 ? search.data[0] : undefined); if (candidate) { const gene = await geneService.getGene(candidate.id); if (gene.status === 'ok' && gene.data) { await renderVariantGene(target, requestId, route, gene.data, demoMode); return; } } if (requestId !== latestRequestId) return; target.innerHTML = renderVariantExplorer(undefined, [], '', '', demoMode ? 'demo' : 'live', query, true); bindVariantSearch(); return; } target.innerHTML = renderVariantExplorer(undefined, [], '', '', demoMode ? 'demo' : 'live'); bindVariantSearch(); return; }
  if (route.kind === 'literature') {
    const query = route.query.get('q') ?? '';
    const sourceValue = route.query.get('source');
    const articleTypeValue = route.query.get('articleType');
    const filters: import('./utils/literature').LiteratureFilters = {
      source: sourceValue === 'europepmc' || sourceValue === 'both' ? sourceValue : 'pubmed',
      yearFrom: route.query.get('yearFrom') && Number.isInteger(Number(route.query.get('yearFrom'))) ? Number(route.query.get('yearFrom')) : undefined,
      yearTo: route.query.get('yearTo') && Number.isInteger(Number(route.query.get('yearTo'))) ? Number(route.query.get('yearTo')) : undefined,
      openAccessOnly: route.query.get('openAccessOnly') === '1',
      articleType: articleTypeValue === 'review' || articleTypeValue === 'original' ? articleTypeValue : 'any',
      preprints: route.query.get('preprints') === 'exclude' ? 'exclude' : 'include',
    };
    const result = await liveLiteratureService.searchPublications(query, filters);
    if (requestId !== latestRequestId) return;
    const state = result.status === 'error' ? 'error' : result.message ? 'partial' : undefined;
    target.innerHTML = renderLiteraturePage(result.data ?? [], query, filters, state);
    bindLiteratureSearch(result.data ?? []);
    return;
  }
  if (route.kind === 'lab') {
    let sequence = pendingImportedSequence ?? pendingProteinSequence ?? '';
    pendingImportedSequence = undefined;
    pendingProteinSequence = undefined;
    const accession = route.query.get('protein');
    const geneId = route.query.get('gene');
    if (!sequence && accession && geneId) {
      const geneResult = await liveGeneService.getGene(geneId);
      if (requestId !== latestRequestId) return;
      if (geneResult.status === 'ok' && geneResult.data) {
        const proteinResult = await liveProteinService.getProteinsForGene(geneResult.data);
        sequence = proteinResult.data?.find((protein) => protein.accession === accession)?.canonicalSequence ?? '';
        if (sequence) sequence = `>protein:${accession}\n${sequence}`;
      }
    }
    if (requestId !== latestRequestId) return;
    target.innerHTML = renderLabPage();
    const sequenceInput = target.querySelector<HTMLTextAreaElement>('#sequence-input');
    if (sequenceInput) sequenceInput.value = sequence;
    bindLab(undefined, sequence);
    return;
  }
  if (route.kind === 'saved') { target.innerHTML = renderWorkspaceSelectionWithNotes(getSavedItems(), getHistory()); bindCompareSelection(); bindWorkspaceNotes(); return; }
  if (route.kind === 'compare') { const savedGeneIds = getSavedItems().filter((item) => item.kind === 'gene').map((item) => item.id); const ids = route.query.get('ids')?.split(',').filter(Boolean) ?? savedGeneIds; const genes: import('./models/scientific').Gene[] = []; for (const id of ids) { if (requestId !== latestRequestId) return; const result = await getLiveGeneWithRetry(id); if (result.status === 'ok' && result.data) genes.push(result.data); } if (requestId !== latestRequestId) return; target.innerHTML = renderGeneComparisonPage(genes); return; }
  if (route.kind === 'notebook') { if (requestId !== latestRequestId) return; const samples = getSampleRegistry().samples; target.innerHTML = renderNotebookPageWithSamples(getExperiments(), samples); bindNotebook(); return; }
  if (route.kind === 'assistant') { const query = route.query.get('q') ?? ''; if (!query) { target.innerHTML = renderAssistantPage(); bindAssistant(); return; } const result = await liveGeneService.getGene(query); if (requestId !== latestRequestId) return; target.innerHTML = renderAssistantPage(result.data, query); bindAssistant(); return; }
  if (route.kind === 'about') { target.innerHTML = renderAboutPage(); return; }
  if (route.kind === 'sources') { target.innerHTML = renderSourcesPage(); return; }
  if (route.kind === 'gene' && route.id) {
    const result = await geneService.getGene(route.id);
    if (requestId !== latestRequestId) return;
    if (result.status !== 'ok' || !result.data) { target.innerHTML = renderError(result.errorCode, route.id); return; }
    const nomenclatureResult = demoMode ? undefined : await hgncAdapter.getForGene(result.data);
    if (requestId !== latestRequestId) return;
    target.innerHTML = renderGeneDetailsWithNomenclature(result.data, result.dataMode ?? 'live', nomenclatureResult?.data);
    bindGeneProteinLink(result.data);
    bindGeneLiteratureLink(result.data);
    addHistoryEntry({ kind: 'gene', id: result.data.id, label: result.data.symbol, href: window.location.hash });
    bindWorkspaceAction('gene', result.data.id, result.data.symbol, result.data.name, result.data);
    return;
  }
  if (route.kind === 'variant' && route.id) { const variantServiceForRoute = demoMode ? demoVariantService : liveVariantService; const result = await getVariantWithGeneFallback(variantServiceForRoute, route.id, route.query.get('gene') ?? undefined); if (requestId !== latestRequestId) return; if (result.status !== 'ok' || !result.data) { target.innerHTML = renderError(result.errorCode, route.id); return; } const gene = demoMode ? await demoGeneService.getGene(result.data.geneId) : await liveGeneService.getGene(result.data.geneId); if (requestId !== latestRequestId) return; target.innerHTML = renderVariantDetailsWithPopulation(result.data, gene.data, demoMode ? 'demo' : 'live'); bindVariantPopulationLookup(); addHistoryEntry({ kind: 'variant', id: result.data.id, label: result.data.id, href: window.location.hash }); bindWorkspaceAction('variant', result.data.id, result.data.id, result.data.consequence ?? result.data.variantType, result.data); }
};

const render = (): void => { const route = parseRoute(); const requestId = ++latestRequestId; renderShell(route); if (route.kind !== 'home' && route.kind !== 'planned') void loadContent(route, requestId); };
window.addEventListener('hashchange', render);
render();
