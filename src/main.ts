import './styles/main.css';
import { getLocale, setLocale, t } from './i18n';
import { renderGeneDetails, renderSearchPage, renderVariantDetails, renderVariantExplorer } from './components/explorer';
import { bindVariantAssessment, bindVariantKnowledgeSearch, renderVariantAssessmentPage, renderVariantKnowledgePage } from './components/variantKnowledge';
import { renderAboutPage, renderAccountPage, renderAssistantPage, renderGeneComparisonPage, renderLabGeneContext, renderLabLoadingPage, renderLabPage, renderLabVcfConditions, renderLiteraturePage, renderNotebookPage, renderSourcesPage, renderWorkspaceSelectionWithNotes } from './components/sitePages';
import { demoGeneService, demoVariantService, applyVariantFilters } from './services/demo';
import { liveGeneService } from './services/live';
import { liveVariantService } from './services/liveVariants';
import { liveLiteratureService } from './services/liveLiterature';
import SequenceAnalysisWorker from './workers/sequence.worker?worker';
import { compareSequences, type PrimerDesignOptions, type SequenceAnalysis, type SequenceFileSummary } from './utils/sequence';
import { addHistoryEntry, getHistory, getSavedItems, isSaved, setNote, toggleSaved, type SavedItemKind } from './utils/workspace';
import { createAccount, getCurrentAccount, loginAccount, logoutAccount } from './utils/accounts';
import { deleteExperimentEverywhere, getExperiments, saveExperiment, syncExperimentRecord, syncExperimentsFromCloud, type NotebookDataPoint, type NotebookReference } from './utils/notebook';
import { getVariantKnowledge, searchVariantKnowledge } from './services/variantKnowledge';

type Route = { kind: 'home' | 'genes' | 'gene' | 'variants' | 'variant' | 'variant-explorer' | 'variant-assessment' | 'literature' | 'lab' | 'assistant' | 'about' | 'sources' | 'saved' | 'compare' | 'notebook' | 'account' | 'planned'; id?: string; query: URLSearchParams };
type PlannedRoute = 'literature' | 'lab' | 'assistant' | 'about' | 'sources' | 'variants';

