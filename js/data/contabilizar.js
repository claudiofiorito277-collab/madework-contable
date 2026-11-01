// Arma los asientos automáticos con los datos reales de cada comprobante
// (la lógica contable está en js/core/asientos.js) y los registra.
import { sb, q } from './supabase.js';
import { contabilidad } from './repos.js';
import { aCentavos } from '../core/redondeo.js';
import {
  asientoVenta, asientoCobranza, asientoCompra, asientoPago, asientoMovimiento, asientoRechazoCheque, asientoAnticipoCertificado, mismasLineas,
} from '../core/asientos.js';

const c = (x) => aCentavos(x ?? 0);
const uno = async (consulta) => q(consulta.maybeSingle());

/** Configuración actual: concepto -> cuenta y cuentas de tesorería. */
export async function configuracion() {
  const [imp, tes] = await Promise.all([contabilidad.imputaciones(), contabilidad.cuentasTesoreria()]);
  return {
    cuentas: Object.fromEntries(imp.filter((i) => i.cuenta_id).map((i) => [i.clave, i.cuenta_id])),
    tesoreria: Object.fromEntries(tes.map((t) => [t.id, { cuenta_id: t.cuenta_contable_id, tipo: t.tipo }])),
  };
}

const centroDe = async (contratoId) => (contratoId ? (await uno(sb.from('contratos').select('centro_costo_id').eq('id', contratoId)))?.centro_costo_id ?? null : null);

/** Arma (sin registrar) el asiento de un comprobante. Devuelve null si no lleva asiento propio. */
export async function armarAsiento(origenTabla, origenId, evento, cfg) {
  if (origenTabla === 'comprobantes_venta') {
    const v = await uno(sb.from('v_comprobantes_venta').select('*').eq('id', origenId));
    return asientoVenta({ ...v, centro_costo_id: await centroDe(v.contrato_id), neto_gravado: c(v.neto_gravado), exento: c(v.exento), no_gravado: c(v.no_gravado),
      iva: c(v.iva), otros_tributos: c(v.otros_tributos), total: c(v.total) }, cfg);
  }
  if (origenTabla === 'cobranzas') {
    const [cob, medios, rets, fr] = await Promise.all([uno(sb.from('v_cobranzas').select('*').eq('id', origenId)),
      q(sb.from('cobranza_medios').select('*').eq('cobranza_id', origenId)), q(sb.from('retenciones_sufridas').select('*').eq('cobranza_id', origenId)),
      q(sb.from('fondo_reparo_movimientos').select('*, contratos(centro_costo_id)').eq('cobranza_id', origenId))]);
    const frm = (t) => fr.filter((x) => x.tipo === t).map((x) => ({ contrato_id: x.contrato_id, centro_costo_id: x.contratos?.centro_costo_id ?? null, importe: c(x.importe) }));
    return asientoCobranza({ id: cob.id, fecha: cob.fecha, numero: cob.numero, cliente: cob.cliente,
      medios: medios.map((m) => ({ medio: m.medio, importe: c(m.importe), cuenta_id: m.cuenta_id })), retenciones: rets.map((r) => ({ tipo: r.tipo, importe: c(r.importe) })),
      fondo_reparo: frm('retencion'), devoluciones_fr: frm('devolucion'), aplicado: c(cob.importe_aplicado), a_cuenta: c(cob.a_cuenta) }, cfg);
  }
  if (origenTabla === 'comprobantes_compra') {
    const [k, perc, imps] = await Promise.all([uno(sb.from('v_comprobantes_compra').select('*').eq('id', origenId)),
      q(sb.from('comprobante_compra_percepciones').select('*').eq('comprobante_id', origenId)),
      q(sb.from('comprobante_compra_imputaciones').select('*, contratos(centro_costo_id)').eq('comprobante_id', origenId))]);
    return asientoCompra({ ...k, total: c(k.total), credito_fiscal: c(k.credito_fiscal), percepciones: perc.map((p) => ({ tipo: p.tipo, importe: c(p.importe) })),
      imputaciones: imps.map((i) => ({ contrato_id: i.contrato_id, centro_costo_id: i.centro_costo_id ?? i.contratos?.centro_costo_id ?? null, categoria: i.categoria, importe: c(i.importe) })) }, cfg);
  }
  if (origenTabla === 'pagos') {
    const [p, medios, rets] = await Promise.all([uno(sb.from('v_pagos').select('*').eq('id', origenId)),
      q(sb.from('pago_medios').select('*').eq('pago_id', origenId)), q(sb.from('retenciones_practicadas').select('*').eq('pago_id', origenId))]);
    return asientoPago({ id: p.id, fecha: p.fecha, numero: p.numero, proveedor: p.proveedor, medios: medios.map((m) => ({ medio: m.medio, importe: c(m.importe), cuenta_id: m.cuenta_id })),
      retenciones: rets.map((r) => ({ importe: c(r.importe) })), aplicado: c(p.importe_aplicado), a_cuenta: c(p.a_cuenta) }, cfg);
  }
  if (origenTabla === 'movimientos_tesoreria') {
    const m = await uno(sb.from('movimientos_tesoreria').select('*').eq('id', origenId));
    let destino = null; let chequeTipo = null;
    if (m.transferencia_id) destino = (await uno(sb.from('movimientos_tesoreria').select('cuenta_id').eq('transferencia_id', m.transferencia_id).eq('tipo', 'ingreso')))?.cuenta_id;
    if (m.cheque_id) chequeTipo = (await uno(sb.from('cheques').select('tipo').eq('id', m.cheque_id)))?.tipo;
    return asientoMovimiento({ ...m, importe: c(m.importe), destino_cuenta_id: destino, cheque_tipo: chequeTipo }, cfg);
  }
  if (origenTabla === 'cheques') {
    const ch = await uno(sb.from('v_cheques').select('*').eq('id', origenId));
    return asientoRechazoCheque({ ...ch, importe: c(ch.importe) }, cfg);
  }
  if (origenTabla === 'certificados') {
    const ce = await uno(sb.from('certificados').select('*, contratos(codigo, centro_costo_id)').eq('id', origenId));
    return asientoAnticipoCertificado({ id: ce.id, fecha: ce.fecha_aprobacion ?? ce.periodo_hasta, numero: ce.numero, contrato_id: ce.contrato_id,
      contrato_codigo: ce.contratos?.codigo, centro_costo_id: ce.contratos?.centro_costo_id, descuento_anticipo: c(ce.descuento_anticipo) }, cfg);
  }
  throw new Error(`Origen desconocido: ${origenTabla}`);
}

