export const parseDelimitedRows = (input: string, delimiter: ',' | '\t'): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"' && cell.length === 0) quoted = true;
    else if (character === delimiter) { row.push(cell); cell = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (quoted) throw new Error('csv-unclosed-quote');
  if (cell.length || row.length) {
    row.push(cell);
    if (row.some((value) => value !== '')) rows.push(row);
  }
  return rows;
};

export const serializeDelimitedRows = (rows: Array<Array<string | number | boolean | null | undefined>>, delimiter: ',' | '\t' = ','): string => rows.map((row) => row.map((value) => {
  const cell = value === undefined || value === null ? '' : String(value);
  return /["\r\n,\t]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}).join(delimiter)).join('\r\n');