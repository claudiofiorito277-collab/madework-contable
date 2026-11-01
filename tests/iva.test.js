import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularComprobante, porcentajeABp, ivaDeNeto, separarTotal, evaluarCreditoFiscal } from '../js/core/iva.js';
import { catalogo, conCambioDeAlicuota } from './catalogo-demo.js';

const HOY = '2026-11-01';
const A_RI_RI = { tipoCodigo: '1', condicionEmisor: 'RI', condicionReceptor: 'RI', fecha: HOY };
const calc = (extra, cat = catalogo) => calcularComprobante({ ...A_RI_RI, ...extra }, cat);

// ---------- Cálculos básicos ----------
test('01 · 21% desde neto: $1.000 -> IVA $210, total $1.210', () => {
  const r = calc({ lineas: [{ alicuota: 'IVA_21', neto: 100000 }] });
  assert.equal(r.ok, true);
  assert.equal(r.totales.iva, 21000);
  assert.equal(r.totales.total, 121000);
});

test('02 · 21% desde neto con redondeo: $100,05 -> IVA $21,01', () => {
  const r = calc({ lineas: [{ alicuota: 'IVA_21', neto: 10005 }] });
  assert.equal(r.totales.iva, 2101);
  assert.equal(r.totales.total, 12106);
});

test('03 · 10,5% desde neto: $1.000 -> $105 y $33,33 -> $3,50', () => {
  assert.equal(calc({ lineas: [{ alicuota: 'IVA_10_5', neto: 100000 }] }).totales.iva, 10500);
  assert.equal(calc({ lineas: [{ alicuota: 'IVA_10_5', neto: 3333 }] }).totales.iva, 350);
});

test('04 · 27% desde neto: $100 -> $27', () => {
  assert.equal(calc({ lineas: [{ alicuota: 'IVA_27', neto: 10000 }] }).totales.iva, 2700);
});

test('05 · 21% desde total: $1.210 -> neto $1.000 + IVA $210', () => {
  const r = calc({ modo: 'desde_total', lineas: [{ alicuota: 'IVA_21', total: 121000 }] });
  assert.equal(r.lineas[0].neto, 100000);
  assert.equal(r.lineas[0].iva, 21000);
});

test('06 · desde total que no divide exacto: $100 -> neto $82,64 + IVA $17,36 (siempre cuadra con el total)', () => {
  const r = calc({ modo: 'desde_total', lineas: [{ alicuota: 'IVA_21', total: 10000 }] });
  assert.equal(r.lineas[0].neto, 8264);
  assert.equal(r.lineas[0].iva, 1736);
  assert.equal(r.lineas[0].neto + r.lineas[0].iva, 10000);
});

test('07 · 10,5% desde total: $110,50 -> neto $100 + IVA $10,50', () => {
  const r = calc({ modo: 'desde_total', lineas: [{ alicuota: 'IVA_10_5', total: 11050 }] });
  assert.deepEqual([r.lineas[0].neto, r.lineas[0].iva], [10000, 1050]);
});

// ---------- Varias alícuotas y tratamientos ----------
test('08 · mezcla 21% y 10,5% en el mismo comprobante, con totales por alícuota', () => {
  const r = calc({ lineas: [{ alicuota: 'IVA_21', neto: 100000 }, { alicuota: 'IVA_10_5', neto: 50000 }] });
  assert.equal(r.totales.iva, 26250);
  assert.equal(r.totales.total, 176250);
  assert.deepEqual(r.totales.porAlicuota.IVA_21, { bp: 2100, neto: 100000, iva: 21000 });
  assert.deepEqual(r.totales.porAlicuota.IVA_10_5, { bp: 1050, neto: 50000, iva: 5250 });
});

test('09 · gravado + exento + no gravado: se separan y solo el gravado lleva IVA', () => {
  const r = calc({ lineas: [
    { alicuota: 'IVA_21', neto: 100000 },
    { tratamiento: 'exento', neto: 20000 },
    { tratamiento: 'no_gravado', neto: 5000 },
  ] });
  assert.equal(r.totales.netoGravado, 100000);
  assert.equal(r.totales.exento, 20000);
  assert.equal(r.totales.noGravado, 5000);
  assert.equal(r.totales.iva, 21000);
  assert.equal(r.totales.total, 146000);
});

