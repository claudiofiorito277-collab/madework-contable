// Costos de obra: costo real por ítem, partes diarios, materiales y stock, equipos, personal e indirectos.
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, cargando, leerPesos, cantidadAR } from './dom.js';
import { encabezado } from './layout.js';
import { costos as repo, contratos as repoContratos, compras as repoCompras } from '../data/repos.js';
import { costoContrato, partesConCosto, materialesValorizados, tarifas as cargarTarifas } from '../data/costos.js';
import { MODALIDADES, CATEGORIAS_INDIRECTO, REGLAS_PRORRATEO, TIPOS_MOV_MATERIAL, tarifaVigente, bajoMinimo, aMilesimas } from '../core/costos.js';
import { aCentavos } from '../core/redondeo.js';

const primeroMes = () => `${hoyISO().slice(0, 7)}-01`;
const tabla = (cab, filas, vacio, pie) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
  h('thead', {}, h('tr', {}, cab.map((t) => (Array.isArray(t) ? h('th', { class: t[1] }, t[0]) : h('th', {}, t))))),
  h('tbody', {}, filas.length ? filas : h('tr', {}, h('td', { colspan: cab.length, class: 'texto-suave' }, vacio))), pie ?? null));
const num = (v) => h('td', { class: 'num' }, v);
const leerCant = (v, nombre = 'la cantidad') => { const x = aMilesimas(v); if (!(x > 0)) throw new Error(`Falta ${nombre}.`); return (x / 1000).toString(); };
const opcContratos = (ctrs, vacio) => [...(vacio ? [['', vacio]] : []), ...ctrs.map((c) => [c.id, `${c.codigo} · ${c.descripcion}`])];
const pedirMotivo = (titulo) => modal({ titulo, peligro: true, aceptar: 'Anular', contenido: campo('Motivo', h('input', { name: 'm', required: true })), alAceptar: (f) => f.elements.m.value.trim() });
const MESES_CORTO = (iso) => fechaAR(iso).slice(3);

const PESTAÑAS = [['costo', 'Costo por ítem'], ['partes', 'Partes diarios'], ['materiales', 'Materiales y stock'], ['equipos', 'Vehículos y equipos'],
  ['personal', 'Personal'], ['indirectos', 'Costos indirectos']];

export async function pantallaCostos(cont, ctx, tabInicial) {
  const rol = ctx.perfil.rol;
  const puede = ['administrador', 'contador'].includes(rol);
  const carga = puede || rol === 'operador';
  const lista = PESTAÑAS.filter(([id]) => (id === 'costo' ? puede || rol === 'consulta' : true));
  let sel = lista.some(([id]) => id === tabInicial) ? tabInicial : lista[0][0];
  const cuerpo = h('div');
  const barra = h('div', { class: 'pestañas', role: 'tablist' });
  const dibujar = () => pantalla(cuerpo, () => VISTAS[sel](cuerpo, { puede, carga, rol, recargar: dibujar }));
  const pintarBarra = () => vaciar(barra, lista.map(([id, t]) => h('button', {
    type: 'button', role: 'tab', class: `pestaña${sel === id ? ' activa' : ''}`, 'aria-selected': String(sel === id),
    onclick: () => { sel = id; history.replaceState(null, '', `#/costos/${id}`); pintarBarra(); dibujar(); },
  }, t)));
  pintarBarra();
  vaciar(cont, encabezado('Costos de obra', 'Partes diarios, materiales, equipos e indirectos: el costo real de cada ítem del contrato.',
    carga ? h('a', { class: 'btn btn-primario', href: '#/nuevo-parte' }, '+ Parte diario') : null), barra, cuerpo);
  await dibujar();
}

