import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAVES, asientoVenta, asientoCobranza, asientoCompra, asientoPago, asientoMovimiento, asientoRechazoCheque, asientoAnticipoCertificado,
  contraasiento, validarAsiento, mismasLineas, sumasYSaldos, mayor, estadoResultados, situacionPatrimonial,
  asientoRefundicion, asientoCierre, asientoApertura, compararCodigo,
} from '../js/core/asientos.js';

// Plan de cuentas DEMO (el mismo esquema que el del sistema) y configuración de imputaciones
const PLAN = [
  ['1', 'ACTIVO', 'activo', false], ['1.1', 'Activo corriente', 'activo', false], ['1.1.1.01', 'Caja', 'activo', true], ['1.1.1.02', 'Banco', 'activo', true],
  ['1.1.1.03', 'Valores a depositar', 'activo', true], ['1.1.2.01', 'Deudores', 'activo', true], ['1.1.2.02', 'Fondo de reparo a cobrar', 'activo', true],
  ['1.1.3.01', 'IVA CF', 'activo', true], ['1.1.3.02', 'Ret IVA', 'activo', true], ['1.1.3.03', 'Perc IVA', 'activo', true], ['1.1.3.04', 'Ret Ganancias', 'activo', true],
  ['1.1.3.05', 'Ret IIBB', 'activo', true], ['1.1.3.06', 'Perc IIBB', 'activo', true], ['1.1.3.07', 'Ret SUSS', 'activo', true], ['1.1.3.09', 'Otras perc/ret', 'activo', true],
  ['1.1.4.01', 'Anticipos a proveedores', 'activo', true],
  ['2', 'PASIVO', 'pasivo', false], ['2.1', 'Pasivo corriente', 'pasivo', false], ['2.1.1.01', 'Proveedores', 'pasivo', true], ['2.1.1.02', 'Cheques diferidos', 'pasivo', true],
  ['2.1.1.03', 'Anticipos de clientes', 'pasivo', true], ['2.1.2.01', 'IVA DF', 'pasivo', true], ['2.1.2.06', 'Ret practicadas', 'pasivo', true], ['2.1.2.07', 'Otros tributos', 'pasivo', true],
  ['3', 'PN', 'patrimonio_neto', false], ['3.1', 'Capital y resultados', 'patrimonio_neto', false], ['3.1.01', 'Capital', 'patrimonio_neto', true], ['3.1.02', 'Resultados no asignados', 'patrimonio_neto', true],
  ['3.1.03', 'Resultado del ejercicio', 'patrimonio_neto', true], ['3.1.04', 'Cuenta particular', 'patrimonio_neto', true],
  ['4', 'INGRESOS', 'ingreso', false], ['4.1', 'Servicios', 'ingreso', false], ['4.1.01', 'Certificados', 'ingreso', true], ['4.2', 'Otros', 'ingreso', false], ['4.2.02', 'Varios', 'ingreso', true],
  ['5', 'COSTOS', 'egreso', false], ['5.1', 'Directos', 'egreso', false], ['5.1.01', 'Materiales', 'egreso', true], ['5.1.02', 'Mano de obra', 'egreso', true],
  ['5.1.04', 'Subcontratos', 'egreso', true], ['5.1.06', 'Equipos', 'egreso', true], ['5.1.11', 'Otros costos', 'egreso', true],
  ['6', 'GASTOS', 'egreso', false], ['6.2', 'Financieros', 'egreso', false], ['6.2.01', 'Gastos bancarios', 'egreso', true], ['6.2.02', 'Imp déb/créd', 'egreso', true], ['6.2.06', 'Multas', 'egreso', true],
].map(([codigo, nombre, rubro, imputable]) => ({ id: `c${codigo}`, codigo, nombre, rubro, imputable }));
const id = (cod) => `c${cod}`;
const MAPA = {
  DEUDORES_POR_VENTAS: '1.1.2.01', VENTAS: '4.1.01', VENTAS_ANTICIPO: '2.1.1.03', MULTAS_CONTRACTUALES: '6.2.06', IVA_DEBITO_FISCAL: '2.1.2.01',
  OTROS_TRIBUTOS_VENTA: '2.1.2.07', ANTICIPOS_DE_CLIENTES: '2.1.1.03', VALORES_A_DEPOSITAR: '1.1.1.03', FONDO_REPARO_A_COBRAR: '1.1.2.02',
  RET_GANANCIAS_SUFRIDAS: '1.1.3.04', RET_IVA_SUFRIDAS: '1.1.3.02', RET_IIBB_CBA_SUFRIDAS: '1.1.3.05', RET_SUSS_SUFRIDAS: '1.1.3.07', RET_OTRAS_SUFRIDAS: '1.1.3.09',
  PROVEEDORES: '2.1.1.01', IVA_CREDITO_FISCAL: '1.1.3.01', PERC_IVA_SUFRIDAS: '1.1.3.03', PERC_IIBB_SUFRIDAS: '1.1.3.06', PERC_OTRAS_SUFRIDAS: '1.1.3.09',
  COSTO_MATERIALES: '5.1.01', COSTO_MANO_OBRA: '5.1.02', COSTO_EQUIPOS: '5.1.06', COSTO_SUBCONTRATOS: '5.1.04', COSTO_OTROS: '5.1.11',
  ANTICIPOS_A_PROVEEDORES: '1.1.4.01', CHEQUES_DIFERIDOS_A_PAGAR: '2.1.1.02', RET_PRACTICADAS_A_DEPOSITAR: '2.1.2.06', CAJA: '1.1.1.01', BANCOS: '1.1.1.02',
  GASTOS_BANCARIOS: '6.2.01', IMPUESTO_DEB_CRED: '6.2.02', IMPUESTOS_BANCARIOS: '6.2.01', APORTES_SOCIOS: '3.1.04', RETIROS_SOCIOS: '3.1.04', AJUSTES: '4.2.02',
  OTROS_MOVIMIENTOS: '4.2.02', RESULTADO_EJERCICIO: '3.1.03', RESULTADOS_NO_ASIGNADOS: '3.1.02',
};
const CFG = { cuentas: Object.fromEntries(Object.entries(MAPA).map(([k, v]) => [k, id(v)])), tesoreria: { gal: { cuenta_id: id('1.1.1.02'), tipo: 'banco' }, caja: { cuenta_id: null, tipo: 'caja' } } };
const saldo = (lineas, cod) => lineas.filter((l) => l.cuenta_id === id(cod)).reduce((s, l) => s + l.debe - l.haber, 0);

