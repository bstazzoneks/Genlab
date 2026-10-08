import { describe, expect, it } from 'vitest';
import { identifySequence } from '../services/geneIdentification';
import { serializeGeneIdentificationCsv } from './variantExport';

const reference = 'ACGTTGCAAGTCCGATGCTAGCTGATCGTACCGTAGCTAGGCTAACGTAGCATGCTAGC';

describe('variant exports', () => {
  it('preserves raw and normalized calls, evidence, sample prevalence, and external status in CSV', () => {
    const changed = `${reference.slice(0, 20)}${reference[20] === 'A' ? 'C' : 'A'}${reference.slice(21)}`;
    const result = identifySequence(`>sample-A\n${reference}\n>sample-B\n${changed}`, reference);
    const csv = serializeGeneIdentificationCsv(result);

    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toContain('"originalPosition"');
    expect(csv).toContain('"normalizedReference"');
    expect(csv).toContain('"externalAnnotationStatus"');
    expect(csv).toContain('"populationFrequencies"');
    expect(csv).toContain('"sample-B"');
    expect(csv).toContain('"true"');
    expect(csv).toContain('"false"');
    expect(csv).toContain('"0.5"');
    expect(csv).toContain('"not-connected"');
    expect(csv).toContain('"USER-PROVIDED"');
    expect(csv).toContain('"COMPUTED"');
  });

  it('exports VCF INFO values as input annotations, not external population data', () => {
    const vcf = '##fileformat=VCFv4.2\n#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\n17\t43071077\t.\tA\tG\t.\tPASS\tAF=0.01;CLNSIG=Pathogenic';
    const csv = serializeGeneIdentificationCsv(identifySequence(vcf));

    expect(csv).toContain('"inputClassification"');
    expect(csv).toContain('"Pathogenic"');
    expect(csv).toContain('"0.01"');
    expect(csv).toContain('"inputAlleleFrequency"');
    expect(csv).toContain('"not-queried"');
  });
});