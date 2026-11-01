// Lógica contable pura: arma los asientos de cada comprobante a partir de la
// configuración de imputaciones (no hay cuentas fijas en el código), los valida,
// y calcula los libros (sumas y saldos, mayor, resultados, situación patrimonial)
// y los asientos de cierre y apertura. Importes en CENTAVOS enteros.
// Se prueba con node --test (tests/asientos.test.js).

// Claves de la configuración de imputaciones (tabla imputaciones_contables)
export const CLAVES = {
  DEUDORES_POR_VENTAS: 'Deudores por ventas (clientes)',
  VENTAS: 'Ventas / certificados de obra',
  VENTAS_ANTICIPO: 'Anticipo financiero facturado',
  MULTAS_CONTRACTUALES: 'Multas descontadas por nota de crédito',
  IVA_DEBITO_FISCAL: 'IVA débito fiscal',
  OTROS_TRIBUTOS_VENTA: 'Otros tributos facturados',
  ANTICIPOS_DE_CLIENTES: 'Anticipos de clientes / cobros a cuenta',
  VALORES_A_DEPOSITAR: 'Cheques y echeqs de terceros en cartera',
  FONDO_REPARO_A_COBRAR: 'Fondo de reparo retenido por el cliente',
  RET_GANANCIAS_SUFRIDAS: 'Retenciones de Ganancias sufridas',
  RET_IVA_SUFRIDAS: 'Retenciones de IVA sufridas',
  RET_IIBB_CBA_SUFRIDAS: 'Retenciones de IIBB Córdoba sufridas',
  RET_SUSS_SUFRIDAS: 'Retenciones de SUSS sufridas',
  RET_OTRAS_SUFRIDAS: 'Otras retenciones sufridas',
  PROVEEDORES: 'Proveedores',
  IVA_CREDITO_FISCAL: 'IVA crédito fiscal',
  PERC_IVA_SUFRIDAS: 'Percepciones de IVA sufridas',
  PERC_IIBB_SUFRIDAS: 'Percepciones de IIBB sufridas',
  PERC_OTRAS_SUFRIDAS: 'Otras percepciones sufridas',
  COSTO_MATERIALES: 'Costo: materiales y pinturas',
  COSTO_MANO_OBRA: 'Costo: mano de obra',
  COSTO_EQUIPOS: 'Costo: equipos',
  COSTO_SUBCONTRATOS: 'Costo: subcontratos',
  COSTO_OTROS: 'Costo: otros',
  ANTICIPOS_A_PROVEEDORES: 'Anticipos a proveedores',
  CHEQUES_DIFERIDOS_A_PAGAR: 'Cheques propios diferidos emitidos',
  RET_PRACTICADAS_A_DEPOSITAR: 'Retenciones practicadas a depositar',
  CAJA: 'Caja (si la cuenta de tesorería no tiene cuenta contable)',
  BANCOS: 'Bancos (si la cuenta de tesorería no tiene cuenta contable)',
  GASTOS_BANCARIOS: 'Gastos bancarios',
  IMPUESTO_DEB_CRED: 'Impuesto a los débitos y créditos',
  IMPUESTOS_BANCARIOS: 'Otros impuestos bancarios',
  APORTES_SOCIOS: 'Aportes del titular',
  RETIROS_SOCIOS: 'Retiros del titular',
  AJUSTES: 'Ajustes y diferencias',
  OTROS_MOVIMIENTOS: 'Otros ingresos y egresos de caja',
  RESULTADO_EJERCICIO: 'Resultado del ejercicio',
  RESULTADOS_NO_ASIGNADOS: 'Resultados no asignados',
};

