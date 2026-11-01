import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogo } from './catalogo-demo.js';
import {
  claveComprobante, buscarDuplicado, pctACentesimos, validarImputacion, repartirImputacion,
  calcularCompra, calcularPago, cuentaCorrienteProveedor, agruparVencimientos,
} from '../js/core/compras.js';

// Factura A de pinturas: 200 litros de esmalte a $8.500 = $1.700.000 + IVA 21% + percepciones
const FACTURA_PINTURA = {
  tipoCodigo: '1', condicionProveedor: 'RI', fecha: '2026-11-18', modo: 'desde_neto',
  lineas: [{ tratamiento: 'gravado', alicuota: 'IVA_21', neto: 170000000 }],
  percepciones: [{ tipo: 'PERC_IVA', importe: 5100000 }, { tipo: 'PERC_IIBB_CBA', importe: 3400000 }],
};

test('C01 · duplicado: misma clave CUIT + tipo + PV + número, con o sin guiones', () => {
  const ex = [{ id: 'a', cuit: '30-71234567-1', tipo_codigo: '1', punto_venta: 4, numero: 1520, estado: 'emitido' }];
  assert.equal(claveComprobante(ex[0]), '30712345671|1|4|1520');
  assert.equal(buscarDuplicado({ cuit: '30712345671', tipo_codigo: '1', punto_venta: '0004', numero: '1520' }, ex)?.id, 'a');
  assert.equal(buscarDuplicado({ cuit: '30712345671', tipo_codigo: '1', punto_venta: 4, numero: 1521 }, ex), null);
  assert.equal(buscarDuplicado({ cuit: '30712345671', tipo_codigo: '6', punto_venta: 4, numero: 1520 }, ex), null, 'otro tipo no es duplicado');
  assert.equal(buscarDuplicado({ cuit: '20111111112', tipo_codigo: '1', punto_venta: 4, numero: 1520 }, ex), null, 'otro proveedor no es duplicado');
});

test('C02 · duplicado: un anulado no cuenta, y el propio registro tampoco', () => {
  const ex = [{ id: 'a', cuit: '30712345671', tipo_codigo: '1', punto_venta: 4, numero: 1520, estado: 'anulado' }];
  assert.equal(buscarDuplicado({ cuit: '30712345671', tipo_codigo: '1', punto_venta: 4, numero: 1520 }, ex), null);
  ex[0].estado = 'emitido';
  assert.equal(buscarDuplicado({ id: 'a', cuit: '30712345671', tipo_codigo: '1', punto_venta: 4, numero: 1520 }, ex), null);
});

test('C03 · imputación repartida 60/40 que suma 100 %', () => {
  const imp = [{ contrato_id: 'E55', item_id: 'i1', porcentaje: 60 }, { contrato_id: 'E55', item_id: 'i2', porcentaje: '40' }];
  assert.deepEqual(validarImputacion(imp), []);
  const r = repartirImputacion(170000000, imp);
  assert.deepEqual(r.map((x) => x.importe), [102000000, 68000000]);
});

test('C04 · imputación: errores claros', () => {
  assert.match(validarImputacion([])[0], /Falta imputar/);
  assert.match(validarImputacion([{ contrato_id: 'x', porcentaje: 60 }, { contrato_id: 'y', porcentaje: 30 }]).join(), /sumar 100 % \(suma 90 %\)/);
  assert.match(validarImputacion([{ porcentaje: 100 }]).join(), /contrato o un centro de costo/);
  assert.match(validarImputacion([{ centro_costo_id: 'cc', item_id: 'i', porcentaje: 100 }]).join(), /ítem tiene que ir con su contrato/);
  assert.match(validarImputacion([{ contrato_id: 'x', porcentaje: 0 }, { contrato_id: 'y', porcentaje: 100 }]).join(), /mayor a cero/);
  assert.match(validarImputacion([{ contrato_id: 'x', porcentaje: 100, categoria: 'nafta' }]).join(), /categoría/);
  assert.equal(pctACentesimos('33,33'), 3333);
});

