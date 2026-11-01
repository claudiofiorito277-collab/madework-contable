import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saldosCuentas, validarTransferencia, impuestoDebCred, accionesCheque, alertasCheques, repartirRechazo,
  partirCSV, detectarSeparador, leerFecha, leerImporte, leerExtracto, sugerirConciliacion, resumenConciliacion,
  inicioSemana, flujoFondos,
} from '../js/core/tesoreria.js';

const CUENTAS = [{ id: 'gal', saldo_inicial: 100000000 }, { id: 'caja', saldo_inicial: 5000000 }];

test('T01 · transferencia entre cuentas: baja una, sube la otra, el total no cambia', () => {
  assert.equal(validarTransferencia({ origen: 'gal', destino: 'caja', importe: 2000000, fecha: '2026-11-20' }).ok, true);
  const movs = [
    { cuenta_id: 'gal', tipo: 'egreso', importe: 2000000, categoria: 'transferencia', fecha: '2026-11-20' },
    { cuenta_id: 'caja', tipo: 'ingreso', importe: 2000000, categoria: 'transferencia', fecha: '2026-11-20' },
  ];
  const s = saldosCuentas(CUENTAS, movs);
  assert.equal(s.gal.saldo, 98000000);
  assert.equal(s.caja.saldo, 7000000);
  assert.equal(s.gal.saldo + s.caja.saldo, 105000000);
});

test('T02 · transferencia: errores y aviso de descubierto', () => {
  assert.match(validarTransferencia({ origen: 'gal', destino: 'gal', importe: 1, fecha: '2026-11-20' }).errores.join(), /distintas/);
  assert.match(validarTransferencia({ origen: 'gal', destino: 'caja', importe: 0, fecha: '2026-11-20' }).errores.join(), /mayor a cero/);
  assert.match(validarTransferencia({ origen: 'gal', destino: 'caja', importe: 500, fecha: '2026-11-20' }, 100).advertencias.join(), /descubierto/);
});

test('T03 · saldos: anulados no cuentan, corte por fecha y saldo conciliado', () => {
  const movs = [
    { cuenta_id: 'gal', tipo: 'ingreso', importe: 1000, fecha: '2026-11-05', conciliado: true },
    { cuenta_id: 'gal', tipo: 'egreso', importe: 300, fecha: '2026-11-10' },
    { cuenta_id: 'gal', tipo: 'egreso', importe: 999, fecha: '2026-11-10', estado: 'anulado' },
  ];
  const s = saldosCuentas([{ id: 'gal', saldo_inicial: 0 }], movs);
  assert.equal(s.gal.saldo, 700);
  assert.equal(s.gal.conciliado, 1000);
  assert.equal(saldosCuentas([{ id: 'gal', saldo_inicial: 0 }], movs, '2026-11-06').gal.saldo, 1000);
});

test('T04 · impuesto a los débitos y créditos (0,6 %): no en transferencias propias', () => {
  assert.equal(impuestoDebCred(835722800, 60, 'cobranza'), 5014337);
  assert.equal(impuestoDebCred(100000, 60, 'transferencia'), 0);
  assert.equal(impuestoDebCred(100000, null, 'pago'), null, 'sin alícuota definida no se calcula');
});

test('T05 · acciones posibles según el estado del cheque', () => {
  assert.deepEqual(accionesCheque({ tipo: 'recibido', estado: 'en_cartera' }), ['depositar', 'acreditar', 'rechazar']);
  assert.deepEqual(accionesCheque({ tipo: 'recibido', estado: 'endosado' }), []);
  assert.deepEqual(accionesCheque({ tipo: 'emitido', estado: 'emitido' }), ['debitar', 'rechazar']);
  assert.deepEqual(accionesCheque({ tipo: 'emitido', estado: 'debitado' }), []);
});

