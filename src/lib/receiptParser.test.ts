import { describe, expect, it } from 'vitest';
import { findCardCandidates, findDate, parseReceiptText } from './receiptParser';

const opts = { today: '2026-11-05', tripStart: '2026-10-25', tripEnd: '2026-11-10' };

describe('parseReceiptText', () => {
  it('ticket argentino con tarjeta enmascarada', () => {
    const text = `PARRILLA DON JULIO
C.U.I.T. 30-12345678-9
IVA RESPONSABLE INSCRIPTO
Fecha: 31/10/2026 Hora: 22:41
2 x Bife de chorizo 25.000,00
1 x Vino Malbec 18.500,00
SUBTOTAL 68.500,00
Propina sugerida 10% 6.850,00
TOTAL $ 68.500,00
VISA CREDITO
Tarj: XXXXXXXXXXXX4821
Cuotas: 1`;
    const r = parseReceiptText(text, { ...opts, knownLast4: ['4821', '1190'] });
    expect(r.card_last4).toBe('4821');
    expect(r.card_brand).toBe('Visa');
    expect(r.total).toBe(68500);
    expect(r.currency).toBe('ARS');
    expect(r.date).toBe('2026-10-31');
    expect(r.merchant).toBe('Parrilla Don Julio');
    expect(r.payment_method).toBe('card');
    expect(r.category).toBe('Comida');
  });

  it('ticket español en euros con asteriscos y espacios', () => {
    const text = `Cafetería La Plaza
NIF B12345678
02-11-2026 13:05
2 Café con leche 3,80
1 Tostada 2,90
BASE IMPONIBLE 6,09
IVA 10% 0,61
TOTAL (IVA incl.) 6,70 €
TARJETA **** **** **** 1190
Contactless`;
    const r = parseReceiptText(text, { ...opts, knownLast4: ['4821', '1190'] });
    expect(r.card_last4).toBe('1190');
    expect(r.total).toBe(6.7);
    expect(r.currency).toBe('EUR');
    expect(r.date).toBe('2026-11-02');
    expect(r.merchant).toBe('Cafetería La Plaza');
    expect(r.category).toBe('Comida');
  });

  it('recibo de EE.UU. con propina: gana el total final', () => {
    const text = `JOE'S DINER
123 Main St
Oct 28, 2026 7:15 PM
Subtotal 45.00
Tax 3.60
Total 48.60
Tip 9.00
Total 57.60
VISA ending in 7733
Approved`;
    const r = parseReceiptText(text, opts);
    expect(r.total).toBe(57.6);
    expect(r.card_last4).toBe('7733');
    expect(r.date).toBe('2026-10-28');
  });

  it('cupón brasileño "final do cartão"', () => {
    const text = `SUPERMERCADO BOM PRECO
CNPJ 12.345.678/0001-90
03/11/2026
VALOR TOTAL R$ 123,45
CARTAO DE CREDITO MASTERCARD
Final do cartão 5512`;
    const r = parseReceiptText(text, opts);
    expect(r.card_last4).toBe('5512');
    expect(r.card_brand).toBe('Mastercard');
    expect(r.currency).toBe('BRL');
    expect(r.total).toBe(123.45);
    expect(r.category).toBe('Supermercado');
  });

  it('ticket en efectivo: sin tarjeta, ignora el vuelto', () => {
    const text = `KIOSCO EL PASO
29/10/2026
Agua mineral 1.500,00
Alfajor 1.200,00
TOTAL 2.700,00
EFECTIVO 5.000,00
VUELTO 2.300,00`;
    const r = parseReceiptText(text, opts);
    expect(r.card_last4).toBeNull();
    expect(r.payment_method).toBe('cash');
    expect(r.total).toBe(2700);
  });

  it('el total en la línea siguiente', () => {
    const text = `UBER
Trip on Nov 1, 2026
TOTAL
US$ 12.34
•••• 3301`;
    const r = parseReceiptText(text, opts);
    expect(r.total).toBe(12.34);
    expect(r.currency).toBe('USD');
    expect(r.card_last4).toBe('3301');
    expect(r.category).toBe('Transporte');
  });

  it('prefiere el número enmascarado sobre los primeros dígitos (BIN)', () => {
    const text = `TARJETA: 4509 XXXX XXXX 6012
IMPORTE: 15.000,00`;
    const r = parseReceiptText(text, opts);
    expect(r.card_last4).toBe('6012');
    expect(r.total).toBe(15000);
  });

  it('corrige confusiones típicas del OCR en la terminación', () => {
    expect(findCardCandidates('XXXXXXXXXXXX48Z1')[0]?.last4).toBe('4821');
    expect(findCardCandidates('************1l90')[0]?.last4).toBe('1190');
  });

  it('terminación registrada suelta cuando el OCR perdió los asteriscos', () => {
    const r = parseReceiptText('MASTER\n~~~~ 1190\nTOTAL 10,00', { ...opts, knownLast4: ['1190'] });
    expect(r.card_last4).toBe('1190');
    expect(r.notes).toMatch(/baja confianza/);
  });

  it('no confunde "consumidor final" ni años con tarjetas', () => {
    const r = parseReceiptText('A CONSUMIDOR FINAL\nFecha 30/10/2026\nTOTAL 100,00', { ...opts, knownLast4: ['2026'] });
    expect(r.card_last4).toBeNull();
  });
});

describe('findDate', () => {
  it('usa el rango del viaje para desambiguar dd/mm vs mm/dd', () => {
    expect(findDate('11/03/2026', { today: '2026-11-05', tripStart: '2026-11-01', tripEnd: '2026-11-10' })).toBe(
      '2026-11-03',
    );
    expect(findDate('03/11/2026', { today: '2026-11-05', tripStart: '2026-11-01', tripEnd: '2026-11-10' })).toBe(
      '2026-11-03',
    );
  });

  it('ignora fechas viejas como inicio de actividades', () => {
    expect(findDate('Inicio de actividades: 01/03/2015\nFecha: 31/10/2026', opts)).toBe('2026-10-31');
  });

  it('entiende meses escritos', () => {
    expect(findDate('31 de octubre de 2026', opts)).toBe('2026-10-31');
    expect(findDate('31-OCT-26', opts)).toBe('2026-10-31');
  });
});
