import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saldosComprobantes, sugerirAplicacion, controlRetencion, calcularCobranza, cuentaCorriente, antiguedad,
  saldosFondoReparo, propuestaDesdeCertificado, estadoCertificadoSegunFactura, validarAsociado,
  formatoNumero, validarNumeracion, caeValido,
} from '../js/core/ventas.js';

// Factura del certificado N° 1 de E55: 100 columnas × $172.670 = $17.267.000 + IVA 21% $3.626.070
const F1 = { id: 'f1', clase: 'factura', letra: 'A', cliente_id: 'cli', total: 2089307000, estado: 'emitido', fecha: '2026-11-20', vencimiento: '2026-12-11' };

test('V01 · numeración ARCA: formato y validación', () => {
  assert.equal(formatoNumero(3, 125), '00003-00000125');
  assert.deepEqual(validarNumeracion(3, 125), []);
  assert.equal(validarNumeracion(0, 1).length, 1);
  assert.equal(validarNumeracion(1, 0).length, 1);
  assert.equal(validarNumeracion('1,5', 2).length, 1);
  assert.equal(caeValido('76123456789012'), true);
  assert.equal(caeValido('7612345678901'), false);
});

test('V02 · cobro parcial: el saldo baja por lo aplicado', () => {
  const s = saldosComprobantes([F1], [{ comprobante_id: 'f1', importe: 1000000000 }]);
  assert.deepEqual(s.f1, { total: 2089307000, notasCredito: 0, cobrado: 1000000000, saldo: 1089307000 });
});

test('V03 · cobro con 3 retenciones (Ganancias, IVA, IIBB) cancela la factura completa', () => {
  const saldos = { f1: 2089307000 };
  const r = calcularCobranza({
    medios: [{ medio: 'transferencia', importe: 1928127480 }],
    retenciones: [
      { tipo: 'RET_GANANCIAS', numero_certificado: 'G-1', importe: 34534000 },   // 2% de 17.267.000
      { tipo: 'RET_IVA', numero_certificado: 'I-1', importe: 108782100 },        // 3% del total ≈ dato del certificado
      { tipo: 'RET_IIBB_CBA', numero_certificado: 'B-1', importe: 17863420 },
    ],
    aplicaciones: [{ comprobante_id: 'f1', importe: 2089307000 }],
  }, { saldos });
  assert.equal(r.ok, true, r.errores.join(' '));
  assert.equal(r.totalRetenciones, 161179520);
  assert.equal(r.total, 2089307000);
  assert.equal(r.sinAplicar, 0);
  const s = saldosComprobantes([F1], [{ comprobante_id: 'f1', importe: r.totalAplicado }]);
  assert.equal(s.f1.saldo, 0);
});

test('V04 · retención sin número de certificado o importe cero: error', () => {
  const r = calcularCobranza({ retenciones: [{ tipo: 'RET_IVA', numero_certificado: '', importe: 0 }] }, {});
  assert.equal(r.ok, false);
  assert.match(r.errores.join(' '), /mayor a cero/);
  assert.match(r.errores.join(' '), /número de certificado/);
});

test('V05 · no se puede aplicar más que el saldo ni más de lo cobrado', () => {
  const a = calcularCobranza({ medios: [{ medio: 'transferencia', importe: 100 }], aplicaciones: [{ comprobante_id: 'f1', importe: 200 }] }, { saldos: { f1: 150 } });
  assert.equal(a.ok, false);
  assert.match(a.errores.join(' '), /saldo 1\.5/);
  assert.match(a.errores.join(' '), /más .* de lo que se cobra/);
  const b = calcularCobranza({ medios: [{ medio: 'efectivo', importe: 100 }], aplicaciones: [{ comprobante_id: 'zz', importe: 50 }] }, { saldos: {} });
  assert.match(b.errores.join(' '), /no está pendiente/);
});