test('C05 · imputación en tercios: los centavos sobrantes no se pierden', () => {
  const tercios = [{ contrato_id: 'a', porcentaje: 33.33 }, { contrato_id: 'b', porcentaje: 33.33 }, { contrato_id: 'c', porcentaje: 33.34 }];
  assert.deepEqual(validarImputacion(tercios), []);
  const r = repartirImputacion(100001, tercios);
  assert.equal(r.reduce((s, x) => s + x.importe, 0), 100001);
  assert.deepEqual(r.map((x) => x.importe), [33330, 33330, 33341]);
  const neg = repartirImputacion(-100001, tercios);
  assert.equal(neg.reduce((s, x) => s + x.importe, 0), -100001);
});

test('C06 · factura A de pintura: crédito fiscal, percepciones fuera del costo, imputación 60/40', () => {
  const r = calcularCompra({ ...FACTURA_PINTURA, imputacion: [{ contrato_id: 'E55', item_id: 'i1', porcentaje: 60 }, { contrato_id: 'E55', item_id: 'i2', porcentaje: 40 }] }, catalogo);
  assert.equal(r.ok, true, r.errores?.join());
  assert.equal(r.netoGravado, 170000000);
  assert.equal(r.ivaTotal, 35700000);
  assert.equal(r.totalPercepciones, 8500000);
  assert.equal(r.total, 170000000 + 35700000 + 8500000);
  assert.equal(r.generaCreditoFiscal, true);
  assert.equal(r.creditoFiscal, 35700000);
  assert.equal(r.costo, 170000000, 'el costo de obra es el neto: el IVA y las percepciones se recuperan');
  assert.deepEqual(r.imputacion.map((x) => x.importe), [102000000, 68000000]);
});

test('C07 · factura C de un monotributista: sin crédito fiscal, todo es costo', () => {
  const r = calcularCompra({ tipoCodigo: '11', condicionProveedor: 'MT', fecha: '2026-11-18',
    lineas: [{ tratamiento: 'gravado', alicuota: 'IVA_21', total: 45000000 }], imputacion: [{ contrato_id: 'E55', porcentaje: 100 }] }, catalogo);
  assert.equal(r.ok, true, r.errores?.join());
  assert.equal(r.generaCreditoFiscal, false);
  assert.equal(r.creditoFiscal, 0);
  assert.equal(r.ivaTotal, 0);
  assert.equal(r.total, 45000000);
  assert.equal(r.costo, 45000000);
  assert.match(r.motivoCreditoFiscal, /no discrimina IVA/);
});

test('C08 · coherencia de letra y condición del proveedor', () => {
  const mt = calcularCompra({ ...FACTURA_PINTURA, condicionProveedor: 'MT', percepciones: [] }, catalogo);
  assert.match(mt.errores.join(), /monotributista emite comprobantes C/);
  const ri = calcularCompra({ tipoCodigo: '11', condicionProveedor: 'RI', fecha: '2026-11-18', lineas: [{ total: 100 }] }, catalogo);
  assert.match(ri.errores.join(), /no emite comprobantes C/);
});

test('C09 · factura B de un RI: IVA contenido que no es crédito, va al costo', () => {
  const r = calcularCompra({ tipoCodigo: '6', condicionProveedor: 'RI', fecha: '2026-11-18', modo: 'desde_total',
    lineas: [{ tratamiento: 'gravado', alicuota: 'IVA_21', total: 12100000 }] }, catalogo);
  assert.equal(r.ok, true);
  assert.equal(r.creditoFiscal, 0);
  assert.equal(r.costo, 12100000);
  assert.ok(r.advertencias.some((a) => /lo normal es Factura A/.test(a)));
});

test('C10 · percepciones: tipo inválido y aviso en comprobante sin IVA', () => {
  const r = calcularCompra({ ...FACTURA_PINTURA, percepciones: [{ tipo: 'XX', importe: 100 }] }, catalogo);
  assert.match(r.errores.join(), /Percepción 1: tipo inválido/);
  const c = calcularCompra({ tipoCodigo: '11', condicionProveedor: 'MT', fecha: '2026-11-18', lineas: [{ total: 1000 }], percepciones: [{ tipo: 'PERC_IIBB_CBA', importe: 30 }] }, catalogo);
  assert.ok(c.advertencias.some((a) => /no suele traer percepciones/.test(a)));
});

