// Junta los datos de costos de obra y calcula el costo real por contrato e ítem
// (la lógica está en js/core/costos.js).
import { costos as repo, contratos as repoContratos } from './repos.js';
import { aCentavos } from '../core/redondeo.js';
import { aMilesimas, costoParte, valorizarMateriales, prorratearIndirecto, costoPorItem } from '../core/costos.js';

const c = (x) => aCentavos(x ?? 0);
const m = (x) => aMilesimas(x ?? 0);
const agrupar = (lista, k) => lista.reduce((o, x) => ((o[x[k]] ??= []).push(x), o), {});
const mes = (f) => f.slice(0, 7);
const primerDia = (f) => `${mes(f)}-01`;
const ultimoDia = (f) => { const d = new Date(`${mes(f)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

/** Tarifas en centavos agrupadas por persona y por equipo. */
export async function tarifas() {
  const [tp, te] = await Promise.all([repo.tarifasPersonal(), repo.tarifasEquipos()]);
  const conv = (t, a, b) => ({ ...t, [a]: t[a] == null ? null : c(t[a]), [b]: t[b] == null ? null : c(t[b]) });
  return { personal: agrupar(tp.map((t) => conv(t, 'costo_hora', 'costo_jornal')), 'personal_id'), equipos: agrupar(te.map((t) => conv(t, 'costo_hora', 'costo_dia')), 'equipo_id') };
}

/** Partes (registrados) con sus líneas y su costo calculado. */
export async function partesConCosto({ desde, hasta, contratoId } = {}) {
  const [partes, { pers, eqs }, tar, personal, equipos] = await Promise.all([repo.partes({ desde, hasta, contratoId }), repo.lineasPartes(), tarifas(), repo.personal(), repo.equipos()]);
  const nomP = Object.fromEntries(personal.map((x) => [x.id, x.nombre])); const nomE = Object.fromEntries(equipos.map((x) => [x.id, x.nombre]));
  const lp = agrupar(pers, 'parte_id'); const le = agrupar(eqs, 'parte_id');
  return partes.map((p) => {
    const parte = { fecha: p.fecha, cantidad_producida: m(p.cantidad_producida),
      personal: (lp[p.id] ?? []).map((x) => ({ personal_id: x.personal_id, nombre: nomP[x.personal_id], horas: m(x.horas), jornales: m(x.jornales) })),
      equipos: (le[p.id] ?? []).map((x) => ({ equipo_id: x.equipo_id, nombre: nomE[x.equipo_id], horas: m(x.horas), dias: m(x.dias) })) };
    return { ...p, ...parte, costo: p.estado === 'registrado' ? costoParte(parte, tar) : null };
  });
}

/** Movimientos de materiales valorizados al costo promedio. */
export async function materialesValorizados() {
  const movs = await repo.movimientosMaterial();
  return valorizarMateriales(movs.map((x) => ({ ...x, cantidad: m(x.cantidad), costo_unitario: x.costo_unitario == null ? null : c(x.costo_unitario) })));
}

/**
 * Costo real de un contrato entre dos fechas, por ítem.
 * Los indirectos se prorratean por mes con su regla (para "costo directo" se usa el costo directo de cada contrato en ese mes).
 */
export async function costoContrato(contratoId, desde, hasta) {
  const d0 = primerDia(desde); const h0 = ultimoDia(hasta);
  const [items, ctrs, partes, mats, compras, indirectos] = await Promise.all([repoContratos.items(contratoId), repoContratos.listar(),
    partesConCosto({ desde: d0, hasta: h0 }), materialesValorizados(), repo.costosImputados(), repo.indirectos()]);
  const enRango = (f) => f >= desde && f <= hasta;
  const vivos = partes.filter((p) => p.estado === 'registrado');
  const consumos = mats.valorizados.filter((x) => x.tipo === 'consumo' && x.contrato_id && x.fecha >= d0 && x.fecha <= h0);
  // Compras que entraron al stock: su costo llega por los consumos (no se cuentan dos veces)
  const conStock = new Set(mats.valorizados.filter((x) => x.tipo === 'ingreso' && x.comprobante_compra_id).map((x) => x.comprobante_compra_id));
  const comprasD = compras.filter((x) => x.fecha >= d0 && x.fecha <= h0 && !conStock.has(x.comprobante_id)).map((x) => ({ ...x, importe: c(x.importe_con_signo) }));

  // Costo directo por contrato y mes (para prorratear indirectos)
  const directo = {};
  const sumar = (ct, f, v) => { ((directo[mes(f)] ??= {})[ct] = (directo[mes(f)][ct] ?? 0) + v); };
  for (const p of vivos) sumar(p.contrato_id, p.fecha, p.costo.total);
  for (const x of consumos) sumar(x.contrato_id, x.fecha, x.costo_total);
  for (const x of comprasD) sumar(x.contrato_id, x.fecha, x.importe);

  const activos = ctrs.map((k) => ({ id: k.id, monto: c(k.monto_contractual), activo: ['adjudicado', 'en_ejecucion'].includes(k.estado) }));
  let indirecto = 0; const detalleInd = []; const avisos = [];
  for (const ind of indirectos.filter((x) => x.estado === 'vigente' && enRango(x.fecha))) {
    const r = prorratearIndirecto({ importe: c(ind.importe), regla: ind.regla, porcentajes: ind.indirecto_porcentajes ?? [] },
      { contratos: activos, costoDirecto: directo[mes(ind.fecha)] ?? {} });
    if (r.error) avisos.push(`${ind.concepto}: ${r.error}`);
    const parte = r.reparto[contratoId] ?? 0;
    indirecto += parte;
    detalleInd.push({ ...ind, parte });
  }
  const propio = (x) => x.contrato_id === contratoId && enRango(x.fecha);
  const pc = vivos.filter(propio);
  for (const p of pc) for (const f of p.costo.faltantes) avisos.push(`Parte del ${p.fecha.split('-').reverse().join('/')}: ${f}`);
  const res = costoPorItem({
    items: items.map((i) => ({ ...i, precio_unitario: c(i.precio_unitario) })),
    partes: pc.map((p) => ({ item_id: p.item_id, mano_obra: p.costo.mano_obra, equipos: p.costo.equipos, cantidad_producida: p.cantidad_producida })),
    consumos: consumos.filter(propio).map((x) => ({ item_id: x.item_id, costo_total: x.costo_total })),
    compras: comprasD.filter(propio).map((x) => ({ item_id: x.item_id, categoria: x.categoria, importe: x.importe })),
    indirecto,
  });
  return { ...res, partes: pc, consumos: consumos.filter(propio), compras: comprasD.filter(propio), indirectos: detalleInd, avisos: [...new Set(avisos)] };
}