test('V06 · cobro mayor que la deuda: el resto queda a cuenta (advertencia)', () => {
  const r = calcularCobranza({ medios: [{ medio: 'echeq', importe: 1000 }], aplicaciones: [{ comprobante_id: 'f1', importe: 800 }] }, { saldos: { f1: 800 } });
  assert.equal(r.ok, true);
  assert.equal(r.sinAplicar, 200);
  assert.match(r.advertencias.join(' '), /a cuenta/);
});

test('V07 · NC parcial por multas baja el saldo; validación de la NC', () => {
  const nc = { id: 'nc1', clase: 'nota_credito', letra: 'A', cliente_id: 'cli', asociado_id: 'f1', total: 50000000, estado: 'emitido' };
  const s = saldosComprobantes([F1, nc], []);
  assert.equal(s.f1.saldo, 2089307000 - 50000000);
  assert.equal(s.nc1, undefined, 'la NC no es deuda propia');
  assert.deepEqual(validarAsociado({ clase: 'nota_credito', letra: 'A', clienteId: 'cli', total: 50000000 }, F1, 0), []);
  assert.match(validarAsociado({ clase: 'nota_credito', letra: 'B', clienteId: 'cli', total: 1 }, F1, 0).join(), /letra/);
  assert.match(validarAsociado({ clase: 'nota_credito', letra: 'A', clienteId: 'otro', total: 1 }, F1, 0).join(), /otro cliente/);
  assert.match(validarAsociado({ clase: 'nota_credito', letra: 'A', clienteId: 'cli', total: 2089307000 }, F1, 1).join(), /supera/);
  assert.match(validarAsociado({ clase: 'nota_credito', letra: 'A', clienteId: 'cli', total: 1 }, null).join(), /asociada/);
  const anulada = saldosComprobantes([F1, { ...nc, estado: 'anulado' }], []);
  assert.equal(anulada.f1.saldo, 2089307000, 'una NC anulada no cuenta');
});

test('V08 · NC parcial, cobro del resto y saldo final cero en la cuenta corriente', () => {
  const nc = { id: 'nc1', clase: 'nota_credito', asociado_id: 'f1', total: 50000000, estado: 'emitido', fecha: '2026-11-25', descripcion: 'NC multas' };
  const cc = cuentaCorriente({
    comprobantes: [{ ...F1, descripcion: 'Factura A' }, nc],
    cobranzas: [{ id: 'r1', numero: 1, fecha: '2026-12-11', total: 2039307000, devolucion_fr: 0, estado: 'registrada' }],
  });
  assert.deepEqual(cc.movimientos.map((m) => m.saldo), [2089307000, 2039307000, 0]);
  assert.equal(cc.saldo, 0);
});

