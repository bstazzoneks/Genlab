import { resolveLabAnalysis } from '../utils/sequence';
import type { PrimerDesignOptions, SequenceFileSummary } from '../utils/sequence';
import { geneIdentificationService, unavailableGeneIdentification } from '../services/geneIdentification';

interface SequenceRequest {
  id: number;
  input: string;
  comparison: string;
  primerOptions: PrimerDesignOptions;
  fileSummary?: SequenceFileSummary;
  geneHint?: string;
}

self.addEventListener('message', (event: MessageEvent<SequenceRequest>) => {
  const request = event.data;
  try {
    const analysis = resolveLabAnalysis(request.input, request.comparison, request.primerOptions, request.fileSummary);
      let identification;
      try {
        identification = geneIdentificationService.identify(request.input, request.comparison, request.geneHint);
      } catch {
        identification = unavailableGeneIdentification(request.input, 'Local gene identification could not be completed; the sequence analysis results remain available.');
      }
    self.postMessage({ id: request.id, result: { ...analysis, identification } });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'sequence-analysis-failed' });
  }
});