const VISTAS = {
  // ------------------------------------------------------------ Costo por ítem
  async costo(cuerpo, { puede }) {
    const ctrs = await repoContratos.listar();
    if (!ctrs.length) { vaciar(cuerpo, h('div', { class: 'tarjeta' }, 'Todavía no hay contratos.')); return; }
    const fK = select(opcContratos(ctrs), ctrs[0].id, { 'aria-label': 'Contrato' });
    const fD = h('input', { type: 'date', value: primeroMes(), 'aria-label': 'Desde' }); const fH = h('input', { type: 'date', value: hoyISO(), 'aria-label': 'Hasta' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const r = await costoContrato(fK.value, fD.value, fH.value);
      const unidad = (f) => f.item?.unidad ?? 'u';
      const princ = r.filas.filter((f) => f.item && f.producido > 0).sort((a, b) => b.total - a.total)[0];
      vaciar(zona,
        !puede ? h('div', { class: 'tarjeta tarjeta-info' }, 'El costo de la mano de obra y de los equipos solo lo ven el administrador y el contador.') : null,
        r.avisos.length ? h('div', { class: 'tarjeta tarjeta-alerta' }, h('strong', {}, 'Revisar:'), h('ul', {}, r.avisos.map((a) => h('li', {}, a)))) : null,
        princ ? h('div', { class: 'datos' },
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, `Costo real · ${princ.item.descripcion}`), h('div', { class: 'dato-valor' }, cent(princ.total)),
            h('div', { class: 'dato-detalle' }, `${cantidadAR(princ.producido / 1000)} ${unidad(princ)} producidas en el período`)),
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, `Costo por ${unidad(princ) === 'u' ? 'columna' : unidad(princ)}`), h('div', { class: 'dato-valor' }, cent(princ.costo_unitario)),
            h('div', { class: 'dato-detalle' }, `Precio de contrato ${cent(princ.precio_unitario)}`)),
          h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Margen por unidad'),
            h('div', { class: `dato-valor ${princ.margen_unitario < 0 ? 'texto-alerta' : ''}` }, cent(princ.margen_unitario)),
            h('div', { class: 'dato-detalle' }, princ.precio_unitario ? `${(Math.round((princ.margen_unitario / princ.precio_unitario) * 1000) / 10).toLocaleString('es-AR')} % del precio` : ''))) : null,
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Costo por ítem'),
          tabla(['Ítem', ['Producido', 'num'], ['Mano de obra', 'num'], ['Equipos', 'num'], ['Materiales', 'num'], ['Otras compras', 'num'], ['Indirectos', 'num'], ['Total', 'num'], ['Costo unitario', 'num'], ['Precio unitario', 'num'], ['Margen unit.', 'num']],
            r.filas.filter((f) => f.total || f.producido).map((f) => h('tr', {},
              h('td', { style: { minWidth: '12rem' } }, f.item ? `${f.item.codigo} · ${f.item.descripcion}` : h('em', {}, 'Sin ítem (gastos generales de la obra)')),
              num(f.producido ? `${cantidadAR(f.producido / 1000)} ${unidad(f)}` : '—'), num(cent(f.mano_obra)), num(cent(f.equipos)), num(cent(f.materiales)), num(cent(f.compras)), num(cent(f.indirectos)),
              num(h('strong', {}, cent(f.total))), num(f.costo_unitario !== null ? h('strong', {}, cent(f.costo_unitario)) : '—'), num(f.precio_unitario !== null ? cent(f.precio_unitario) : '—'),
              num(f.margen_unitario !== null ? h('span', { class: f.margen_unitario < 0 ? 'texto-alerta' : '' }, cent(f.margen_unitario)) : '—'))),
            'No hay costos cargados en el período.',
            h('tfoot', {}, h('tr', {}, h('td', {}, h('strong', {}, 'Total')), h('td'), ...['mano_obra', 'equipos', 'materiales', 'compras', 'indirectos', 'total'].map((k) => num(h('strong', {}, cent(r.totales[k])))), h('td'), h('td'), h('td')))),
          h('p', { class: 'campo-ayuda' }, 'Mano de obra y equipos: partes diarios × tarifa vigente. Materiales: consumos al costo promedio. Otras compras: facturas imputadas a la obra que no entraron al stock. Indirectos: prorrateados según la regla de cada uno y, dentro del contrato, según el costo directo de cada ítem.')),
        h('section', { class: 'tarjeta' }, h('h2', {}, `Partes del período (${r.partes.length})`),
          tabla(['Fecha', 'Ítem', 'Cuadrilla', ['Producido', 'num'], ['Mano de obra', 'num'], ['Equipos', 'num'], ['MO + equipos', 'num'], ['Por unidad (sin materiales)', 'num']], r.partes.sort((a, b) => a.fecha.localeCompare(b.fecha)).map((p) => h('tr', {},
            h('td', {}, h('a', { href: `#/parte/${p.id}` }, fechaAR(p.fecha))), h('td', {}, p.item_codigo ?? '—'), h('td', {}, p.cuadrilla ?? ''), num(cantidadAR(p.cantidad_producida / 1000)),
            num(cent(p.costo.mano_obra)), num(cent(p.costo.equipos)), num(cent(p.costo.total)), num(p.cantidad_producida ? cent(Math.round(p.costo.total * 1000 / p.cantidad_producida)) : '—'))), 'Sin partes.')),
        h('div', { class: 'grilla-2' },
          h('section', { class: 'tarjeta' }, h('h2', {}, 'Consumos de materiales'),
            tabla(['Fecha', 'Material', 'Ítem', ['Cantidad', 'num'], ['Costo', 'num']], r.consumos.map((x) => h('tr', {}, h('td', {}, fechaAR(x.fecha)), h('td', {}, x.material), h('td', {}, x.item_codigo ?? '—'),
              num(`${cantidadAR(x.cantidad / 1000)} ${x.unidad}`), num(cent(x.costo_total)))), 'Sin consumos.')),
          h('section', { class: 'tarjeta' }, h('h2', {}, 'Indirectos prorrateados'),
            tabla(['Mes', 'Concepto', 'Regla', ['Total', 'num'], ['A este contrato', 'num']], r.indirectos.map((x) => h('tr', {}, h('td', {}, MESES_CORTO(x.fecha)), h('td', {}, x.concepto),
              h('td', { class: 'texto-suave' }, REGLAS_PRORRATEO[x.regla]), num(pesos(x.importe)), num(cent(x.parte)))), 'Sin indirectos en el período.'))));
    };
    for (const x of [fK, fD, fH]) x.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Contrato', fK), campo('Desde', fD), campo('Hasta', fH),
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, 'Imprimir'))), zona);
    await pintar();
  },

  // ------------------------------------------------------------ Partes diarios
  async partes(cuerpo, { puede, recargar }) {
    const ctrs = await repoContratos.listar();
    const fK = select(opcContratos(ctrs, 'Todos'), '', { 'aria-label': 'Contrato' });
    const fD = h('input', { type: 'date', value: primeroMes(), 'aria-label': 'Desde' }); const fH = h('input', { type: 'date', value: hoyISO(), 'aria-label': 'Hasta' });
    const zona = h('div');
    const pintar = async () => {
      vaciar(zona, cargando());
      const ps = await partesConCosto({ contratoId: fK.value || null, desde: fD.value, hasta: fH.value });
      const anular = async (p) => { const m = await pedirMotivo(`Anular el parte del ${fechaAR(p.fecha)}`); if (!m) return; try { await repo.anularParte(p.id, m); aviso('Parte anulado.'); await recargar(); } catch (e) { error(e.message); } };
      vaciar(zona, tabla(['Fecha', 'Contrato', 'Ítem', 'Cuadrilla', 'Personas', 'Equipos', ['Producido', 'num'], puede ? ['Costo', 'num'] : '', 'Estado', ''], ps.map((p) => h('tr', { class: p.estado === 'anulado' ? 'inactivo' : '' },
        h('td', {}, h('a', { href: `#/parte/${p.id}` }, fechaAR(p.fecha))), h('td', {}, p.contrato_codigo), h('td', {}, p.item_codigo ? `${p.item_codigo} · ${p.item_descripcion}` : '—'), h('td', {}, p.cuadrilla ?? ''),
        h('td', {}, `${p.personas} · ${[Number(p.jornales) ? `${cantidadAR(p.jornales)} jornal(es)` : '', Number(p.horas) ? `${cantidadAR(p.horas)} h` : ''].filter(Boolean).join(' + ')}`),
        h('td', {}, p.equipos ?? '—'), num(cantidadAR(p.cantidad_producida / 1000)), puede ? num(p.costo ? cent(p.costo.total) : '—') : h('td'),
        h('td', {}, p.estado === 'anulado' ? etiqueta('Anulado', 'peligro') : p.costo?.faltantes.length && puede ? etiqueta('Falta tarifa', 'alerta') : etiqueta('Registrado', 'ok')),
        h('td', {}, puede && p.estado === 'registrado' ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => anular(p) }, 'Anular') : null))), 'No hay partes en el período.'));
    };
    for (const x of [fK, fD, fH]) x.onchange = pintar;
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Contrato', fK), campo('Desde', fD), campo('Hasta', fH)), zona));
    await pintar();
  },

  // ------------------------------------------------------------ Materiales y stock
  async materiales(cuerpo, { puede, carga, recargar }) {
    const [mats, deps, ctrs, val, stock] = await Promise.all([repo.materiales(), repo.depositos(), repoContratos.listar(), materialesValorizados(), repo.stock()]);
    const movs = await repo.movimientosMaterial();
    const costoMov = Object.fromEntries(val.valorizados.map((x) => [x.id, x]));
    const activos = mats.filter((x) => x.activo);
    const opMat = activos.map((x) => [x.id, `${x.codigo} · ${x.nombre} (${x.unidad})`]);
    const opDep = deps.filter((d) => d.activo).map((d) => [d.id, d.nombre]);
    const accion = async (fn, msg) => { try { await fn(); aviso(msg); await recargar(); } catch (e) { error(e.message); } };
    const nuevoMaterial = async () => {
      const r = await modal({ titulo: 'Nuevo material', contenido: h('div', { class: 'form-grilla' },
        campo('Código', h('input', { name: 'codigo', required: true, placeholder: 'PINT-AM' })), campo('Nombre', h('input', { name: 'nombre', required: true, placeholder: 'Esmalte amarillo vial' })),
        campo('Unidad', h('input', { name: 'unidad', required: true, placeholder: 'l, kg, u' })), campo('Categoría', h('input', { name: 'categoria', placeholder: 'pinturas' })),
        campo('Stock mínimo', h('input', { name: 'minimo', inputmode: 'decimal', value: '0' }), 'Avisa cuando el stock total baja de esta cantidad.')),
      alAceptar: (f) => repo.crearMaterial({ codigo: f.elements.codigo.value.trim(), nombre: f.elements.nombre.value.trim(), unidad: f.elements.unidad.value.trim(),
        categoria: f.elements.categoria.value.trim() || null, stock_minimo: aMilesimas(f.elements.minimo.value || 0) / 1000 }) });
      if (r) { aviso('Material creado.'); await recargar(); }
    };
    const nuevoDeposito = async () => {
      const fT = select([['deposito', 'Depósito'], ['obra', 'Obrador (de un contrato)']], 'obra', { name: 'tipo' });
      const r = await modal({ titulo: 'Nuevo depósito u obrador', contenido: h('div', { class: 'form-grilla' }, campo('Nombre', h('input', { name: 'nombre', required: true, placeholder: 'Obrador E55' })),
        campo('Tipo', fT), campo('Contrato', select(opcContratos(ctrs, '—'), ctrs[0]?.id ?? '', { name: 'contrato' }), 'Los consumos en un obrador se imputan a su contrato.')),
      alAceptar: (f) => repo.crearDeposito({ nombre: f.elements.nombre.value.trim(), tipo: fT.value, contrato_id: fT.value === 'obra' ? f.elements.contrato.value || null : null }) });
      if (r) { aviso('Depósito creado.'); await recargar(); }
    };
    const movimiento = async (tipo) => {
      const itemsDe = {};
      const fCt = select(opcContratos(ctrs, '—'), deps.find((d) => d.tipo === 'obra')?.contrato_id ?? '', { name: 'contrato' });
      const fIt = select([['', '—']], '', { name: 'item' });
      const cargarItems = async () => { const k = fCt.value; itemsDe[k] ??= k ? await repoContratos.items(k) : []; vaciar(fIt, [['', '— sin ítem —'], ...itemsDe[k].map((i) => [i.id, `${i.codigo} · ${i.descripcion}`])].map(([v, t]) => h('option', { value: v }, t))); if (itemsDe[k][0]) fIt.value = itemsDe[k][0].id; };
      fCt.onchange = cargarItems;
      const compras = tipo === 'ingreso' ? (await repoCompras.comprobantes()).filter((k) => k.estado === 'emitido').slice(0, 40) : [];
      const obra = deps.find((d) => d.tipo === 'obra' && d.activo);
      const central = deps.find((d) => d.tipo === 'deposito' && d.activo);
      const cont = [campo('Material', select(opMat, '', { name: 'material', required: true })), campo('Fecha', h('input', { name: 'fecha', type: 'date', value: hoyISO(), required: true })),
        campo('Cantidad', h('input', { name: 'cantidad', inputmode: 'decimal', required: true }))];
      if (tipo === 'ingreso') cont.push(campo('Depósito', select(opDep, central?.id, { name: 'destino' })), campo('Costo unitario (sin IVA)', h('input', { name: 'costo', inputmode: 'decimal', required: true })),
        campo('Factura de compra', select([['', '— sin factura —'], ...compras.map((k) => [k.id, `${fechaAR(k.fecha)} · ${k.proveedor} · ${k.numero_formateado}`])], '', { name: 'compra' }),
          'Si la elegís, el costo de esa factura llega a la obra por los consumos y no se cuenta dos veces.'));
      if (tipo === 'transferencia') cont.push(campo('Desde', select(opDep, central?.id, { name: 'origen' })), campo('Hacia', select(opDep, obra?.id, { name: 'destino' })));
      if (tipo === 'consumo') { cont.push(campo('Depósito u obrador', select(opDep, obra?.id, { name: 'origen' })), campo('Contrato', fCt), campo('Ítem', fIt)); }
      if (tipo === 'ajuste') cont.push(campo('Depósito', select(opDep, central?.id, { name: 'dep' })), campo('Sentido', select([['menos', 'Falta (baja el stock)'], ['mas', 'Sobra (sube el stock)']], 'menos', { name: 'sentido' })));
      cont.push(campo('Observación', h('input', { name: 'obs' })));
      if (tipo === 'consumo') await cargarItems();
      const r = await modal({ titulo: TIPOS_MOV_MATERIAL[tipo], contenido: h('div', { class: 'form-grilla' }, cont), aceptar: 'Registrar',
        alAceptar: async (f) => {
          const e = f.elements; const base = { fecha: e.fecha.value, material_id: e.material.value, cantidad: leerCant(e.cantidad.value), observacion: e.obs.value };
          if (tipo === 'ingreso') {
            const cu = leerPesos(e.costo.value, { obligatorio: true });
            if (e.compra.value) return repo.ingresoDesdeCompra({ comprobante_compra_id: e.compra.value, deposito_id: e.destino.value, fecha: base.fecha, lineas: [{ material_id: base.material_id, cantidad: base.cantidad, costo_unitario: cu }] });
            return repo.moverMaterial({ ...base, tipo, deposito_destino_id: e.destino.value, costo_unitario: cu });
          }
          if (tipo === 'transferencia') return repo.moverMaterial({ ...base, tipo, deposito_origen_id: e.origen.value, deposito_destino_id: e.destino.value });
          if (tipo === 'consumo') return repo.moverMaterial({ ...base, tipo, deposito_origen_id: e.origen.value, contrato_id: fCt.value || null, item_id: fIt.value || null });
          return repo.moverMaterial({ ...base, tipo, [e.sentido.value === 'mas' ? 'deposito_destino_id' : 'deposito_origen_id']: e.dep.value });
        } });
      if (r) { aviso('Movimiento registrado.'); await recargar(); }
    };
    const anular = async (x) => { const m = await pedirMotivo('Anular movimiento de stock'); if (m) await accion(() => repo.anularMovimientoMaterial(x.id, m), 'Movimiento anulado.'); };
    const bajos = bajoMinimo(mats.map((x) => ({ ...x, stock_minimo: aMilesimas(x.stock_minimo) })), val.total);
    const filasStock = stock.filter((s) => Number(s.cantidad) !== 0 || true).sort((a, b) => a.codigo.localeCompare(b.codigo) || a.deposito.localeCompare(b.deposito));
    vaciar(cuerpo,
      bajos.length ? h('div', { class: 'tarjeta tarjeta-alerta' }, h('strong', {}, 'Stock bajo: '), bajos.map((b) => `${b.material.nombre} (${cantidadAR(b.stock / 1000)} ${b.material.unidad})`).join(' · ')) : null,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Stock'),
        h('div', { class: 'acciones acciones-envolver' },
          carga ? h('button', { class: 'btn btn-primario', type: 'button', onclick: () => movimiento('consumo'), disabled: !activos.length }, '+ Consumo en obra') : null,
          carga ? h('button', { class: 'btn', type: 'button', onclick: () => movimiento('transferencia'), disabled: !activos.length }, '+ Transferencia') : null,
          puede ? h('button', { class: 'btn', type: 'button', onclick: () => movimiento('ingreso'), disabled: !activos.length }, '+ Ingreso') : null,
          puede ? h('button', { class: 'btn', type: 'button', onclick: () => movimiento('ajuste'), disabled: !activos.length }, '+ Ajuste') : null),
        tabla(['Material', 'Depósito', ['Cantidad', 'num'], puede ? ['Costo promedio', 'num'] : '', puede ? ['Valor', 'num'] : ''], filasStock.map((s) => h('tr', {},
          h('td', {}, `${s.codigo} · ${s.nombre}`), h('td', {}, s.deposito), num(`${cantidadAR(s.cantidad)} ${s.unidad}`),
          puede ? num(cent(val.promedio[s.material_id] ?? 0)) : h('td'), puede ? num(cent(Math.round(aMilesimas(s.cantidad) * (val.promedio[s.material_id] ?? 0) / 1000))) : h('td'))),
        activos.length ? 'Todavía no hay stock: cargá un ingreso.' : 'Primero cargá los materiales (abajo).')),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Movimientos'),
        tabla(['Fecha', 'Tipo', 'Material', ['Cantidad', 'num'], 'De → a', 'Obra / ítem', puede ? ['Costo', 'num'] : '', ''], movs.slice(0, 200).map((x) => h('tr', { class: x.estado === 'anulado' ? 'inactivo' : '' },
          h('td', {}, fechaAR(x.fecha)), h('td', {}, TIPOS_MOV_MATERIAL[x.tipo], x.estado === 'anulado' ? h('span', {}, ' ', etiqueta('Anulado', 'peligro')) : null),
          h('td', {}, x.material), num(`${cantidadAR(x.cantidad)} ${x.unidad}`), h('td', {}, [x.deposito_origen, x.deposito_destino].filter(Boolean).join(' → ')),
          h('td', {}, [x.contrato_codigo, x.item_codigo].filter(Boolean).join(' · ')), puede ? num(costoMov[x.id] ? cent(costoMov[x.id].costo_total) : '—') : h('td'),
          h('td', {}, puede && x.estado === 'vigente' ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => anular(x) }, 'Anular') : null))), 'Sin movimientos.')),
      h('div', { class: 'grilla-2' },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Materiales'), puede ? h('button', { class: 'btn btn-chico', type: 'button', onclick: nuevoMaterial }, '+ Material') : null,
          tabla(['Código', 'Nombre', 'Unidad', ['Mínimo', 'num']], mats.map((x) => h('tr', { class: x.activo ? '' : 'inactivo' }, h('td', {}, x.codigo), h('td', {}, x.nombre), h('td', {}, x.unidad), num(cantidadAR(x.stock_minimo)))), 'Sin materiales.')),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Depósitos y obradores'), puede ? h('button', { class: 'btn btn-chico', type: 'button', onclick: nuevoDeposito }, '+ Depósito u obrador') : null,
          tabla(['Nombre', 'Tipo', 'Contrato'], deps.map((d) => h('tr', {}, h('td', {}, d.nombre), h('td', {}, d.tipo === 'obra' ? 'Obrador' : 'Depósito'), h('td', {}, ctrs.find((k) => k.id === d.contrato_id)?.codigo ?? '—'))), ''))));
  },

  // ------------------------------------------------------------ Equipos
  async equipos(cuerpo, { puede, carga, recargar }) {
    const [eqs, gastos, ctrs] = await Promise.all([repo.equipos(), repo.gastosEquipos(), repoContratos.listar()]);
    const tar = puede ? (await cargarTarifas()).equipos : {};
    const ps = await partesConCosto({ desde: primeroMes(), hasta: hoyISO() });
    const usoMes = {};
    for (const p of ps.filter((x) => x.estado === 'registrado')) for (const e of p.equipos) { const u = (usoMes[e.equipo_id] ??= { horas: 0, dias: 0 }); u.horas += e.horas; u.dias += e.dias; }
    const gastoMes = {};
    for (const g of gastos.filter((x) => x.estado === 'vigente' && x.fecha >= primeroMes())) gastoMes[g.equipo_id] = (gastoMes[g.equipo_id] ?? 0) + aCentavos(g.importe);
    const nuevo = async () => {
      const r = await modal({ titulo: 'Nuevo vehículo o equipo', contenido: h('div', { class: 'form-grilla' },
        campo('Código', h('input', { name: 'codigo', required: true, placeholder: 'HID-01' })), campo('Nombre', h('input', { name: 'nombre', required: true, placeholder: 'Hidroelevador' })),
        campo('Tipo', select([['vehiculo', 'Vehículo'], ['equipo', 'Equipo'], ['herramienta', 'Herramienta']], 'equipo', { name: 'tipo' })), campo('Patente', h('input', { name: 'patente' })),
        campo('Propiedad', select([['1', 'Propio'], ['0', 'Alquilado']], '1', { name: 'propio' }))),
      alAceptar: (f) => repo.crearEquipo({ codigo: f.elements.codigo.value.trim(), nombre: f.elements.nombre.value.trim(), tipo: f.elements.tipo.value, patente: f.elements.patente.value.trim() || null, propio: f.elements.propio.value === '1' }) });
      if (r) { aviso('Equipo creado.'); await recargar(); }
    };
    const tarifa = async (e) => {
      const r = await modal({ titulo: `Tarifa de ${e.nombre}`, contenido: [h('p', { class: 'texto-suave' }, 'Una tarifa no se modifica: para cambiarla se carga una nueva desde la fecha en que rige.'),
        h('div', { class: 'form-grilla' }, campo('Vigente desde', h('input', { name: 'desde', type: 'date', value: primeroMes(), required: true })),
          campo('Costo por hora', h('input', { name: 'hora', inputmode: 'decimal' })), campo('Costo por día', h('input', { name: 'dia', inputmode: 'decimal' })))],
      alAceptar: (f) => { const hh = leerPesos(f.elements.hora.value); const dd = leerPesos(f.elements.dia.value); if (!hh && !dd) throw new Error('Cargá el costo por hora o por día.');
        return repo.nuevaTarifaEquipo({ equipo_id: e.id, vigente_desde: f.elements.desde.value, costo_hora: hh, costo_dia: dd }); } });
      if (r) { aviso('Tarifa guardada.'); await recargar(); }
    };
    const gasto = async (tipo) => {
      const r = await modal({ titulo: tipo === 'combustible' ? 'Carga de combustible' : 'Mantenimiento', contenido: h('div', { class: 'form-grilla' },
        campo('Equipo', select(eqs.filter((x) => x.activo).map((x) => [x.id, `${x.codigo} · ${x.nombre}`]), '', { name: 'equipo' })),
        campo('Fecha', h('input', { name: 'fecha', type: 'date', value: hoyISO(), required: true })),
        tipo === 'combustible' ? campo('Litros', h('input', { name: 'litros', inputmode: 'decimal', required: true })) : campo('Descripción', h('input', { name: 'desc', required: true, placeholder: 'Service 10.000 km' })),
        campo('Importe', h('input', { name: 'importe', inputmode: 'decimal', required: true })),
        campo('Km u horas de motor', h('input', { name: 'odo', inputmode: 'decimal' })),
        campo('Obra', select(opcContratos(ctrs, '—'), ctrs[0]?.id ?? '', { name: 'contrato' })),
        tipo === 'mantenimiento' ? campo('Próximo service', h('input', { name: 'prox', type: 'date' })) : null),
      aceptar: 'Registrar',
      alAceptar: (f) => { const e = f.elements; return repo.nuevoGastoEquipo({ equipo_id: e.equipo.value, tipo, fecha: e.fecha.value, litros: tipo === 'combustible' ? leerCant(e.litros.value, 'los litros') : null,
        descripcion: e.desc?.value.trim() || null, importe: leerPesos(e.importe.value, { obligatorio: true }), odometro: e.odo.value ? aMilesimas(e.odo.value) / 1000 : null,
        contrato_id: e.contrato.value || null, proximo_service: e.prox?.value || null }); } });
      if (r) { aviso('Registrado.'); await recargar(); }
    };
    const anularG = async (g) => { const m = await pedirMotivo('Anular gasto del equipo'); if (!m) return; try { await repo.anularGastoEquipo(g.id, m); aviso('Anulado.'); await recargar(); } catch (e) { error(e.message); } };
    const nom = Object.fromEntries(eqs.map((x) => [x.id, x.nombre]));
    const services = gastos.filter((g) => g.estado === 'vigente' && g.proximo_service && g.proximo_service <= hoyISO().replace(/-\d\d$/, '-31'));
    vaciar(cuerpo,
      services.length ? h('div', { class: 'tarjeta tarjeta-alerta' }, 'Service próximo o vencido: ', services.map((g) => `${nom[g.equipo_id]} (${fechaAR(g.proximo_service)})`).join(' · ')) : null,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Vehículos y equipos'),
        h('div', { class: 'acciones acciones-envolver' }, puede ? h('button', { class: 'btn', type: 'button', onclick: nuevo }, '+ Vehículo o equipo') : null,
          carga && eqs.length ? h('button', { class: 'btn', type: 'button', onclick: () => gasto('combustible') }, '+ Combustible') : null,
          carga && eqs.length ? h('button', { class: 'btn', type: 'button', onclick: () => gasto('mantenimiento') }, '+ Mantenimiento') : null),
        h('p', { class: 'texto-suave' }, 'El uso de cada equipo se carga en el parte diario y se cuesta con su tarifa. El combustible y el mantenimiento se registran para controlar el gasto real del equipo contra lo que se le cargó a la obra.'),
        tabla(['Equipo', 'Tipo', puede ? ['Tarifa vigente', 'num'] : '', ['Uso del mes', 'num'], puede ? ['Cargado a obra', 'num'] : '', ['Gasto real del mes', 'num'], ''], eqs.map((e) => {
          const t = tarifaVigente(tar[e.id], hoyISO()); const u = usoMes[e.id] ?? { horas: 0, dias: 0 };
          const cargado = t ? Math.round((u.horas * (t.costo_hora ?? 0) + u.dias * (t.costo_dia ?? 0)) / 1000) : null;
          return h('tr', { class: e.activo ? '' : 'inactivo' }, h('td', {}, h('strong', {}, e.codigo), ` · ${e.nombre}`, e.patente ? h('small', { class: 'texto-suave' }, ` (${e.patente})`) : null),
            h('td', {}, { vehiculo: 'Vehículo', equipo: 'Equipo', herramienta: 'Herramienta' }[e.tipo]),
            puede ? num(t ? [t.costo_hora ? `${cent(t.costo_hora)}/h` : '', t.costo_dia ? `${cent(t.costo_dia)}/día` : ''].filter(Boolean).join(' · ') : etiqueta('Sin tarifa', 'alerta')) : h('td'),
            num([u.horas ? `${cantidadAR(u.horas / 1000)} h` : '', u.dias ? `${cantidadAR(u.dias / 1000)} días` : ''].filter(Boolean).join(' + ') || '—'),
            puede ? num(cargado !== null ? cent(cargado) : '—') : h('td'), num(gastoMes[e.id] ? cent(gastoMes[e.id]) : '—'),
            h('td', {}, puede ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => tarifa(e) }, 'Nueva tarifa') : null));
        }), 'Todavía no hay equipos cargados.')),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Combustible y mantenimiento'),
        tabla(['Fecha', 'Equipo', 'Tipo', 'Detalle', ['Importe', 'num'], ''], gastos.slice(0, 200).map((g) => h('tr', { class: g.estado === 'anulado' ? 'inactivo' : '' },
          h('td', {}, fechaAR(g.fecha)), h('td', {}, nom[g.equipo_id]), h('td', {}, g.tipo === 'combustible' ? 'Combustible' : 'Mantenimiento'),
          h('td', {}, g.tipo === 'combustible' ? `${cantidadAR(g.litros)} l` : g.descripcion, g.odometro ? ` · ${cantidadAR(g.odometro)}` : '', g.estado === 'anulado' ? h('span', {}, ' ', etiqueta('Anulado', 'peligro')) : null),
          num(pesos(g.importe)), h('td', {}, puede && g.estado === 'vigente' ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => anularG(g) }, 'Anular') : null))), 'Sin registros.')));
  },

  // ------------------------------------------------------------ Personal
  async personal(cuerpo, { puede, recargar }) {
    const pers = await repo.personal();
    const [datos, tar] = puede ? await Promise.all([repo.datosPersonales(), cargarTarifas()]) : [[], { personal: {} }];
    const dat = Object.fromEntries(datos.map((d) => [d.personal_id, d]));
    const editar = async (p) => {
      const d = p ? dat[p.id] ?? {} : {};
      const r = await modal({ titulo: p ? `Editar · ${p.nombre}` : 'Nueva persona', contenido: [h('div', { class: 'form-grilla' },
        campo('Nombre y apellido', h('input', { name: 'nombre', required: true, value: p?.nombre ?? '' })), campo('Categoría', h('input', { name: 'categoria', value: p?.categoria ?? '', placeholder: 'Oficial pintor' })),
        campo('Modalidad', select(Object.entries(MODALIDADES), p?.modalidad ?? 'dependencia', { name: 'modalidad' })), campo('Cuadrilla', h('input', { name: 'cuadrilla', value: p?.cuadrilla ?? '', placeholder: 'A' })),
        p ? campo('Estado', select([['1', 'Activo'], ['0', 'De baja']], p.activo ? '1' : '0', { name: 'activo' })) : null),
      h('h3', {}, 'Datos personales (solo administrador y contador)'),
      h('div', { class: 'form-grilla' }, campo('CUIL', h('input', { name: 'cuil', value: d.cuil ?? '', inputmode: 'numeric', placeholder: '11 dígitos sin guiones' })),
        campo('Teléfono', h('input', { name: 'tel', value: d.telefono ?? '' })), campo('Fecha de ingreso', h('input', { name: 'ingreso', type: 'date', value: d.fecha_ingreso ?? '' })),
        campo('Domicilio', h('input', { name: 'dom', value: d.domicilio ?? '' })))],
      alAceptar: async (f) => {
        const e = f.elements; const cuil = e.cuil.value.replace(/\D/g, '');
        if (cuil && cuil.length !== 11) throw new Error('El CUIL tiene 11 dígitos.');
        const base = { nombre: e.nombre.value.trim(), categoria: e.categoria.value.trim() || null, modalidad: e.modalidad.value, cuadrilla: e.cuadrilla.value.trim() || null };
        const id = p ? (await repo.actualizarPersona(p.id, { ...base, activo: e.activo.value === '1' }), p.id) : (await repo.crearPersona(base))[0].id;
        const dd = { cuil: cuil || null, telefono: e.tel.value.trim() || null, fecha_ingreso: e.ingreso.value || null, domicilio: e.dom.value.trim() || null };
        if (Object.values(dd).some(Boolean) || dat[id]) await repo.guardarDatos(id, dd, !!dat[id]);
        return true;
      } });
      if (r) { aviso('Guardado.'); await recargar(); }
    };
    const tarifa = async (p) => {
      const r = await modal({ titulo: `Costo de ${p.nombre}`, contenido: [h('p', { class: 'texto-suave' }, 'Es el costo total para la empresa (sueldo + cargas, o lo que factura). No liquida sueldos. Para un aumento se carga una tarifa nueva desde la fecha en que rige.'),
        h('div', { class: 'form-grilla' }, campo('Vigente desde', h('input', { name: 'desde', type: 'date', value: primeroMes(), required: true })),
          campo('Costo por hora', h('input', { name: 'hora', inputmode: 'decimal' })), campo('Costo por jornal', h('input', { name: 'jornal', inputmode: 'decimal' })))],
      alAceptar: (f) => { const hh = leerPesos(f.elements.hora.value); const jj = leerPesos(f.elements.jornal.value); if (!hh && !jj) throw new Error('Cargá el costo por hora o por jornal.');
        return repo.nuevaTarifaPersonal({ personal_id: p.id, vigente_desde: f.elements.desde.value, costo_hora: hh, costo_jornal: jj }); } });
      if (r) { aviso('Tarifa guardada.'); await recargar(); }
    };
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('h2', {}, 'Personal'),
      puede ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: () => editar(null) }, '+ Persona')) : null,
      h('p', { class: 'texto-suave' }, puede ? 'El sistema no liquida sueldos: registra el costo por hora o por jornal para calcular el costo de la obra.' : 'Los datos personales y los costos solo los ven el administrador y el contador.'),
      tabla(['Nombre', 'Categoría', 'Modalidad', 'Cuadrilla', puede ? 'CUIL' : '', puede ? ['Costo vigente', 'num'] : '', ''], pers.map((p) => {
        const t = tarifaVigente(tar.personal[p.id], hoyISO());
        return h('tr', { class: p.activo ? '' : 'inactivo' }, h('td', {}, h('strong', {}, p.nombre), p.activo ? null : h('span', {}, ' ', etiqueta('De baja'))), h('td', {}, p.categoria ?? ''),
          h('td', {}, MODALIDADES[p.modalidad]), h('td', {}, p.cuadrilla ?? ''), h('td', {}, puede ? dat[p.id]?.cuil ?? '—' : ''),
          puede ? num(t ? [t.costo_jornal ? `${cent(t.costo_jornal)}/jornal` : '', t.costo_hora ? `${cent(t.costo_hora)}/h` : ''].filter(Boolean).join(' · ') : etiqueta('Sin costo', 'alerta')) : h('td'),
          h('td', {}, puede ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editar(p) }, 'Editar'),
            h('button', { class: 'btn btn-chico', type: 'button', onclick: () => tarifa(p) }, 'Nuevo costo')) : null));
      }), 'Todavía no hay personal cargado.')));
  },

  // ------------------------------------------------------------ Indirectos
  async indirectos(cuerpo, { puede, recargar }) {
    const [inds, ctrs] = await Promise.all([repo.indirectos(), repoContratos.listar()]);
    const nuevo = async () => {
      const fR = select(Object.entries(REGLAS_PRORRATEO), 'costo_directo', { name: 'regla' });
      const pcts = h('div', { class: 'form-grilla', hidden: true }, ctrs.map((c) => campo(`% ${c.codigo}`, h('input', { inputmode: 'decimal', dataset: { contrato: c.id }, value: ctrs.length === 1 ? '100' : '' }))));
      fR.onchange = () => { pcts.hidden = fR.value !== 'porcentajes'; };
      const r = await modal({ titulo: 'Nuevo costo indirecto', contenido: [h('div', { class: 'form-grilla' },
        campo('Fecha', h('input', { name: 'fecha', type: 'date', value: hoyISO(), required: true }), 'Se prorratea con los costos de ese mes.'),
        campo('Concepto', h('input', { name: 'concepto', required: true, placeholder: 'Póliza de caución, honorarios, seguro de la camioneta…' })),
        campo('Categoría', select(Object.entries(CATEGORIAS_INDIRECTO), 'administracion', { name: 'categoria' })),
        campo('Importe (sin IVA)', h('input', { name: 'importe', inputmode: 'decimal', required: true })), campo('Cómo se reparte', fR)), pcts],
      aceptar: 'Registrar',
      alAceptar: (f) => {
        const e = f.elements;
        const porcentajes = fR.value === 'porcentajes' ? [...pcts.querySelectorAll('input')].filter((i) => i.value.trim()).map((i) => ({ contrato_id: i.dataset.contrato, porcentaje: aMilesimas(i.value) / 1000 })) : [];
        return repo.registrarIndirecto({ fecha: e.fecha.value, concepto: e.concepto.value.trim(), categoria: e.categoria.value, importe: leerPesos(e.importe.value, { obligatorio: true }), regla: fR.value, porcentajes });
      } });
      if (r) { aviso('Costo indirecto registrado.'); await recargar(); }
    };
    const anular = async (x) => { const m = await pedirMotivo(`Anular · ${x.concepto}`); if (!m) return; try { await repo.anularIndirecto(x.id, m); aviso('Anulado.'); await recargar(); } catch (e) { error(e.message); } };
    vaciar(cuerpo, h('section', { class: 'tarjeta' }, h('h2', {}, 'Costos indirectos'),
      h('p', { class: 'texto-suave' }, 'Seguros, pólizas, administración y otros gastos que no son de una sola obra. Cada uno se reparte entre los contratos con su regla. No cargues acá una factura que ya imputaste a una obra (se contaría dos veces).'),
      puede ? h('div', { class: 'acciones' }, h('button', { class: 'btn btn-primario', type: 'button', onclick: nuevo }, '+ Costo indirecto')) : null,
      tabla(['Fecha', 'Concepto', 'Categoría', 'Reparto', ['Importe', 'num'], ''], inds.map((x) => h('tr', { class: x.estado === 'anulado' ? 'inactivo' : '' },
        h('td', {}, fechaAR(x.fecha)), h('td', {}, x.concepto, x.estado === 'anulado' ? h('span', {}, ' ', etiqueta('Anulado', 'peligro')) : null), h('td', {}, CATEGORIAS_INDIRECTO[x.categoria]),
        h('td', { class: 'texto-suave' }, x.regla === 'porcentajes' ? (x.indirecto_porcentajes ?? []).map((p) => `${ctrs.find((c) => c.id === p.contrato_id)?.codigo ?? '?'} ${cantidadAR(p.porcentaje)} %`).join(' · ') : REGLAS_PRORRATEO[x.regla]),
        num(pesos(x.importe)), h('td', {}, puede && x.estado === 'vigente' ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => anular(x) }, 'Anular') : null))), 'Sin costos indirectos.')));
  },
};
