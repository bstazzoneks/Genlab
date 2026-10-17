import { describe, expect, it } from 'vitest';
import { parseDelimitedRows, serializeDelimitedRows } from './csv';

describe('local delimited text helpers', () => {
  it('round-trips commas, quotes, tabs and newlines', () => {
    const rows = [['sample', 'notes'], ['S1', 'contains, comma and "quote"\nnext line']];
    expect(parseDelimitedRows(serializeDelimitedRows(rows), ',')).toEqual(rows);
    expect(parseDelimitedRows('sample\tCt\r\nS1\t20.4\r\n', '\t')).toEqual([['sample', 'Ct'], ['S1', '20.4']]);
  });

  it('rejects an unclosed quoted cell', () => {
    expect(() => parseDelimitedRows('sample,"unfinished', ',')).toThrow('csv-unclosed-quote');
  });
});