test('V09 · CRITERIO DE ACEPTACIÓN: facturo un certificado, lo cobro en dos partes con Ganancias, IVA e IIBB y la cuenta queda en cero', () => {
  const cert = { id: 'c1', numero: 1, base_factura: '17267000.00', iva: '3626070.00', total_factura: '20893070.00', fondo_reparo: '0', multas: '0',
    periodo_desde: '2026-11-16', periodo_hasta: '2026-11-20' };
  const contrato = { id: 'k1', codigo: 'E55', cliente_id: 'cli', alicuota_iva: 'IVA_21' };
  const p = propuestaDesdeCertificado(cert, contrato);
  assert.equal(p.total, 2089307000);
  assert.equal(p.lineas[0].neto + p.lineas[0].iva, p.total);
  const factura = { ...F1, total: p.total };

  // Primer cobro: transferencia + Ganancias + IIBB
  let saldos = saldosComprobantes([factura], []);
  const c1 = calcularCobranza({
    medios: [{ medio: 'transferencia', importe: 900000000 }],
    retenciones: [{ tipo: 'RET_GANANCIAS', numero_certificado: 'G-0001', importe: 34534000 }, { tipo: 'RET_IIBB_CBA', numero_certificado: 'IB-0001', importe: 17863420 }],
    aplicaciones: [{ comprobante_id: 'f1', importe: 952397420 }],
  }, { saldos: { f1: saldos.f1.saldo } });
  assert.equal(c1.ok, true, c1.errores.join(' '));
  assert.equal(c1.sinAplicar, 0);
  saldos = saldosComprobantes([factura], [{ comprobante_id: 'f1', importe: c1.totalAplicado }]);
  assert.equal(saldos.f1.saldo, 1136909580);
  assert.equal(estadoCertificadoSegunFactura({ estado: 'emitido', ...saldos.f1 }), 'facturado');

  // Segundo cobro: echeq + retención de IVA, por el resto
  const c2 = calcularCobranza({
    medios: [{ medio: 'echeq', importe: 1028127480 }],
    retenciones: [{ tipo: 'RET_IVA', numero_certificado: 'IVA-0001', importe: 108782100 }],
    aplicaciones: [{ comprobante_id: 'f1', importe: 1136909580 }],
  }, { saldos: { f1: saldos.f1.saldo } });
  assert.equal(c2.ok, true, c2.errores.join(' '));
  saldos = saldosComprobantes([factura], [{ comprobante_id: 'f1', importe: c1.totalAplicado }, { comprobante_id: 'f1', importe: c2.totalAplicado }]);
  assert.equal(saldos.f1.saldo, 0);
  assert.equal(estadoCertificadoSegunFactura({ estado: 'emitido', ...saldos.f1 }), 'cobrado');

  const cc = cuentaCorriente({
    comprobantes: [{ ...factura, descripcion: 'Factura' }],
    cobranzas: [{ id: 'r1', numero: 1, fecha: '2026-12-11', total: c1.total, estado: 'registrada' }, { id: 'r2', numero: 2, fecha: '2026-12-18', total: c2.total, estado: 'registrada' }],
  });
  assert.equal(cc.saldo, 0);
  assert.equal(cc.debe, cc.haber);
});

test('V10 · fondo de reparo retenido en el pago y devuelto después', () => {
  // Factura 1.000; el cliente paga 950 y retiene 50 de fondo de reparo
  const c1 = calcularCobranza({
    medios: [{ medio: 'transferencia', importe: 95000 }],
    fondoReparo: [{ contrato_id: 'k1', importe: 5000 }],
    aplicaciones: [{ comprobante_id: 'f1', importe: 100000 }],
  }, { saldos: { f1: 100000 } });
  assert.equal(c1.ok, true, c1.errores.join(' '));
  assert.equal(c1.haberCuentaCorriente, 100000);
  let fr = saldosFondoReparo([{ contrato_id: 'k1', tipo: 'retencion', importe: 5000 }]);
  assert.equal(fr.k1.saldo, 5000);

  // Más adelante devuelve el fondo de reparo: entra plata, no baja deuda de facturas
  const c2 = calcularCobranza({ medios: [{ medio: 'transferencia', importe: 5000 }], devolucionesFR: [{ contrato_id: 'k1', importe: 5000 }] }, { saldosFR: { k1: 5000 } });
  assert.equal(c2.ok, true, c2.errores.join(' '));
  assert.equal(c2.haberCuentaCorriente, 0);
  fr = saldosFondoReparo([{ contrato_id: 'k1', tipo: 'retencion', importe: 5000 }, { contrato_id: 'k1', tipo: 'devolucion', importe: 5000 }]);
  assert.equal(fr.k1.saldo, 0);

  const excede = calcularCobranza({ medios: [{ medio: 'transferencia', importe: 6000 }], devolucionesFR: [{ contrato_id: 'k1', importe: 6000 }] }, { saldosFR: { k1: 5000 } });
  assert.match(excede.errores.join(' '), /supera el saldo retenido/);

  const cc = cuentaCorriente({
    comprobantes: [{ id: 'f1', clase: 'factura', total: 100000, fecha: '2026-11-20', estado: 'emitido' }],
    cobranzas: [{ id: 'r1', fecha: '2026-12-01', total: c1.total, devolucion_fr: 0, estado: 'registrada' },
      { id: 'r2', fecha: '2027-12-01', total: c2.total, devolucion_fr: c2.totalDevolucionFR, estado: 'registrada' }],
  });
  assert.equal(cc.saldo, 0);
});

