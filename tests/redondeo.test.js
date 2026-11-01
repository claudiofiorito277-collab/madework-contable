import test from 'node:test';
import assert from 'node:assert/strict';
import { aCentavos, formatear, dividirRedondeando } from '../js/core/redondeo.js';
import { buscarVigente } from '../js/core/vigencia.js';

test('aCentavos: formato argentino con miles y coma decimal', () => {
  assert.equal(aCentavos('1.234.567,89'), 123456789);
  assert.equal(aCentavos('$ 1.000,5'), 100050);
});

test('aCentavos: número y texto con punto decimal', () => {
  assert.equal(aCentavos(1234.56), 123456);
  assert.equal(aCentavos('1234.56'), 123456);
  assert.equal(aCentavos(0.1 + 0.2), 30); // 0.30000000000000004 no rompe nada
});

test('aCentavos: tercer decimal redondea mitad hacia arriba (sin error de coma flotante)', () => {
  assert.equal(aCentavos(1.005), 101);
  assert.equal(aCentavos('2,675'), 268);
  assert.equal(aCentavos('2,674'), 267);
  assert.equal(aCentavos(-1.005), -101);
});

test('aCentavos: vacío es cero y texto inválido da error', () => {
  assert.equal(aCentavos(''), 0);
  assert.equal(aCentavos(null), 0);
  assert.throws(() => aCentavos('12a,3'), /Importe inválido/);
});

test('formatear: estilo argentino', () => {
  assert.equal(formatear(123456789), '$ 1.234.567,89');
  assert.equal(formatear(-5), '-$ 0,05');
  assert.equal(formatear(100, { simbolo: false }), '1,00');
});

test('dividirRedondeando: mitad hacia arriba simétrico', () => {
  assert.equal(dividirRedondeando(5, 10), 1);
  assert.equal(dividirRedondeando(4, 10), 0);
  assert.equal(dividirRedondeando(-5, 10), -1);
  assert.equal(dividirRedondeando(15, 10), 2);
  assert.throws(() => dividirRedondeando(1, 0));
});

test('buscarVigente: elige el valor según la fecha y detecta superposición', () => {
  const regs = [
    { tipo: 'X', codigo: 'A', valor: 1, vigente_desde: '2026-01-01', vigente_hasta: '2026-06-30' },
    { tipo: 'X', codigo: 'A', valor: 2, vigente_desde: '2026-07-01', vigente_hasta: null },
  ];
  assert.equal(buscarVigente(regs, { tipo: 'X', codigo: 'A', fecha: '2026-06-30' }).valor, 1);
  assert.equal(buscarVigente(regs, { tipo: 'X', codigo: 'A', fecha: '2026-07-01' }).valor, 2);
  assert.equal(buscarVigente(regs, { tipo: 'X', codigo: 'A', fecha: '2025-12-31' }), null);
  const malos = [...regs, { tipo: 'X', codigo: 'A', valor: 3, vigente_desde: '2026-08-01', vigente_hasta: null }];
  assert.throws(() => buscarVigente(malos, { tipo: 'X', codigo: 'A', fecha: '2026-09-01' }), /Revisá las vigencias/);
  assert.throws(() => buscarVigente(regs, { tipo: 'X', codigo: 'A', fecha: '01/07/2026' }), /Fecha inválida/);
});