// Datos DEMO: la obra E55 de punta a punta
const FACTURA = { id: 'f1', fecha: '2026-11-23', clase: 'factura', origen: 'certificado', numero_formateado: '00003-00000125', cliente: 'CdS', contrato_id: 'E55', centro_costo_id: 'cc55',
  neto_gravado: 1726700000, exento: 0, no_gravado: 0, iva: 362607000, otros_tributos: 0, total: 2089307000 };
const NC_MULTA = { id: 'nc1', fecha: '2026-11-24', clase: 'nota_credito', origen: 'multas', numero_formateado: '00003-00000012', contrato_id: 'E55', centro_costo_id: 'cc55',
  neto_gravado: 50000000, exento: 0, no_gravado: 0, iva: 10500000, otros_tributos: 0, total: 60500000 };
const COBRANZA = { id: 'r1', fecha: '2026-12-04', numero: 1, medios: [{ medio: 'transferencia', importe: 1500000000, cuenta_id: 'gal' }, { medio: 'echeq', importe: 288807000 }],
  retenciones: [{ tipo: 'RET_GANANCIAS', importe: 34534000 }, { tipo: 'RET_IVA', importe: 72520000 }, { tipo: 'RET_IIBB_CBA', importe: 51801000 }],
  fondo_reparo: [{ contrato_id: 'E55', centro_costo_id: 'cc55', importe: 81145000 }], devoluciones_fr: [], aplicado: 2028807000, a_cuenta: 0 };
