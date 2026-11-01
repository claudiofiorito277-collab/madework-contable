import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcularCertificado, precioVigente, resumenContrato, fechaPago, fechaFinPlazo, diasEntre,
  importeMulta, cantidadesDesdeAvance, importeLinea,
} from '../js/core/certificados.js';

// Datos del contrato RP-E55 según la oferta (1 ítem, 539 columnas a $172.670).
const ITEM = { id: 'i1', codigo: '1', descripcion: 'Pintado de columnas de iluminación en RP-E55', unidad: 'CU', cantidad: '539', precio_unitario: '172670.00' };
const SIN_DESC = { fondo_reparo_pct: 0, anticipo_monto: 0, anticipo_descuento_pct: 0 };
const cert = (extra) => calcularCertificado({ contrato: SIN_DESC, items: [ITEM], fecha: '2026-11-20', ...extra });
const previo = (id, estado, cantidad, descuento_anticipo = 0) => ({ id, estado, descuento_anticipo, items: [{ item_id: 'i1', cantidad }] });

test('C01 · certificado de 100 columnas: bruto, IVA 21% y total', () => {
  const r = cert({ cantidades: { i1: 100 } });
  assert.equal(r.ok, true);
  assert.equal(r.bruto, 1726700000);
  assert.equal(r.iva, 362607000);
  assert.equal(r.totalFactura, 2089307000);
  assert.equal(r.netoACobrar, 2089307000);
});

test('C02 · acumulados: suma lo certificado antes y calcula el % de avance', () => {
  const r = cert({ cantidades: { i1: 150 }, previos: [previo('c1', 'aprobado', 100)] });
  const l = r.lineas[0];
  assert.deepEqual([l.anterior, l.actual, l.acumulado, l.pctAcumulado], [100, 150, 250, 46.38]);
});

test('C03 · supera lo contratado: se permite pero avisa', () => {
  const r = cert({ cantidades: { i1: 50 }, previos: [previo('c1', 'aprobado', 500)] });
  assert.equal(r.ok, true);
  assert.match(r.advertencias.join(' '), /supera lo contratado/);
});

test('C04 · anticipo 20%: descuenta 20% del bruto y lo resta de la factura', () => {
  const contrato = { fondo_reparo_pct: 0, anticipo_monto: '18613826.00', anticipo_descuento_pct: 20, anticipo_en_factura: true };
  const r = calcularCertificado({ contrato, items: [ITEM], fecha: '2026-11-20', cantidades: { i1: 100 } });
  assert.equal(r.descuentoAnticipo, 345340000);
  assert.equal(r.anticipoPendienteDespues, 1861382600 - 345340000);
  assert.equal(r.baseFactura, 1381360000);
  assert.equal(r.iva, 290085600);
});

test('C05 · anticipo casi agotado: descuenta solo el saldo pendiente', () => {
  const contrato = { anticipo_monto: '18613826.00', anticipo_descuento_pct: 20, anticipo_en_factura: true };
  const r = calcularCertificado({ contrato, items: [ITEM], fecha: '2026-11-20', cantidades: { i1: 100 },
    previos: [previo('c1', 'aprobado', 400, '18000000.00')] });
  assert.equal(r.descuentoAnticipo, 61382600);
  assert.equal(r.anticipoPendienteDespues, 0);
});

test('C06 · obra al 100% con anticipo pendiente: avisa', () => {
  const contrato = { anticipo_monto: '18613826.00', anticipo_descuento_pct: 1 };
  const r = calcularCertificado({ contrato, items: [ITEM], fecha: '2026-12-20', cantidades: { i1: 39 },
    previos: [previo('c1', 'aprobado', 500, '1000.00')] });
  assert.match(r.advertencias.join(' '), /falta descontar/);
});

test('C07 · fondo de reparo 5% retenido en el pago (no en la factura)', () => {
  const r = calcularCertificado({ contrato: { fondo_reparo_pct: 5 }, items: [ITEM], fecha: '2026-11-20', cantidades: { i1: 100 } });
  assert.equal(r.fondoReparo, 86335000);
  assert.equal(r.baseFactura, r.bruto);
  assert.equal(r.retenidoEnPago, 86335000);
  assert.equal(r.netoACobrar, r.totalFactura - 86335000);
});

test('C08 · fondo de reparo descontado en la factura', () => {
  const r = calcularCertificado({ contrato: { fondo_reparo_pct: 5, fr_en_factura: true }, items: [ITEM], fecha: '2026-11-20', cantidades: { i1: 100 } });
  assert.equal(r.baseFactura, 1726700000 - 86335000);
  assert.equal(r.retenidoEnPago, 0);
});

