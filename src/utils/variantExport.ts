import type { GeneIdentificationResult } from '../models/geneIdentification';
import { getVariantComparisonKey } from '../services/variantAnnotation';

export const serializeGeneIdentificationCsv = (result: GeneIdentificationResult): string => {
  const headers = ['recordType', 'generatedAt', 'record', 'moleculeType', 'geneLabel', 'confidence', 'identityPercent', 'coveragePercent', 'alignmentScore', 'originalPosition', 'originalReference', 'originalAlternative', 'normalizedPosition', 'normalizedReference', 'normalizedAlternative', 'normalizationStatus', 'variantType', 'nucleotideChange', 'chromosome', 'gene', 'transcript', 'strand', 'hgvsGenomic', 'hgvsCoding', 'hgvsProtein', 'consequence', 'proteinImpact', 'rsId', 'externalAnnotationStatus', 'externalIdentifiers', 'populationFrequencies', 'inputVariantIdentifier', 'inputClassification', 'inputReportedAssociation', 'inputAlleleFrequency', 'sampleIds', 'samplePresent', 'sampleCount', 'sampleTotal', 'samplePrevalence', 'evidence', 'evidenceLimitations', 'reasons'];
  const rows: unknown[][] = [headers];
  for (const record of result.records) {
    const variants = record.variants.length ? record.variants : [undefined];
    for (const variant of variants) {
      const normalization = variant?.normalization;
      const evidence = variant?.evidence ?? record.evidence;
      const sampleSummary = variant ? result.sampleComparison?.find((item) => item.variantKey === getVariantComparisonKey(variant)) : undefined;
      rows.push([
        variant ? 'variant-call' : 'record', result.generatedAt, record.header, record.moleculeType, record.candidateLabel, variant?.confidence ?? record.confidence,
        record.identityPercent, record.coveragePercent, record.alignmentScore,
        normalization?.original.position ?? variant?.position, normalization?.original.reference ?? variant?.reference, normalization?.original.alternative ?? variant?.alternative,
        normalization?.normalized?.position, normalization?.normalized?.reference, normalization?.normalized?.alternative, normalization?.status,
        normalization?.type ?? variant?.type, variant?.nucleotideChange, variant?.chromosome, variant?.gene, variant?.transcript, variant?.strand,
        variant?.hgvsGenomic, variant?.hgvsCoding, variant?.hgvsProtein, variant?.consequence ?? variant?.predictedConsequence,
        variant?.proteinImpact ? JSON.stringify(variant.proteinImpact) : '', variant?.rsId, variant?.externalAnnotation?.status,
        variant?.externalAnnotation?.identifiers?.join('; '), variant?.populationFrequencies ? JSON.stringify(variant.populationFrequencies) : '',
        variant?.inputAnnotation?.identifier, variant?.inputAnnotation?.classification, variant?.inputAnnotation?.reportedCondition, variant?.inputAnnotation?.alleleFrequency,
        variant?.sampleIds?.join('; '), variant ? 'true' : '', sampleSummary?.sampleCount, sampleSummary?.sampleTotal, variant?.samplePrevalence,
        JSON.stringify(evidence), JSON.stringify(evidence.map((item) => item.limitations)), record.reasons.join('; '),
      ]);
    }
  }
  for (const summary of result.sampleComparison ?? []) {
    const variant = summary.variant;
    const normalization = variant.normalization;
    const evidence = variant.evidence;
    for (const sampleId of summary.allSampleIds) {
      const record = result.records.find((item) => item.header === sampleId);
      rows.push([
        'sample-presence', result.generatedAt, sampleId, record?.moleculeType, record?.candidateLabel, variant.confidence ?? record?.confidence,
        record?.identityPercent, record?.coveragePercent, record?.alignmentScore,
        normalization?.original.position ?? variant.position, normalization?.original.reference ?? variant.reference, normalization?.original.alternative ?? variant.alternative,
        normalization?.normalized?.position, normalization?.normalized?.reference, normalization?.normalized?.alternative, normalization?.status,
        normalization?.type ?? variant.type, variant.nucleotideChange, variant.chromosome, variant.gene, variant.transcript, variant.strand,
        variant.hgvsGenomic, variant.hgvsCoding, variant.hgvsProtein, variant.consequence ?? variant.predictedConsequence,
        variant.proteinImpact ? JSON.stringify(variant.proteinImpact) : '', variant.rsId, variant.externalAnnotation?.status,
        variant.externalAnnotation?.identifiers?.join('; '), variant.populationFrequencies ? JSON.stringify(variant.populationFrequencies) : '',
        variant.inputAnnotation?.identifier, variant.inputAnnotation?.classification, variant.inputAnnotation?.reportedCondition, variant.inputAnnotation?.alleleFrequency,
        summary.presentIn.join('; '), summary.presentIn.includes(sampleId), summary.sampleCount, summary.sampleTotal, summary.samplePrevalence,
        JSON.stringify(evidence), JSON.stringify(evidence.map((item) => item.limitations)), record?.reasons.join('; '),
      ]);
    }
  }
  const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
  return `\uFEFF${csv}`;
};