const RET_SUFRIDA = { RET_GANANCIAS: 'RET_GANANCIAS_SUFRIDAS', RET_IVA: 'RET_IVA_SUFRIDAS', RET_IIBB_CBA: 'RET_IIBB_CBA_SUFRIDAS', RET_SUSS: 'RET_SUSS_SUFRIDAS', OTRA: 'RET_OTRAS_SUFRIDAS' };
const PERCEPCION = { PERC_IVA: 'PERC_IVA_SUFRIDAS', PERC_IIBB_CBA: 'PERC_IIBB_SUFRIDAS', PERC_IIBB_OTRAS: 'PERC_IIBB_SUFRIDAS', PERC_GANANCIAS: 'PERC_OTRAS_SUFRIDAS', OTRA: 'PERC_OTRAS_SUFRIDAS' };
const COSTO = { materiales: 'COSTO_MATERIALES', mano_obra: 'COSTO_MANO_OBRA', equipos: 'COSTO_EQUIPOS', subcontratos: 'COSTO_SUBCONTRATOS', otros: 'COSTO_OTROS' };
const MOV_MANUAL = { gasto_bancario: 'GASTOS_BANCARIOS', impuesto_bancario: 'IMPUESTOS_BANCARIOS', imp_deb_cred: 'IMPUESTO_DEB_CRED', aporte: 'APORTES_SOCIOS', retiro: 'RETIROS_SOCIOS', ajuste: 'AJUSTES', otro: 'OTROS_MOVIMIENTOS' };

// ---------------------------------------------------------------- Armado de líneas

/**
 * Ayudante para armar un asiento. cfg: { cuentas: { CLAVE: cuenta_id }, tesoreria: { cuenta_tes_id: { cuenta_id, tipo } } }
 * Junta las líneas de la misma cuenta, contrato, centro y lado.
 */
function armador(cfg) {
  const lineas = [];
  const faltan = new Set();
  const cuenta = (clave) => {
    const c = cfg.cuentas?.[clave];
    if (!c) faltan.add(clave);
    return c ?? null;
  };
  const cuentaTes = (id) => {
    const t = cfg.tesoreria?.[id];
    if (t?.cuenta_id) return t.cuenta_id;
    return cuenta(t?.tipo === 'caja' ? 'CAJA' : 'BANCOS');
  };
  const add = (lado, cuentaId, importe, extra = {}) => {
    if (!importe) return;
    if (importe < 0) { add(lado === 'debe' ? 'haber' : 'debe', cuentaId, -importe, extra); return; }
    const k = [cuentaId, extra.contrato_id ?? '', extra.centro_costo_id ?? '', lado].join('|');
    const ya = lineas.find((l) => l._k === k);
    if (ya) { ya[lado] += importe; return; }
    lineas.push({ _k: k, cuenta_id: cuentaId, debe: lado === 'debe' ? importe : 0, haber: lado === 'haber' ? importe : 0,
      contrato_id: extra.contrato_id ?? null, centro_costo_id: extra.centro_costo_id ?? null, detalle: extra.detalle ?? null });
  };
  return {
    cuenta, cuentaTes,
    debe: (c, imp, x) => add('debe', c, imp, x),
    haber: (c, imp, x) => add('haber', c, imp, x),
    fin: (cab) => {
      const ls = lineas.map(({ _k, ...l }) => l);
      return { ...cab, lineas: ls, faltan: [...faltan], ...validarAsiento(ls, { faltan: [...faltan] }) };
    },
  };
}

/** Intercambia debe y haber (para notas de crédito). */
export function invertir(lineas) {
  return lineas.map((l) => ({ ...l, debe: l.haber, haber: l.debe }));
}

/** Debe = haber, importes enteros no negativos, cada línea en un solo lado, cuenta asignada. */
export function validarAsiento(lineas = [], { faltan = [] } = {}) {
  const errores = [];
  if (faltan.length) errores.push(`Falta configurar la cuenta para: ${faltan.map((f) => CLAVES[f] ?? f).join(', ')}.`);
  if (lineas.length < 2) errores.push('Un asiento necesita al menos dos líneas.');
  let debe = 0; let haber = 0;
  lineas.forEach((l, i) => {
    if (!Number.isSafeInteger(l.debe) || !Number.isSafeInteger(l.haber) || l.debe < 0 || l.haber < 0) errores.push(`Línea ${i + 1}: importe inválido.`);
    else if ((l.debe > 0) === (l.haber > 0)) errores.push(`Línea ${i + 1}: tiene que ir al debe o al haber (no a los dos, ni vacía).`);
    if (!l.cuenta_id && !faltan.length) errores.push(`Línea ${i + 1}: falta la cuenta.`);
    debe += l.debe || 0; haber += l.haber || 0;
  });
  if (debe !== haber) errores.push(`El asiento no balancea: debe ${debe / 100} y haber ${haber / 100}.`);
  return { ok: errores.length === 0, errores, debe, haber };
}

