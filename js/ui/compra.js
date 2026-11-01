// Comprobantes de compra: carga (también desde el celular, con foto) y detalle.
// El motor de IVA decide si hay crédito fiscal; el costo se imputa a contratos, ítems
// y centros de costo en porcentajes que suman 100.
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, leerPesos, confirmar } from './dom.js';
import { compras, proveedores, contratos, centrosCosto, fiscal, adjuntos } from '../data/repos.js';
import { panelAdjuntos } from './adjuntos.js';
import { editarProveedor } from './proveedores.js';
import { nombreCompra, etiquetaCompra } from './compras.js';
import { aCentavos } from '../core/redondeo.js';
import { calcularCompra, buscarDuplicado, CATEGORIAS_COSTO, TIPOS_PERCEPCION, CATEGORIAS_PROVEEDOR } from '../core/compras.js';
import { validarNumeracion } from '../core/ventas.js';
import { formatearCuit } from '../core/cuit.js';

const aTxt = (c) => (c / 100).toFixed(2);
const mostrar = (c) => (c ? cent(c).replace('$ ', '') : '');
const leerCent = (v) => { try { return aCentavos(leerPesos(v) ?? 0); } catch { return NaN; } };
// Rubro del proveedor -> categoría de costo propuesta
const CATEGORIA_DE_RUBRO = { pinturas: 'materiales', materiales: 'materiales', combustible: 'equipos', alquiler_equipos: 'equipos',
  subcontratistas: 'subcontratos', transporte: 'otros', seguridad: 'materiales', seguros: 'otros', servicios: 'otros', otros: 'otros' };

