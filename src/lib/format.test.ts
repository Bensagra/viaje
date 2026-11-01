import { describe, expect, it } from 'vitest';
import { amountInput, daysInclusive, isValidISODate, parseAmount, parseRate, rateInput } from './format';

describe('parseAmount', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1234,5', 1234.5],
    ['45.90', 45.9],
    ['$ 12.500', 12500],
    ['1.250.000', 1250000],
    ['US$ 1,250,000.10', 1250000.1],
    ['0.500', 0.5],
    ['(12,50)', -12.5],
    ['-3', -3],
    ['', null],
    ['abc', null],
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe('parseRate', () => {
  it.each([
    ['1,083', 1.083],
    ['1.083', 1.083],
    ['1250', 1250],
    ['1.250,50', 1250.5],
    ['0,000805', 0.000805],
    ['0', null],
  ])('%s → %s', (input, expected) => {
    expect(parseRate(input)).toBe(expected);
  });

  it('ida y vuelta con los valores que muestran los inputs', () => {
    for (const r of [1.083, 1250, 0.000805, 5.4321]) expect(parseRate(rateInput(r))).toBe(r);
    for (const a of [1234.5, 0.99, 68500]) expect(parseAmount(amountInput(a))).toBe(a);
  });
});

describe('fechas', () => {
  it('valida fechas ISO reales', () => {
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });

  it('cuenta días incluyendo ambas puntas', () => {
    expect(daysInclusive('2026-10-30', '2026-11-02')).toBe(4);
  });
});
