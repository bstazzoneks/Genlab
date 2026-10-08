# GeneLab

[![Deploy to GitHub Pages](https://github.com/krissj1212/GeneLab/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/krissj1212/GeneLab/actions/workflows/deploy-pages.yml)
[![Tests](https://img.shields.io/badge/tests-28%20passing-2d6a4f)](https://github.com/krissj1212/GeneLab/actions)
[![License](https://img.shields.io/badge/license-to%20be%20defined-lightgrey)](#license)

> **Explore genes. Trace the evidence. Analyze molecular sequences.**

GeneLab is a bilingual scientific exploration platform for human molecular genetics. It connects live public scientific records with gene, variant, literature, and sequence-analysis tools while keeping provenance and limitations visible.

**Live project:** [https://krissj1212.github.io/GeneLab/](https://krissj1212.github.io/GeneLab/)

> GeneLab is an educational and research-support platform. It is not a diagnostic system, clinical interpretation service, substitute for genetic counseling, laboratory validation, or peer-reviewed scientific judgment.

## Why GeneLab?

Scientific information is distributed across specialized databases, each with different identifiers, scopes, and evidence standards. This creates friction for students, educators, and early-stage researchers who need to move from a gene to its variants, proteins, literature, and computational analysis without losing the source context.

GeneLab provides a single, accessible workflow:

```text
Search -> Explore -> Analyze -> Read the evidence -> Interpret carefully
```

The platform is designed around a simple principle: **retrieved scientific data, user input, computational results, and future AI explanations must remain visibly distinct.**

## Current Capabilities

### Human Gene Explorer

- Searches arbitrary human genes through live NCBI Gene records.
- Supports symbols, names, aliases, NCBI Gene IDs, and Ensembl Gene IDs.
- Displays official identity, organism, aliases, genomic location, assembly, gene type, descriptions, designations, record dates, cross-references, transcripts, protein products, and source metadata when supplied by the database.
- Uses Ensembl REST for additional gene enrichment.
- Preserves exact gene identity and never substitutes an unrelated result.

### Variant Explorer

- Has its own search interface for a human gene or a direct ClinVar accession.
- Retrieves variant records from ClinVar through public NCBI E-utilities.
- Displays HGVS changes, genomic location, molecular consequence, clinical significance, review status, conditions, and provenance.
- Supports filtering by variant type and molecular consequence.
- Keeps variant information separate from the gene detail page.

### Scientific Literature

- Searches PubMed on demand.
- Displays sourced publication titles, authors, journals, years, identifiers, and official PubMed links.
- Does not generate article interpretations or fabricated summaries.

### Virtual Molecular Lab

Local computational tools for educational exploration:

- Sequence length
- DNA/RNA/protein alphabet detection
- FASTA input support
- GC percentage
- DNA transcription to RNA
- Reverse complement
- Basic codon translation
- ORF detection on both strands
- Restriction-site detection
- Primer candidates with GC, melting temperature, and warnings
- Sequence comparison with identity percentage and positional differences
- Local gene/reference comparison and SNV, MNV, insertion, and deletion detection when the user supplies one compatible reference
- Confidence and provenance for each local alignment; unsupported protein matching and unverified header labels are explicitly marked
- Reference-relative variant minimization and left alignment where the supplied sequence validates the reference allele
- Consequence/protein effects only when a complete CDS, coding position, and transcript context are supplied to the annotation service
- Multi-FASTA presence/absence matrix, local sample prevalence, combined filters, and a reference-relative position map
- Expanded JSON/CSV variant exports with original and normalized representations and evidence
- Reproducibility notebook records with notes and JSON export
- Up to 20 custom field/value data points per notebook entry

Sequence analysis remains in the existing worker. A bounded local nucleotide aligner compares only user-supplied references; query sequences are not sent to external services. NCBI/Ensembl metadata lookup may use an explicit gene or accession label from the input. BLAST matching is not enabled because NCBI QBlast does not provide browser CORS access. JSON and CSV exports include match evidence and limitations.

Etapa 3 does not infer genomic coordinates, database identifiers, population allele frequencies, or clinical classification from reference-relative calls. ClinVar coordinate matching remains disconnected; existing ClinVar lookup by accession or gene ID is separate. FASTA multi-record summaries report sample presence only, not genotype or allele frequency. A complete CDS/transcript must be supplied explicitly to the coding-consequence service.

### Evidence Research Assistant

The current assistant organizes retrieved gene fields and their sources. It is intentionally evidence-based and does not present generative AI output as authoritative scientific information.

### Bilingual and Accessible Interface

- English and Spanish UI.
- Hash-based deep links compatible with GitHub Pages.
- Responsive layouts for desktop, tablet, and mobile.
- Keyboard navigation and visible focus states.
- Semantic landmarks and screen-reader labels.
- Light and dark themes.
- Reduced-motion support.
- Local workspace notes and experiment history.
- Private-by-default local workspace and lab notebook; scientific records stay in the browser unless explicitly exported.

## Scientific Sources

Live integrations currently include:

| Source | Current role |
| --- | --- |
| [NCBI Gene](https://www.ncbi.nlm.nih.gov/gene/) | Human gene search, normalized records, full gene XML detail |
| [Ensembl](https://www.ensembl.org/) | Gene enrichment and Ensembl Gene ID lookup |
| [ClinVar](https://www.ncbi.nlm.nih.gov/clinvar/) | On-demand variant records and clinical database assertions |
| [PubMed](https://pubmed.ncbi.nlm.nih.gov/) | Literature search and publication metadata |

Additional sources are catalogued for future integration, including HGNC, UniProt, dbSNP, and Europe PMC.

Every live record can retain:

- Database name
- Scientific identifier
- Official URL
- Retrieval timestamp
- Evidence category
- Known limitations

Database assertions may be incomplete, change over time, or differ between submissions. GeneLab does not collapse those differences into an invented universal confidence score.

## Technology

- Vite
- TypeScript
- Vanilla browser APIs
- Vitest
- GitHub Actions
- GitHub Pages

The project is a static, account-free application. Scientific data retrieval uses provider-specific service adapters; workspace notes, history, and notebook records are stored only in the browser. No scientific input is uploaded for sequence analysis.

## Architecture

```text
src/
  components/             Reusable explorer, evidence, and site-page views
  data/                   Source catalog and clearly labelled demo fixtures
  i18n/                   English and Spanish dictionaries
  models/                 Typed scientific entities and provenance models
  services/
    adapters/             NCBI, Ensembl, ClinVar, and PubMed adapters
    live.ts               Live gene service composition
    liveVariants.ts       Live variant service
    liveLiterature.ts     Live literature service
  utils/                  Pure sequence and data-transformation functions
  styles/                 Theme, responsive, and accessibility styles
  main.ts                 Hash routing and application shell
docs/
  architecture.md         Integration boundaries and scientific design rules
.github/workflows/
  deploy-pages.yml        Test, build, and deploy pipeline
```

The UI never calls provider URLs directly. Adapters normalize external responses into shared models such as `Gene`, `Variant`, `Publication`, `Sequence`, `AnalysisResult`, and `ScientificSource`.

## Demo Data Policy

Synthetic demo data is retained only for interface testing and is activated explicitly with `demo=1` in the URL. It is labelled:

```text
DEMO DATA - NOT LIVE SCIENTIFIC DATABASE DATA
```

Demo data never limits live gene searches and is never silently used as a replacement for a failed scientific request.

## Run Locally

Requirements: Node.js 20 or newer.

```bash
git clone https://github.com/krissj1212/GeneLab.git
cd GeneLab
npm install
npm run dev
```

Open the local URL shown by Vite. To run the production build locally:

```bash
npm test
npm run build
npm run preview
```

## GitHub Pages Deployment

Deployment is automated by [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

1. Push the repository to GitHub.
2. Open **Settings -> Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main` or run the workflow manually from the **Actions** tab.
5. GitHub Actions runs tests, builds `dist/`, and deploys the result.

The expected public URL is:

```text
https://krissj1212.github.io/GeneLab/
```

The Vite base is relative and hash routing is used because GitHub Pages does not provide SPA rewrite rules by default.

## Testing

The project currently has 30 passing tests covering:

- Gene search normalization and filtering
- NCBI response normalization and provenance
- Exact gene identity and cache isolation
- Ensembl ID lookup
- ClinVar variant normalization and empty results
- PubMed response mapping
- DNA/RNA/protein sequence analysis
- FASTA headers and multiline sequences
- Ambiguous nucleotide handling

```bash
npm test
```

## Scientific and Technical Limitations

- API availability and rate limits are controlled by external providers.
- The browser does not contain private credentials or API keys.
- A secured serverless proxy may be needed for higher-volume production usage.
- ClinVar interpretations are database records, not independent clinical conclusions.
- PubMed currently provides publication metadata rather than full article text or AI summaries.
- The sequence lab provides educational calculations, not validated laboratory protocols or production bioinformatics pipelines.
- Coverage depends on the records returned by connected public databases at request time; GeneLab does not claim to contain every human gene locally.

## Roadmap

The core contest scope is implemented. Future improvements may include:

- Additional HGNC, UniProt, dbSNP, and Europe PMC adapters.
- Pagination and stronger provider-specific throttling.
- Browser-level accessibility and mobile testing.
- More sequence-analysis operations and reproducibility exports.
- A separately secured, evidence-grounded AI service if a backend is introduced.

## License

A project license should be selected before public release. Until then, treat the repository as source-available for evaluation and do not assume reuse permissions.

## Team / Project Context

GeneLab was built as a solo-developer scientific hackathon project with a focus on:

- Reproducibility over visual claims
- Source attribution over opaque aggregation
- Public static deployment over unnecessary infrastructure
- Educational exploration over clinical interpretation
- A maintainable foundation that can grow without fabricating scientific data
