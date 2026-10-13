import type { ScientificSource } from './scientific';

export interface GeneNomenclature {
  hgncId: string;
  approvedSymbol: string;
  approvedName: string;
  previousSymbols: string[];
  aliasSymbols: string[];
  locusType?: string;
  chromosomalLocation?: string;
  crossReferences: Record<string, string[]>;
  source: ScientificSource;
}