// ---------------------------------------------------------------- Generadores por comprobante

/**
 * Factura, nota de débito o nota de crédito de venta.
 * v: { id, fecha, clase, origen, numero_formateado, tipo_descripcion, cliente, contrato_id, centro_costo_id,
 *      neto_gravado, exento, no_gravado, iva, otros_tributos, total }
 */
export function asientoVenta(v, cfg) {
  const a = armador(cfg);
  const ctx = { contrato_id: v.contrato_id ?? null, centro_costo_id: v.centro_costo_id ?? null };
  const claveIngreso = v.clase === 'nota_credito' && v.origen === 'multas' ? 'MULTAS_CONTRACTUALES' : v.origen === 'anticipo' ? 'VENTAS_ANTICIPO' : 'VENTAS';
  a.debe(a.cuenta('DEUDORES_POR_VENTAS'), v.total);
  a.haber(a.cuenta(claveIngreso), v.neto_gravado + v.exento + v.no_gravado, ctx);
  a.haber(a.cuenta('IVA_DEBITO_FISCAL'), v.iva);
  a.haber(a.cuenta('OTROS_TRIBUTOS_VENTA'), v.otros_tributos);
  const r = a.fin({ origen_tabla: 'comprobantes_venta', origen_id: v.id, evento: 'alta', fecha: v.fecha,
    descripcion: `${v.tipo_descripcion ?? 'Comprobante'} ${v.numero_formateado ?? ''} · ${v.cliente ?? ''}`.trim() });
  if (v.clase === 'nota_credito') r.lineas = invertir(r.lineas);
  return r;
}

/**
 * Cobranza (recibo).
 * c: { id, fecha, numero, cliente, medios: [{ medio, importe, cuenta_id }], retenciones: [{ tipo, importe }],
 *      fondo_reparo: [{ contrato_id, centro_costo_id, importe }], devoluciones_fr: [{ contrato_id, centro_costo_id, importe }], aplicado, a_cuenta }
 */
export function asientoCobranza(c, cfg) {
  const a = armador(cfg);
  for (const m of c.medios ?? []) {
    if (['echeq', 'cheque'].includes(m.medio)) a.debe(a.cuenta('VALORES_A_DEPOSITAR'), m.importe);
    else a.debe(a.cuentaTes(m.cuenta_id), m.importe);
  }
  for (const r of c.retenciones ?? []) a.debe(a.cuenta(RET_SUFRIDA[r.tipo] ?? 'RET_OTRAS_SUFRIDAS'), r.importe);
  for (const f of c.fondo_reparo ?? []) a.debe(a.cuenta('FONDO_REPARO_A_COBRAR'), f.importe, { contrato_id: f.contrato_id, centro_costo_id: f.centro_costo_id });
  a.haber(a.cuenta('DEUDORES_POR_VENTAS'), c.aplicado);
  for (const d of c.devoluciones_fr ?? []) a.haber(a.cuenta('FONDO_REPARO_A_COBRAR'), d.importe, { contrato_id: d.contrato_id, centro_costo_id: d.centro_costo_id });
  a.haber(a.cuenta('ANTICIPOS_DE_CLIENTES'), c.a_cuenta);
  return a.fin({ origen_tabla: 'cobranzas', origen_id: c.id, evento: 'alta', fecha: c.fecha, descripcion: `Recibo N° ${c.numero} · ${c.cliente ?? ''}`.trim() });
}

