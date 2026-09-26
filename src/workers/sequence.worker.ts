import { resolveLabAnalysis } from '../utils/sequence';
import type { PrimerDesignOptions, SequenceFileSummary } from '../utils/sequence';

interface SequenceRequest {
  id: number;
  input: string;
  comparison: string;
  primerOptions: PrimerDesignOptions;
  fileSummary?: SequenceFileSummary;
}

self.addEventListener('message', (event: MessageEvent<SequenceRequest>) => {
  const request = event.data;
  try {
    const result = resolveLabAnalysis(request.input, request.comparison, request.primerOptions, request.fileSummary);
    self.postMessage({ id: request.id, result });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : 'sequence-analysis-failed' });
  }
});
