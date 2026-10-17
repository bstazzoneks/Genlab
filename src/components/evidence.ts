import type { ScientificSource } from '../models/scientific';
import { t } from '../i18n';

const categoryKey: Record<ScientificSource['category'], Parameters<typeof t>[0]> = {
  'primary-literature': 'source.primary',
  'curated-database': 'source.curated',
  'reference-database': 'source.reference',
  'computational-prediction': 'source.prediction',
  'ai-explanation': 'source.ai',
  'user-provided': 'source.user',
};

const safe = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const renderLimitation = (value: string): string => value.startsWith('i18n:') ? t(value.slice(5) as Parameters<typeof t>[0]) : safe(value);
const evidenceScore = (sources: ScientificSource): number => sources.category === 'primary-literature' ? 4 : sources.category === 'curated-database' ? 3 : sources.category === 'reference-database' ? 2 : 1;

export const renderEvidence = (sources: ScientificSource[]): string => { if (!sources.length) return ''; const score = sources.reduce((total, source) => total + evidenceScore(source), 0); const quality = Math.min(100, Math.round((score / (sources.length * 4)) * 100)); return `<section class="evidence-panel" aria-labelledby="evidence-title"><div class="panel-heading"><p class="eyebrow">${t('explorer.evidence')}</p><h2 id="evidence-title">${sources.length} ${t('explorer.source')}</h2></div><div class="evidence-quality"><span>${t('explorer.evidenceQuality')}</span><strong>${quality}%</strong><div class="quality-track"><span style="width: ${quality}%"></span></div></div><div class="evidence-list">${sources.map((source) => `<article class="evidence-item"><div><strong>${safe(source.name)}</strong><span>${t(categoryKey[source.category])}</span></div>${source.identifier || source.retrievedAt ? `<dl>${source.identifier ? `<div><dt>${t('explorer.identifier')}</dt><dd>${safe(source.identifier)}</dd></div>` : ''}${source.retrievedAt ? `<div><dt>${t('explorer.retrieved')}</dt><dd>${safe(source.retrievedAt)}</dd></div>` : ''}</dl>` : ''}${source.url ? `<a class="text-link" href="${safe(source.url)}" target="_blank" rel="noopener noreferrer">${t('explorer.openSource')} -&gt;</a>` : ''}${source.dataUseUrl ? `<a class="text-link" href="${safe(source.dataUseUrl)}" target="_blank" rel="noopener noreferrer">${t('sources.dataUse')}</a>` : ''}${source.limitations?.length ? `<p class="source-note">${t('explorer.notes')}: ${source.limitations.map(renderLimitation).join(' ')}</p>` : ''}</article>`).join('')}</div></section>`; };