/**
 * Comprobante de compra. El costo se imputa por línea de imputación (contrato, centro, categoría).
 * k: { id, fecha, clase, numero_formateado, tipo_descripcion, proveedor, total, credito_fiscal,
 *      percepciones: [{ tipo, importe }], imputaciones: [{ contrato_id, centro_costo_id, categoria, importe }] }
 */
export function asientoCompra(k, cfg) {
  const a = armador(cfg);
  for (const i of k.imputaciones ?? []) {
    a.debe(a.cuenta(COSTO[i.categoria] ?? 'COSTO_OTROS'), i.importe, { contrato_id: i.contrato_id, centro_costo_id: i.centro_costo_id });
  }
  a.debe(a.cuenta('IVA_CREDITO_FISCAL'), k.credito_fiscal);
  for (const p of k.percepciones ?? []) a.debe(a.cuenta(PERCEPCION[p.tipo] ?? 'PERC_OTRAS_SUFRIDAS'), p.importe);
  a.haber(a.cuenta('PROVEEDORES'), k.total);
  const r = a.fin({ origen_tabla: 'comprobantes_compra', origen_id: k.id, evento: 'alta', fecha: k.fecha,
    descripcion: `${k.tipo_descripcion ?? 'Compra'} ${k.numero_formateado ?? ''} · ${k.proveedor ?? ''}`.trim() });
  if (k.clase === 'nota_credito') r.lineas = invertir(r.lineas);
  return r;
}

/**
 * Pago (orden de pago).
 * p: { id, fecha, numero, proveedor, medios: [{ medio, importe, cuenta_id }], retenciones: [{ importe }], aplicado, a_cuenta }
 */
export function asientoPago(p, cfg) {
  const a = armador(cfg);
  a.debe(a.cuenta('PROVEEDORES'), p.aplicado);
  a.debe(a.cuenta('ANTICIPOS_A_PROVEEDORES'), p.a_cuenta);
  for (const m of p.medios ?? []) {
    if (m.medio === 'cheque_tercero') a.haber(a.cuenta('VALORES_A_DEPOSITAR'), m.importe);
    else if (['echeq', 'cheque'].includes(m.medio)) a.haber(a.cuenta('CHEQUES_DIFERIDOS_A_PAGAR'), m.importe);
    else a.haber(a.cuentaTes(m.cuenta_id), m.importe);
  }
  for (const r of p.retenciones ?? []) a.haber(a.cuenta('RET_PRACTICADAS_A_DEPOSITAR'), r.importe);
  return a.fin({ origen_tabla: 'pagos', origen_id: p.id, evento: 'alta', fecha: p.fecha, descripcion: `Orden de pago N° ${p.numero} · ${p.proveedor ?? ''}`.trim() });
}

/**
 * Movimiento de tesorería que no viene de una cobranza o un pago (esos ya están en su asiento):
 * transferencias (se contabiliza la pata que sale), cheques (acreditación, débito y rechazos) y manuales.
 * m: { id, fecha, tipo, categoria, importe, cuenta_id, descripcion, destino_cuenta_id (transferencia), cheque_tipo ('recibido'|'emitido') }
 * Devuelve null si el movimiento no lleva asiento propio.
 */
export function asientoMovimiento(m, cfg) {
  if (['cobranza', 'pago'].includes(m.categoria)) return null;
  if (m.categoria === 'transferencia' && m.tipo === 'ingreso') return null;
  const a = armador(cfg);
  const caja = a.cuentaTes(m.cuenta_id);
  let contra;
  if (m.categoria === 'transferencia') {
    contra = a.cuentaTes(m.destino_cuenta_id);
    a.debe(contra, m.importe); a.haber(caja, m.importe);
  } else {
    if (m.categoria === 'cheque') {
      if (m.cheque_tipo === 'recibido') contra = a.cuenta(m.tipo === 'ingreso' ? 'VALORES_A_DEPOSITAR' : 'DEUDORES_POR_VENTAS');      // acreditación / rechazo
      else contra = a.cuenta(m.tipo === 'egreso' ? 'CHEQUES_DIFERIDOS_A_PAGAR' : 'PROVEEDORES');                                     // débito / rechazo
    } else contra = a.cuenta(MOV_MANUAL[m.categoria] ?? 'OTROS_MOVIMIENTOS');
    if (m.tipo === 'ingreso') { a.debe(caja, m.importe); a.haber(contra, m.importe); } else { a.debe(contra, m.importe); a.haber(caja, m.importe); }
  }
  return a.fin({ origen_tabla: 'movimientos_tesoreria', origen_id: m.id, evento: 'alta', fecha: m.fecha, descripcion: m.descripcion ?? 'Movimiento de tesorería' });
}