test('C11 · otros tributos se suman al total y al costo', () => {
  const r = calcularCompra({ tipoCodigo: '1', condicionProveedor: 'RI', fecha: '2026-11-18', lineas: [{ alicuota: 'IVA_21', neto: 10000 }], otrosTributos: 500 }, catalogo);
  assert.equal(r.total, 12600);
  assert.equal(r.costo, 10500);
});

test('C12 · pago parcial a dos facturas y anticipo', () => {
  const saldos = { f1: 214200000, f2: 45000000 };
  const p = calcularPago({ medios: [{ medio: 'transferencia', importe: 100000000 }], aplicaciones: [{ comprobante_id: 'f1', importe: 60000000 }, { comprobante_id: 'f2', importe: 40000000 }] }, { saldos });
  assert.equal(p.ok, true);
  assert.equal(p.total, 100000000);
  assert.equal(p.aCuenta, 0);
  const a = calcularPago({ medios: [{ medio: 'echeq', importe: 50000000 }], aplicaciones: [{ comprobante_id: 'f2', importe: 45000000 }] }, { saldos });
  assert.equal(a.aCuenta, 5000000);
  assert.ok(a.advertencias.some((x) => /anticipo al proveedor/.test(x)));
});

test('C13 · pago: no aplica más que el saldo ni más de lo pagado', () => {
  const saldos = { f1: 1000 };
  assert.match(calcularPago({ medios: [{ medio: 'efectivo', importe: 2000 }], aplicaciones: [{ comprobante_id: 'f1', importe: 1500 }] }, { saldos }).errores.join(), /saldo 10/);
  assert.match(calcularPago({ medios: [{ medio: 'efectivo', importe: 500 }], aplicaciones: [{ comprobante_id: 'f1', importe: 800 }] }, { saldos }).errores.join(), /más \(8\) de lo que se paga \(5\)/);
  assert.match(calcularPago({ medios: [{ medio: 'cripto', importe: 500 }] }, { saldos }).errores.join(), /medio inválido/);
});

test('C14 · retenciones practicadas: desactivadas por defecto', () => {
  const p = { medios: [{ medio: 'transferencia', importe: 98000 }], retenciones: [{ tipo: 'RET_GANANCIAS', importe: 2000 }], aplicaciones: [{ comprobante_id: 'f1', importe: 100000 }] };
  assert.match(calcularPago(p, { saldos: { f1: 100000 } }).errores.join(), /no está configurado como agente de retención/);
  const ok = calcularPago(p, { saldos: { f1: 100000 }, agenteRetencion: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.total, 100000);
});

test('C15 · cuenta corriente del proveedor: factura, NC y pago dejan saldo cero', () => {
  const cc = cuentaCorrienteProveedor({
    comprobantes: [{ id: 'f', fecha: '2026-11-18', clase: 'factura', total: 214200000, estado: 'emitido' },
      { id: 'nc', fecha: '2026-11-20', clase: 'nota_credito', total: 4200000, estado: 'emitido' },
      { id: 'x', fecha: '2026-11-20', clase: 'factura', total: 999, estado: 'anulado' }],
    pagos: [{ id: 'p', fecha: '2026-11-25', numero: 1, total: 210000000, estado: 'registrado' }],
  });
  assert.equal(cc.saldo, 0);
  assert.deepEqual(cc.movimientos.map((m) => m.saldo), [214200000, 210000000, 0]);
});

test('C16 · vencimientos agrupados', () => {
  const g = agruparVencimientos([
    { id: 'a', saldo: 100, vencimiento: '2026-11-10' }, { id: 'b', saldo: 200, vencimiento: '2026-11-20' },
    { id: 'c', saldo: 300, vencimiento: '2026-12-10' }, { id: 'd', saldo: 400, vencimiento: '2027-02-01' },
    { id: 'e', saldo: 0, vencimiento: '2026-11-10' }, { id: 'f', saldo: 50, fecha: '2026-11-01' },
  ], '2026-11-18');
  assert.deepEqual(g.vencido.map((x) => x.id), ['f', 'a']);
  assert.deepEqual(g.semana.map((x) => x.id), ['b']);
  assert.deepEqual(g.mes.map((x) => x.id), ['c']);
  assert.deepEqual(g.despues.map((x) => x.id), ['d']);
  assert.equal(g.totales.total, 1050);
});