// =====================================================================
// Carga: "" | "nc:<id>" | "oc:<id>" | "prov:<id>"
// =====================================================================
export async function pantallaNuevaCompra(cont, ctx, param) {
  const rol = ctx.perfil.rol;
  if (!['administrador', 'contador', 'operador'].includes(rol)) {
    vaciar(cont, h('div', { class: 'tarjeta tarjeta-error' }, 'Tu usuario es de solo consulta: no puede cargar comprobantes.'));
    return;
  }
  const [modo, ref] = String(param ?? '').split(':');
  await pantalla(cont, async () => {
    const [catalogo, provs, condiciones, ctrs, centros, existentes, ocs] = await Promise.all([
      fiscal.catalogo(), proveedores.listar(), fiscal.condicionesIva(), contratos.listar(), centrosCosto.listar(), compras.comprobantes(), compras.ordenes()]);
    const hoy = hoyISO();
    const itemsPorContrato = {};
    const cargarItems = async (id) => { if (id && !itemsPorContrato[id]) itemsPorContrato[id] = (await contratos.items(id)).filter((i) => i.activo); };
    const activos = ctrs.filter((c) => !['finalizado', 'rescindido'].includes(c.estado));

    let asociado = null; let oc = null;
    if (modo === 'nc') { asociado = await compras.comprobante(ref); if (!asociado) throw new Error('No se encontró el comprobante asociado.'); }
    if (modo === 'oc') oc = ocs.find((o) => o.id === ref) ?? null;
    const est = {
      proveedor_id: asociado?.proveedor_id ?? oc?.proveedor_id ?? (modo === 'prov' ? ref : ''),
      lineas: [{ tratamiento: 'gravado', alicuota: 'IVA_21', importe: 0 }],
      percepciones: [],
      imputacion: [],
      foto: null,
    };
    const prov = () => provs.find((p) => p.id === est.proveedor_id);
    const contratoInicial = asociado ? null : (oc?.contrato_id ?? (activos.length === 1 ? activos[0].id : ''));
    const resetImputacion = () => {
      est.imputacion = [{ contrato_id: contratoInicial ?? '', item_id: '', centro_costo_id: '', categoria: CATEGORIA_DE_RUBRO[prov()?.categoria] ?? 'materiales', porcentaje: 100 }];
    };
    resetImputacion();
    if (contratoInicial) await cargarItems(contratoInicial);
    if (asociado) { // la NC se imputa igual que la factura
      const det = await compras.detalle(asociado.id);
      est.imputacion = det.imputaciones.map((i) => ({ contrato_id: i.contrato_id ?? '', item_id: i.item_id ?? '', centro_costo_id: i.centro_costo_id ?? '', categoria: i.categoria ?? '', porcentaje: Number(i.porcentaje) }));
      for (const i of est.imputacion) await cargarItems(i.contrato_id);
      est.lineas = [{ tratamiento: 'gravado', alicuota: det.alicuotas[0]?.alicuota ?? 'IVA_21', importe: 0 }];
    }
    const clase = asociado ? 'nota_credito' : null;

    // ---- Tipos posibles según el proveedor
    const tiposPara = () => {
      const p = prov();
      const letras = !p ? ['A', 'B', 'C', 'M', 'X'] : p.condicion_iva === 'RI' ? ['A', 'M', 'B', 'X'] : ['C', 'X'];
      return catalogo.tiposComprobante.filter((t) => t.activo !== false && letras.includes(t.letra)
        && (clase ? t.clase === clase && t.letra === asociado.letra : ['factura', 'nota_debito', 'ticket'].includes(t.clase)));
    };
    const alicuotas = [...new Map(catalogo.parametros.filter((p) => p.tipo === 'ALICUOTA_IVA' && p.valor !== null).map((p) => [p.codigo, p.descripcion ?? p.codigo])).entries()];

    // ---- Controles
    const f = {
      prov: select([['', 'Elegí el proveedor'], ...provs.filter((p) => p.activo).map((p) => [p.id, `${p.razon_social}${p.cuit ? ' · ' + formatearCuit(p.cuit) : ''}`])], est.proveedor_id,
        { required: true, disabled: !!asociado, 'aria-label': 'Proveedor' }),
      tipo: h('select', { required: true, 'aria-label': 'Tipo de comprobante' }),
      pv: h('input', { inputmode: 'numeric', required: true, placeholder: 'Ej. 4', 'aria-label': 'Punto de venta' }),
      numero: h('input', { inputmode: 'numeric', required: true, 'aria-label': 'Número' }),
      fecha: h('input', { type: 'date', required: true, value: hoy, 'aria-label': 'Fecha' }),
      venc: h('input', { type: 'date', 'aria-label': 'Vencimiento' }),
      desc: h('input', { placeholder: 'Ej. 200 L esmalte sintético', 'aria-label': 'Descripción', value: oc?.descripcion ?? '' }),
      oc: select([['', 'Sin orden de compra']], oc?.id ?? '', { 'aria-label': 'Orden de compra' }),
      otros: h('input', { inputmode: 'decimal', placeholder: '0', 'aria-label': 'Otros tributos' }),
      obs: h('textarea', { rows: 2, 'aria-label': 'Observación' }),
      foto: h('input', { type: 'file', accept: 'image/*,application/pdf', capture: 'environment', 'aria-label': 'Foto del comprobante' }),
    };
    const avisoDup = h('div');
    const zonaLineas = h('div'); const zonaPerc = h('div'); const zonaImp = h('div'); const zonaTot = h('div');
    let calc = null;

    const pintarTipos = () => {
      const ts = tiposPara();
      const previo = f.tipo.value;
      vaciar(f.tipo, ts.map((t) => h('option', { value: t.codigo }, `${t.descripcion} (${t.codigo})`)));
      if (ts.some((t) => t.codigo === previo)) f.tipo.value = previo;
      const ocsProv = ocs.filter((o) => o.proveedor_id === est.proveedor_id && o.estado === 'abierta');
      const ocPrev = f.oc.value;
      vaciar(f.oc, [['', 'Sin orden de compra'], ...ocsProv.map((o) => [o.id, `OC N° ${o.numero} · ${o.descripcion}`])].map(([v, t]) => h('option', { value: v }, t)));
      if (ocsProv.some((o) => o.id === ocPrev)) f.oc.value = ocPrev;
    };
    const tipoActual = () => catalogo.tiposComprobante.find((t) => t.codigo === f.tipo.value);
    const revisarDuplicado = () => {
      const delProv = existentes.filter((e) => e.proveedor_id === est.proveedor_id);
      const d = f.pv.value && f.numero.value ? buscarDuplicado({ cuit: '', tipo_codigo: f.tipo.value, punto_venta: f.pv.value, numero: f.numero.value },
        delProv.map((e) => ({ ...e, cuit: '' }))) : null;
      vaciar(avisoDup, d ? h('div', { class: 'tarjeta tarjeta-error' }, h('strong', {}, '⚠ Comprobante duplicado: '),
        `${nombreCompra(d)} de este proveedor ya está cargado (${fechaAR(d.fecha)}, ${pesos(d.total)}). `, h('a', { href: `#/compra/${d.id}`, target: '_blank' }, 'Ver el que está cargado')) : null);
      return d;
    };

    const recalcular = () => {
      const tipo = tipoActual();
      const discrimina = tipo?.discrimina_iva !== false;
      const otros = leerCent(f.otros.value);
      calc = calcularCompra({
        tipoCodigo: f.tipo.value, condicionProveedor: prov()?.condicion_iva ?? 'RI', fecha: f.fecha.value || hoy, modo: discrimina ? 'desde_neto' : 'desde_total',
        lineas: est.lineas.map((l) => ({ tratamiento: discrimina ? l.tratamiento : 'gravado', alicuota: l.alicuota, neto: l.importe, total: l.importe })),
        percepciones: est.percepciones, otrosTributos: Number.isNaN(otros) ? 0 : otros,
        imputacion: est.imputacion.map((i) => ({ ...i, contrato_id: i.contrato_id || null, item_id: i.item_id || null, centro_costo_id: i.centro_costo_id || null, categoria: i.categoria || null })),
      }, catalogo);
      // Líneas
      vaciar(zonaLineas, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, h('th', {}, discrimina ? 'Neto' : 'Importe total'), discrimina ? [h('th', {}, 'Alícuota'), h('th', {}, 'Tratamiento')] : null, h('th'))),
        h('tbody', {}, est.lineas.map((l, i) => h('tr', {},
          h('td', {}, h('input', { class: 'input-num', inputmode: 'decimal', value: mostrar(l.importe), 'aria-label': `Importe línea ${i + 1}`,
            onchange: (e) => { const v = leerCent(e.target.value); if (Number.isNaN(v)) { error(`Importe inválido: ${e.target.value}`); return; } l.importe = v; recalcular(); } })),
          discrimina ? [
            h('td', {}, l.tratamiento === 'gravado' ? select(alicuotas, l.alicuota, { 'aria-label': `Alícuota línea ${i + 1}`, onchange: (e) => { l.alicuota = e.target.value; recalcular(); } }) : '—'),
            h('td', {}, select([['gravado', 'Gravado'], ['exento', 'Exento'], ['no_gravado', 'No gravado']], l.tratamiento, { 'aria-label': `Tratamiento línea ${i + 1}`, onchange: (e) => { l.tratamiento = e.target.value; recalcular(); } }))] : null,
          h('td', {}, est.lineas.length > 1 ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.lineas.splice(i, 1); recalcular(); } }, 'Quitar') : null))))),
        discrimina ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.lineas.push({ tratamiento: 'gravado', alicuota: 'IVA_10_5', importe: 0 }); recalcular(); } }, '+ Otra alícuota') : null));
      // Percepciones
      vaciar(zonaPerc, est.percepciones.length ? h('table', { class: 'tabla' }, h('tbody', {}, est.percepciones.map((p, i) => h('tr', {},
        h('td', {}, select(Object.entries(TIPOS_PERCEPCION), p.tipo, { 'aria-label': `Percepción ${i + 1}`, onchange: (e) => { p.tipo = e.target.value; recalcular(); } }),
          p.tipo === 'OTRA' ? h('input', { placeholder: 'Cuál', value: p.descripcion ?? '', onchange: (e) => { p.descripcion = e.target.value; } }) : null),
        h('td', {}, h('input', { class: 'input-num', inputmode: 'decimal', value: mostrar(p.importe), 'aria-label': `Importe percepción ${i + 1}`,
          onchange: (e) => { const v = leerCent(e.target.value); if (!Number.isNaN(v)) { p.importe = v; recalcular(); } } })),
        h('td', {}, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.percepciones.splice(i, 1); recalcular(); } }, 'Quitar')))))) : null,
        h('div', { class: 'botones-agregar' }, ['PERC_IVA', 'PERC_IIBB_CBA', 'OTRA'].map((t) => h('button', { class: 'btn btn-chico', type: 'button',
          onclick: () => { est.percepciones.push({ tipo: t, importe: 0 }); recalcular(); } }, `+ ${TIPOS_PERCEPCION[t]}`))));
      // Imputación
      const imp = calc.ok ? calc.imputacion : [];
      const sumaPct = est.imputacion.reduce((s, x) => s + (Number(String(x.porcentaje).replace(',', '.')) || 0), 0);
      vaciar(zonaImp, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Contrato', 'Ítem', 'Centro de costo', 'Categoría', '%', 'Importe', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, est.imputacion.map((x, i) => h('tr', {},
          h('td', {}, select([['', '—'], ...ctrs.map((c) => [c.id, c.codigo])], x.contrato_id, { 'aria-label': `Contrato imputación ${i + 1}`,
            onchange: async (e) => { x.contrato_id = e.target.value; x.item_id = ''; await cargarItems(x.contrato_id); recalcular(); } })),
          h('td', {}, x.contrato_id ? select([['', 'Todo el contrato'], ...(itemsPorContrato[x.contrato_id] ?? []).map((it) => [it.id, `${it.codigo} · ${it.descripcion}`])], x.item_id,
            { 'aria-label': `Ítem imputación ${i + 1}`, onchange: (e) => { x.item_id = e.target.value; } }) : '—'),
          h('td', {}, select([['', '—'], ...centros.filter((c) => c.activo).map((c) => [c.id, `${c.codigo} · ${c.nombre}`])], x.centro_costo_id,
            { 'aria-label': `Centro de costo imputación ${i + 1}`, onchange: (e) => { x.centro_costo_id = e.target.value; recalcular(); } })),
          h('td', {}, select([['', '—'], ...Object.entries(CATEGORIAS_COSTO)], x.categoria, { 'aria-label': `Categoría imputación ${i + 1}`, onchange: (e) => { x.categoria = e.target.value; } })),
          h('td', {}, h('input', { class: 'input-pct', inputmode: 'decimal', value: String(x.porcentaje).replace('.', ','), 'aria-label': `Porcentaje imputación ${i + 1}`,
            onchange: (e) => { x.porcentaje = e.target.value.trim().replace(',', '.'); recalcular(); } })),
          h('td', { class: 'num' }, imp[i] ? cent(imp[i].importe) : '—'),
          h('td', {}, est.imputacion.length > 1 ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.imputacion.splice(i, 1); recalcular(); } }, 'Quitar') : null)))),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, h('strong', {}, 'Total')), h('td', {}, h('strong', { class: Math.abs(sumaPct - 100) > 0.001 ? 'texto-alerta' : '' }, `${sumaPct.toLocaleString('es-AR')} %`)),
          h('td', { class: 'num' }, calc.ok ? h('strong', {}, cent(calc.costo)) : '—'), h('td'))))),
        h('div', { class: 'botones-agregar' },
          h('button', { class: 'btn btn-chico', type: 'button', onclick: () => {
            const resto = Math.max(0, Math.round((100 - sumaPct) * 100) / 100);
            est.imputacion.push({ contrato_id: est.imputacion[0]?.contrato_id ?? '', item_id: '', centro_costo_id: '', categoria: est.imputacion[0]?.categoria ?? '', porcentaje: resto });
            recalcular();
          } }, '+ Repartir en otra línea')));
      // Totales
      const sinImportes = !est.lineas.some((l) => l.importe) && !est.percepciones.some((p) => p.importe);
      if (sinImportes) { vaciar(zonaTot, h('p', { class: 'texto-suave' }, 'Cargá el importe para ver el total, el crédito fiscal y el costo.')); return; }
      if (!calc.ok) { vaciar(zonaTot, h('div', { class: 'tarjeta tarjeta-error' }, h('ul', {}, calc.errores.map((x) => h('li', {}, x))))); return; }
      const fila = (k, v, fuerte) => h('tr', {}, h('td', {}, fuerte ? h('strong', {}, k) : k), h('td', { class: 'num' }, fuerte ? h('strong', {}, v) : v));
      vaciar(zonaTot,
        calc.advertencias.length ? h('ul', { class: 'advertencias tarjeta' }, calc.advertencias.map((a) => h('li', {}, a))) : null,
        h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
          Object.entries(calc.porAlicuota).map(([, a]) => [fila(`Neto gravado ${(a.bp / 100).toLocaleString('es-AR')} %`, cent(a.neto)), fila(`IVA ${(a.bp / 100).toLocaleString('es-AR')} %${calc.iva.ivaContenido ? ' (contenido)' : ''}`, cent(a.iva))]),
          calc.exento ? fila('Exento', cent(calc.exento)) : null,
          calc.noGravado ? fila(calc.iva.discriminaIva ? 'No gravado' : 'Importe', cent(calc.noGravado)) : null,
          calc.percepciones.map((p) => fila(TIPOS_PERCEPCION[p.tipo], cent(p.importe))),
          calc.otrosTributos ? fila('Otros tributos', cent(calc.otrosTributos)) : null,
          fila('Total del comprobante', cent(calc.total), true),
          fila(calc.generaCreditoFiscal ? 'IVA crédito fiscal' : 'Sin crédito fiscal', calc.generaCreditoFiscal ? cent(calc.creditoFiscal) : calc.motivoCreditoFiscal),
          fila('Costo de obra (lo que se imputa)', cent(calc.costo), true))));
    };

    // ---- Eventos
    f.prov.addEventListener('change', () => { est.proveedor_id = f.prov.value; resetImputacion(); pintarTipos(); revisarDuplicado(); recalcular(); });
    f.tipo.addEventListener('change', () => { revisarDuplicado(); recalcular(); });
    f.pv.addEventListener('change', revisarDuplicado); f.numero.addEventListener('change', revisarDuplicado);
    f.fecha.addEventListener('change', recalcular); f.otros.addEventListener('change', recalcular);
    f.foto.addEventListener('change', () => { est.foto = f.foto.files[0] ?? null; });
    const nuevoProv = async () => {
      const p = await editarProveedor(null, condiciones);
      if (!p) return;
      provs.push(p);
      f.prov.appendChild(h('option', { value: p.id }, `${p.razon_social}${p.cuit ? ' · ' + formatearCuit(p.cuit) : ''}`));
      f.prov.value = p.id; f.prov.dispatchEvent(new Event('change'));
      aviso('Proveedor creado.');
    };

    // ---- Guardar
    const enviar = async (extra = {}) => {
      const tipo = tipoActual();
      const discrimina = tipo?.discrimina_iva !== false;
      const imp = calc.imputacion.map((x) => ({ contrato_id: x.contrato_id || null, item_id: x.item_id || null, centro_costo_id: x.centro_costo_id || null,
        categoria: x.categoria || null, porcentaje: Number(x.porcentaje), importe: aTxt(x.importe) }));
      const datos = {
        proveedor_id: est.proveedor_id, tipo_codigo: f.tipo.value, punto_venta: Number(f.pv.value), numero: Number(f.numero.value), fecha: f.fecha.value,
        vencimiento: f.venc.value || null, comprobante_asociado_id: asociado?.id ?? null, orden_compra_id: f.oc.value || null,
        descripcion: f.desc.value, observacion: f.obs.value,
        alicuotas: discrimina ? Object.entries(calc.porAlicuota).map(([alicuota, a]) => ({ alicuota, neto: aTxt(a.neto), iva: aTxt(a.iva) })) : [],
        exento: aTxt(discrimina ? calc.exento : 0), no_gravado: aTxt(discrimina ? calc.noGravado : 0),
        sin_discriminar: aTxt(discrimina ? 0 : calc.iva.totales.total),
        otros_tributos: aTxt(calc.otrosTributos),
        percepciones: calc.percepciones.map((p) => ({ tipo: p.tipo, descripcion: p.descripcion, importe: aTxt(p.importe) })),
        imputaciones: imp, ...extra,
      };
      return compras.registrar(datos);
    };
    const guardar = async (e) => {
      e.preventDefault();
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        const errs = validarNumeracion(f.pv.value === '0' ? 1 : f.pv.value, f.numero.value);
        if (!est.proveedor_id) errs.push('Elegí el proveedor.');
        if (!f.fecha.value) errs.push('Falta la fecha.');
        if (f.venc.value && f.venc.value < f.fecha.value) errs.push('El vencimiento no puede ser anterior a la fecha.');
        recalcular();
        if (!calc.ok) errs.push(...calc.errores);
        if (errs.length) throw new Error(errs.join(' '));
        let id;
        try { id = await enviar(); } catch (err) {
          if (!/DUPLICADO/.test(err.message)) throw err;
          if (rol !== 'administrador') throw new Error(`${err.message.split('. Si de verdad')[0]}. Si de verdad es otro comprobante, pedile al administrador que lo cargue.`);
          const motivo = await modal({ titulo: 'Comprobante duplicado', peligro: true, aceptar: 'Cargar igual',
            contenido: [h('p', {}, err.message), campo('Motivo (queda registrado)', h('input', { name: 'm', required: true }))], alAceptar: (fm) => fm.elements.m.value.trim() });
          if (!motivo) return;
          id = await enviar({ forzar_duplicado: true, motivo_duplicado: motivo });
        }
        if (est.foto) {
          try { await adjuntos.subir('comprobantes_compra', id, est.foto, 'Foto del comprobante'); } catch (err) { error(`El comprobante se guardó, pero la foto no se pudo subir: ${err.message}`); }
        }
        aviso(rol === 'operador' ? 'Comprobante cargado. Queda a revisar por el contador.' : 'Comprobante registrado.');
        location.hash = `#/compra/${id}`;
      } catch (err) { error(err.message); } finally { if (btn) btn.disabled = false; }
    };

    const titulo = asociado ? `Nota de crédito sobre ${nombreCompra(asociado)}` : 'Cargar comprobante de compra';
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/compras' }, 'Compras y pagos'), ' › ', titulo),
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, titulo),
        h('p', { class: 'descripcion' }, 'Cargá los datos como figuran en la factura. Desde el celular podés sacarle una foto y queda adjunta.'))),
      asociado ? h('div', { class: 'tarjeta tarjeta-info' }, `${asociado.proveedor} · ${nombreCompra(asociado)} del ${fechaAR(asociado.fecha)} · Total ${pesos(asociado.total)} · Saldo ${pesos(asociado.saldo)}`) : null,
      h('form', { onsubmit: guardar },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Comprobante'),
          h('div', { class: 'form-grilla' },
            h('div', { class: 'campo' }, h('span', { class: 'campo-etiqueta' }, 'Proveedor'), f.prov,
              asociado ? null : h('button', { class: 'btn btn-chico btn-link', type: 'button', onclick: nuevoProv }, '+ Nuevo proveedor')),
            campo('Tipo', f.tipo), campo('Punto de venta', f.pv), campo('Número', f.numero),
            campo('Fecha', f.fecha), campo('Vencimiento de pago', f.venc), campo('Orden de compra', f.oc), campo('Descripción', f.desc)),
          avisoDup,
          campo('Foto o PDF del comprobante', f.foto, 'En el celular abre la cámara. Se guarda adjunta al comprobante.')),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Importes'), zonaLineas,
          h('h3', {}, 'Percepciones sufridas'), zonaPerc,
          h('div', { class: 'form-grilla' }, campo('Otros tributos', f.otros)),
          zonaTot),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Imputación a obra'),
          h('p', { class: 'campo-ayuda' }, 'A qué contrato, ítem o centro de costo va este gasto. Se puede repartir en porcentajes (por ejemplo 60 % a un ítem y 40 % a otro); tiene que sumar 100 %.'),
          zonaImp),
        h('section', { class: 'tarjeta' }, campo('Observación', f.obs),
          h('div', { class: 'acciones' }, h('a', { class: 'btn', href: asociado ? `#/compra/${asociado.id}` : '#/compras' }, 'Cancelar'),
            h('button', { class: 'btn btn-primario', type: 'submit' }, 'Guardar comprobante')))));
    pintarTipos();
    recalcular();
  });
}