test('T06 · alertas de cheques: depositar a tiempo (30 días) y fondos para los propios', () => {
  const a = alertasCheques([
    { id: 1, tipo: 'recibido', estado: 'en_cartera', fecha_pago: '2026-11-22' },
    { id: 2, tipo: 'recibido', estado: 'en_cartera', fecha_pago: '2026-10-01' },
    { id: 3, tipo: 'recibido', estado: 'en_cartera', fecha_pago: '2026-12-30' },
    { id: 4, tipo: 'emitido', estado: 'emitido', fecha_pago: '2026-11-21' },
    { id: 5, tipo: 'recibido', estado: 'depositado', fecha_pago: '2026-11-01' },
  ], '2026-11-20');
  assert.deepEqual(a.map((x) => x.cheque.id), [1, 2, 4]);
  assert.match(a[1].texto, /vencido para depositar desde el 2026-10-31/);
  assert.match(a[2].texto, /se debita en 1 día/);
});

test('T07 · rechazo de cheque: reabre la deuda desde la última factura aplicada', () => {
  const r = repartirRechazo(500000, [{ comprobante_id: 'f1', importe: 400000 }, { comprobante_id: 'f2', importe: 300000 }], 0);
  assert.deepEqual(r.reversiones, [{ comprobante_id: 'f2', importe: 300000 }, { comprobante_id: 'f1', importe: 200000 }]);
  assert.equal(r.sinCubrir, 0);
  const c = repartirRechazo(500000, [{ comprobante_id: 'f1', importe: 400000 }], 150000);
  assert.equal(c.deCuenta, 150000);
  assert.deepEqual(c.reversiones, [{ comprobante_id: 'f1', importe: 350000 }]);
});

test('T08 · CSV: comillas, separador y formatos argentinos', () => {
  assert.deepEqual(partirCSV('"12/11/2026";"Transf. ""CDS""";"-1.234,50"', ';'), ['12/11/2026', 'Transf. "CDS"', '-1.234,50']);
  assert.equal(detectarSeparador('Fecha;Concepto;Importe\n01/11/2026;x;10'), ';');
  assert.equal(leerFecha('5/11/26'), '2026-11-05');
  assert.equal(leerFecha('2026-11-05'), '2026-11-05');
  assert.equal(leerFecha(46330), '2026-11-04', 'número de serie de Excel');
  assert.equal(leerFecha('31/13/2026'), null);
  assert.equal(leerImporte('1.234,56'), 123456);
  assert.equal(leerImporte('(1.234,56)'), -123456);
  assert.equal(leerImporte('1234.56-', '.'), -123456);
  assert.equal(leerImporte(-50.1), -5010);
});

test('T09 · extracto con débito y crédito separados y columnas por nombre', () => {
  const filas = [['Banco Galicia - movimientos'], ['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo'],
    ['17/11/2026', 'TRANSF CAMINOS SIERRAS', '', '6.687.428,00', ''], ['18/11/2026', 'COMISION MANT CTA', '12.100,00', '', ''],
    ['', '', '', '', ''], ['xx', 'basura', '1', '', '']];
  const r = leerExtracto(filas, { fila_encabezado: 2, col_fecha: 'Fecha', col_descripcion: 'descripción', col_debito: 'Débito', col_credito: 'Crédito', decimal: ',' });
  assert.deepEqual(r.lineas.map((l) => l.importe), [668742800, -1210000]);
  assert.match(r.errores.join(), /fecha inválida "xx"/);
  assert.match(leerExtracto(filas, { fila_encabezado: 2, col_fecha: 'Fecha' }).errores.join(), /columna de importe/);
});

