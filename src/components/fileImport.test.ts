import { describe, expect, it } from 'vitest';
import type { FileImportResult } from '../models/fileImport';
import { t } from '../i18n';
import { renderFileImportPage } from './fileImport';

describe('file import rendering', () => {
  it('does not label replicate SD as below threshold when it cannot be calculated', () => {
    const result: FileImportResult = {
      id: 'IMPORT-1',
      format: 'qpcr',
      fileName: 'qpcr.csv',
      fileSize: 12,
      sampleId: 'SMP-1',
      metadata: {
        sampleId: 'SMP-1',
        fileName: 'qpcr.csv',
        fileSize: 12,
        fileChecksum: 'sha256:test',
        geneLabVersion: '0.1.0',
        toolName: 'qPCR summary',
        parameters: { mapping: JSON.stringify({ sample: 'sample', target: 'target', ct: 'Ct' }), referenceGene: null, standardDeviationThreshold: 0 },
        importedAt: '2026-01-01T00:00:00.000Z',
      },
      series: [],
      headers: ['sample', 'target', 'Ct'],
      rows: [['S1', 'ACTB', '22']],
      mapping: { sample: 'sample', target: 'target', ct: 'Ct' },
      missingCtCount: 0,
      standardDeviationThreshold: 0.5,
      assumptions: [],
      aggregates: [{ sample: 'S1', target: 'ACTB', replicateCount: 1, meanCt: 22, exceedsThreshold: false }],
    };

    const markup = renderFileImportPage([], { result });

    expect(markup).toContain(`<td>${t('lab.notAvailable')}</td>`);
    expect(markup).not.toContain(t('explorer.noData'));
    expect(markup).not.toContain(t('fileImport.qpcr.withinThreshold'));
    expect(markup).toContain(t('fileImport.analysisParameters'));
    expect(markup).toContain(`${t('fileImport.qpcr.ctColumn')}: Ct`);
    expect(markup).toContain(t('fileImport.parameter.notSelected'));
    expect(markup).not.toContain('"standardDeviationThreshold":0');
  });
});