const COMPRA = { id: 'k1', fecha: '2026-11-18', clase: 'factura', numero_formateado: '00004-00001520', proveedor: 'Pinturerías', total: 214200000, credito_fiscal: 35700000,
  percepciones: [{ tipo: 'PERC_IVA', importe: 5100000 }, { tipo: 'PERC_IIBB_CBA', importe: 3400000 }],
  imputaciones: [{ contrato_id: 'E55', centro_costo_id: 'cc55', categoria: 'materiales', importe: 102000000 }, { contrato_id: 'E55', centro_costo_id: 'cc55', categoria: 'materiales', importe: 68000000 }] };
const COMPRA_C = { id: 'k2', fecha: '2026-11-19', clase: 'factura', total: 45000000, credito_fiscal: 0, percepciones: [],
  imputaciones: [{ contrato_id: 'E55', centro_costo_id: 'cc55', categoria: 'mano_obra', importe: 45000000 }] };
const PAGO = { id: 'p1', fecha: '2026-11-25', numero: 1, medios: [{ medio: 'cheque_tercero', importe: 40000000 }, { medio: 'echeq', importe: 174200000 }], retenciones: [], aplicado: 214200000, a_cuenta: 0 };
const PAGO_CAJA = { id: 'p2', fecha: '2026-11-26', numero: 2, medios: [{ medio: 'efectivo', importe: 50000000, cuenta_id: 'caja' }], retenciones: [], aplicado: 45000000, a_cuenta: 5000000 };
const MOVS = [
  { id: 'm1', fecha: '2026-11-20', tipo: 'egreso', categoria: 'transferencia', importe: 20000000, cuenta_id: 'gal', destino_cuenta_id: 'caja', descripcion: 'A caja' },
  { id: 'm2', fecha: '2026-11-20', tipo: 'ingreso', categoria: 'transferencia', importe: 20000000, cuenta_id: 'caja' },
  { id: 'm3', fecha: '2026-12-10', tipo: 'ingreso', categoria: 'cheque', cheque_tipo: 'recibido', importe: 288807000, cuenta_id: 'gal', descripcion: 'Acreditación echeq' },
  { id: 'm4', fecha: '2026-12-11', tipo: 'egreso', categoria: 'cheque', cheque_tipo: 'emitido', importe: 174200000, cuenta_id: 'gal', descripcion: 'Débito echeq propio' },
  { id: 'm5', fecha: '2026-11-30', tipo: 'egreso', categoria: 'gasto_bancario', importe: 1210000, cuenta_id: 'gal', descripcion: 'Comisión' },
  { id: 'm6', fecha: '2026-11-30', tipo: 'egreso', categoria: 'imp_deb_cred', importe: 7260, cuenta_id: 'gal', descripcion: 'Imp. d/c' },
  { id: 'm7', fecha: '2026-11-01', tipo: 'ingreso', categoria: 'aporte', importe: 300000000, cuenta_id: 'gal', descripcion: 'Aporte inicial' },
  { id: 'm8', fecha: '2026-12-01', tipo: 'ingreso', categoria: 'cobranza', importe: 1, cuenta_id: 'gal' },
];

test('A01 · factura de venta: deudores contra ventas e IVA débito, con el contrato en la línea de ventas', () => {
  const a = asientoVenta(FACTURA, CFG);
  assert.equal(a.ok, true, a.errores.join());
  assert.equal(saldo(a.lineas, '1.1.2.01'), 2089307000);
  assert.equal(saldo(a.lineas, '4.1.01'), -1726700000);
  assert.equal(saldo(a.lineas, '2.1.2.01'), -362607000);
  assert.equal(a.lineas.find((l) => l.cuenta_id === id('4.1.01')).contrato_id, 'E55');
  assert.equal(a.origen_tabla, 'comprobantes_venta');
});

test('A02 · nota de crédito por multa: invierte y va a "multas"', () => {
  const a = asientoVenta(NC_MULTA, CFG);
  assert.equal(a.ok, true);
  assert.equal(saldo(a.lineas, '1.1.2.01'), -60500000);
  assert.equal(saldo(a.lineas, '6.2.06'), 50000000);
  assert.equal(saldo(a.lineas, '2.1.2.01'), 10500000);
});