/**
 * Rechazo de un cheque que nunca pasó por la cuenta (estaba en cartera o emitido sin debitar):
 * vuelve la deuda y se da de baja el valor.
 * ch: { id, fecha_estado, tipo, numero, importe, cliente, proveedor }
 */
export function asientoRechazoCheque(ch, cfg) {
  const a = armador(cfg);
  if (ch.tipo === 'recibido') { a.debe(a.cuenta('DEUDORES_POR_VENTAS'), ch.importe); a.haber(a.cuenta('VALORES_A_DEPOSITAR'), ch.importe); }
  else { a.debe(a.cuenta('CHEQUES_DIFERIDOS_A_PAGAR'), ch.importe); a.haber(a.cuenta('PROVEEDORES'), ch.importe); }
  return a.fin({ origen_tabla: 'cheques', origen_id: ch.id, evento: 'rechazo', fecha: ch.fecha_estado,
    descripcion: `Rechazo cheque N° ${ch.numero} · ${ch.cliente ?? ch.proveedor ?? ''}`.trim() });
}

/**
 * Descuento del anticipo financiero en un certificado facturado: el anticipo ya cobrado
 * se aplica como ingreso de la obra (A CONFIRMAR CON CONTADOR).
 * c: { id, fecha, numero, contrato_codigo, contrato_id, centro_costo_id, descuento_anticipo }
 */
export function asientoAnticipoCertificado(c, cfg) {
  if (!c.descuento_anticipo) return null;
  const a = armador(cfg);
  const ctx = { contrato_id: c.contrato_id, centro_costo_id: c.centro_costo_id };
  a.debe(a.cuenta('VENTAS_ANTICIPO'), c.descuento_anticipo);
  a.haber(a.cuenta('VENTAS'), c.descuento_anticipo, ctx);
  return a.fin({ origen_tabla: 'certificados', origen_id: c.id, evento: 'anticipo', fecha: c.fecha,
    descripcion: `Descuento de anticipo · certificado N° ${c.numero} · ${c.contrato_codigo ?? ''}`.trim() });
}

/** Contraasiento: mismas líneas con debe y haber invertidos. */
export function contraasiento(asiento, { fecha, motivo }) {
  return {
    fecha: fecha ?? asiento.fecha, tipo: 'anulacion', descripcion: `Anulación del asiento N° ${asiento.numero}: ${motivo}`,
    lineas: invertir(asiento.lineas.map(({ cuenta_id, debe, haber, contrato_id, centro_costo_id, detalle }) => ({ cuenta_id, debe, haber, contrato_id, centro_costo_id, detalle }))),
  };
}

/** ¿Cambiaron las líneas? (para regenerar asientos al cambiar la configuración) */
export function mismasLineas(a, b) {
  const norm = (ls) => ls.map((l) => [l.cuenta_id, l.debe, l.haber, l.contrato_id ?? '', l.centro_costo_id ?? ''].join('|')).sort().join(';');
  return norm(a) === norm(b);
}

// ---------------------------------------------------------------- Libros

/** Totales por cuenta. lineas: [{ cuenta_id, debe, haber }] */
export function saldosPorCuenta(lineas = []) {
  const r = {};
  for (const l of lineas) {
    const x = (r[l.cuenta_id] ??= { debe: 0, haber: 0 });
    x.debe += l.debe; x.haber += l.haber;
  }
  return r;
}

const naturaleza = (rubro) => (['activo', 'egreso'].includes(rubro) ? 1 : -1);

