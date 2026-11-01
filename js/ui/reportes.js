// Reportes: rentabilidad y costo por unidad, IVA Ventas y Compras (con Libro IVA Digital en borrador),
// retenciones y percepciones, saldos y vencimientos. Todos se exportan a Excel y PDF.
import { h, vaciar, pantalla, campo, select, etiqueta, fechaAR, cent, hoyISO, cargando, cantidadAR } from './dom.js';
import { encabezado } from './layout.js';
import { contratos as repoContratos } from '../data/repos.js';
import { reporteIvaVentas, reporteIvaCompras, reporteLibroIva, reporteRetenciones, reporteSaldos, reporteRentabilidad } from '../data/reportes.js';
import { TEXTO_ALICUOTA, NOMBRES_RET, NOMBRES_PERC, TRAMOS_VENC } from '../core/reportes.js';
import { zip } from '../core/exportar.js';
import { botonesExportar, col, periodoTexto, descargar } from './exportar.js';

const TIPOS_TRABAJO = { pintura_columnas: 'Pintura de columnas', bacheo: 'Bacheo', reparacion_calzada: 'Reparación de calzada', senalizacion: 'Señalización', mantenimiento: 'Mantenimiento', otro: 'Otro' };
const PESTAÑAS = [['rentabilidad', 'Rentabilidad y costo por unidad'], ['iva-ventas', 'IVA Ventas'], ['iva-compras', 'IVA Compras'], ['retenciones', 'Retenciones y percepciones'],
  ['saldos', 'Saldos y vencimientos'], ['otros', 'Otros reportes']];
const primeroMes = (iso = hoyISO()) => `${iso.slice(0, 7)}-01`;
const ultimoMes = (iso = hoyISO()) => { const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const tabla = (cab, filas, vacio, pie) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
  h('thead', {}, h('tr', {}, cab.map((t) => (Array.isArray(t) ? h('th', { class: t[1] }, t[0]) : h('th', {}, t))))),
  h('tbody', {}, filas.length ? filas : h('tr', {}, h('td', { colspan: cab.length, class: 'texto-suave' }, vacio))), pie ?? null));
const num = (v, clase = '') => h('td', { class: `num ${clase}` }, v);
const pc = (x) => (x === null || x === undefined ? '—' : `${String(x).replace('.', ',')} %`);
const signo = (x) => (x < 0 ? 'texto-negativo' : '');
const dato = (titulo, valor, detalle, neg) => h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, titulo), h('div', { class: `dato-valor ${neg ? 'negativo' : ''}` }, valor), detalle ? h('div', { class: 'dato-detalle' }, detalle) : null);
const unidadNombre = (u) => ({ u: 'unidad', un: 'unidad', col: 'columna', m2: 'm²', 'm²': 'm²', km: 'km', ml: 'metro lineal', m: 'metro', m3: 'm³', 'm³': 'm³', gl: 'global' }[String(u ?? '').toLowerCase()] ?? u ?? 'unidad');
const fechas = (d, hh) => ({ d: h('input', { type: 'date', value: d, 'aria-label': 'Desde' }), h: h('input', { type: 'date', value: hh, 'aria-label': 'Hasta' }) });

export async function pantallaReportes(cont, ctx, tabInicial) {
  let sel = PESTAÑAS.some(([id]) => id === tabInicial) ? tabInicial : 'rentabilidad';
  const cuerpo = h('div');
  const barra = h('div', { class: 'pestañas', role: 'tablist' });
  const dibujar = () => pantalla(cuerpo, () => VISTAS[sel](cuerpo, ctx));
  const pintarBarra = () => vaciar(barra, PESTAÑAS.map(([id, t]) => h('button', {
    type: 'button', role: 'tab', class: `pestaña${sel === id ? ' activa' : ''}`, 'aria-selected': String(sel === id),
    onclick: () => { sel = id; history.replaceState(null, '', `#/reportes/${id}`); pintarBarra(); dibujar(); },
  }, t)));
  pintarBarra();
  vaciar(cont, encabezado('Reportes', 'Rentabilidad, IVA, retenciones y saldos. Cada reporte se descarga en Excel o PDF con los filtros aplicados.'), barra, cuerpo);
  await dibujar();
}