const aPesos = (lineas) => lineas.map((l) => ({ ...l, debe: (l.debe / 100).toFixed(2), haber: (l.haber / 100).toFixed(2) }));

/** Registra un asiento armado. */
export async function registrarArmado(a) {
  return contabilidad.registrar({ fecha: a.fecha, tipo: 'automatico', descripcion: a.descripcion, origen_tabla: a.origen_tabla, origen_id: a.origen_id,
    evento: a.evento, lineas: aPesos(a.lineas) });
}

/**
 * Contabiliza los pendientes: registra los asientos que faltan y anula (con contraasiento)
 * los de comprobantes anulados. Devuelve { registrados, anulados, errores: [{ pendiente, error }] }.
 */
export async function contabilizarPendientes(pendientes, alAvanzar = () => {}) {
  const cfg = await configuracion();
  const r = { registrados: 0, anulados: 0, errores: [] };
  let i = 0;
  for (const p of pendientes) {
    alAvanzar(++i, pendientes.length);
    try {
      if (p.accion === 'anular') { await contabilidad.anular(p.asiento_id, 'Se anuló el comprobante de origen'); r.anulados++; continue; }
      const a = await armarAsiento(p.origen_tabla, p.origen_id, p.evento, cfg);
      if (!a) continue;
      if (!a.ok) throw new Error(a.errores.join(' '));
      await registrarArmado(a);
      r.registrados++;
    } catch (e) { r.errores.push({ pendiente: p, error: e.message }); }
  }
  return r;
}

/**
 * Regenera los asientos automáticos de un período abierto con la configuración actual:
 * los que cambian se anulan con contraasiento y se registran de nuevo.
 */
export async function regenerar(desde, hasta) {
  const cfg = await configuracion();
  const asientos = (await contabilidad.asientos({ desde, hasta })).filter((a) => a.tipo === 'automatico' && a.estado === 'contabilizado');
  const r = { revisados: asientos.length, regenerados: 0, errores: [] };
  for (const a of asientos) {
    try {
      const actual = await contabilidad.asiento(a.id);
      const nuevo = await armarAsiento(a.origen_tabla, a.origen_id, a.evento, cfg);
      if (!nuevo || !nuevo.ok) throw new Error(nuevo ? nuevo.errores.join(' ') : 'El comprobante ya no lleva asiento');
      const lineasActuales = actual.lineas.map((l) => ({ cuenta_id: l.cuenta_id, debe: c(l.debe), haber: c(l.haber), contrato_id: l.contrato_id, centro_costo_id: l.centro_costo_id }));
      if (mismasLineas(lineasActuales, nuevo.lineas)) continue;
      await contabilidad.anular(a.id, 'Regenerado por cambio en la configuración de imputaciones');
      await registrarArmado(nuevo);
      r.regenerados++;
    } catch (e) { r.errores.push({ asiento: a, error: e.message }); }
  }
  return r;
}