test('C09 · multa de 600 L de nafta: por nota de crédito, no toca la factura', () => {
  const multa = importeMulta(600, '2300') / 100;
  const r = cert({ cantidades: { i1: 100 }, multas: [{ importe: multa }] });
  assert.equal(r.multas, 138000000);
  assert.equal(r.baseFactura, r.bruto);
  assert.equal(r.multasPorNC, 138000000);
  assert.equal(r.netoACobrar, r.totalFactura - 138000000);
});

test('C10 · redeterminación por factor aprobada: rige desde su fecha', () => {
  const red = [{ numero: 1, fecha_vigencia: '2026-12-01', estado: 'aprobada', factor: '1.15' }];
  assert.equal(precioVigente(ITEM, red, '2026-11-30'), 17267000);
  assert.equal(precioVigente(ITEM, red, '2026-12-01'), 19857050);
  const r = cert({ fecha: '2026-12-05', redeterminaciones: red, cantidades: { i1: 10 } });
  assert.equal(r.bruto, 198570500);
  assert.match(r.advertencias.join(' '), /redeterminado/);
});

test('C11 · redeterminación en borrador se ignora; precio explícito gana sobre el factor', () => {
  assert.equal(precioVigente(ITEM, [{ fecha_vigencia: '2026-11-01', estado: 'borrador', factor: 2 }], '2026-12-01'), 17267000);
  const red = [{ numero: 1, fecha_vigencia: '2026-11-01', estado: 'aprobada', factor: 2, precios: { i1: '180000.00' } }];
  assert.equal(precioVigente(ITEM, red, '2026-12-01'), 18000000);
});

test('C12 · errores: cantidad negativa, ítem desconocido y fecha mal escrita', () => {
  assert.match(cert({ cantidades: { i1: -5 } }).errores[0], /negativa/);
  assert.match(cert({ cantidades: { otro: 3 } }).errores[0], /desconocido/);
  assert.match(cert({ fecha: '20/11/2026', cantidades: { i1: 1 } }).errores[0], /fecha/);
});

test('C13 · cantidades con decimales (m²): sin error de redondeo', () => {
  assert.equal(importeLinea('12,345', 100000), 1234500);
  assert.equal(importeLinea(0.1 + 0.2, 100), 30);
});

test('C14 · los certificados anulados, en borrador o el propio no cuentan como anteriores', () => {
  const previos = [previo('c1', 'anulado', 100), previo('c2', 'borrador', 100), previo('c3', 'aprobado', 20), previo('yo', 'presentado', 999)];
  const r = cert({ cantidades: { i1: 10 }, previos, certificadoId: 'yo' });
  assert.equal(r.lineas[0].anterior, 20);
});

test('C15 · fecha de pago: primer viernes a partir de los 15 días corridos', () => {
  assert.equal(fechaPago('2026-11-02'), '2026-11-20'); // lunes + 15 = martes 17 -> viernes 20
  assert.equal(fechaPago('2026-11-05'), '2026-11-20'); // jueves + 15 = viernes 20 -> ese día
  assert.equal(fechaPago('2026-11-07'), '2026-11-27'); // sábado + 15 = domingo 22 -> viernes 27
});

test('C16 · fin de plazo: acta + 90 días corridos', () => {
  assert.equal(fechaFinPlazo('2026-11-10', 90), '2027-02-08');
  assert.equal(diasEntre('2026-11-10', '2027-02-08'), 90);
  assert.equal(fechaFinPlazo(null, 90), null);
});

test('C17 · cantidades desde el registro de columnas: solo aprobadas, sin certificar y hasta la fecha', () => {
  const avances = [
    { id: 'a1', item_id: 'i1', estado: 'aprobada', fecha_aprobacion: '2026-11-18' },
    { id: 'a2', item_id: 'i1', estado: 'aprobada', fecha_aprobacion: '2026-11-20' },
    { id: 'a3', item_id: 'i1', estado: 'aprobada', fecha_aprobacion: '2026-11-21' },
    { id: 'a4', item_id: 'i1', estado: 'ejecutada', fecha_aprobacion: null },
    { id: 'a5', item_id: 'i1', estado: 'aprobada', fecha_aprobacion: '2026-11-17', certificado_id: 'c1' },
  ];
  const r = cantidadesDesdeAvance(avances, '2026-11-20');
  assert.deepEqual(r.cantidades, { i1: 2 });
  assert.deepEqual(r.ids, ['a1', 'a2']);
});

test('C18 · resumen del contrato: monto contractual y % de avance', () => {
  const r = resumenContrato([ITEM], [
    { estado: 'aprobado', bruto: '17267000.00', items: [{ item_id: 'i1', cantidad: 100 }] },
    { estado: 'anulado', bruto: '5000000.00', items: [{ item_id: 'i1', cantidad: 30 }] },
  ]);
  assert.equal(r.montoContractual, 9306913000);
  assert.equal(r.certificado, 1726700000);
  assert.equal(r.avanceMontoPct, 18.55);
  assert.equal(r.avanceCantidadPct, 18.55);
});