test('10 · una línea exenta con IVA es rechazada', () => {
  const r = calc({ lineas: [{ tratamiento: 'exento', neto: 10000, iva: 2100 }] });
  assert.equal(r.ok, false);
  assert.match(r.errores[0], /exento no puede llevar IVA/);
});

test('11 · varias líneas desde total: cada línea cuadra y la suma da el total cargado', () => {
  const r = calc({ modo: 'desde_total', lineas: [1, 2, 3].map(() => ({ alicuota: 'IVA_21', total: 10000 })) });
  assert.equal(r.totales.total, 30000);
  assert.equal(r.totales.netoGravado + r.totales.iva, 30000);
});

// ---------- Carga manual ----------
test('12 · carga manual exacta es aceptada', () => {
  const r = calc({ modo: 'manual', lineas: [{ alicuota: 'IVA_21', neto: 100000, iva: 21000 }] });
  assert.equal(r.ok, true);
  assert.equal(r.advertencias.length, 0);
});

test('13 · carga manual con 1 centavo de diferencia: aceptada con advertencia', () => {
  const r = calc({ modo: 'manual', lineas: [{ alicuota: 'IVA_21', neto: 10005, iva: 2102 }] });
  assert.equal(r.ok, true);
  assert.match(r.advertencias[0], /1 centavo/);
});

test('14 · carga manual que no cuadra: rechazada con la diferencia', () => {
  const r = calc({ modo: 'manual', lineas: [{ alicuota: 'IVA_21', neto: 10005, iva: 2105 }] });
  assert.equal(r.ok, false);
  assert.match(r.errores[0], /no cuadra/);
});

test('15 · carga manual sin IVA: rechazada', () => {
  const r = calc({ modo: 'manual', lineas: [{ alicuota: 'IVA_21', neto: 10000 }] });
  assert.equal(r.ok, false);
});

// ---------- Crédito fiscal ----------
test('16 · Factura A entre Responsables Inscriptos genera crédito fiscal', () => {
  const r = calc({ lineas: [{ alicuota: 'IVA_21', neto: 100000 }] });
  assert.equal(r.generaCreditoFiscal, true);
  assert.equal(r.creditoFiscal, 21000);
});

test('17 · Factura C de monotributista: sin IVA y sin crédito fiscal', () => {
  const r = calc({ tipoCodigo: '11', condicionEmisor: 'MT', lineas: [{ alicuota: 'IVA_21', total: 50000 }] });
  assert.equal(r.ok, true);
  assert.equal(r.totales.iva, 0);
  assert.equal(r.totales.sinDiscriminar, 50000);
  assert.equal(r.generaCreditoFiscal, false);
  assert.equal(r.creditoFiscal, 0);
});

test('18 · Factura B recibida de un RI: IVA contenido calculado pero sin crédito fiscal', () => {
  const r = calc({ tipoCodigo: '6', modo: 'desde_total', lineas: [{ alicuota: 'IVA_21', total: 12100 }] });
  assert.equal(r.ivaContenido, true);
  assert.equal(r.totales.iva, 2100);
  assert.equal(r.generaCreditoFiscal, false);
  assert.equal(r.creditoFiscal, 0);
});

test('19 · Factura A a un receptor que no es RI: no genera crédito', () => {
  const r = calc({ condicionReceptor: 'CF', lineas: [{ alicuota: 'IVA_21', neto: 10000 }] });
  assert.equal(r.generaCreditoFiscal, false);
  assert.match(r.motivoCreditoFiscal, /receptor/);
});

test('20 · Factura M: sigue la configuración del tipo (A CONFIRMAR CON CONTADOR)', () => {
  const r = calc({ tipoCodigo: '51', lineas: [{ alicuota: 'IVA_21', neto: 10000 }] });
  assert.equal(r.generaCreditoFiscal, true);
  const sinCredito = evaluarCreditoFiscal({ tipo: { codigo: '51', discrimina_iva: true, genera_credito_fiscal: false }, condicionEmisor: 'RI', condicionReceptor: 'RI' });
  assert.equal(sinCredito.genera, false);
});

// ---------- Notas de crédito e importes negativos ----------
test('21 · Nota de crédito A: signo negativo en total y crédito fiscal', () => {
  const r = calc({ tipoCodigo: '3', lineas: [{ alicuota: 'IVA_21', neto: 100000 }] });
  assert.equal(r.signo, -1);
  assert.equal(r.totalConSigno, -121000);
  assert.equal(r.creditoFiscal, -21000);
});