test('A03 · cobranza con transferencia, echeq, 3 retenciones y fondo de reparo', () => {
  const a = asientoCobranza(COBRANZA, CFG);
  assert.equal(a.ok, true, a.errores.join());
  assert.equal(a.debe, 2028807000);
  assert.equal(saldo(a.lineas, '1.1.1.02'), 1500000000);
  assert.equal(saldo(a.lineas, '1.1.1.03'), 288807000);
  assert.equal(saldo(a.lineas, '1.1.3.04') + saldo(a.lineas, '1.1.3.02') + saldo(a.lineas, '1.1.3.05'), 158855000);
  assert.equal(saldo(a.lineas, '1.1.2.02'), 81145000);
  assert.equal(saldo(a.lineas, '1.1.2.01'), -2028807000);
});

test('A04 · cobranza a cuenta y devolución de fondo de reparo', () => {
  const a = asientoCobranza({ id: 'r2', fecha: '2027-12-01', numero: 9, medios: [{ medio: 'efectivo', importe: 1000, cuenta_id: 'caja' }], retenciones: [],
    fondo_reparo: [], devoluciones_fr: [{ contrato_id: 'E55', importe: 700 }], aplicado: 0, a_cuenta: 300 }, CFG);
  assert.equal(a.ok, true, a.errores.join());
  assert.equal(saldo(a.lineas, '1.1.1.01'), 1000, 'la caja sin cuenta propia usa la cuenta configurada "Caja"');
  assert.equal(saldo(a.lineas, '1.1.2.02'), -700);
  assert.equal(saldo(a.lineas, '2.1.1.03'), -300);
});

test('A05 · compra imputada 60/40: costo por línea con contrato, IVA crédito y percepciones', () => {
  const a = asientoCompra(COMPRA, CFG);
  assert.equal(a.ok, true, a.errores.join());
  assert.equal(saldo(a.lineas, '5.1.01'), 170000000);
  assert.equal(a.lineas.filter((l) => l.cuenta_id === id('5.1.01')).length, 1, 'misma cuenta y contrato: una sola línea');
  assert.equal(saldo(a.lineas, '1.1.3.01'), 35700000);
  assert.equal(saldo(a.lineas, '1.1.3.03') + saldo(a.lineas, '1.1.3.06'), 8500000);
  assert.equal(saldo(a.lineas, '2.1.1.01'), -214200000);
});

test('A06 · factura C: todo al costo de mano de obra, sin IVA', () => {
  const a = asientoCompra(COMPRA_C, CFG);
  assert.equal(a.ok, true);
  assert.equal(saldo(a.lineas, '5.1.02'), 45000000);
  assert.equal(saldo(a.lineas, '1.1.3.01'), 0);
});

test('A07 · pagos: endoso de terceros, echeq propio, efectivo y anticipo', () => {
  const a = asientoPago(PAGO, CFG);
  assert.equal(a.ok, true, a.errores.join());
  assert.equal(saldo(a.lineas, '1.1.1.03'), -40000000);
  assert.equal(saldo(a.lineas, '2.1.1.02'), -174200000);
  const b = asientoPago(PAGO_CAJA, CFG);
  assert.equal(b.ok, true);
  assert.equal(saldo(b.lineas, '1.1.4.01'), 5000000);
  assert.equal(saldo(b.lineas, '1.1.1.01'), -50000000);
});

test('A08 · movimientos de tesorería: transferencia (una sola vez), cheques, gastos y aporte', () => {
  const as = MOVS.map((m) => asientoMovimiento(m, CFG));
  assert.equal(as[1], null, 'la pata que entra de la transferencia no lleva asiento propio');
  assert.equal(as[7], null, 'el movimiento de una cobranza ya está en el asiento de la cobranza');
  for (const a of as.filter(Boolean)) assert.equal(a.ok, true, a.errores.join());
  assert.equal(saldo(as[0].lineas, '1.1.1.01'), 20000000);
  assert.equal(saldo(as[2].lineas, '1.1.1.03'), -288807000, 'acreditación: sale de valores a depositar');
  assert.equal(saldo(as[3].lineas, '2.1.1.02'), 174200000, 'débito: se cancela el cheque diferido');
  assert.equal(saldo(as[6].lineas, '3.1.04'), -300000000);
});