/**
 * Balance de sumas y saldos. cuentas: [{ id, codigo, nombre, rubro, imputable }]
 * Incluye las cuentas madre con los totales de sus hijas.
 */
export function sumasYSaldos(lineas, cuentas) {
  const s = saldosPorCuenta(lineas);
  const filas = cuentas.map((c) => {
    const hijas = cuentas.filter((h) => h.imputable && (h.codigo === c.codigo || h.codigo.startsWith(`${c.codigo}.`)));
    const debe = hijas.reduce((t, h) => t + (s[h.id]?.debe ?? 0), 0);
    const haber = hijas.reduce((t, h) => t + (s[h.id]?.haber ?? 0), 0);
    const saldo = debe - haber;
    return { ...c, debe, haber, deudor: saldo > 0 ? saldo : 0, acreedor: saldo < 0 ? -saldo : 0 };
  }).filter((f) => f.debe || f.haber).sort((a, b) => compararCodigo(a.codigo, b.codigo));
  const imp = filas.filter((f) => f.imputable);
  const tot = imp.reduce((t, f) => ({ debe: t.debe + f.debe, haber: t.haber + f.haber, deudor: t.deudor + f.deudor, acreedor: t.acreedor + f.acreedor }), { debe: 0, haber: 0, deudor: 0, acreedor: 0 });
  return { filas, totales: tot, cuadra: tot.debe === tot.haber && tot.deudor === tot.acreedor };
}

export function compararCodigo(a, b) {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/**
 * Mayor de una cuenta: saldo anterior al período y movimientos con saldo acumulado.
 * movs: [{ fecha, numero, descripcion, debe, haber, asiento_id }] de esa cuenta (todas las fechas)
 */
export function mayor(movs = [], desde, hasta, rubro = 'activo') {
  const signo = naturaleza(rubro);
  const orden = [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.numero ?? 0) - (b.numero ?? 0));
  let saldo = 0;
  for (const m of orden) if (desde && m.fecha < desde) saldo += (m.debe - m.haber) * signo;
  const anterior = saldo;
  const lineas = [];
  for (const m of orden) {
    if ((desde && m.fecha < desde) || (hasta && m.fecha > hasta)) continue;
    saldo += (m.debe - m.haber) * signo;
    lineas.push({ ...m, saldo });
  }
  return { anterior, lineas, saldo, debe: lineas.reduce((t, l) => t + l.debe, 0), haber: lineas.reduce((t, l) => t + l.haber, 0) };
}

/** Agrupa por cuenta madre de un nivel dado, con el saldo en su sentido natural. */
function agrupar(cuentas, s, rubros, nivel) {
  const imputables = cuentas.filter((c) => c.imputable && rubros.includes(c.rubro));
  const grupos = {};
  for (const c of imputables) {
    const v = ((s[c.id]?.debe ?? 0) - (s[c.id]?.haber ?? 0)) * naturaleza(c.rubro);
    if (!v) continue;
    const cod = c.codigo.split('.').slice(0, nivel).join('.');
    const madre = cuentas.find((x) => x.codigo === cod) ?? { codigo: cod, nombre: cod };
    const g = (grupos[cod] ??= { codigo: cod, nombre: madre.nombre, rubro: c.rubro, total: 0, cuentas: [] });
    g.total += v;
    g.cuentas.push({ id: c.id, codigo: c.codigo, nombre: c.nombre, saldo: v });
  }
  return Object.values(grupos).sort((a, b) => compararCodigo(a.codigo, b.codigo));
}

/** Estado de resultados: ingresos menos costos y gastos. */
export function estadoResultados(lineas, cuentas, nivel = 2) {
  const s = saldosPorCuenta(lineas);
  const ingresos = agrupar(cuentas, s, ['ingreso'], nivel);
  const egresos = agrupar(cuentas, s, ['egreso'], nivel);
  const totIng = ingresos.reduce((t, g) => t + g.total, 0);
  const totEgr = egresos.reduce((t, g) => t + g.total, 0);
  return { ingresos, egresos, totalIngresos: totIng, totalEgresos: totEgr, resultado: totIng - totEgr };
}

