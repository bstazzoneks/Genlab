# GeneLab architecture

## Boundaries

The project is a Vite + TypeScript static site. The UI is currently a small shell rendered by `src/main.ts`; scientific models and services are kept separate so future phases can replace the shell without moving domain logic into the DOM.

- `src/models/`: typed scientific entities and provenance concepts.
- `src/services/`: contracts for data retrieval. Adapters should map external responses into local models.
- `src/utils/`: local, deterministic analysis and browser-persistence helpers; these modules do not depend on identity or remote storage.
- `src/data/`: centralized source metadata and, later, explicitly labelled demo fixtures.
- `src/i18n/`: complete UI dictionaries. Identifiers, symbols and nomenclature stay in scientific data, not translation strings.
- `src/styles/`: tokens, responsive layout, accessible focus states and reduced-motion support.

## Data and evidence

Every retrieved entity should carry source provenance. A source category describes origin, not truth: primary literature, curated database, reference database, computational prediction, AI explanation, and user-provided information are intentionally distinct. Any future confidence or limitation field must document its methodology; no universal score is assumed here.

External integrations belong behind service interfaces such as `GeneService`. In a static deployment, adapters may use public endpoints only after checking CORS, terms of use, rate limits and response stability. A small serverless proxy can be added later without coupling components to provider-specific URLs or exposing secrets.

Future scientific capabilities should be added as independent domain modules. Each module should expose typed inputs and results, keep parsing/validation and computation separate from rendering, and depend on shared scientific models rather than another tool's UI. Sequence, variant, comparison, expression, and format-conversion modules can then compose shared services without sharing mutable state. User-provided sequences and analysis inputs are processed in the browser; persistence is opt-in through browser-local workspace/notebook storage or an explicit export.

The Stage 2 identification path reuses the existing sequence worker and parser. `geneIdentificationService` accepts FASTA records and at most one user-supplied reference; `variantDetection` consumes a bounded local nucleotide alignment. The `bioseq` CIGAR-based global aligner is capped at 10,000 residues per side and one million cells across a request. Confidence thresholds are explicit: HIGH requires at least 100 query residues, 98.5% identity, and 90% query coverage; MEDIUM requires at least 50 residues, 90% identity, and 80% coverage; LOW requires at least 20 residues, 70% identity, and 70% coverage. Variants are emitted only for HIGH/MEDIUM alignments containing unambiguous A/C/G/T. Evidence is labeled as user-provided reference plus computation, not a database match. A header symbol is an unverified annotation. No genomic coordinate, HGVS term, protein change, or coding consequence is emitted without transcript/reference annotation.

Stage 3 extends the same `DetectedSequenceVariant` records through `variantAnnotationService`. It stores original and reference-validated minimized/left-aligned alleles, evidence origin, external-annotation status, optional HGVS/protein fields, and sample-presence summaries. Multi-FASTA prevalence is a record-presence ratio and is never exposed as population allele frequency. Coding consequence/protein impact is available only through the service's explicit complete-CDS and cDNA-position context; normal pipeline calls without that context remain `unknown`. Splice classification accepts explicit boundary windows but no genomic splice claims are made by default. `variantAnnotationProviders` is intentionally empty: current ClinVar adapters resolve accessions or genes, not user-reference-relative coordinates, and are not queried as coordinate matches.

NCBI Gene E-utilities and Ensembl remain available for metadata resolved from explicit header identifiers. NCBI QBlast was checked but does not expose CORS headers, so its alignment results cannot be consumed by this static browser app. No query sequence is sent to BLAST or another service. A future database-backed sequence search needs an approved CORS-enabled provider or an explicitly designed proxy and consent; it must not change the local default.

Phase 2.5 connects `liveGeneService` to NCBI Gene E-utilities for search and normalized records, then uses Ensembl REST as best-effort enrichment on detail pages. `liveVariantService` uses ClinVar E-utilities by NCBI Gene ID for on-demand variant records. A live enrichment failure does not replace the NCBI record or invent fields; unavailable fields remain unavailable. The demo service is selected only through the explicit `demo=1` query parameter.

Phase 2.9 keeps search database-driven rather than maintaining a supported-gene list. NCBI Gene IDs are fetched directly with `esummary`; the selected gene detail is then enriched with the single-record XML `efetch` endpoint. Ensembl IDs use `/lookup/id/{id}`. Search results are ranked by exact identity, and detail loading requires an explicit symbol, alias, or stable identifier match. The shell uses a monotonically increasing request ID so stale asynchronous responses cannot overwrite the current route.

Variant records intentionally live outside Gene Details. A gene page links to `#/variants?gene={ncbiGeneId}`, where ClinVar records, filters and variant details are rendered by the Variant Explorer. This keeps gene identity/transcript/protein provenance separate from variant evidence and prevents the two datasets from being visually mixed.

The XML parser is browser-side because the deployment is static. If XML parsing fails or the full endpoint is temporarily unavailable, the already validated NCBI summary remains visible and unavailable fields stay unavailable; no other gene is substituted.

## Routing and deployment

Hash routing (`#/genes`) works with direct navigation on GitHub Pages without server rewrites. Vite uses a relative base (`./`) so the same build can be served from a repository subpath. The deployment workflow can later publish `dist/` using GitHub Actions.

## Future analysis and AI

Virtual Lab operations should be pure functions: receive validated user input, return a typed `AnalysisResult`, and report limitations. UI components should only format those results. The AI assistant should receive retrieved evidence and its provenance as context, then label its output as AI-generated explanation. It must never be used as a replacement for a source record or clinical interpretation.