const VISTAS = {
  // ------------------------------------------------------------ Rentabilidad
  async rentabilidad(cuerpo, ctx) {
    const ctrs = await repoContratos.listar();
    if (!ctrs.length) { vaciar(cuerpo, h('div', { class: 'tarjeta' }, 'Todavía no hay contratos.')); return; }
    const veCostos = ['administrador', 'contador'].includes(ctx.perfil.rol);
    const fCli = select([['', 'Todos'], ...[...new Set(ctrs.map((k) => k.cliente))].map((x) => [x, x])], '', { 'aria-label': 'Cliente' });
    const fRuta = select([['', 'Todas'], ...[...new Set(ctrs.map((k) => k.ruta).filter(Boolean))].map((x) => [x, x])], '', { 'aria-label': 'Ruta' });
    const fTipo = select([['', 'Todos'], ...[...new Set(ctrs.map((k) => k.tipo_trabajo).filter(Boolean))].map((x) => [x, TIPOS_TRABAJO[x] ?? x])], '', { 'aria-label': 'Tipo de trabajo' });
    const fK = select([], '', { 'aria-label': 'Contrato' });
    const f = fechas('2026-01-01', hoyISO());
    const zona = h('div'); let ultimo = null;
    const filtrados = () => ctrs.filter((k) => (!fCli.value || k.cliente === fCli.value) && (!fRuta.value || k.ruta === fRuta.value) && (!fTipo.value || k.tipo_trabajo === fTipo.value));
    const llenarContratos = () => { const l = filtrados(); const prev = fK.value; vaciar(fK, l.map((k) => h('option', { value: k.id }, `${k.codigo} · ${k.descripcion}`))); if (l.some((k) => k.id === prev)) fK.value = prev; };
    const pintar = async () => {
      if (!fK.value) { vaciar(zona, h('div', { class: 'tarjeta' }, 'Ningún contrato cumple los filtros.')); ultimo = null; return; }
      vaciar(zona, cargando());
      const k = ctrs.find((x) => x.id === fK.value);
      const r = await reporteRentabilidad(fK.value, f.d.value, f.h.value);
      ultimo = { k, r };
      const t = r.totales;
      vaciar(zona,
        !veCostos ? h('div', { class: 'tarjeta tarjeta-info' }, 'El costo de mano de obra y equipos solo lo ven el administrador y el contador: acá el costo real no los incluye.') : null,
        r.costo.avisos.length ? h('div', { class: 'tarjeta tarjeta-alerta' }, h('strong', {}, 'Revisar: '), r.costo.avisos.join(' · ')) : null,
        h('div', { class: 'panel-cifras' },
          dato('Ingreso certificado', cent(t.ingreso), 'Certificados aprobados en el período'),
          dato('Costo real', cent(t.costo_real), `Presupuestado ${cent(t.costo_presupuestado)}`),
          dato('Desvío de costo', cent(t.desvio), t.desvio > 0 ? 'Gastado de más' : 'Por debajo del presupuesto', t.desvio > 0),
          dato('Margen', cent(t.margen), `${pc(t.margen_pct)} del ingreso`, t.margen < 0)),
        h('section', { class: 'tarjeta' }, h('h2', {}, `${k.codigo} · por ítem`),
          tabla(['Ítem', ['Certificado', 'num'], ['Ingreso', 'num'], ['Producido', 'num'], ['Costo presup.', 'num'], ['Costo real', 'num'], ['Desvío', 'num'], ['Margen', 'num'], ['Margen %', 'num'], ['Costo por unidad', 'num']],
            r.filas.map((x) => h('tr', {}, h('td', { style: { minWidth: '11rem' } }, x.item ? `${x.item.codigo} · ${x.item.descripcion}` : h('em', {}, 'Sin ítem (gastos generales)')),
              num(x.item ? `${cantidadAR(x.cantidad_certificada / 1000)} ${x.item.unidad}` : ''), num(cent(x.ingreso)), num(x.item ? `${cantidadAR(x.producido / 1000)} ${x.item.unidad}` : ''),
              num(cent(x.costo_presupuestado)), num(h('strong', {}, cent(x.costo_real))), num(cent(x.desvio), x.desvio > 0 ? 'texto-negativo' : ''), num(cent(x.margen), signo(x.margen)), num(pc(x.margen_pct)),
              num(x.costo_unitario !== null ? `${cent(x.costo_unitario)} por ${unidadNombre(x.item?.unidad)}` : '—'))),
            'Sin certificados ni costos en el período.',
            h('tfoot', {}, h('tr', {}, h('td', {}, h('strong', {}, 'Total')), h('td'), num(h('strong', {}, cent(t.ingreso))), h('td'), num(h('strong', {}, cent(t.costo_presupuestado))),
              num(h('strong', {}, cent(t.costo_real))), num(h('strong', {}, cent(t.desvio))), num(h('strong', {}, cent(t.margen))), num(h('strong', {}, pc(t.margen_pct))), h('td')))),
          h('p', { class: 'campo-ayuda' }, 'Ingreso: certificados aprobados, facturados o cobrados, por fecha de aprobación. Costo real: compras imputadas, personal, equipos, materiales e indirectos (Etapa 7). Costo presupuestado: costo unitario del contrato × lo producido según los partes. Desvío = real − presupuestado. Margen = ingreso − costo real.')));
    };
    const armar = () => {
      if (!ultimo) throw new Error('No hay datos para exportar.');
      const { k, r } = ultimo;
      return { titulo: `Rentabilidad ${k.codigo}`, filtros: [['Contrato', `${k.codigo} · ${k.descripcion}`], ['Cliente', k.cliente], ['Período', periodoTexto(f.d.value, f.h.value)]],
        notas: ['Ingreso: certificados aprobados por fecha de aprobación. Costo real: compras + personal + equipos + materiales + indirectos.'],
        secciones: [{ titulo: 'Por ítem', columnas: [col('Ítem'), col('Unidad'), col('Certificado', 'numero'), col('Ingreso', 'pesos'), col('Producido', 'numero'), col('Costo presupuestado', 'pesos'),
          col('Costo real', 'pesos'), col('Desvío', 'pesos'), col('Margen', 'pesos'), col('Margen %', 'numero'), col('Costo por unidad', 'pesos')],
        filas: r.filas.map((x) => [x.item ? `${x.item.codigo} · ${x.item.descripcion}` : 'Sin ítem', x.item?.unidad ?? '', x.cantidad_certificada / 1000, x.ingreso, x.producido / 1000, x.costo_presupuestado,
          x.costo_real, x.desvio, x.margen, x.margen_pct, x.costo_unitario]),
        totales: ['Total', '', null, r.totales.ingreso, null, r.totales.costo_presupuestado, r.totales.costo_real, r.totales.desvio, r.totales.margen, r.totales.margen_pct, null] },
        { titulo: 'Composición del costo real', columnas: [col('Ítem'), col('Mano de obra', 'pesos'), col('Equipos', 'pesos'), col('Materiales', 'pesos'), col('Otras compras', 'pesos'), col('Indirectos', 'pesos'), col('Total', 'pesos')],
          filas: r.costo.filas.filter((x) => x.total).map((x) => [x.item ? `${x.item.codigo} · ${x.item.descripcion}` : 'Sin ítem', x.mano_obra, x.equipos, x.materiales, x.compras, x.indirectos, x.total]),
          totales: ['Total', r.costo.totales.mano_obra, r.costo.totales.equipos, r.costo.totales.materiales, r.costo.totales.compras, r.costo.totales.indirectos, r.costo.totales.total] }] };
    };
    const refiltrar = () => { llenarContratos(); pintar(); };
    fCli.onchange = refiltrar; fRuta.onchange = refiltrar; fTipo.onchange = refiltrar; fK.onchange = pintar; f.d.onchange = pintar; f.h.onchange = pintar;
    llenarContratos();
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Cliente', fCli), campo('Ruta', fRuta), campo('Tipo de trabajo', fTipo), campo('Contrato', fK),
      campo('Desde', f.d), campo('Hasta', f.h), botonesExportar(armar)),
      h('p', { class: 'campo-ayuda' }, 'Filtro por tramo: A CONFIRMAR. Hoy los partes y las compras se cargan por contrato e ítem, no por tramo.')), zona);
    await pintar();
  },

  // ------------------------------------------------------------ IVA Ventas
  async 'iva-ventas'(cuerpo) {
    const f = fechas(primeroMes(), ultimoMes()); const zona = h('div'); let r = null;
    const pintar = async () => {
      vaciar(zona, cargando());
      r = await reporteIvaVentas(f.d.value, f.h.value);
      vaciar(zona,
        h('div', { class: 'panel-cifras' }, dato('Débito fiscal', cent(r.debitoFiscal)), dato('Neto gravado', cent(r.totales.neto_gravado)), dato('Exento y no gravado', cent(r.totales.exento + r.totales.no_gravado)), dato('Total facturado', cent(r.totales.total))),
        h('section', { class: 'tarjeta' }, h('h2', {}, `Comprobantes (${r.filas.length})`),
          tabla(['Fecha', 'Comprobante', 'Cliente', 'CUIT', ['Neto gravado', 'num'], ['IVA', 'num'], ['Exento', 'num'], ['No gravado', 'num'], ['Otros trib.', 'num'], ['Total', 'num']],
            r.filas.map((x) => h('tr', {}, h('td', {}, fechaAR(x.fecha)), h('td', {}, `${x.tipo_descripcion} ${x.numero_formateado}`), h('td', {}, x.cliente), h('td', {}, x.cliente_cuit ?? ''),
              num(cent(x.neto_gravado), signo(x.total)), num(cent(x.iva), signo(x.total)), num(cent(x.exento)), num(cent(x.no_gravado)), num(cent(x.otros_tributos)), num(cent(x.total), signo(x.total)))), 'Sin comprobantes en el período.',
            h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, h('strong', {}, 'Totales')), ...['neto_gravado', 'iva', 'exento', 'no_gravado', 'otros_tributos', 'total'].map((k) => num(h('strong', {}, cent(r.totales[k])))))))),
        h('div', { class: 'grilla-2' },
          h('section', { class: 'tarjeta' }, h('h2', {}, 'Por alícuota'), tabla(['Alícuota', ['Neto', 'num'], ['IVA', 'num']], r.porAlicuota.map((a) => h('tr', {}, h('td', {}, TEXTO_ALICUOTA(a.porcentaje)), num(cent(a.neto)), num(cent(a.iva)))), '—')),
          h('section', { class: 'tarjeta' }, h('h2', {}, 'Por tratamiento'), tabla(['Tratamiento', ['Importe', 'num']], r.tratamiento.map(([t, v]) => h('tr', {}, h('td', {}, t), num(cent(v)))), '—'))));
    };
    const armar = () => ({ titulo: `IVA Ventas ${periodoTexto(f.d.value, f.h.value)}`, archivo: `IVA Ventas ${f.d.value} ${f.h.value}`, filtros: [['Período', periodoTexto(f.d.value, f.h.value)]],
      notas: ['Las notas de crédito restan. No incluye comprobantes anulados por error de carga.'],
      secciones: [{ titulo: 'Comprobantes', columnas: [col('Fecha', 'fecha'), col('Comprobante'), col('Cliente'), col('CUIT'), col('Neto gravado', 'pesos'), col('IVA', 'pesos'), col('Exento', 'pesos'), col('No gravado', 'pesos'), col('Otros tributos', 'pesos'), col('Total', 'pesos')],
        filas: r.filas.map((x) => [x.fecha, `${x.tipo_descripcion} ${x.numero_formateado}`, x.cliente, x.cliente_cuit, x.neto_gravado, x.iva, x.exento, x.no_gravado, x.otros_tributos, x.total]),
        totales: ['Totales', '', '', '', r.totales.neto_gravado, r.totales.iva, r.totales.exento, r.totales.no_gravado, r.totales.otros_tributos, r.totales.total] },
      { titulo: 'Por alícuota', columnas: [col('Alícuota'), col('Neto', 'pesos'), col('IVA (débito fiscal)', 'pesos')], filas: r.porAlicuota.map((a) => [TEXTO_ALICUOTA(a.porcentaje), a.neto, a.iva]),
        totales: ['Total', r.porAlicuota.reduce((s, a) => s + a.neto, 0), r.debitoFiscal] },
      { titulo: 'Por tratamiento', columnas: [col('Tratamiento'), col('Importe', 'pesos')], filas: r.tratamiento }] });
    f.d.onchange = pintar; f.h.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', f.d), campo('Hasta', f.h), botonesExportar(armar), botonLID(f))), zona);
    await pintar();
  },

  // ------------------------------------------------------------ IVA Compras
  async 'iva-compras'(cuerpo) {
    const f = fechas(primeroMes(), ultimoMes()); const zona = h('div'); let r = null;
    const pintar = async () => {
      vaciar(zona, cargando());
      r = await reporteIvaCompras(f.d.value, f.h.value);
      const t = r.totales;
      vaciar(zona,
        h('div', { class: 'panel-cifras' }, dato('Crédito fiscal computable', cent(r.creditoFiscal)), dato('IVA no computable', cent(t.iva_no_computable), 'Lo que va al costo'),
          dato('Percepciones de IVA', cent(t.perc_iva)), dato('Percepciones de IIBB', cent(t.perc_iibb)), dato('Total comprado', cent(t.total))),
        h('section', { class: 'tarjeta' }, h('h2', {}, `Comprobantes (${r.filas.length})`),
          tabla(['Fecha', 'Comprobante', 'Proveedor', 'CUIT', ['Neto gravado', 'num'], ['IVA', 'num'], ['Crédito fiscal', 'num'], ['Exento / no grav.', 'num'], ['Sin discriminar', 'num'], ['Perc. IVA', 'num'], ['Perc. IIBB', 'num'], ['Otras perc.', 'num'], ['Total', 'num']],
            r.filas.map((x) => h('tr', {}, h('td', {}, fechaAR(x.fecha)), h('td', {}, `${x.tipo_descripcion} ${x.numero_formateado}`), h('td', {}, x.proveedor), h('td', {}, x.proveedor_cuit ?? ''),
              num(cent(x.neto_gravado)), num(cent(x.iva)), num(cent(x.credito_fiscal)), num(cent(x.exento_no_gravado)), num(cent(x.sin_discriminar)), num(cent(x.perc_iva)), num(cent(x.perc_iibb)), num(cent(x.perc_otras)), num(cent(x.total), signo(x.total)))),
            'Sin comprobantes en el período.',
            h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, h('strong', {}, 'Totales')),
              ...['neto_gravado', 'iva', 'credito_fiscal', 'exento_no_gravado', 'sin_discriminar', 'perc_iva', 'perc_iibb', 'perc_otras', 'total'].map((k) => num(h('strong', {}, cent(t[k])))))))),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Por alícuota'), tabla(['Alícuota', ['Neto', 'num'], ['IVA', 'num'], ['Computable', 'num']],
          r.porAlicuota.map((a) => h('tr', {}, h('td', {}, TEXTO_ALICUOTA(a.porcentaje)), num(cent(a.neto)), num(cent(a.iva)), num(cent(a.computable)))), '—')));
    };
    const armar = () => {
      const t = r.totales;
      return { titulo: `IVA Compras ${periodoTexto(f.d.value, f.h.value)}`, archivo: `IVA Compras ${f.d.value} ${f.h.value}`, filtros: [['Período', periodoTexto(f.d.value, f.h.value)]],
        notas: ['Las notas de crédito restan. Crédito fiscal computable: IVA discriminado de proveedores responsables inscriptos.'],
        secciones: [{ titulo: 'Comprobantes', columnas: [col('Fecha', 'fecha'), col('Comprobante'), col('Proveedor'), col('CUIT'), col('Neto gravado', 'pesos'), col('IVA', 'pesos'), col('Crédito fiscal', 'pesos'),
          col('Exento / no gravado', 'pesos'), col('Sin discriminar', 'pesos'), col('Perc. IVA', 'pesos'), col('Perc. IIBB', 'pesos'), col('Otras perc.', 'pesos'), col('Otros tributos', 'pesos'), col('Total', 'pesos')],
        filas: r.filas.map((x) => [x.fecha, `${x.tipo_descripcion} ${x.numero_formateado}`, x.proveedor, x.proveedor_cuit, x.neto_gravado, x.iva, x.credito_fiscal, x.exento_no_gravado, x.sin_discriminar, x.perc_iva, x.perc_iibb, x.perc_otras, x.otros_tributos, x.total]),
        totales: ['Totales', '', '', '', t.neto_gravado, t.iva, t.credito_fiscal, t.exento_no_gravado, t.sin_discriminar, t.perc_iva, t.perc_iibb, t.perc_otras, t.otros_tributos, t.total] },
        { titulo: 'Por alícuota', columnas: [col('Alícuota'), col('Neto', 'pesos'), col('IVA', 'pesos'), col('Crédito fiscal computable', 'pesos')],
          filas: r.porAlicuota.map((a) => [TEXTO_ALICUOTA(a.porcentaje), a.neto, a.iva, a.computable]) },
        { titulo: 'Resumen', columnas: [col('Concepto'), col('Importe', 'pesos')],
          filas: [['Crédito fiscal computable', r.creditoFiscal], ['IVA no computable (al costo)', t.iva_no_computable], ['Percepciones de IVA', t.perc_iva], ['Percepciones de IIBB', t.perc_iibb], ['Otras percepciones', t.perc_otras]] }] };
    };
    f.d.onchange = pintar; f.h.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', f.d), campo('Hasta', f.h), botonesExportar(armar), botonLID(f))), zona);
    await pintar();
  },

  // ------------------------------------------------------------ Retenciones y percepciones
  async retenciones(cuerpo) {
    const f = fechas(primeroMes(), ultimoMes()); const zona = h('div'); let r = null;
    const pintar = async () => {
      vaciar(zona, cargando());
      r = await reporteRetenciones(f.d.value, f.h.value);
      vaciar(zona,
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Resumen para el contador'), tabla(['Concepto', ['Importe', 'num']], r.resumen.map(([k, v]) => h('tr', {}, h('td', {}, k), num(cent(v)))), 'Sin retenciones ni percepciones en el período.',
          h('tfoot', {}, h('tr', {}, h('td', {}, h('strong', {}, 'Total a computar')), num(h('strong', {}, cent(r.total))))))),
        h('section', { class: 'tarjeta' }, h('h2', {}, `Retenciones sufridas (${r.retenciones.length})`),
          tabla(['Fecha', 'Tipo', 'Certificado', 'Cliente', 'Comprobante', ['Base', 'num'], ['Alícuota', 'num'], ['Importe', 'num']], r.retenciones.map((x) => h('tr', {}, h('td', {}, fechaAR(x.fecha)),
            h('td', {}, NOMBRES_RET[x.tipo] ?? x.tipo), h('td', {}, x.numero_certificado), h('td', {}, x.cliente), h('td', {}, x.comprobante_numero ?? `Recibo N° ${x.recibo}`),
            num(x.base !== null ? cent(x.base) : ''), num(x.alicuota ? pc(Number(x.alicuota)) : ''), num(cent(x.importe)))), 'Sin retenciones.')),
        h('section', { class: 'tarjeta' }, h('h2', {}, `Percepciones sufridas en compras (${r.percepciones.length})`),
          tabla(['Fecha', 'Tipo', 'Proveedor', 'Comprobante', ['Importe', 'num']], r.percepciones.map((x) => h('tr', {}, h('td', {}, fechaAR(x.fecha)), h('td', {}, NOMBRES_PERC[x.tipo] ?? x.tipo),
            h('td', {}, x.proveedor), h('td', {}, x.numero_formateado), num(cent(x.importe), signo(x.importe)))), 'Sin percepciones.')));
    };
    const armar = () => ({ titulo: `Retenciones y percepciones ${periodoTexto(f.d.value, f.h.value)}`, archivo: `Retenciones y percepciones ${f.d.value} ${f.h.value}`, filtros: [['Período', periodoTexto(f.d.value, f.h.value)]],
      secciones: [{ titulo: 'Resumen', columnas: [col('Concepto'), col('Importe', 'pesos')], filas: r.resumen, totales: ['Total', r.total] },
        { titulo: 'Retenciones sufridas', columnas: [col('Fecha', 'fecha'), col('Tipo'), col('Certificado'), col('Cliente'), col('CUIT'), col('Comprobante'), col('Base', 'pesos'), col('Alícuota %', 'numero'), col('Importe', 'pesos')],
          filas: r.retenciones.map((x) => [x.fecha, NOMBRES_RET[x.tipo] ?? x.tipo, x.numero_certificado, x.cliente, x.cliente_cuit, x.comprobante_numero ?? `Recibo ${x.recibo}`, x.base, x.alicuota === null ? null : Number(x.alicuota), x.importe]) },
        { titulo: 'Percepciones sufridas', columnas: [col('Fecha', 'fecha'), col('Tipo'), col('Proveedor'), col('CUIT'), col('Comprobante'), col('Importe', 'pesos')],
          filas: r.percepciones.map((x) => [x.fecha, NOMBRES_PERC[x.tipo] ?? x.tipo, x.proveedor, x.proveedor_cuit, x.numero_formateado, x.importe]) }] });
    f.d.onchange = pintar; f.h.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', f.d), campo('Hasta', f.h), botonesExportar(armar))), zona);
    await pintar();
  },

  // ------------------------------------------------------------ Saldos y vencimientos
  async saldos(cuerpo) {
    const fC = h('input', { type: 'date', value: hoyISO(), 'aria-label': 'Al' }); const zona = h('div'); let r = null;
    const bloque = (titulo, x, link) => h('section', { class: 'tarjeta' }, h('h2', {}, titulo, ' ', h('a', { class: 'btn btn-chico', href: link }, 'Ver detalle')),
      tabla(['', ...TRAMOS_VENC.map((t) => [t, 'num']), ['Total', 'num']], x.filas.map((f) => h('tr', {}, h('td', {}, f.tercero), ...f.tramos.map((v, i) => num(v ? cent(v) : '', i >= 2 && v ? 'texto-negativo' : '')), num(h('strong', {}, cent(f.total))))),
        'Sin saldos pendientes.', h('tfoot', {}, h('tr', {}, h('td', {}, h('strong', {}, 'Total')), ...x.totales.tramos.map((v) => num(h('strong', {}, cent(v)))), num(h('strong', {}, cent(x.totales.total)))))));
    const pintar = async () => {
      vaciar(zona, cargando());
      r = await reporteSaldos(fC.value);
      vaciar(zona, bloque('A cobrar (clientes)', r.clientes, '#/ventas/cuenta'), bloque('A pagar (proveedores)', r.proveedores, '#/compras/vencimientos'));
    };
    const sec = (titulo, x) => [{ titulo: `${titulo} por antigüedad`, columnas: [col('Tercero'), ...TRAMOS_VENC.map((t) => col(t, 'pesos')), col('Total', 'pesos')],
      filas: x.filas.map((f) => [f.tercero, ...f.tramos, f.total]), totales: ['Total', ...x.totales.tramos, x.totales.total] },
    { titulo: `${titulo} detalle`, columnas: [col('Tercero'), col('Comprobante'), col('Fecha', 'fecha'), col('Vence', 'fecha'), col('Días de atraso', 'numero'), col('Saldo', 'pesos')],
      filas: x.filas.flatMap((f) => f.documentos.map((d) => [f.tercero, d.numero, d.fecha, d.vencimiento, d.atraso, d.saldo])) }];
    const armar = () => ({ titulo: `Saldos y vencimientos al ${fechaAR(fC.value)}`, filtros: [['Fecha de corte', fechaAR(fC.value)]],
      secciones: [...sec('A cobrar', r.clientes), ...sec('A pagar', r.proveedores)] });
    fC.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Al', fC), botonesExportar(armar))), zona);
    await pintar();
  },

  // ------------------------------------------------------------ Otros
  async otros(cuerpo) {
    const it = (titulo, texto, href) => h('a', { class: 'dato', href, style: { textDecoration: 'none', color: 'inherit' } }, h('div', { class: 'dato-titulo' }, titulo), h('div', {}, texto));
    vaciar(cuerpo, h('div', { class: 'panel-cifras' },
      it('Libro diario', 'Asientos del período, con Excel y PDF.', '#/contabilidad/diario'),
      it('Mayor', 'Movimientos y saldo de una cuenta.', '#/contabilidad/mayor'),
      it('Sumas y saldos', 'Balance de comprobación.', '#/contabilidad/sumas'),
      it('Estado de resultados', 'Ingresos, costos y gastos.', '#/contabilidad/resultados'),
      it('Situación patrimonial', 'Activo, pasivo y patrimonio.', '#/contabilidad/patrimonio'),
      it('Flujo de fondos', 'Real y proyectado, por semana o mes.', '#/tesoreria/flujo'),
      it('Cuenta corriente de clientes', 'Movimientos por cliente.', '#/ventas/cuenta'),
      it('Vencimientos a pagar', 'Facturas de proveedores por vencer.', '#/compras/vencimientos'),
      it('Costo por ítem', 'Detalle de partes, consumos e indirectos.', '#/costos/costo')));
  },
};