/**
 * Estado de situación patrimonial. El resultado del período (cuentas de ingreso y egreso
 * todavía no refundidas) se muestra dentro del patrimonio neto.
 */
export function situacionPatrimonial(lineas, cuentas, nivel = 2) {
  const s = saldosPorCuenta(lineas);
  const activo = agrupar(cuentas, s, ['activo'], nivel);
  const pasivo = agrupar(cuentas, s, ['pasivo'], nivel);
  const pn = agrupar(cuentas, s, ['patrimonio_neto'], nivel);
  const resultado = estadoResultados(lineas, cuentas).resultado;
  const tA = activo.reduce((t, g) => t + g.total, 0);
  const tP = pasivo.reduce((t, g) => t + g.total, 0);
  const tPN = pn.reduce((t, g) => t + g.total, 0) + resultado;
  return { activo, pasivo, patrimonio: pn, resultadoPeriodo: resultado, totalActivo: tA, totalPasivo: tP, totalPatrimonio: tPN, cuadra: tA === tP + tPN };
}

// ---------------------------------------------------------------- Cierre y apertura del ejercicio

/**
 * Refundición: lleva los saldos de ingresos y egresos al Resultado del ejercicio.
 */
export function asientoRefundicion(lineas, cuentas, cuentaResultadoId, fecha) {
  const s = saldosPorCuenta(lineas);
  const ls = [];
  let neto = 0;
  for (const c of cuentas.filter((x) => x.imputable && ['ingreso', 'egreso'].includes(x.rubro))) {
    const saldo = (s[c.id]?.debe ?? 0) - (s[c.id]?.haber ?? 0);
    if (!saldo) continue;
    ls.push({ cuenta_id: c.id, debe: saldo < 0 ? -saldo : 0, haber: saldo > 0 ? saldo : 0 });
    neto += saldo;
  }
  if (neto) ls.push({ cuenta_id: cuentaResultadoId, debe: neto > 0 ? neto : 0, haber: neto < 0 ? -neto : 0 });
  return { tipo: 'refundicion', fecha, descripcion: 'Refundición de cuentas de resultado', lineas: ls, ...validarAsiento(ls) };
}

/** Cierre: deja en cero todas las cuentas patrimoniales (después de la refundición). */
export function asientoCierre(lineas, cuentas, fecha) {
  const s = saldosPorCuenta(lineas);
  const ls = [];
  for (const c of cuentas.filter((x) => x.imputable && ['activo', 'pasivo', 'patrimonio_neto'].includes(x.rubro))) {
    const saldo = (s[c.id]?.debe ?? 0) - (s[c.id]?.haber ?? 0);
    if (saldo) ls.push({ cuenta_id: c.id, debe: saldo < 0 ? -saldo : 0, haber: saldo > 0 ? saldo : 0 });
  }
  return { tipo: 'cierre', fecha, descripcion: 'Asiento de cierre del ejercicio', lineas: ls, ...validarAsiento(ls) };
}

/**
 * Apertura del ejercicio siguiente: reabre las cuentas patrimoniales; el resultado
 * del ejercicio pasa a Resultados no asignados.
 */
export function asientoApertura(cierre, cuentaResultadoId, cuentaNoAsignadosId, fecha) {
  const ls = invertir(cierre.lineas).map((l) => (l.cuenta_id === cuentaResultadoId ? { ...l, cuenta_id: cuentaNoAsignadosId } : l));
  const juntas = [];
  for (const l of ls) {
    const ya = juntas.find((x) => x.cuenta_id === l.cuenta_id);
    if (ya) { const n = ya.debe - ya.haber + l.debe - l.haber; ya.debe = n > 0 ? n : 0; ya.haber = n < 0 ? -n : 0; } else juntas.push({ ...l });
  }
  const fin = juntas.filter((l) => l.debe || l.haber);
  return { tipo: 'apertura', fecha, descripcion: 'Asiento de apertura del ejercicio', lineas: fin, ...validarAsiento(fin) };
}
