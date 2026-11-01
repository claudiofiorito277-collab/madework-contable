// Lógica pura de ventas y cobranzas. Importes en CENTAVOS enteros.
// No toca la pantalla ni la base: se prueba con node --test (tests/ventas.test.js).
//
// Modelo:
// - Facturas y notas de débito son deuda del cliente. Cada una tiene su saldo.
// - Una nota de crédito va siempre asociada a una factura o nota de débito y le baja el saldo.
// - Una cobranza (recibo) junta: medios de cobro + retenciones sufridas + fondo de reparo retenido.
//   Ese total se aplica a facturas; lo que no se aplica queda "a cuenta".
//   Además, una cobranza puede traer la devolución del fondo de reparo de un contrato:
//   esa plata no baja deuda de facturas, baja el fondo de reparo a cobrar.

import { aCentavos, dividirRedondeando } from './redondeo.js';

export const CLASES_DEUDA = ['factura', 'nota_debito'];

export const MEDIOS = {
  transferencia: 'Transferencia', echeq: 'Echeq', cheque: 'Cheque físico', efectivo: 'Efectivo', otro: 'Otro',
};

export const TIPOS_RETENCION = {
  RET_GANANCIAS: 'Ganancias', RET_IVA: 'IVA', RET_IIBB_CBA: 'Ingresos Brutos Córdoba', RET_SUSS: 'SUSS', OTRA: 'Otra',
};

const enteroSeguro = (x) => Number.isSafeInteger(x);

/** "00003-00000125" */
export function formatoNumero(puntoVenta, numero) {
  return `${String(puntoVenta ?? 0).padStart(5, '0')}-${String(numero ?? 0).padStart(8, '0')}`;
}

/** Punto de venta 1 a 99999 y número 1 a 99999999 (formato ARCA). Devuelve lista de errores. */
export function validarNumeracion(puntoVenta, numero) {
  const errores = [];
  const pv = Number(puntoVenta);
  const nro = Number(numero);
  if (!Number.isInteger(pv) || pv < 1 || pv > 99999) errores.push('El punto de venta tiene que ser un número entre 1 y 99999.');
  if (!Number.isInteger(nro) || nro < 1 || nro > 99999999) errores.push('El número de comprobante tiene que ser un número entre 1 y 99999999.');
  return errores;
}

/** El CAE de ARCA tiene 14 dígitos. */
export function caeValido(cae) {
  return /^\d{14}$/.test(String(cae ?? '').trim());
}

/**
 * Saldo de cada comprobante.
 * @param comprobantes [{ id, clase, total (cent, positivo), asociado_id, estado }]
 * @param aplicaciones [{ comprobante_id, importe (cent) }] (solo de cobranzas vigentes)
 * @returns objeto id -> { total, notasCredito, cobrado, saldo }  (solo facturas y notas de débito)
 */
export function saldosComprobantes(comprobantes = [], aplicaciones = []) {
  const vigentes = comprobantes.filter((c) => c.estado !== 'anulado');
  const r = {};
  for (const c of vigentes) {
    if (CLASES_DEUDA.includes(c.clase)) r[c.id] = { total: c.total, notasCredito: 0, cobrado: 0, saldo: c.total };
  }
  for (const nc of vigentes.filter((c) => c.clase === 'nota_credito')) {
    const d = r[nc.asociado_id];
    if (d) { d.notasCredito += nc.total; d.saldo -= nc.total; }
  }
  for (const a of aplicaciones) {
    const d = r[a.comprobante_id];
    if (d) { d.cobrado += a.importe; d.saldo -= a.importe; }
  }
  return r;
}

/**
 * Controla una nota de crédito o débito contra su comprobante asociado.
 * La NC no puede superar el total del asociado menos las NC anteriores.
 */