test('A09 · rechazo de cheques: con y sin paso por el banco', () => {
  const conBanco = asientoMovimiento({ id: 'x', fecha: '2026-12-12', tipo: 'egreso', categoria: 'cheque', cheque_tipo: 'recibido', importe: 5000, cuenta_id: 'gal' }, CFG);
  assert.equal(saldo(conBanco.lineas, '1.1.2.01'), 5000, 'vuelve la deuda del cliente');
  assert.equal(saldo(conBanco.lineas, '1.1.1.02'), -5000);
  const sinBanco = asientoRechazoCheque({ id: 'ch', fecha_estado: '2026-12-12', tipo: 'recibido', numero: '77', importe: 5000 }, CFG);
  assert.equal(sinBanco.ok, true);
  assert.equal(saldo(sinBanco.lineas, '1.1.1.03'), -5000);
  const propio = asientoRechazoCheque({ id: 'ch2', fecha_estado: '2026-12-12', tipo: 'emitido', numero: 'P1', importe: 900 }, CFG);
  assert.equal(saldo(propio.lineas, '2.1.1.01'), -900, 'vuelve la deuda con el proveedor');
});

test('A10 · descuento de anticipo en un certificado', () => {
  const a = asientoAnticipoCertificado({ id: 'c1', fecha: '2026-11-20', numero: 1, contrato_id: 'E55', descuento_anticipo: 138136000 }, CFG);
  assert.equal(a.ok, true);
  assert.equal(saldo(a.lineas, '2.1.1.03'), 138136000);
  assert.equal(asientoAnticipoCertificado({ id: 'c2', descuento_anticipo: 0 }, CFG), null);
});

test('A11 · sin la cuenta configurada, el asiento no se puede registrar y dice cuál falta', () => {
  const sin = { ...CFG, cuentas: { ...CFG.cuentas, IVA_DEBITO_FISCAL: undefined } };
  const a = asientoVenta(FACTURA, sin);
  assert.equal(a.ok, false);
  assert.match(a.errores.join(), /IVA débito fiscal/);
  assert.equal(Object.keys(CLAVES).length >= 38, true);
});

test('A12 · validación de asientos manuales', () => {
  assert.match(validarAsiento([{ cuenta_id: 'a', debe: 100, haber: 0 }, { cuenta_id: 'b', debe: 0, haber: 90 }]).errores.join(), /no balancea/);
  assert.match(validarAsiento([{ cuenta_id: 'a', debe: 100, haber: 100 }, { cuenta_id: 'b', debe: 0, haber: 0 }]).errores.join(), /debe o al haber/);
  assert.match(validarAsiento([{ cuenta_id: 'a', debe: 100, haber: 0 }]).errores.join(), /dos líneas/);
  assert.match(validarAsiento([{ cuenta_id: '', debe: 1, haber: 0 }, { cuenta_id: 'b', debe: 0, haber: 1 }]).errores.join(), /falta la cuenta/);
  assert.equal(validarAsiento([{ cuenta_id: 'a', debe: 1, haber: 0 }, { cuenta_id: 'b', debe: 0, haber: 1 }]).ok, true);
});

test('A13 · anulación: el contraasiento deja la cuenta en cero', () => {
  const a = { ...asientoVenta(FACTURA, CFG), numero: 7 };
  const c = contraasiento(a, { motivo: 'Error de carga' });
  assert.equal(c.tipo, 'anulacion');
  assert.match(c.descripcion, /asiento N° 7: Error de carga/);
  const todas = [...a.lineas, ...c.lineas];
  for (const cod of ['1.1.2.01', '4.1.01', '2.1.2.01']) assert.equal(saldo(todas, cod), 0);
  assert.equal(mismasLineas(a.lineas, asientoVenta(FACTURA, CFG).lineas), true);
  assert.equal(mismasLineas(a.lineas, asientoVenta(FACTURA, { ...CFG, cuentas: { ...CFG.cuentas, VENTAS: id('4.2.02') } }).lineas), false);
});