/** Botón del Libro IVA Digital: descarga un .zip con los 4 archivos de ancho fijo (BORRADOR). */
function botonLID(f) {
  return h('button', { class: 'btn', type: 'button', title: 'Borrador para revisar con el contador',
    onclick: async () => {
      const l = await reporteLibroIva(f.d.value, f.h.value);
      const enc = new TextEncoder();
      const per = f.d.value.slice(0, 7);
      const leeme = ['LIBRO IVA DIGITAL - BORRADOR PARA REVISAR CON EL CONTADOR', `Periodo: ${f.d.value} al ${f.h.value}`, '',
        'Archivos de ancho fijo (VENTAS_CBTE, VENTAS_ALICUOTAS, COMPRAS_CBTE, COMPRAS_ALICUOTAS) para importar en "Libro IVA Digital" de ARCA.',
        'Revisar antes de presentar: codigos de comprobante, tratamiento de exentos y no gravados, percepciones y credito fiscal computable.',
        ...(l.avisos.length ? ['', 'AVISOS:', ...l.avisos] : [])].join('\r\n');
      descargar(zip([['LEEME_BORRADOR.txt', leeme], ['VENTAS_CBTE.txt', l.ventasCbte], ['VENTAS_ALICUOTAS.txt', l.ventasAlicuotas], ['COMPRAS_CBTE.txt', l.comprasCbte], ['COMPRAS_ALICUOTAS.txt', l.comprasAlicuotas]]
        .map(([nombre, s]) => ({ nombre, datos: enc.encode(s) }))), `Libro_IVA_Digital_BORRADOR_${per}.zip`, 'application/zip');
    } }, 'Libro IVA Digital (borrador)');
}