export function validarAsociado({ clase, letra, clienteId, total }, asociado, ncAnteriores = 0) {
  const errores = [];
  if (!['nota_credito', 'nota_debito'].includes(clase)) return errores;
  if (!asociado) { errores.push('Una nota de crédito o débito tiene que estar asociada a una factura.'); return errores; }
  if (asociado.estado === 'anulado') errores.push('El comprobante asociado está anulado.');
  if (!CLASES_DEUDA.includes(asociado.clase)) errores.push('Solo se puede asociar a una factura o nota de débito.');
  if (asociado.letra !== letra) errores.push(`La letra tiene que coincidir con la del comprobante asociado (${asociado.letra}).`);
  if (asociado.cliente_id !== clienteId) errores.push('El comprobante asociado es de otro cliente.');
  if (clase === 'nota_credito' && total > asociado.total - ncAnteriores) {
    errores.push(`La nota de crédito supera lo que queda del comprobante asociado (máximo ${(asociado.total - ncAnteriores) / 100}).`);
  }
  return errores;
}

/**
 * Reparte un importe entre comprobantes pendientes, del más viejo al más nuevo (por vencimiento y fecha).
 * @param pendientes [{ id, saldo, vencimiento, fecha }]
 * @returns { aplicaciones: [{ comprobante_id, importe }], resto }
 */
export function sugerirAplicacion(importe, pendientes = []) {
  let resto = importe;
  const orden = [...pendientes].filter((p) => p.saldo > 0)
    .sort((a, b) => (a.vencimiento ?? a.fecha ?? '').localeCompare(b.vencimiento ?? b.fecha ?? '') || (a.fecha ?? '').localeCompare(b.fecha ?? ''));
  const aplicaciones = [];
  for (const p of orden) {
    if (resto <= 0) break;
    const x = Math.min(resto, p.saldo);
    aplicaciones.push({ comprobante_id: p.id, importe: x });
    resto -= x;
  }
  return { aplicaciones, resto };
}

/**
 * Control opcional de una retención: no la calcula el sistema (se carga lo que dice el
 * certificado), solo avisa si no coincide con base × alícuota.
 * @param ret { base, importe (cent), alicuotaBp (la del certificado, opcional) }
 * @param parametroBp alícuota del parámetro fiscal vigente (o null si no está definida)
 * @returns { controlado, coincide, esperado, aviso }
 */
export function controlRetencion({ base, importe, alicuotaBp }, parametroBp = null, toleranciaCent = 1) {
  const bp = alicuotaBp ?? parametroBp;
  if (!base || bp === null || bp === undefined) {
    return { controlado: false, coincide: null, esperado: null, aviso: null };
  }
  const esperado = dividirRedondeando(BigInt(base) * BigInt(bp), 10000);
  const avisos = [];
  if (Math.abs(esperado - importe) > toleranciaCent) {
    avisos.push(`El importe (${importe / 100}) no coincide con ${bp / 100}% de la base (${esperado / 100}).`);
  }
  if (alicuotaBp !== null && alicuotaBp !== undefined && parametroBp !== null && parametroBp !== undefined && alicuotaBp !== parametroBp) {
    avisos.push(`La alícuota del certificado (${alicuotaBp / 100}%) es distinta de la del parámetro (${parametroBp / 100}%).`);
  }
  return { controlado: true, coincide: avisos.length === 0, esperado, aviso: avisos.join(' ') || null };
}

/**
 * Valida y totaliza una cobranza antes de guardarla.
 * @param c {
 *   medios: [{ medio, importe }],
 *   retenciones: [{ tipo, numero_certificado, importe }],
 *   fondoReparo: [{ contrato_id, importe }],        retenido por el cliente en este pago
 *   aplicaciones: [{ comprobante_id, importe }],    a facturas / notas de débito
 *   devolucionesFR: [{ contrato_id, importe }],     devolución del fondo de reparo
 * }
 * @param ctx { saldos: { id: saldoCent }, saldosFR: { contrato_id: saldoCent } }
 */