// Todo el circuito DEMO
const TODOS = [asientoVenta(FACTURA, CFG), asientoVenta(NC_MULTA, CFG), asientoCobranza(COBRANZA, CFG), asientoCompra(COMPRA, CFG), asientoCompra(COMPRA_C, CFG),
  asientoPago(PAGO, CFG), asientoPago(PAGO_CAJA, CFG), ...MOVS.map((m) => asientoMovimiento(m, CFG)).filter(Boolean)];
const LINEAS = TODOS.flatMap((a) => a.lineas);

test('A14 · CRITERIO: con todos los comprobantes DEMO, el balance de sumas y saldos cuadra', () => {
  assert.ok(TODOS.every((a) => a.ok));
  const b = sumasYSaldos(LINEAS, PLAN);
  assert.equal(b.cuadra, true);
  assert.equal(b.totales.debe, b.totales.haber);
  assert.equal(b.totales.deudor, b.totales.acreedor);
  const activo = b.filas.find((f) => f.codigo === '1');
  assert.ok(activo.debe > 0, 'las cuentas madre acumulan a sus hijas');
});

test('A15 · estado de resultados y situación patrimonial', () => {
  const r = estadoResultados(LINEAS, PLAN);
  assert.equal(r.totalIngresos, 1726700000);
  assert.equal(r.totalEgresos, 170000000 + 45000000 + 50000000 + 1210000 + 7260);
  assert.equal(r.resultado, r.totalIngresos - r.totalEgresos);
  const s = situacionPatrimonial(LINEAS, PLAN);
  assert.equal(s.cuadra, true, `A ${s.totalActivo} vs P+PN ${s.totalPasivo + s.totalPatrimonio}`);
  assert.equal(s.resultadoPeriodo, r.resultado);
});

test('A16 · mayor de Banco con saldo anterior', () => {
  const movs = LINEAS.filter((l) => l.cuenta_id === id('1.1.1.02')).map((l, i) => ({ ...l, fecha: TODOS.find((a) => a.lineas.includes(l)).fecha, numero: i }));
  const m = mayor(movs, '2026-12-01', '2026-12-31', 'activo');
  assert.equal(m.anterior, 300000000 - 20000000 - 1210000 - 7260);
  assert.equal(m.saldo, m.anterior + 1500000000 + 288807000 - 174200000);
});

test('A17 · cierre de ejercicio: refundición, cierre que deja todo en cero y apertura', () => {
  const ref = asientoRefundicion(LINEAS, PLAN, id('3.1.03'), '2026-12-31');
  assert.equal(ref.ok, true, ref.errores.join());
  const tras = [...LINEAS, ...ref.lineas];
  assert.equal(estadoResultados(tras, PLAN).resultado, 0);
  const cie = asientoCierre(tras, PLAN, '2026-12-31');
  assert.equal(cie.ok, true);
  const fin = sumasYSaldos([...tras, ...cie.lineas], PLAN);
  assert.equal(fin.totales.deudor + fin.totales.acreedor, 0, 'después del cierre no queda saldo');
  const ap = asientoApertura(cie, id('3.1.03'), id('3.1.02'), '2027-01-01');
  assert.equal(ap.ok, true);
  assert.equal(ap.lineas.some((l) => l.cuenta_id === id('3.1.03')), false, 'el resultado pasa a "Resultados no asignados"');
  assert.equal(situacionPatrimonial(ap.lineas, PLAN).cuadra, true);
});

test('A18 · orden de códigos de cuenta', () => {
  assert.ok(compararCodigo('1.1.2', '1.1.10') < 0);
  assert.ok(compararCodigo('1.1', '1.1.1') < 0);
  assert.ok(compararCodigo('5.1.11', '5.1.2') > 0);
});