test('V11 · sugerir aplicación: del vencimiento más viejo al más nuevo', () => {
  const r = sugerirAplicacion(1500, [
    { id: 'b', saldo: 1000, vencimiento: '2026-12-20' },
    { id: 'a', saldo: 1000, vencimiento: '2026-12-10' },
    { id: 'c', saldo: 0, vencimiento: '2026-12-01' },
  ]);
  assert.deepEqual(r.aplicaciones, [{ comprobante_id: 'a', importe: 1000 }, { comprobante_id: 'b', importe: 500 }]);
  assert.equal(r.resto, 0);
  assert.equal(sugerirAplicacion(3000, [{ id: 'a', saldo: 1000 }]).resto, 2000);
});

test('V12 · control de retención: avisa si no coincide, no calcula por su cuenta', () => {
  assert.deepEqual(controlRetencion({ base: 1726700000, importe: 34534000 }, null), { controlado: false, coincide: null, esperado: null, aviso: null });
  const bien = controlRetencion({ base: 1726700000, importe: 34534000, alicuotaBp: 200 }, 200);
  assert.equal(bien.coincide, true);
  const mal = controlRetencion({ base: 1726700000, importe: 30000000 }, 200);
  assert.equal(mal.coincide, false);
  assert.match(mal.aviso, /no coincide/);
  const distinta = controlRetencion({ base: 100000, importe: 3000, alicuotaBp: 300 }, 200);
  assert.match(distinta.aviso, /distinta de la del parámetro/);
});

test('V13 · cuenta corriente ignora anulados y ordena por fecha', () => {
  const cc = cuentaCorriente({
    comprobantes: [
      { id: 'f2', clase: 'factura', total: 500, fecha: '2026-12-01', estado: 'emitido' },
      { id: 'f1', clase: 'factura', total: 1000, fecha: '2026-11-01', estado: 'emitido' },
      { id: 'fx', clase: 'factura', total: 999, fecha: '2026-11-15', estado: 'anulado' },
      { id: 'nd', clase: 'nota_debito', total: 100, fecha: '2026-12-05', estado: 'emitido' },
    ],
    cobranzas: [{ id: 'r1', fecha: '2026-11-10', total: 1000, estado: 'registrada' }, { id: 'rx', fecha: '2026-11-11', total: 5, estado: 'anulada' }],
  });
  assert.deepEqual(cc.movimientos.map((m) => m.id), ['f1', 'r1', 'f2', 'nd']);
  assert.equal(cc.saldo, 600);
});

test('V14 · antigüedad de la deuda por tramos', () => {
  const r = antiguedad([
    { saldo: 100, vencimiento: '2026-12-31' },
    { saldo: 200, vencimiento: '2026-11-20' },
    { saldo: 300, vencimiento: '2026-10-15' },
    { saldo: 400, vencimiento: '2026-09-15' },
    { saldo: 500, fecha: '2026-07-01' },
    { saldo: 0, vencimiento: '2020-01-01' },
  ], '2026-12-01');
  assert.deepEqual(r, { noVencido: 100, d1a30: 200, d31a60: 300, d61a90: 400, mas90: 500, total: 1500 });
});

test('V15 · estado del certificado según su factura', () => {
  assert.equal(estadoCertificadoSegunFactura(null), 'aprobado');
  assert.equal(estadoCertificadoSegunFactura({ estado: 'anulado', saldo: 0, cobrado: 0 }), 'aprobado');
  assert.equal(estadoCertificadoSegunFactura({ estado: 'emitido', saldo: 10, cobrado: 5 }), 'facturado');
  assert.equal(estadoCertificadoSegunFactura({ estado: 'emitido', saldo: 0, cobrado: 0 }), 'facturado', 'cancelada solo por NC no es cobrada');
  assert.equal(estadoCertificadoSegunFactura({ estado: 'emitido', saldo: 0, cobrado: 10 }), 'cobrado');
});