export function calcularCobranza(c, { saldos = {}, saldosFR = {} } = {}) {
  const errores = [];
  const advertencias = [];
  const medios = c.medios ?? [];
  const retenciones = c.retenciones ?? [];
  const fondoReparo = c.fondoReparo ?? [];
  const aplicaciones = c.aplicaciones ?? [];
  const devolucionesFR = c.devolucionesFR ?? [];

  const revisar = (lista, nombre) => lista.forEach((x, i) => {
    if (!enteroSeguro(x.importe) || x.importe <= 0) errores.push(`${nombre} ${i + 1}: el importe tiene que ser mayor a cero.`);
  });
  revisar(medios, 'Medio de cobro');
  revisar(retenciones, 'Retención');
  revisar(fondoReparo, 'Fondo de reparo retenido');
  revisar(aplicaciones, 'Aplicación');
  revisar(devolucionesFR, 'Devolución de fondo de reparo');

  medios.forEach((m, i) => { if (!MEDIOS[m.medio]) errores.push(`Medio de cobro ${i + 1}: medio inválido.`); });
  retenciones.forEach((r, i) => {
    if (!TIPOS_RETENCION[r.tipo]) errores.push(`Retención ${i + 1}: tipo inválido.`);
    if (!String(r.numero_certificado ?? '').trim()) errores.push(`Retención ${i + 1}: falta el número de certificado.`);
  });

  // Una misma factura no se aplica dos veces en la misma cobranza
  const porComp = {};
  for (const a of aplicaciones) porComp[a.comprobante_id] = (porComp[a.comprobante_id] ?? 0) + a.importe;
  for (const [id, imp] of Object.entries(porComp)) {
    if (!(id in saldos)) errores.push('Hay una aplicación a un comprobante que no está pendiente.');
    else if (imp > saldos[id]) errores.push(`Se aplica ${imp / 100} a un comprobante con saldo ${saldos[id] / 100}.`);
  }
  const porContrato = {};
  for (const d of devolucionesFR) porContrato[d.contrato_id] = (porContrato[d.contrato_id] ?? 0) + d.importe;
  for (const [id, imp] of Object.entries(porContrato)) {
    if (imp > (saldosFR[id] ?? 0)) errores.push(`La devolución de fondo de reparo (${imp / 100}) supera el saldo retenido del contrato (${(saldosFR[id] ?? 0) / 100}).`);
  }

  const suma = (l) => l.reduce((s, x) => s + (enteroSeguro(x.importe) ? x.importe : 0), 0);
  const totalMedios = suma(medios);
  const totalRetenciones = suma(retenciones);
  const totalFondoReparo = suma(fondoReparo);
  const total = totalMedios + totalRetenciones + totalFondoReparo;
  const totalAplicado = suma(aplicaciones);
  const totalDevolucionFR = suma(devolucionesFR);
  const sinAplicar = total - totalAplicado - totalDevolucionFR;

  if (total === 0) errores.push('La cobranza no tiene importes.');
  if (sinAplicar < 0) errores.push(`Se aplica más (${(totalAplicado + totalDevolucionFR) / 100}) de lo que se cobra (${total / 100}).`);
  if (sinAplicar > 0 && total > 0) advertencias.push(`Quedan ${sinAplicar / 100} sin aplicar: se registran como pago a cuenta del cliente.`);
  if (totalFondoReparo > 0 && totalAplicado === 0) advertencias.push('Se registra fondo de reparo retenido sin aplicar a ninguna factura.');

  return {
    ok: errores.length === 0, errores, advertencias,
    totalMedios, totalRetenciones, totalFondoReparo, total, totalAplicado, totalDevolucionFR, sinAplicar,
    // Lo que baja la deuda del cliente en la cuenta corriente
    haberCuentaCorriente: total - totalDevolucionFR,
  };
}

/**
 * Cuenta corriente del cliente, en orden de fecha, con saldo acumulado.
 * @param comprobantes [{ id, fecha, clase, descripcion, total, estado }]
 * @param cobranzas    [{ id, fecha, numero, total, devolucion_fr, estado }]
 * @param saldoInicial cent (opcional)
 */
