import fs from 'fs';

/** Read SQL Server dump (UTF-16 LE with BOM or UTF-8). */
export function readLegacySqlDump(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.toString('utf16le').replace(/^\uFEFF/, '');
  }
  return buf.toString('utf-8');
}

export function parseSqlStringLiteral(input: string, start: number): { value: string; next: number } {
  let i = start;
  if (input[i] === 'N') i += 1;
  if (input[i] !== "'") throw new Error(`Expected string at ${start}`);
  i += 1;

  let value = '';
  while (i < input.length) {
    const ch = input[i];
    if (ch === "'") {
      if (input[i + 1] === "'") {
        value += "'";
        i += 2;
        continue;
      }
      return { value, next: i + 1 };
    }
    value += ch;
    i += 1;
  }
  throw new Error('Unterminated SQL string');
}

function parseCastDateTime(input: string, start: number): { value: string | null; next: number } {
  const open = input.indexOf('(', start);
  const close = input.indexOf(')', open);
  if (open === -1 || close === -1) throw new Error('Invalid CAST expression');
  const inner = input.slice(open + 1, close).trim();
  if (inner.toUpperCase() === 'NULL') return { value: null, next: close + 1 };
  const parsed = parseSqlStringLiteral(inner, inner.startsWith('N') ? 0 : 0);
  return { value: parsed.value, next: close + 1 };
}

export function tokenizeValues(valuesInner: string): (string | null)[] {
  const tokens: (string | null)[] = [];
  let i = 0;
  const s = valuesInner.trim();

  while (i < s.length) {
    while (i < s.length && (s[i] === ',' || /\s/.test(s[i]))) i += 1;
    if (i >= s.length) break;

    if (s.slice(i, i + 4).toUpperCase() === 'NULL') {
      tokens.push(null);
      i += 4;
      continue;
    }

    if (s.slice(i, i + 5).toUpperCase() === 'CAST(') {
      const parsed = parseCastDateTime(s, i);
      tokens.push(parsed.value);
      i = parsed.next;
      continue;
    }

    if (s[i] === 'N' && s[i + 1] === "'") {
      const parsed = parseSqlStringLiteral(s, i);
      tokens.push(parsed.value);
      i = parsed.next;
      continue;
    }

    const numMatch = s.slice(i).match(/^\d+/);
    if (numMatch) {
      tokens.push(numMatch[0]);
      i += numMatch[0].length;
      continue;
    }

    throw new Error(`Unexpected token near: ${s.slice(i, i + 60)}`);
  }

  return tokens;
}

export function extractInsertLines(content: string, tableName: string): string[] {
  const prefix = `INSERT [dbo].[${tableName}]`;
  return content.split(/\r?\n/).filter((line) => line.startsWith(prefix));
}

export function valuesInnerFromLine(line: string): string | null {
  const valuesIdx = line.indexOf('VALUES');
  if (valuesIdx === -1) return null;
  const open = line.indexOf('(', valuesIdx);
  const close = line.lastIndexOf(')');
  if (open === -1 || close === -1 || close <= open) return null;
  return line.slice(open + 1, close);
}

export function sqlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}