test('22 · importes negativos redondean espejo de los positivos', () => {
  const pos = calc({ lineas: [{ alicuota: 'IVA_21', neto: 10005 }] });
  const neg = calc({ lineas: [{ alicuota: 'IVA_21', neto: -10005 }] });
  assert.equal(neg.totales.iva, -pos.totales.iva);
  assert.equal(neg.totales.total, -pos.totales.total);
});

test('23 · Nota de crédito C: negativa y sin crédito fiscal', () => {
  const r = calc({ tipoCodigo: '13', condicionEmisor: 'MT', lineas: [{ total: 5000 }] });
  assert.equal(r.signo, -1);
  assert.equal(r.creditoFiscal, 0);
});

// ---------- Redondeos límite ----------
test('24 · redondeos límite: 2 centavos -> IVA 0; 3 centavos -> IVA 1; 50 centavos -> IVA 11 (mitad exacta)', () => {
  assert.equal(ivaDeNeto(2, 2100), 0);
  assert.equal(ivaDeNeto(3, 2100), 1);
  assert.equal(ivaDeNeto(50, 2100), 11); // 10,5 centavos exactos -> sube
  assert.equal(ivaDeNeto(5, 1050), 1);   // 0,525 centavos -> sube
});

test('25 · importe grande sin pérdida de precisión: $1.000.000.000 al 21%', () => {
  const r = calc({ lineas: [{ alicuota: 'IVA_21', neto: 100000000000 }] });
  assert.equal(r.totales.iva, 21000000000);
  const s = separarTotal(121000000000, 2100);
  assert.deepEqual(s, { neto: 100000000000, iva: 21000000000 });
});

test('26 · total cero: se acepta con advertencia', () => {
  const r = calc({ lineas: [{ alicuota: 'IVA_21', neto: 0 }] });
  assert.equal(r.ok, true);
  assert.match(r.advertencias.join(' '), /total del comprobante es cero/);
});

// ---------- Vigencias y configuración ----------
test('27 · cambio de alícuota por vigencia (valor ficticio 22% desde 2027): usa la vigente en cada fecha', () => {
  const cat = conCambioDeAlicuota('IVA_21', 22, '2027-01-01', '2026-12-31');
  assert.equal(calc({ fecha: '2026-12-31', lineas: [{ alicuota: 'IVA_21', neto: 10000 }] }, cat).totales.iva, 2100);
  assert.equal(calc({ fecha: '2027-01-01', lineas: [{ alicuota: 'IVA_21', neto: 10000 }] }, cat).totales.iva, 2200);
});

test('28 · fecha anterior al inicio de vigencia: error claro', () => {
  const r = calc({ fecha: '2026-10-31', lineas: [{ alicuota: 'IVA_21', neto: 10000 }] });
  assert.equal(r.ok, false);
  assert.match(r.errores[0], /sin valor vigente al 2026-10-31/);
});

test('29 · alícuota, tipo de comprobante o modo inexistentes: error', () => {
  assert.equal(calc({ lineas: [{ alicuota: 'IVA_99', neto: 100 }] }).ok, false);
  assert.match(calc({ tipoCodigo: '999', lineas: [{ alicuota: 'IVA_21', neto: 100 }] }).errores[0], /Tipo de comprobante inexistente/);
  assert.match(calc({ modo: 'otro', lineas: [{ alicuota: 'IVA_21', neto: 100 }] }).errores[0], /Modo/);
});

test('30 · comprobante sin líneas o fecha mal escrita: error', () => {
  assert.match(calc({ lineas: [] }).errores[0], /no tiene líneas/);
  assert.match(calc({ fecha: '01/11/2026', lineas: [{ alicuota: 'IVA_21', neto: 100 }] }).errores[0], /Fecha inválida/);
});

test('31 · porcentajes en distintos formatos', () => {
  assert.equal(porcentajeABp(21), 2100);
  assert.equal(porcentajeABp('10,5'), 1050);
  assert.equal(porcentajeABp('27.00'), 2700);
  assert.throws(() => porcentajeABp(150));
});

test('32 · la tolerancia de cuadre se toma de la configuración', () => {
  const cat = { ...catalogo, parametros: catalogo.parametros.map((p) => p.codigo === 'CUADRE_IVA_CENTAVOS' ? { ...p, valor: 0 } : p) };
  const r = calc({ modo: 'manual', lineas: [{ alicuota: 'IVA_21', neto: 10005, iva: 2102 }] }, cat);
  assert.equal(r.ok, false);
});