test('T10 · conciliación con diferencias: comisión sin registrar, cheque no debitado e importe distinto', () => {
  const lineas = [
    { id: 'l1', fecha: '2026-11-17', importe: 668742800 },   // cobranza: coincide
    { id: 'l2', fecha: '2026-11-18', importe: -1210000 },    // comisión que no está en el sistema
    { id: 'l3', fecha: '2026-11-19', importe: -214200000 },  // pago al proveedor: coincide (fecha corrida 1 día)
    { id: 'l4', fecha: '2026-11-19', importe: -50000 },      // importe distinto al del sistema (50.001)
  ];
  const movs = [
    { id: 'm1', fecha: '2026-11-17', tipo: 'ingreso', importe: 668742800 },
    { id: 'm2', fecha: '2026-11-18', tipo: 'egreso', importe: 214200000 },
    { id: 'm3', fecha: '2026-11-19', tipo: 'egreso', importe: 50001 },
    { id: 'm4', fecha: '2026-11-25', tipo: 'egreso', importe: 30000000 },   // cheque propio todavía no debitado
    { id: 'm5', fecha: '2026-11-01', tipo: 'ingreso', importe: 1, conciliado: true },
  ];
  const s = sugerirConciliacion(lineas, movs);
  assert.deepEqual(s.pares.map((p) => [p.linea_id, p.movimiento_id]).sort(), [['l1', 'm1'], ['l3', 'm2']]);
  assert.deepEqual(s.lineasSinPar.map((l) => l.id).sort(), ['l2', 'l4']);
  assert.deepEqual(s.movimientosSinPar.map((m) => m.id).sort(), ['m3', 'm4']);
  // Saldo según banco vs sistema: la diferencia queda explicada por lo pendiente
  const saldoSistema = 668742800 - 214200000 - 50001 - 30000000;
  const saldoBanco = 668742800 - 1210000 - 214200000 - 50000;
  const r = resumenConciliacion({ saldoBanco, saldoSistema, lineasPendientes: s.lineasSinPar, movimientosPendientes: s.movimientosSinPar });
  assert.equal(r.cuadra, true);
  assert.equal(r.enBancoNoEnSistema, -1260000);
  assert.equal(r.enSistemaNoEnBanco, -30050001);
  assert.equal(r.sinExplicar, 0);
});

test('T11 · conciliación: un movimiento no se usa dos veces y gana la fecha más cercana', () => {
  const s = sugerirConciliacion(
    [{ id: 'a', fecha: '2026-11-10', importe: -1000 }, { id: 'b', fecha: '2026-11-12', importe: -1000 }],
    [{ id: 'x', fecha: '2026-11-12', tipo: 'egreso', importe: 1000 }, { id: 'y', fecha: '2026-11-09', tipo: 'egreso', importe: 1000 }]);
  assert.deepEqual(s.pares.map((p) => `${p.linea_id}${p.movimiento_id}`).sort(), ['ay', 'bx']);
  const lejos = sugerirConciliacion([{ id: 'a', fecha: '2026-11-01', importe: 5 }], [{ id: 'x', fecha: '2026-11-20', tipo: 'ingreso', importe: 5 }]);
  assert.equal(lejos.pares.length, 0, 'fuera de la tolerancia de días no se sugiere');
});

test('T12 · flujo de fondos real y proyectado por semana', () => {
  assert.equal(inicioSemana('2026-11-19'), '2026-11-16');
  const f = flujoFondos({
    saldoInicial: 1000000,
    movimientos: [
      { fecha: '2026-10-30', tipo: 'ingreso', importe: 500000 },
      { fecha: '2026-11-03', tipo: 'egreso', importe: 200000 },
      { fecha: '2026-11-04', tipo: 'egreso', importe: 9999, categoria: 'transferencia' },
      { fecha: '2026-11-10', tipo: 'ingreso', importe: 800000 },
    ],
    cobrar: [{ fecha: '2026-11-20', importe: 3000000 }, { fecha: '2026-11-01', importe: 100000 }],
    pagar: [{ fecha: '2026-11-25', importe: 2000000 }],
  }, { desde: '2026-11-02', hasta: '2026-11-29', hoy: '2026-11-11', agrupar: 'semana' });
  assert.equal(f.saldoInicial, 1500000);
  assert.deepEqual(f.periodos.map((p) => p.clave), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  assert.deepEqual(f.periodos.map((p) => p.saldo), [1300000, 2100000, 2100000, 2100000]);
  assert.equal(f.periodos[1].cobrar, 100000, 'lo atrasado entra en la semana de hoy');
  assert.deepEqual(f.periodos.map((p) => p.saldoProyectado), [1300000, 2200000, 5200000, 3200000]);
});

test('T13 · flujo de fondos por mes', () => {
  const f = flujoFondos({ movimientos: [{ fecha: '2026-12-05', tipo: 'ingreso', importe: 10 }], cobrar: [{ fecha: '2027-01-10', importe: 5 }] },
    { desde: '2026-11-01', hasta: '2027-01-31', hoy: '2026-11-01', agrupar: 'mes' });
  assert.deepEqual(f.periodos.map((p) => [p.clave, p.saldoProyectado]), [['2026-11', 0], ['2026-12', 10], ['2027-01', 15]]);
});
