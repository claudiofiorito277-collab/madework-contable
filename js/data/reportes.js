// Junta los datos de los reportes (la lógica está en js/core/reportes.js).
import { sb, q } from './supabase.js';
import { contratos as repoContratos } from './repos.js';
import { costoContrato } from './costos.js';
import { aCentavos } from '../core/redondeo.js';
import { aMilesimas } from '../core/costos.js';
import { ivaVentas, ivaCompras, libroIvaDigital, retencionesYPercepciones, antiguedadSaldos, rentabilidad } from '../core/reportes.js';

const c = (x) => aCentavos(x ?? 0);
const enRango = (consulta, desde, hasta, campo = 'fecha') => { let x = consulta; if (desde) x = x.gte(campo, desde); if (hasta) x = x.lte(campo, hasta); return x; };
const porIds = async (tabla, ids) => (ids.length ? q(sb.from(tabla).select('*').in('comprobante_id', ids)) : []);
const CV = ['neto_gravado', 'exento', 'no_gravado', 'iva', 'otros_tributos', 'total'];
const CC = ['neto_gravado', 'exento', 'no_gravado', 'sin_discriminar', 'iva', 'credito_fiscal', 'percepciones', 'otros_tributos', 'total'];
const centavos = (o, ks) => ({ ...o, ...Object.fromEntries(ks.map((k) => [k, c(o[k])])) });

async function ventasDelPeriodo(desde, hasta) {
  const cps = (await q(enRango(sb.from('v_comprobantes_venta').select('*'), desde, hasta))).map((x) => centavos(x, CV));
  const als = (await porIds('comprobante_venta_alicuotas', cps.map((x) => x.id))).map((a) => ({ ...a, neto: c(a.neto), iva: c(a.iva) }));
  return { cps, als };
}
async function comprasDelPeriodo(desde, hasta) {
  const cps = (await q(enRango(sb.from('v_comprobantes_compra').select('*'), desde, hasta))).map((x) => centavos(x, CC));
  const ids = cps.map((x) => x.id);
  const [als, per] = await Promise.all([porIds('comprobante_compra_alicuotas', ids), porIds('comprobante_compra_percepciones', ids)]);
  return { cps, als: als.map((a) => ({ ...a, neto: c(a.neto), iva: c(a.iva) })), per: per.map((p) => ({ ...p, importe: c(p.importe) })) };
}

export async function reporteIvaVentas(desde, hasta) { const { cps, als } = await ventasDelPeriodo(desde, hasta); return ivaVentas(cps, als); }
export async function reporteIvaCompras(desde, hasta) { const { cps, als, per } = await comprasDelPeriodo(desde, hasta); return ivaCompras(cps, als, per); }

export async function reporteLibroIva(desde, hasta) {
  const [v, k] = await Promise.all([ventasDelPeriodo(desde, hasta), comprasDelPeriodo(desde, hasta)]);
  const agr = (lista, k2) => lista.reduce((o, x) => ((o[x[k2]] ??= []).push(x), o), {});
  const av = agr(v.als, 'comprobante_id'); const ac = agr(k.als, 'comprobante_id'); const pc = agr(k.per, 'comprobante_id');
  const perc = (lista = []) => ({ perc_iva: lista.filter((p) => p.tipo === 'PERC_IVA').reduce((s, p) => s + p.importe, 0),
    perc_iibb: lista.filter((p) => ['PERC_IIBB_CBA', 'PERC_IIBB_OTRAS'].includes(p.tipo)).reduce((s, p) => s + p.importe, 0),
    perc_otras: lista.filter((p) => !['PERC_IVA', 'PERC_IIBB_CBA', 'PERC_IIBB_OTRAS'].includes(p.tipo)).reduce((s, p) => s + p.importe, 0) });
  return libroIvaDigital(v.cps.map((x) => ({ ...x, alicuotas: av[x.id] ?? [] })), k.cps.map((x) => ({ ...x, alicuotas: ac[x.id] ?? [], perc: perc(pc[x.id]) })));
}

export async function reporteRetenciones(desde, hasta) {
  const [ret, k] = await Promise.all([q(enRango(sb.from('v_retenciones_sufridas').select('*'), desde, hasta)), comprasDelPeriodo(desde, hasta)]);
  const cps = new Map(k.cps.filter((x) => x.estado === 'emitido').map((x) => [x.id, x]));
  const per = k.per.filter((p) => cps.has(p.comprobante_id)).map((p) => { const x = cps.get(p.comprobante_id);
    return { ...p, fecha: x.fecha, clase: x.clase, proveedor: x.proveedor, proveedor_cuit: x.proveedor_cuit, numero_formateado: x.numero_formateado }; });
  return retencionesYPercepciones(ret.map((r) => ({ ...r, importe: c(r.importe), base: r.base == null ? null : c(r.base) })), per);
}

export async function reporteSaldos(corte) {
  const [cv, cc] = await Promise.all([q(sb.from('v_comprobantes_venta').select('*').eq('estado', 'emitido')), q(sb.from('v_comprobantes_compra').select('*').eq('estado', 'emitido'))]);
  const docs = (l, ter) => l.filter((x) => x.clase !== 'nota_credito' && x.fecha <= corte && c(x.saldo) > 0)
    .map((x) => ({ tercero: x[ter], fecha: x.fecha, vencimiento: x.vencimiento, numero: `${x.tipo_descripcion ?? ''} ${x.numero_formateado}`.trim(), saldo: c(x.saldo) }));
  return { clientes: antiguedadSaldos(docs(cv, 'cliente'), corte), proveedores: antiguedadSaldos(docs(cc, 'proveedor'), corte) };
}

const costoPrevisto = (it) => ['costo_mano_obra', 'costo_materiales', 'costo_equipos', 'costo_subcontratos', 'costo_otros'].reduce((s, k) => s + c(it[k]), 0);

/** Rentabilidad de un contrato entre dos fechas (ingreso certificado por fecha de aprobación del certificado). */
export async function reporteRentabilidad(contratoId, desde, hasta) {
  const [items, certs, costo] = await Promise.all([repoContratos.items(contratoId),
    q(sb.from('certificados').select('*, certificado_items(*)').eq('contrato_id', contratoId).in('estado', ['aprobado', 'facturado', 'cobrado'])),
    costoContrato(contratoId, desde, hasta)]);
  const fechaCert = (x) => x.fecha_aprobacion ?? x.periodo_hasta;
  const certificado = certs.filter((x) => fechaCert(x) >= desde && fechaCert(x) <= hasta)
    .flatMap((x) => (x.certificado_items ?? []).map((i) => ({ item_id: i.item_id, cantidad: aMilesimas(i.cantidad), importe: c(i.importe) })));
  const r = rentabilidad(items.map((i) => ({ ...i, precio_unitario: c(i.precio_unitario), costo_previsto: costoPrevisto(i) })), certificado, costo);
  return { ...r, costo, items };
}

/** Margen de cada contrato activo, desde el inicio hasta hoy (para el panel). */
export async function margenContratos(hasta) {
  const ctrs = (await repoContratos.listar()).filter((x) => ['adjudicado', 'en_ejecucion'].includes(x.estado));
  const out = [];
  for (const k of ctrs) {
    const r = await reporteRentabilidad(k.id, '2000-01-01', hasta);
    out.push({ contrato: k, ...r.totales, avisos: r.costo.avisos });
  }
  return out;
}