const plannedRoutes: Record<PlannedRoute, string> = { literature: 'literature', lab: 'lab', assistant: 'assistant', about: 'about', sources: 'sources', variants: 'variants' };
const navItems: Array<{ route: string; key: Parameters<typeof t>[0] }> = [
  { route: '', key: 'nav.home' }, { route: 'genes', key: 'nav.genes' }, { route: 'variants', key: 'nav.variants' }, { route: 'variant-explorer', key: 'nav.variantExplorer' },
  { route: 'literature', key: 'nav.literature' }, { route: 'lab', key: 'nav.lab' }, { route: 'assistant', key: 'nav.assistant' }, { route: 'saved', key: 'nav.saved' }, { route: 'notebook', key: 'nav.notebook' }, { route: 'account', key: 'nav.account' },
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
  if (segments[0] === 'variants') return { kind: 'variants', query };
  if (segments[0] === 'variant' && segments[1]) return { kind: 'variant', id: decodeURIComponent(segments[1]), query };
  if (segments[0] === 'variant-explorer') return { kind: 'variant-explorer', query };
  if (segments[0] === 'variant-assessment' && segments[1]) return { kind: 'variant-assessment', id: decodeURIComponent(segments[1]), query };
  if (['literature', 'lab', 'assistant', 'about', 'sources', 'saved', 'compare', 'notebook', 'account'].includes(segments[0])) return { kind: segments[0] as Route['kind'], query };
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
const bindVariantFilters = (geneId: string): void => document.querySelector<HTMLFormElement>('#variant-filters')?.addEventListener('submit', (event) => { event.preventDefault(); const data = new FormData(event.currentTarget as HTMLFormElement); const type = data.get('type')?.toString() ?? ''; const consequence = data.get('consequence')?.toString() ?? ''; const significance = data.get('significance')?.toString() ?? ''; const transcript = data.get('transcript')?.toString() ?? ''; window.location.hash = `#/variants?gene=${encodeURIComponent(geneId)}&type=${encodeURIComponent(type)}&consequence=${encodeURIComponent(consequence)}&significance=${encodeURIComponent(significance)}&transcript=${encodeURIComponent(transcript)}`; });
const bindVariantSearch = (): void => { const form = document.querySelector<HTMLFormElement>('#variant-search-form'); const input = document.querySelector<HTMLInputElement>('#variant-query'); if (!form || !input) return; form.addEventListener('submit', (event) => { event.preventDefault(); const query = input.value.trim(); if (query) window.location.hash = `#/variants?q=${encodeURIComponent(query)}`; }); };
const bindLiteratureSearch = (publications: import('./models/scientific').Publication[] = []): void => { document.querySelector<HTMLFormElement>('#literature-search-form')?.addEventListener('submit', (event) => { event.preventDefault(); const query = new FormData(event.currentTarget as HTMLFormElement).get('query')?.toString() ?? ''; window.location.hash = `#/literature?q=${encodeURIComponent(query)}`; }); document.querySelector<HTMLButtonElement>('#export-literature')?.addEventListener('click', () => downloadJson('genelab-bibliography.json', publications.map((publication) => ({ title: publication.title, authors: publication.authors, journal: publication.journal, year: publication.year, identifiers: publication.identifiers, url: publication.url })))); };
const downloadJson = (filename: string, value: unknown): void => { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); };
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
  const header = input.split(/\r?\n/).find((line) => line.startsWith('>'))?.slice(1).trim();
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
const analyzeInWorker = (input: string, comparison: string, primerOptions: PrimerDesignOptions, fileSummary?: SequenceFileSummary): Promise<ReturnType<typeof import('./utils/sequence').resolveLabAnalysis>> => new Promise((resolve, reject) => {
  const worker = new SequenceAnalysisWorker();
  const id = ++labAnalysisRequestId;
  worker.addEventListener('message', (event: MessageEvent<{ id: number; result?: ReturnType<typeof import('./utils/sequence').resolveLabAnalysis>; error?: string }>) => {
    if (event.data.id !== id) return;
    worker.terminate();
    if (event.data.result) resolve(event.data.result);
    else reject(new Error(event.data.error ?? 'sequence-analysis-failed'));
  });
  worker.addEventListener('error', () => { worker.terminate(); reject(new Error('sequence-analysis-worker-failed')); }, { once: true });
  worker.postMessage({ id, input, comparison, primerOptions, fileSummary });
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
        const result = await analyzeInWorker(input, nextComparisonSequence, nextPrimerOptions, fileSummary);
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
        const page = compactLabMarkup(renderLabPage(nextAnalysis.alphabet === 'unknown' ? undefined : nextAnalysis, nextAnalysis.alphabet === 'unknown', nextComparison, nextSummary, nextPrimerOptions), nextAnalysis);
        const closingSection = page.lastIndexOf('</section>');
        const labContext = `${renderLabGeneContext(geneHint, detectedGene, clinvarVariants)}${renderLabVcfConditions(nextSummary)}`;
        target.innerHTML = closingSection < 0 ? page : `${page.slice(0, closingSection)}${labContext}${page.slice(closingSection)}`;
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
      const fileGeneHints = files.map((file) => geneHintFromFileName(file.name)).filter((hint): hint is string => Boolean(hint));
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
const bindWorkspaceAction = (kind: SavedItemKind, id: string, label: string, subtitle: string, exportData?: unknown): void => { const host = document.querySelector<HTMLElement>('.record-actions') ?? document.querySelector<HTMLElement>('.record-heading'); if (!host) return; const button = document.createElement('button'); button.className = 'action-button'; button.type = 'button'; const update = (): void => { button.textContent = isSaved(kind, id) ? t('workspace.saved') : t('workspace.save'); }; update(); button.addEventListener('click', () => { toggleSaved({ kind, id, label, subtitle }); update(); }); host.append(button); if (exportData) { const exportButton = document.createElement('button'); exportButton.className = 'action-button'; exportButton.type = 'button'; exportButton.textContent = t('workspace.export'); exportButton.addEventListener('click', () => downloadJson(`genelab-${kind}-${id}.json`, exportData)); host.append(exportButton); const notebookButton = document.createElement('button'); notebookButton.className = 'action-button'; notebookButton.type = 'button'; notebookButton.textContent = t('notebook.addReference'); notebookButton.addEventListener('click', () => { const record = saveExperiment({ title: `${t(`workspace.${kind}`)}: ${label}`, notes: '', tags: [], references: [{ kind, id, label, data: exportData as NotebookReference['data'] }], dataPoints: [], ownerEmail: getCurrentAccount()?.email }); void syncExperimentRecord(record); notebookButton.textContent = t('notebook.saved'); }); host.append(notebookButton); } };
const bindCompareSelection = (): void => document.querySelector<HTMLFormElement>('#compare-selection-form')?.addEventListener('submit', (event) => { event.preventDefault(); const ids = new FormData(event.currentTarget as HTMLFormElement).getAll('gene').map((value) => value.toString()); if (ids.length < 4) { window.alert(t('workspace.compareMinimum')); return; } window.location.hash = `#/compare?ids=${encodeURIComponent(ids.join(','))}`; });
const bindWorkspaceNotes = (): void => document.querySelectorAll<HTMLButtonElement>('.save-note').forEach((button) => button.addEventListener('click', () => { const kind = button.dataset.noteKind as SavedItemKind; const id = button.dataset.noteId ?? ''; const note = document.querySelector<HTMLTextAreaElement>(`[data-note-kind="${kind}"][data-note-id="${id}"]`); if (!note) return; setNote(kind, id, note.value); button.textContent = t('workspace.noteSaved'); }));
const bindNotebook = (): void => { document.querySelector<HTMLFormElement>('#notebook-entry-form')?.addEventListener('submit', (event) => { event.preventDefault(); const values = new FormData(event.currentTarget as HTMLFormElement); const references: NotebookReference[] = (values.get('references')?.toString() ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => { const [kindValue, idValue, ...labelParts] = line.split('|'); const kind = ['gene', 'variant', 'publication', 'analysis'].includes(kindValue) ? kindValue as NotebookReference['kind'] : 'analysis'; return { kind, id: idValue || labelParts.join('|'), label: labelParts.join('|') || idValue || line }; }); const dataPoints: NotebookDataPoint[] = (values.get('dataPoints')?.toString() ?? '').split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 20).map((line, index) => { const separator = line.indexOf('|'); return separator >= 0 ? { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() } : { label: `${t('notebook.data')} ${index + 1}`, value: line }; }); const record = saveExperiment({ title: values.get('title')?.toString().trim() || t('notebook.defaultTitle'), notes: values.get('notes')?.toString() ?? '', tags: [], references, dataPoints, ownerEmail: getCurrentAccount()?.email }); void syncExperimentRecord(record); render(); }); document.querySelectorAll<HTMLButtonElement>('.delete-experiment').forEach((button) => button.addEventListener('click', async () => { const id = button.dataset.experimentId; if (id && window.confirm(t('notebook.confirmDelete'))) { await deleteExperimentEverywhere(id); render(); } })); document.querySelectorAll<HTMLButtonElement>('.export-experiment').forEach((button) => button.addEventListener('click', () => { const id = button.dataset.experimentId; const experiment = getExperiments().find((item) => item.id === id); if (experiment) downloadJson(`genelab-${experiment.id}.json`, experiment); })); };
const bindAccount = (): void => { document.querySelector<HTMLButtonElement>('#logout-account')?.addEventListener('click', () => { logoutAccount(); render(); }); const form = document.querySelector<HTMLFormElement>('#account-form'); const modeButton = document.querySelector<HTMLButtonElement>('#account-login-mode'); if (!form || !modeButton) return; let loginMode = false; modeButton.addEventListener('click', () => { loginMode = !loginMode; modeButton.textContent = loginMode ? t('account.create') : t('account.login'); const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]'); if (submit) submit.textContent = loginMode ? t('account.login') : t('account.create'); }); form.addEventListener('submit', async (event) => { event.preventDefault(); const values = new FormData(form); const email = values.get('email')?.toString() ?? ''; const password = values.get('password')?.toString() ?? ''; try { if (loginMode) await loginAccount(email, password); else await createAccount(email, password); render(); } catch (error) { const message = error instanceof Error && error.message === 'weak-password' ? t('account.weakPassword') : error instanceof Error && error.message === 'account-exists' ? t('account.exists') : t('account.invalid'); let feedback = form.querySelector<HTMLElement>('.account-error'); if (!feedback) { feedback = document.createElement('p'); feedback.className = 'account-error'; form.append(feedback); } feedback.textContent = message; } }); };
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

const renderVariantGene = async (target: HTMLDivElement, requestId: number, route: Route, gene: import('./models/scientific').Gene, demoMode: boolean, directVariant?: import('./models/scientific').Variant): Promise<void> => {
  const variants = directVariant ? { data: [directVariant] } : await (demoMode ? demoVariantService : liveVariantService).getVariantsForGene(gene.id);
  const filtered = applyVariantFilters(variants.data ?? [], { type: route.query.get('type') || undefined, consequence: route.query.get('consequence') || undefined, significance: route.query.get('significance') || undefined, transcript: route.query.get('transcript') || undefined });
  if (requestId !== latestRequestId) return;
  target.innerHTML = renderVariantExplorer(gene, filtered, route.query.get('type') ?? '', route.query.get('consequence') ?? '', demoMode ? 'demo' : 'live', route.query.get('q') ?? '', false, route.query.get('significance') ?? '', route.query.get('transcript') ?? '');
  bindVariantFilters(gene.id);
  bindVariantSearch();
};

const loadContent = async (route: Route, requestId: number): Promise<void> => {
  const target = document.querySelector<HTMLDivElement>('#page-content');
  if (!target) return;
  const demoMode = route.query.get('demo') === '1';
  const geneService = demoMode ? demoGeneService : liveGeneService;
  if (route.kind === 'genes') { const result = await geneService.search(route.query.get('q') ?? ''); if (requestId !== latestRequestId) return; target.innerHTML = result.status === 'ok' ? renderSearchPage(result.data ?? [], route.query.get('q') ?? '', result.dataMode ?? 'live') : renderError(result.errorCode, route.query.get('q') ?? ''); bindGeneSearch(); return; }
  if (route.kind === 'variant-explorer') { const query = route.query.get('q')?.trim() ?? ''; const result = query ? await searchVariantKnowledge(query, { genome: route.query.get('genome') || undefined, variantType: route.query.get('variantType') || undefined }) : undefined; if (requestId !== latestRequestId) return; target.innerHTML = renderVariantKnowledgePage(result); bindVariantKnowledgeSearch((nextQuery, filters) => { const params = new URLSearchParams({ q: nextQuery }); Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); }); window.location.hash = `#/variant-explorer?${params.toString()}`; }); return; }
  if (route.kind === 'variant-assessment' && route.id) { const result = await getVariantKnowledge(route.id); if (requestId !== latestRequestId) return; const record = result.records[0]; if (!record) { target.innerHTML = renderVariantKnowledgePage(result); bindVariantKnowledgeSearch((query) => { window.location.hash = `#/variant-explorer?q=${encodeURIComponent(query)}`; }); return; } target.innerHTML = renderVariantAssessmentPage(record); bindVariantAssessment(record, () => render()); return; }
  if (route.kind === 'variants') { const geneId = route.query.get('gene'); const query = route.query.get('q')?.trim() ?? ''; if (geneId) { const result = await geneService.getGene(geneId); if (requestId !== latestRequestId) return; if (result.status !== 'ok' || !result.data) { target.innerHTML = renderError(result.errorCode, geneId); return; } await renderVariantGene(target, requestId, route, result.data, demoMode); return; } if (query) { const variantQuery = /^(VCV|SCV|rs|DEMO-VAR)/i.test(query); if (variantQuery) { const variant = await (demoMode ? demoVariantService : liveVariantService).getVariant(query); if (variant.status === 'ok' && variant.data) { const gene = await (demoMode ? demoGeneService : liveGeneService).getGene(variant.data.geneId); if (gene.status === 'ok' && gene.data) { await renderVariantGene(target, requestId, route, gene.data, demoMode, variant.data); return; } } } const search = await geneService.search(query); const candidate = search.data?.find((item) => item.symbol.toLocaleLowerCase() === query.toLocaleLowerCase() || item.id.toLocaleLowerCase() === query.toLocaleLowerCase()) ?? (search.data?.length === 1 ? search.data[0] : undefined); if (candidate) { const gene = await geneService.getGene(candidate.id); if (gene.status === 'ok' && gene.data) { await renderVariantGene(target, requestId, route, gene.data, demoMode); return; } } if (requestId !== latestRequestId) return; target.innerHTML = renderVariantExplorer(undefined, [], '', '', demoMode ? 'demo' : 'live', query, true); bindVariantSearch(); return; } target.innerHTML = renderVariantExplorer(undefined, [], '', '', demoMode ? 'demo' : 'live'); bindVariantSearch(); return; }
  if (route.kind === 'literature') { const query = route.query.get('q') ?? ''; const result = await liveLiteratureService.searchPublications(query); if (requestId !== latestRequestId) return; target.innerHTML = renderLiteraturePage(result.data ?? [], query); bindLiteratureSearch(result.data ?? []); return; }
  if (route.kind === 'lab') { target.innerHTML = renderLabPage(); bindLab(); return; }
  if (route.kind === 'saved') { target.innerHTML = renderWorkspaceSelectionWithNotes(getSavedItems(), getHistory()); bindCompareSelection(); bindWorkspaceNotes(); return; }
  if (route.kind === 'compare') { const savedGeneIds = getSavedItems().filter((item) => item.kind === 'gene').map((item) => item.id); const ids = route.query.get('ids')?.split(',').filter(Boolean) ?? savedGeneIds; const genes: import('./models/scientific').Gene[] = []; for (const id of ids) { if (requestId !== latestRequestId) return; const result = await getLiveGeneWithRetry(id); if (result.status === 'ok' && result.data) genes.push(result.data); } if (requestId !== latestRequestId) return; target.innerHTML = renderGeneComparisonPage(genes); return; }
  if (route.kind === 'notebook') { let experiments = getExperiments(getCurrentAccount()?.email); try { experiments = await syncExperimentsFromCloud(); } catch { /* Keep local notebook available when the API is offline. */ } if (requestId !== latestRequestId) return; target.innerHTML = renderNotebookPage(experiments); bindNotebook(); return; }
  if (route.kind === 'account') { target.innerHTML = renderAccountPage(getCurrentAccount()); bindAccount(); return; }
  if (route.kind === 'assistant') { const query = route.query.get('q') ?? ''; if (!query) { target.innerHTML = renderAssistantPage(); bindAssistant(); return; } const result = await liveGeneService.getGene(query); if (requestId !== latestRequestId) return; target.innerHTML = renderAssistantPage(result.data, query); bindAssistant(); return; }
  if (route.kind === 'about') { target.innerHTML = renderAboutPage(); return; }
  if (route.kind === 'sources') { target.innerHTML = renderSourcesPage(); return; }
  if (route.kind === 'gene' && route.id) { const result = await geneService.getGene(route.id); if (requestId !== latestRequestId) return; if (result.status !== 'ok' || !result.data) { target.innerHTML = renderError(result.errorCode, route.id); return; } if (requestId !== latestRequestId) return; target.innerHTML = renderGeneDetails(result.data, result.dataMode ?? 'live'); addHistoryEntry({ kind: 'gene', id: result.data.id, label: result.data.symbol, href: window.location.hash }); bindWorkspaceAction('gene', result.data.id, result.data.symbol, result.data.name, result.data); return; }
  if (route.kind === 'variant' && route.id) { const variantServiceForRoute = demoMode ? demoVariantService : liveVariantService; const result = await getVariantWithGeneFallback(variantServiceForRoute, route.id, route.query.get('gene') ?? undefined); if (requestId !== latestRequestId) return; if (result.status !== 'ok' || !result.data) { target.innerHTML = renderError(result.errorCode, route.id); return; } const gene = demoMode ? await demoGeneService.getGene(result.data.geneId) : await liveGeneService.getGene(result.data.geneId); if (requestId !== latestRequestId) return; target.innerHTML = renderVariantDetails(result.data, gene.data, demoMode ? 'demo' : 'live'); addHistoryEntry({ kind: 'variant', id: result.data.id, label: result.data.id, href: window.location.hash }); bindWorkspaceAction('variant', result.data.id, result.data.id, result.data.consequence ?? result.data.variantType, result.data); }
};

const render = (): void => { const route = parseRoute(); const requestId = ++latestRequestId; renderShell(route); if (route.kind !== 'home' && route.kind !== 'planned') void loadContent(route, requestId); };
window.addEventListener('hashchange', render);
render();
