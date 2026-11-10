import { csvCell } from '@/lib/utils/csv-cell';
import { describe, expect, it } from 'vitest';

describe('csvCell (#173, #996, #1020)', () => {
  it('quotes cells and keeps spreadsheet formulas from running', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+81')).toBe("'+81");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(1)')).toBe("'@SUM(1)");
  });

  it('prefixes a leading tab or carriage return, and quotes a line break', () => {
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('')).toBe('');
  });
});