export function cuentaCorriente({ comprobantes = [], cobranzas = [] }, saldoInicial = 0) {
  const movs = [];
  for (const c of comprobantes) {
    if (c.estado === 'anulado') continue;
    const debe = CLASES_DEUDA.includes(c.clase) ? c.total : 0;
    const haber = c.clase === 'nota_credito' ? c.total : 0;
    movs.push({ fecha: c.fecha, orden: 0, tipo: 'comprobante', id: c.id, descripcion: c.descripcion, debe, haber });
  }
  for (const r of cobranzas) {
    if (r.estado === 'anulada') continue;
    movs.push({ fecha: r.fecha, orden: 1, tipo: 'cobranza', id: r.id, descripcion: r.descripcion ?? `Recibo N° ${r.numero}`, debe: 0, haber: r.total - (r.devolucion_fr ?? 0) });
  }
  movs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);
  let saldo = saldoInicial;
  for (const m of movs) { saldo += m.debe - m.haber; m.saldo = saldo; }
  return { movimientos: movs, saldo, debe: movs.reduce((s, m) => s + m.debe, 0), haber: movs.reduce((s, m) => s + m.haber, 0) };
}

/** Días entre dos fechas ISO (b − a). */
function dias(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * Antigüedad de la deuda a una fecha, según el vencimiento (o la fecha si no tiene).
 * @param pendientes [{ saldo, vencimiento, fecha }]
 */
export function antiguedad(pendientes = [], fecha) {
  const r = { noVencido: 0, d1a30: 0, d31a60: 0, d61a90: 0, mas90: 0, total: 0 };
  for (const p of pendientes) {
    if (!p.saldo || p.saldo <= 0) continue;
    const atraso = dias(p.vencimiento ?? p.fecha, fecha);
    const k = atraso <= 0 ? 'noVencido' : atraso <= 30 ? 'd1a30' : atraso <= 60 ? 'd31a60' : atraso <= 90 ? 'd61a90' : 'mas90';
    r[k] += p.saldo;
    r.total += p.saldo;
  }
  return r;
}

/** Saldo del fondo de reparo por contrato. movs: [{ contrato_id, tipo: 'retencion'|'devolucion', importe }] */
export function saldosFondoReparo(movs = []) {
  const r = {};
  for (const m of movs) {
    if (m.anulado) continue;
    const x = (r[m.contrato_id] ??= { retenido: 0, devuelto: 0, saldo: 0 });
    if (m.tipo === 'retencion') x.retenido += m.importe; else x.devuelto += m.importe;
    x.saldo = x.retenido - x.devuelto;
  }
  return r;
}

/**
 * Propuesta de factura a partir de un certificado aprobado (los importes vienen de la base en pesos).
 * El neto es la "base a facturar" del certificado y el IVA, el calculado en el certificado.
 */
export function propuestaDesdeCertificado(cert, contrato) {
  return {
    origen: 'certificado',
    certificado_id: cert.id,
    contrato_id: contrato.id,
    cliente_id: contrato.cliente_id,
    lineas: [{ tratamiento: 'gravado', alicuota: contrato.alicuota_iva ?? 'IVA_21', neto: aCentavos(cert.base_factura), iva: aCentavos(cert.iva) }],
    total: aCentavos(cert.total_factura),
    periodo_desde: cert.periodo_desde,
    periodo_hasta: cert.periodo_hasta,
    descripcion: `Certificado N° ${cert.numero} · ${contrato.codigo} · período ${cert.periodo_desde} al ${cert.periodo_hasta}`,
    fondoReparo: aCentavos(cert.fondo_reparo ?? 0),
    multas: aCentavos(cert.multas ?? 0),
  };
}

/**
 * Estado que corresponde al certificado según su factura (misma regla que la base).
 * Sin factura vigente: aprobado. Con factura: facturado, o cobrado si ya se cobró y no queda saldo.
 */
export function estadoCertificadoSegunFactura(factura) {
  if (!factura || factura.estado === 'anulado') return 'aprobado';
  return factura.cobrado > 0 && factura.saldo <= 0 ? 'cobrado' : 'facturado';
}