// =====================================================================
// Detalle
// =====================================================================
export async function pantallaCompra(cont, ctx, id) {
  const rol = ctx.perfil.rol;
  const puede = ['administrador', 'contador'].includes(rol);
  const carga = puede || rol === 'operador';
  await pantalla(cont, async () => {
    const c = await compras.comprobante(id);
    if (!c) throw new Error('No se encontró el comprobante.');
    const d = await compras.detalle(id);
    const vigente = c.estado === 'emitido';
    const recargar = () => pantallaCompra(cont, ctx, id);

    const revisar = async () => { try { await compras.actualizar(id, { revisado: true }); aviso('Marcado como revisado.'); await recargar(); } catch (e) { error(e.message); } };
    const editar = async () => {
      const ok = await modal({ titulo: 'Datos del comprobante', contenido: [
        h('p', { class: 'texto-suave' }, 'Los importes, el proveedor, el número y la imputación no se modifican. Si están mal, anulalo y cargalo de nuevo.'),
        campo('Vencimiento de pago', h('input', { type: 'date', name: 'venc', value: c.vencimiento ?? '' })),
        campo('Descripción', h('input', { name: 'desc', value: c.descripcion ?? '' })),
        campo('Observación', h('textarea', { name: 'obs', rows: 2 }, c.observacion ?? ''))],
      alAceptar: async (fm) => { await compras.actualizar(id, { vencimiento: fm.elements.venc.value, descripcion: fm.elements.desc.value, observacion: fm.elements.obs.value }); } });
      if (ok) { aviso('Guardado.'); await recargar(); }
    };
    const anular = async () => {
      const motivo = await modal({ titulo: `Anular ${nombreCompra(c)}`, peligro: true, aceptar: 'Anular',
        contenido: [h('p', {}, 'Anular sirve para corregir un error de carga. Si el proveedor bonificó o devolvió algo, lo que corresponde es cargar su nota de crédito.'),
          campo('Motivo', h('input', { name: 'm', required: true }))], alAceptar: (fm) => fm.elements.m.value.trim() });
      if (!motivo) return;
      try { await compras.anular(id, motivo); aviso('Comprobante anulado.'); await recargar(); } catch (e) { error(e.message); }
    };

    const kv = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('span', {}, k), h('strong', {}, v)));
    const acciones = [];
    if (vigente && puede && !c.revisado) acciones.push(h('button', { class: 'btn btn-primario', type: 'button', onclick: revisar }, 'Marcar revisado'));
    if (vigente && puede && c.clase !== 'nota_credito' && aCentavos(c.saldo) > 0) acciones.push(h('a', { class: 'btn', href: `#/nuevo-pago/${c.proveedor_id}` }, 'Pagar'));
    if (vigente && carga && c.clase !== 'nota_credito') acciones.push(h('a', { class: 'btn', href: `#/nueva-compra/nc:${c.id}` }, 'Cargar nota de crédito'));
    if (vigente && puede) acciones.push(h('button', { class: 'btn', type: 'button', onclick: editar }, 'Editar datos'));
    if (vigente && puede) acciones.push(h('button', { class: 'btn btn-peligro', type: 'button', onclick: anular }, 'Anular'));

    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/compras' }, 'Compras y pagos'), ' › ', nombreCompra(c)),
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, `${nombreCompra(c)} `, etiquetaCompra(c)),
          h('p', { class: 'descripcion' }, `${c.proveedor}${c.proveedor_cuit ? ` · CUIT ${formatearCuit(c.proveedor_cuit)}` : ''} · ${fechaAR(c.fecha)}`),
          vigente && !c.revisado ? h('p', { class: 'nota' }, 'Cargado desde la obra: falta que el contador o el administrador lo revise.') : null,
          c.duplicado_autorizado ? h('p', { class: 'nota' }, h('strong', {}, 'Duplicado autorizado: '), c.motivo_duplicado) : null,
          c.estado === 'anulado' ? h('p', { class: 'nota' }, h('strong', {}, 'Anulado: '), c.motivo ?? '') : null),
        h('div', { class: 'acciones acciones-envolver' }, acciones)),
      vigente && c.clase !== 'nota_credito' ? h('div', { class: 'datos' },
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Total'), h('div', { class: 'dato-valor' }, pesos(c.total))),
        aCentavos(c.notas_credito) ? h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Notas de crédito'), h('div', { class: 'dato-valor' }, `− ${pesos(c.notas_credito)}`)) : null,
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Pagado'), h('div', { class: 'dato-valor' }, pesos(c.pagado))),
        h('div', { class: `dato${aCentavos(c.saldo) > 0 ? ' dato-alerta' : ''}` }, h('div', { class: 'dato-titulo' }, 'Saldo'), h('div', { class: 'dato-valor' }, pesos(c.saldo)),
          c.vencimiento ? h('div', { class: 'dato-detalle' }, `Vence ${fechaAR(c.vencimiento)}`) : null)) : null,
      h('div', { class: 'grilla-2' },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Datos'),
          kv('Tipo', `${c.tipo_descripcion} (código ${c.tipo_codigo})`), kv('Punto de venta y número', c.numero_formateado),
          kv('Fecha', fechaAR(c.fecha)), kv('Vencimiento', c.vencimiento ? fechaAR(c.vencimiento) : null),
          kv('Rubro del proveedor', CATEGORIAS_PROVEEDOR[c.proveedor_categoria]),
          c.orden_compra_numero ? kv('Orden de compra', `N° ${c.orden_compra_numero}`) : null,
          c.comprobante_asociado_id ? h('div', { class: 'kv' }, h('span', {}, 'Comprobante asociado'), h('a', { href: `#/compra/${c.comprobante_asociado_id}` }, c.asociado_numero)) : null,
          kv('Descripción', c.descripcion), kv('Observación', c.observacion)),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Importes'),
          h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
            d.alicuotas.map((a) => [h('tr', {}, h('td', {}, `Neto gravado ${Number(a.porcentaje).toLocaleString('es-AR')} %`), h('td', { class: 'num' }, pesos(a.neto))),
              h('tr', {}, h('td', {}, `IVA ${Number(a.porcentaje).toLocaleString('es-AR')} %`), h('td', { class: 'num' }, pesos(a.iva)))]),
            aCentavos(c.exento) ? h('tr', {}, h('td', {}, 'Exento'), h('td', { class: 'num' }, pesos(c.exento))) : null,
            aCentavos(c.no_gravado) ? h('tr', {}, h('td', {}, 'No gravado'), h('td', { class: 'num' }, pesos(c.no_gravado))) : null,
            aCentavos(c.sin_discriminar) ? h('tr', {}, h('td', {}, 'Importe (sin IVA discriminado)'), h('td', { class: 'num' }, pesos(c.sin_discriminar))) : null,
            d.percepciones.map((p) => h('tr', {}, h('td', {}, TIPOS_PERCEPCION[p.tipo], p.descripcion ? ` (${p.descripcion})` : ''), h('td', { class: 'num' }, pesos(p.importe)))),
            aCentavos(c.otros_tributos) ? h('tr', {}, h('td', {}, 'Otros tributos'), h('td', { class: 'num' }, pesos(c.otros_tributos))) : null,
            h('tr', {}, h('td', {}, h('strong', {}, 'Total')), h('td', { class: 'num' }, h('strong', {}, pesos(c.total)))),
            h('tr', {}, h('td', {}, c.genera_credito_fiscal ? 'IVA crédito fiscal' : 'Crédito fiscal'), h('td', { class: 'num' }, c.genera_credito_fiscal ? pesos(c.credito_fiscal) : 'No genera')),
            h('tr', {}, h('td', {}, h('strong', {}, 'Costo de obra')), h('td', { class: 'num' }, h('strong', {}, pesos(c.costo)))))))),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Imputación'),
        h('table', { class: 'tabla' }, h('thead', {}, h('tr', {}, ['Contrato', 'Ítem', 'Centro de costo', 'Categoría', '%', 'Importe'].map((t) => h('th', {}, t)))),
          h('tbody', {}, d.imputaciones.map((i) => h('tr', {},
            h('td', {}, i.contrato_id ? h('a', { href: `#/contrato/${i.contrato_id}` }, i.contrato_codigo) : '—'),
            h('td', {}, i.item_codigo ? `${i.item_codigo} · ${i.item_descripcion}` : '—'), h('td', {}, i.centro_codigo ?? '—'),
            h('td', {}, CATEGORIAS_COSTO[i.categoria] ?? '—'), h('td', {}, `${Number(i.porcentaje).toLocaleString('es-AR')} %`), h('td', { class: 'num' }, pesos(i.importe))))))),
      d.asociados.length ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Notas de crédito y débito asociadas'),
        h('table', { class: 'tabla' }, h('tbody', {}, d.asociados.map((a) => h('tr', { class: a.estado === 'anulado' ? 'inactivo' : '' },
          h('td', {}, fechaAR(a.fecha)), h('td', {}, h('a', { href: `#/compra/${a.id}` }, nombreCompra(a))), h('td', { class: 'num' }, pesos(a.total)), h('td', {}, etiquetaCompra(a))))))) : null,
      c.clase !== 'nota_credito' ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Pagos aplicados'),
        d.pagos.length ? h('table', { class: 'tabla' }, h('tbody', {}, d.pagos.map((p) => h('tr', {},
          h('td', {}, fechaAR(p.pagos.fecha)), h('td', {}, h('a', { href: `#/pago/${p.pago_id}` }, `Orden de pago N° ${p.pagos.numero}`)), h('td', { class: 'num' }, pesos(p.importe))))))
          : h('p', { class: 'texto-suave' }, 'Todavía no se pagó.')) : null,
      panelAdjuntos('comprobantes_compra', id, carga));
  });
}
