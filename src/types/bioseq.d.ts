declare module 'bioseq' {
  interface BioseqAlignment {
    score: number;
    position: number;
    CIGAR: number[];
  }

  interface BioseqApi {
    align(reference: string, query: string, isLocal?: boolean): BioseqAlignment;
    cigar2gaps(reference: string, query: string, start: number, cigar: number[], fixed?: boolean): [string, string];
  }

  const bioseq: BioseqApi;
  export default bioseq;
}