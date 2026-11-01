// Detalle de un contrato: resumen, ítems, columnas (avance), certificados, multas, pólizas,
// redeterminaciones y archivos.
import {
  h, vaciar, pantalla, campo, select, leerForm, modal, aviso, error, etiqueta, fechaAR, hoyISO,
  pesos, cent, cantidadAR, barra, dato, pestañas, leerPesos, leerCantidad, numeroAR,
} from './dom.js';
import { contratos, clientes, avance, certificados, multas, polizas } from '../data/repos.js';
import { ESTADOS_CONTRATO, TIPOS_TRABAJO } from './contratos.js';
import { panelAdjuntos } from './adjuntos.js';
import { diasEntre, sumarDias, importeMulta, importeLinea, resumenContrato } from '../core/certificados.js';
import { aCentavos } from '../core/redondeo.js';

export const ESTADOS_CERT = {
  borrador: ['Borrador', 'neutra'], presentado: ['Presentado', 'alerta'], observado: ['Observado', 'peligro'],
  aprobado: ['Aprobado', 'ok'], facturado: ['Facturado', 'ok'], cobrado: ['Cobrado', 'ok'], anulado: ['Anulado', 'neutra'],
};
const ESTADOS_UNIDAD = { pendiente: ['Pendiente', 'neutra'], ejecutada: ['Ejecutada', 'alerta'], aprobada: ['Aprobada', 'ok'], observada: ['Observada', 'peligro'], rechazada: ['Rechazada', 'peligro'] };
const MOTIVOS_MULTA = { demora_inicio: ['Demora en el inicio', 300], demora_plazo: ['Demora en el plazo total', 600], orden_servicio: ['Orden de servicio incumplida', 600], otra: ['Otra', 0] };
const TIPOS_POLIZA = { responsabilidad_civil: 'Responsabilidad civil', caucion_anticipo: 'Caución de anticipo', caucion_cumplimiento: 'Caución de cumplimiento',
  caucion_oferta: 'Caución de oferta', art: 'ART', vida_obligatorio: 'Vida colectivo obligatorio', accidentes_personales: 'Accidentes personales',
  tecnico_equipos: 'Técnico de equipos', automotor: 'Automotor', otro: 'Otro' };
const DIAS = [['', '—'], ['1', 'Lunes'], ['2', 'Martes'], ['3', 'Miércoles'], ['4', 'Jueves'], ['5', 'Viernes']];

export async function pantallaContrato(cont, ctx, id) {
  const rol = ctx.perfil.rol;
  const esAdmCont = ['administrador', 'contador'].includes(rol);
  const esOperativo = esAdmCont || rol === 'operador';
  let c; let items = []; let tramos = [];
  const cuerpo = h('div');
  let pestañaActual = sessionStorageGet(`mw_tab_${id}`) ?? 'resumen';

  const recargar = async () => {
    [c, items, tramos] = await Promise.all([contratos.obtener(id), contratos.items(id), contratos.tramos(id)]);
    if (!c) throw new Error('No se encontró el contrato.');
  };
  const mostrar = () => pantalla(cuerpo, async () => {
    sessionStorageSet(`mw_tab_${id}`, pestañaActual);
    const vistas = { resumen: vistaResumen, items: vistaItems, columnas: vistaColumnas, certificados: vistaCertificados,
      multas: vistaMultas, polizas: vistaPolizas, redeterminaciones: vistaRedeterminaciones, archivos: vistaArchivos };
    await vistas[pestañaActual]();
  });
  const refrescar = async () => { await recargar(); await mostrar(); };

  // ---------------------------------------------------------------- Resumen
  async function vistaResumen() {
    const certs = await certificados.listar(id);
    const r = resumenContrato(items, certs);
    const costoUnit = (it) => ['costo_mano_obra', 'costo_materiales', 'costo_equipos', 'costo_subcontratos', 'costo_otros'].reduce((s, k) => s + aCentavos(it[k] ?? 0), 0);
    const costoTotal = items.reduce((s, it) => s + importeLinea(it.cantidad, costoUnit(it)), 0);
    const margen = r.montoContractual ? Math.round(((r.montoContractual - costoTotal) / r.montoContractual) * 1000) / 10 : null;
    const hoy = hoyISO();
    const restan = c.fecha_fin_prevista ? diasEntre(hoy, c.fecha_fin_prevista) : null;
    const defPrevista = c.fecha_recepcion_provisoria ? sumarDias(c.fecha_recepcion_provisoria, c.plazo_garantia_dias) : null;
    const fila = (k, v) => (v === null || v === undefined || v === '' ? null : h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v)));
    vaciar(cuerpo,
      h('div', { class: 'datos' },
        dato('Monto del contrato', cent(r.montoContractual), 'sin IVA'),
        dato('Certificado', cent(r.certificado), `${r.avanceMontoPct.toLocaleString('es-AR')} % del contrato`),
        dato('Saldo a certificar', cent(r.saldo)),
        dato('Fin de plazo', c.fecha_fin_prevista ? fechaAR(c.fecha_fin_prevista) : '—',
          restan === null ? 'Falta la fecha del acta de replanteo' : restan >= 0 ? `Faltan ${restan} días` : `Vencido hace ${-restan} días`,
          restan !== null && restan < 0 && !['recepcion_provisoria', 'finalizado'].includes(c.estado) ? 'peligro' : restan !== null && restan <= 10 ? 'alerta' : null),
        Number(c.anticipo_monto) ? dato('Anticipo pendiente de descontar', pesos(c.anticipo_pendiente), `de ${pesos(c.anticipo_monto)}`) : null,
        costoTotal ? dato('Margen esperado', `${numeroAR(margen, 1)} %`, `Costo presupuestado ${cent(costoTotal)}`, margen < 10 ? 'alerta' : null) : null,
      ),
      barra(r.avanceMontoPct, `Avance ${r.avanceMontoPct}%`),
      h('section', { class: 'tarjeta' },
        h('div', { class: 'fila-titulo' }, h('h2', {}, 'Condiciones del contrato'),
          esAdmCont ? h('button', { class: 'btn btn-chico btn-primario', type: 'button', onclick: editarCondiciones }, 'Editar condiciones') : null),
        h('div', { class: 'grilla-2' },
          h('dl', { class: 'kvs' },
            fila('Cliente', c.cliente), fila('Concurso / licitación', c.numero_concurso), fila('N° de contrato', c.numero_contrato),
            fila('Orden de compra', c.orden_compra), fila('Expediente', c.expediente),
            fila('Ubicación', [c.ruta, c.tramo, c.km_desde !== null && c.km_hasta !== null ? `km ${numeroAR(c.km_desde, 1)} a ${numeroAR(c.km_hasta, 1)}` : null, c.localidad].filter(Boolean).join(' · ')),
            fila('Tipo de trabajo', TIPOS_TRABAJO.find(([k]) => k === c.tipo_trabajo)?.[1]),
            fila('Sistema', c.sistema_contratacion === 'unidad_medida' ? 'Por unidad de medida' : 'Ajuste alzado'),
            fila('Representante técnico', c.representante_tecnico), fila('Inspector', c.inspector)),
          h('dl', { class: 'kvs' },
            fila('Adjudicación', fechaAR(c.fecha_adjudicacion)), fila('Firma', fechaAR(c.fecha_firma)),
            fila('Acta de replanteo', fechaAR(c.fecha_acta_replanteo)), fila('Plazo', c.plazo_dias ? `${c.plazo_dias} días corridos` : null),
            fila('Recepción provisoria', fechaAR(c.fecha_recepcion_provisoria)),
            fila('Recepción definitiva', c.fecha_recepcion_definitiva ? fechaAR(c.fecha_recepcion_definitiva) : defPrevista ? `prevista ${fechaAR(defPrevista)} (garantía ${c.plazo_garantia_dias} días)` : `Garantía: ${c.plazo_garantia_dias} días desde la recepción provisoria`),
            fila('Certificación', c.periodicidad_certificacion),
            fila('Pago', `${c.pago_dias} días corridos desde la factura${c.pago_dia_semana !== null ? `, el primer ${DIAS.find(([k]) => k === String(c.pago_dia_semana))?.[1].toLowerCase()} siguiente` : ''}`),
            fila('Fondo de reparo', `${numeroAR(c.fondo_reparo_pct, 2)} %${Number(c.fondo_reparo_pct) ? (c.fr_en_factura ? ' (se descuenta en la factura)' : ' (se retiene en el pago)') : ''}`),
            fila('Anticipo', Number(c.anticipo_pct) || Number(c.anticipo_monto) ? `${numeroAR(c.anticipo_pct, 2)} % · ${pesos(c.anticipo_monto)} · se descuenta ${numeroAR(c.anticipo_descuento_pct, 2)} % de cada certificado` : 'No solicitado'),
            fila('Multas', `${c.multa_unidad ?? ''} · ${c.multas_en_factura ? 'se descuentan en la factura' : 'por nota de crédito'}`),
            fila('Presupuesto oficial', c.presupuesto_oficial ? pesos(c.presupuesto_oficial) + ' (con IVA)' : null))),
        c.observaciones ? h('p', { class: 'nota' }, c.observaciones) : null));
  }

  async function editarCondiciones() {
    const lista = await clientes.listar();
    const inp = (name, props = {}) => h('input', { name, value: c[name] ?? '', ...props });
    const chk = (name, texto) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: !!c[name] }), ' ', texto);
    const ok = await modal({
      titulo: `Condiciones · ${c.codigo}`,
      contenido: h('div', { class: 'form-grilla form-modal-ancho' },
        h('h3', { class: 'campo-ancho' }, 'Datos generales'),
        campo('Descripción', inp('descripcion', { required: true })),
        campo('Cliente', select(lista.map((x) => [x.id, x.razon_social]), c.cliente_id, { name: 'cliente_id' })),
        campo('Estado', select(Object.entries(ESTADOS_CONTRATO).map(([k, [t]]) => [k, t]), c.estado, { name: 'estado' })),
        campo('Tipo de trabajo', select(TIPOS_TRABAJO, c.tipo_trabajo, { name: 'tipo_trabajo' })),
        campo('N° concurso', inp('numero_concurso')), campo('N° contrato', inp('numero_contrato')),
        campo('Orden de compra', inp('orden_compra')), campo('Expediente', inp('expediente')),
        campo('Ruta', inp('ruta')), campo('Tramo', inp('tramo')),
        campo('Km desde', inp('km_desde', { inputmode: 'decimal' })), campo('Km hasta', inp('km_hasta', { inputmode: 'decimal' })),
        campo('Localidad', inp('localidad')), campo('Presupuesto oficial (con IVA)', inp('presupuesto_oficial', { inputmode: 'decimal' })),
        campo('Representante técnico', inp('representante_tecnico')), campo('Inspector', inp('inspector')),
        h('h3', { class: 'campo-ancho' }, 'Fechas y plazos'),
        campo('Fecha de oferta', inp('fecha_oferta', { type: 'date' })), campo('Adjudicación', inp('fecha_adjudicacion', { type: 'date' })),
        campo('Firma', inp('fecha_firma', { type: 'date' })), campo('Acta de replanteo', inp('fecha_acta_replanteo', { type: 'date' })),
        campo('Plazo (días corridos)', inp('plazo_dias', { type: 'number', min: 1 })), campo('Recepción provisoria', inp('fecha_recepcion_provisoria', { type: 'date' })),
        campo('Garantía (días)', inp('plazo_garantia_dias', { type: 'number', min: 0 })), campo('Recepción definitiva', inp('fecha_recepcion_definitiva', { type: 'date' })),
        h('h3', { class: 'campo-ancho' }, 'Certificación, pago y descuentos'),
        campo('Certificación', select([['semanal', 'Semanal'], ['quincenal', 'Quincenal'], ['mensual', 'Mensual'], ['por_avance', 'Por avance']], c.periodicidad_certificacion, { name: 'periodicidad_certificacion' })),
        campo('Días para el pago', inp('pago_dias', { type: 'number', min: 0 })),
        campo('Día de pago', select(DIAS, c.pago_dia_semana ?? '', { name: 'pago_dia_semana' }), 'Ej.: primer viernes siguiente'),
        campo('Fondo de reparo (%)', inp('fondo_reparo_pct', { inputmode: 'decimal' })), chk('fr_en_factura', 'El fondo de reparo se descuenta en la factura'),
        campo('Anticipo (%)', inp('anticipo_pct', { inputmode: 'decimal' })), campo('Anticipo cobrado ($)', inp('anticipo_monto', { inputmode: 'decimal' })),
        campo('Fecha de cobro del anticipo', inp('anticipo_fecha', { type: 'date' })), campo('Descuento por certificado (%)', inp('anticipo_descuento_pct', { inputmode: 'decimal' })),
        chk('anticipo_en_factura', 'El descuento del anticipo se resta en la factura'),
        campo('Unidad de las multas', inp('multa_unidad')), chk('multas_en_factura', 'Las multas se descuentan en la factura (si no, por nota de crédito)'),
        h('label', { class: 'campo campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Observaciones'), h('textarea', { name: 'observaciones', rows: 3, text: c.observaciones ?? '' })),
        h('p', { class: 'campo-ancho campo-ayuda' }, 'Cómo se tratan el fondo de reparo, el anticipo y las multas en la factura: A CONFIRMAR CON CONTADOR.'),
      ),
      alAceptar: async (form) => {
        const d = leerForm(form);
        const nul = (v) => (v === '' ? null : v);
        const num = (v) => (v === '' ? null : leerCantidad(v));
        await contratos.actualizar(c.id, {
          descripcion: d.descripcion, cliente_id: d.cliente_id, estado: d.estado, tipo_trabajo: d.tipo_trabajo,
          numero_concurso: nul(d.numero_concurso), numero_contrato: nul(d.numero_contrato), orden_compra: nul(d.orden_compra), expediente: nul(d.expediente),
          ruta: nul(d.ruta), tramo: nul(d.tramo), km_desde: num(d.km_desde), km_hasta: num(d.km_hasta), localidad: nul(d.localidad),
          presupuesto_oficial: leerPesos(d.presupuesto_oficial), representante_tecnico: nul(d.representante_tecnico), inspector: nul(d.inspector),
          fecha_oferta: nul(d.fecha_oferta), fecha_adjudicacion: nul(d.fecha_adjudicacion), fecha_firma: nul(d.fecha_firma), fecha_acta_replanteo: nul(d.fecha_acta_replanteo),
          plazo_dias: d.plazo_dias ? Number(d.plazo_dias) : null, fecha_recepcion_provisoria: nul(d.fecha_recepcion_provisoria),
          plazo_garantia_dias: d.plazo_garantia_dias ? Number(d.plazo_garantia_dias) : 365, fecha_recepcion_definitiva: nul(d.fecha_recepcion_definitiva),
          periodicidad_certificacion: d.periodicidad_certificacion, pago_dias: Number(d.pago_dias || 0), pago_dia_semana: d.pago_dia_semana === '' ? null : Number(d.pago_dia_semana),
          fondo_reparo_pct: num(d.fondo_reparo_pct) ?? 0, fr_en_factura: d.fr_en_factura,
          anticipo_pct: num(d.anticipo_pct) ?? 0, anticipo_monto: leerPesos(d.anticipo_monto) ?? 0, anticipo_fecha: nul(d.anticipo_fecha),
          anticipo_descuento_pct: num(d.anticipo_descuento_pct) ?? 0, anticipo_en_factura: d.anticipo_en_factura,
          multa_unidad: nul(d.multa_unidad), multas_en_factura: d.multas_en_factura, observaciones: nul(d.observaciones),
        });
      },
    });
    if (ok) { aviso('Condiciones guardadas.'); await refrescar(); }
  }

  // ---------------------------------------------------------------- Ítems
  async function vistaItems() {
    const costoU = (it) => ['costo_mano_obra', 'costo_materiales', 'costo_equipos', 'costo_subcontratos', 'costo_otros'].reduce((s, k) => s + aCentavos(it[k] ?? 0), 0);
    vaciar(cuerpo, h('section', { class: 'tarjeta' },
      h('div', { class: 'fila-titulo' }, h('h2', {}, 'Ítems del contrato'),
        esAdmCont ? h('button', { class: 'btn btn-primario btn-chico', type: 'button', onclick: () => editarItem(null) }, '+ Nuevo ítem') : null),
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Ítem', 'Descripción', 'Unidad', 'Cantidad', 'Precio unitario', 'Subtotal', 'Costo unitario', 'Margen', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, items.length ? items.map((it) => {
          const precio = aCentavos(it.precio_unitario); const cu = costoU(it);
          return h('tr', { class: it.activo ? '' : 'inactivo' },
            h('td', {}, it.codigo), h('td', {}, it.descripcion), h('td', {}, it.unidad), h('td', { class: 'num' }, cantidadAR(it.cantidad)),
            h('td', { class: 'num' }, cent(precio)), h('td', { class: 'num' }, cent(importeLinea(it.cantidad, precio))),
            h('td', { class: 'num' }, cu ? cent(cu) : '—'), h('td', { class: 'num' }, cu && precio ? `${numeroAR(((precio - cu) / precio) * 100, 1)} %` : '—'),
            h('td', {}, esAdmCont ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editarItem(it) }, 'Editar') : null));
        }) : h('tr', {}, h('td', { colspan: 9 }, 'Todavía no hay ítems.'))))),
      h('p', { class: 'campo-ayuda' }, 'El costo unitario es el presupuesto de costo por unidad (mano de obra, materiales, equipos, subcontratos y otros). Sirve para comparar con el costo real en las etapas siguientes.')));
  }

  async function editarItem(it) {
    const nuevo = !it;
    const inp = (name, props = {}) => h('input', { name, value: it?.[name] ?? '', ...props });
    const ok = await modal({
      titulo: nuevo ? 'Nuevo ítem' : `Editar ítem ${it.codigo}`,
      contenido: h('div', { class: 'form-grilla' },
        campo('Código', inp('codigo', { required: true, value: it?.codigo ?? String(items.length + 1) })),
        campo('Unidad', inp('unidad', { required: true, placeholder: 'CU, m², ml, km, gl' })),
        h('label', { class: 'campo campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Descripción'), inp('descripcion', { required: true })),
        campo('Cantidad contratada', inp('cantidad', { required: true, inputmode: 'decimal' })),
        campo('Precio unitario sin IVA', inp('precio_unitario', { required: true, inputmode: 'decimal' })),
        h('h3', { class: 'campo-ancho' }, 'Costo presupuestado por unidad (opcional)'),
        campo('Mano de obra', inp('costo_mano_obra', { inputmode: 'decimal' })), campo('Materiales', inp('costo_materiales', { inputmode: 'decimal' })),
        campo('Equipos', inp('costo_equipos', { inputmode: 'decimal' })), campo('Subcontratos', inp('costo_subcontratos', { inputmode: 'decimal' })),
        campo('Otros', inp('costo_otros', { inputmode: 'decimal' })),
        nuevo ? null : h('label', { class: 'check campo-ancho' }, h('input', { type: 'checkbox', name: 'activo', checked: it.activo }), ' Activo'),
      ),
      alAceptar: async (form) => {
        const d = leerForm(form);
        const datos = { codigo: d.codigo, unidad: d.unidad, descripcion: d.descripcion,
          cantidad: leerCantidad(d.cantidad, { obligatorio: true }), precio_unitario: leerPesos(d.precio_unitario, { obligatorio: true }),
          costo_mano_obra: leerPesos(d.costo_mano_obra) ?? 0, costo_materiales: leerPesos(d.costo_materiales) ?? 0,
          costo_equipos: leerPesos(d.costo_equipos) ?? 0, costo_subcontratos: leerPesos(d.costo_subcontratos) ?? 0, costo_otros: leerPesos(d.costo_otros) ?? 0 };
        if (nuevo) await contratos.crearItem({ ...datos, contrato_id: c.id, orden: items.length + 1 });
        else await contratos.actualizarItem(it.id, { ...datos, activo: d.activo });
      },
    });
    if (ok) { aviso(nuevo ? 'Ítem creado.' : 'Ítem actualizado.'); await refrescar(); }
  }

  // ---------------------------------------------------------------- Columnas (avance)
  async function vistaColumnas() {
    const [unidades, certs] = await Promise.all([avance.listar(id), certificados.listar(id)]);
    const numCert = Object.fromEntries(certs.map((x) => [x.id, x.numero]));
    const filtros = { estado: '', tramo: '', texto: '' };
    const seleccion = new Set();
    const tabla = h('div');
    const nombreTramo = (tid) => tramos.find((t) => t.id === tid)?.nombre ?? '—';

    const resumenTramos = () => {
      const filas = [...tramos, { id: null, nombre: 'Sin tramo', cantidad_prevista: 0 }].map((t) => {
        const us = unidades.filter((u) => (u.tramo_id ?? null) === t.id);
        const sum = (f) => us.filter(f).reduce((s, u) => s + Number(u.cantidad), 0);
        return { t, ejec: sum((u) => ['ejecutada', 'aprobada', 'observada'].includes(u.estado)), aprob: sum((u) => u.estado === 'aprobada'), certif: sum((u) => !!u.certificado_id) };
      }).filter((f) => f.t.id || f.ejec);
      const totalPrev = items.reduce((s, it) => s + Number(it.cantidad), 0);
      const total = filas.reduce((a, f) => ({ ejec: a.ejec + f.ejec, aprob: a.aprob + f.aprob, certif: a.certif + f.certif }), { ejec: 0, aprob: 0, certif: 0 });
      return h('section', { class: 'tarjeta' },
        h('div', { class: 'fila-titulo' }, h('h2', {}, 'Avance por tramo'),
          esOperativo ? h('button', { class: 'btn btn-chico', type: 'button', onclick: editarTramos }, 'Editar tramos') : null),
        h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
          h('thead', {}, h('tr', {}, ['Tramo', 'Previstas', 'Ejecutadas', 'Aprobadas', 'Certificadas', 'Avance'].map((x) => h('th', {}, x)))),
          h('tbody', {}, filas.map((f) => h('tr', {}, h('td', {}, f.t.nombre), h('td', { class: 'num' }, cantidadAR(f.t.cantidad_prevista)),
            h('td', { class: 'num' }, cantidadAR(f.ejec)), h('td', { class: 'num' }, cantidadAR(f.aprob)), h('td', { class: 'num' }, cantidadAR(f.certif)),
            h('td', { style: { minWidth: '120px' } }, Number(f.t.cantidad_prevista) ? barra(Math.round((f.aprob / Number(f.t.cantidad_prevista)) * 100)) : '—')))),
          h('tfoot', {}, h('tr', {}, h('th', {}, 'Total'), h('th', { class: 'num' }, cantidadAR(totalPrev)), h('th', { class: 'num' }, cantidadAR(total.ejec)),
            h('th', { class: 'num' }, cantidadAR(total.aprob)), h('th', { class: 'num' }, cantidadAR(total.certif)),
            h('th', {}, totalPrev ? barra(Math.round((total.aprob / totalPrev) * 100)) : '—'))))));
    };

    const dibujarTabla = () => {
      const t = filtros.texto.toLowerCase();
      const vis = unidades.filter((u) => (!filtros.estado || (filtros.estado === 'por_certificar' ? u.estado === 'aprobada' && !u.certificado_id : u.estado === filtros.estado))
        && (!filtros.tramo || (u.tramo_id ?? '') === filtros.tramo) && (!t || u.identificador.toLowerCase().includes(t)));
      const btnAprobar = h('button', { class: 'btn btn-chico btn-primario', type: 'button', disabled: !seleccion.size, onclick: () => aprobar([...seleccion]) }, `Marcar aprobadas (${seleccion.size})`);
      vaciar(tabla, h('section', { class: 'tarjeta' },
        h('div', { class: 'fila-titulo' }, h('h2', {}, `Planilla de columnas (${vis.length})`),
          esOperativo ? h('div', { class: 'acciones' }, btnAprobar, h('button', { class: 'btn btn-chico btn-primario', type: 'button', onclick: cargarUnidades }, '+ Cargar columnas')) : null),
        h('div', { class: 'tabla-scroll tabla-alta' }, h('table', { class: 'tabla' },
          h('thead', {}, h('tr', {}, esOperativo ? h('th', {}, h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todas', onchange: (e) => {
            vis.filter((u) => !u.certificado_id && u.estado !== 'aprobada').forEach((u) => (e.target.checked ? seleccion.add(u.id) : seleccion.delete(u.id))); dibujarTabla();
          } })) : null, ['Columna', 'Tramo', 'Km', 'Lado', 'Pintada', 'Estado', 'Aprobación', 'Certificado', ''].map((x) => h('th', {}, x)))),
          h('tbody', {}, vis.length ? vis.slice(0, 800).map((u) => {
            const [et, tp] = ESTADOS_UNIDAD[u.estado];
            const seleccionable = !u.certificado_id && u.estado !== 'aprobada';
            return h('tr', {},
              esOperativo ? h('td', {}, seleccionable ? h('input', { type: 'checkbox', checked: seleccion.has(u.id), 'aria-label': `Seleccionar ${u.identificador}`,
                onchange: (e) => { e.target.checked ? seleccion.add(u.id) : seleccion.delete(u.id); btnAprobar.disabled = !seleccion.size; btnAprobar.textContent = `Marcar aprobadas (${seleccion.size})`; } }) : null) : null,
              h('td', { class: 'mono' }, u.identificador), h('td', {}, nombreTramo(u.tramo_id)), h('td', { class: 'num' }, u.progresiva_km !== null ? numeroAR(u.progresiva_km, 3) : '—'),
              h('td', {}, u.lado ?? ''), h('td', {}, fechaAR(u.fecha_ejecucion)), h('td', {}, etiqueta(et, tp)),
              h('td', {}, u.fecha_aprobacion ? `${fechaAR(u.fecha_aprobacion)}${u.inspector ? ' · ' + u.inspector : ''}` : ''),
              h('td', {}, u.certificado_id ? h('a', { href: `#/certificado/${u.certificado_id}` }, `N° ${numCert[u.certificado_id] ?? '?'}`) : ''),
              h('td', {}, esOperativo && !u.certificado_id ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editarUnidad(u) }, 'Editar') : null));
          }) : h('tr', {}, h('td', { colspan: 10 }, 'No hay columnas con estos filtros.'))))),
        vis.length > 800 ? h('p', { class: 'campo-ayuda' }, 'Se muestran las primeras 800. Usá los filtros para ver el resto.') : null));
    };

    const aprobar = async (ids) => {
      const ok = await modal({
        titulo: `Aprobar ${ids.length} columna(s)`,
        contenido: [campo('Fecha de aprobación', h('input', { type: 'date', name: 'fecha', required: true, value: hoyISO() })),
          campo('Inspector', h('input', { name: 'inspector', value: c.inspector ?? '' }))],
        aceptar: 'Aprobar',
        alAceptar: async (form) => { const d = leerForm(form); await avance.actualizarVarios(ids, { estado: 'aprobada', fecha_aprobacion: d.fecha, inspector: d.inspector || null }); },
      });
      if (ok) { aviso(`${ids.length} columna(s) aprobadas.`); await mostrar(); }
    };

    const itemSel = () => (items.length > 1 ? campo('Ítem', select(items.map((it) => [it.id, `${it.codigo} · ${it.descripcion}`]), items[0]?.id, { name: 'item_id' })) : null);
    const tramoSel = (v) => campo('Tramo', select([['', '—'], ...tramos.map((t) => [t.id, t.nombre])], v ?? '', { name: 'tramo_id' }));

    async function cargarUnidades() {
      if (!items.length) return error('Primero cargá el ítem del contrato.');
      const estadoSel = select([['ejecutada', 'Ejecutada (pintada)'], ['aprobada', 'Aprobada por la inspección'], ['pendiente', 'Pendiente']], 'ejecutada', { name: 'estado' });
      const ok = await modal({
        titulo: 'Cargar columnas',
        contenido: h('div', { class: 'form-grilla' },
          h('p', { class: 'campo-ancho campo-ayuda' }, 'Cargá un rango: por ejemplo prefijo "C-", desde 1 hasta 40 crea C-1 a C-40. Para una sola, poné el mismo número en desde y hasta.'),
          itemSel(), tramoSel(),
          campo('Prefijo', h('input', { name: 'prefijo', value: 'C-' })), campo('Ceros a la izquierda', h('input', { name: 'ceros', type: 'number', min: 0, max: 5, value: 0 })),
          campo('Desde N°', h('input', { name: 'desde', type: 'number', min: 0, required: true })), campo('Hasta N°', h('input', { name: 'hasta', type: 'number', min: 0, required: true })),
          campo('Fecha de pintado', h('input', { name: 'fecha', type: 'date', value: hoyISO() })), campo('Estado', estadoSel),
          campo('Fecha de aprobación', h('input', { name: 'fecha_aprobacion', type: 'date' }), 'Solo si ya están aprobadas'), campo('Inspector', h('input', { name: 'inspector', value: c.inspector ?? '' })),
          campo('Lado', select([['', '—'], ['Ascendente', 'Ascendente'], ['Descendente', 'Descendente'], ['Cantero central', 'Cantero central'], ['Rotonda', 'Rotonda'], ['Peaje', 'Peaje']], '', { name: 'lado' })),
          campo('Observación', h('input', { name: 'observacion' }))),
        aceptar: 'Cargar',
        alAceptar: async (form) => {
          const d = leerForm(form);
          const desde = Number(d.desde); const hasta = Number(d.hasta);
          if (!Number.isInteger(desde) || !Number.isInteger(hasta) || hasta < desde) throw new Error('Revisá el rango: "hasta" tiene que ser mayor o igual que "desde".');
          if (hasta - desde + 1 > 600) throw new Error('Cargá como máximo 600 columnas por vez.');
          if (d.estado === 'aprobada' && !d.fecha_aprobacion) throw new Error('Indicá la fecha de aprobación.');
          const ceros = Number(d.ceros || 0);
          const filas = [];
          for (let n = desde; n <= hasta; n++) {
            filas.push({ contrato_id: c.id, item_id: d.item_id || items[0].id, tramo_id: d.tramo_id || null,
              identificador: `${d.prefijo}${String(n).padStart(ceros, '0')}`, fecha_ejecucion: d.estado === 'pendiente' ? null : d.fecha || null,
              estado: d.estado, fecha_aprobacion: d.estado === 'aprobada' ? d.fecha_aprobacion : null, inspector: d.inspector || null,
              lado: d.lado || null, observacion: d.observacion || null });
          }
          await avance.crear(filas);
          return filas.length;
        },
      });
      if (ok) { aviso(`${ok} columna(s) cargadas.`); await mostrar(); }
    }

    async function editarUnidad(u) {
      const ok = await modal({
        titulo: `Columna ${u.identificador}`,
        contenido: h('div', { class: 'form-grilla' },
          tramoSel(u.tramo_id),
          campo('Progresiva (km)', h('input', { name: 'progresiva_km', inputmode: 'decimal', value: u.progresiva_km ?? '' })),
          campo('Lado', h('input', { name: 'lado', value: u.lado ?? '' })), campo('Ubicación', h('input', { name: 'ubicacion', value: u.ubicacion ?? '' })),
          campo('Fecha de pintado', h('input', { name: 'fecha_ejecucion', type: 'date', value: u.fecha_ejecucion ?? '' })),
          campo('Estado', select(Object.entries(ESTADOS_UNIDAD).map(([k, [t]]) => [k, t]), u.estado, { name: 'estado' })),
          campo('Fecha de aprobación', h('input', { name: 'fecha_aprobacion', type: 'date', value: u.fecha_aprobacion ?? '' })),
          campo('Inspector', h('input', { name: 'inspector', value: u.inspector ?? '' })),
          h('label', { class: 'campo campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Observación'), h('input', { name: 'observacion', value: u.observacion ?? '' }))),
        alAceptar: async (form) => {
          const d = leerForm(form);
          if (d.estado === 'aprobada' && !d.fecha_aprobacion) throw new Error('Indicá la fecha de aprobación.');
          await avance.actualizar(u.id, { tramo_id: d.tramo_id || null, progresiva_km: d.progresiva_km === '' ? null : leerCantidad(d.progresiva_km),
            lado: d.lado || null, ubicacion: d.ubicacion || null, fecha_ejecucion: d.fecha_ejecucion || null, estado: d.estado,
            fecha_aprobacion: d.fecha_aprobacion || null, inspector: d.inspector || null, observacion: d.observacion || null });
        },
      });
      if (ok) { aviso('Columna actualizada.'); await mostrar(); }
    }

    vaciar(cuerpo,
      resumenTramos(),
      h('div', { class: 'filtros' },
        campo('Estado', select([['', 'Todos'], ['por_certificar', 'Aprobadas sin certificar'], ...Object.entries(ESTADOS_UNIDAD).map(([k, [t]]) => [k, t])], '', { onchange: (e) => { filtros.estado = e.target.value; dibujarTabla(); } })),
        campo('Tramo', select([['', 'Todos'], ...tramos.map((t) => [t.id, t.nombre])], '', { onchange: (e) => { filtros.tramo = e.target.value; dibujarTabla(); } })),
        campo('Buscar', h('input', { type: 'search', placeholder: 'N° de columna', oninput: (e) => { filtros.texto = e.target.value.trim(); dibujarTabla(); } }))),
      tabla);
    dibujarTabla();
  }

  async function editarTramos() {
    const area = h('textarea', { name: 'tramos', rows: 12, text: tramos.map((t) => `${t.nombre} | ${Number(t.cantidad_prevista)}`).join('\n') });
    const ok = await modal({
      titulo: 'Tramos de la obra',
      contenido: [h('p', { class: 'campo-ayuda' }, 'Un tramo por renglón, con el formato: Nombre | cantidad prevista. El orden de los renglones es el orden de los tramos. Los tramos que quites quedan inactivos.'), area],
      alAceptar: async (form) => {
        const lineas = leerForm(form).tramos.split('\n').map((l) => l.trim()).filter(Boolean);
        const nuevos = lineas.map((l, i) => { const [n, q] = l.split('|').map((x) => x.trim()); return { nombre: n, cantidad_prevista: leerCantidad(q || '0') ?? 0, orden: i + 1 }; });
        for (const t of nuevos) {
          const ex = tramos.find((x) => x.nombre.toLowerCase() === t.nombre.toLowerCase());
          if (ex) await contratos.actualizarTramo(ex.id, { ...t, activo: true }); else await contratos.crearTramo({ ...t, contrato_id: c.id });
        }
        for (const ex of tramos) if (!nuevos.some((t) => t.nombre.toLowerCase() === ex.nombre.toLowerCase()) && ex.activo) await contratos.actualizarTramo(ex.id, { activo: false });
      },
    });
    if (ok) { aviso('Tramos guardados.'); await refrescar(); }
  }

  // ---------------------------------------------------------------- Certificados
  async function vistaCertificados() {
    const certs = await certificados.listar(id);
    vaciar(cuerpo, h('section', { class: 'tarjeta' },
      h('div', { class: 'fila-titulo' }, h('h2', {}, 'Certificados'),
        esOperativo ? h('button', { class: 'btn btn-primario btn-chico', type: 'button', onclick: nuevoCertificado }, '+ Nuevo certificado') : null),
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['N°', 'Período', 'Estado', 'Cantidad', 'Bruto', 'Descuentos', 'Total factura', 'Neto a cobrar'].map((x) => h('th', {}, x)))),
        h('tbody', {}, certs.length ? certs.map((x) => {
          const [et, tp] = ESTADOS_CERT[x.estado];
          const cant = (x.certificado_items ?? []).reduce((s, i) => s + Number(i.cantidad), 0);
          return h('tr', { class: x.estado === 'anulado' ? 'inactivo' : '' },
            h('td', {}, h('a', { href: `#/certificado/${x.id}` }, h('strong', {}, `N° ${x.numero}`))),
            h('td', {}, `${fechaAR(x.periodo_desde)} al ${fechaAR(x.periodo_hasta)}`), h('td', {}, etiqueta(et, tp)),
            h('td', { class: 'num' }, cantidadAR(cant)), h('td', { class: 'num' }, pesos(x.bruto)),
            h('td', { class: 'num' }, pesos(Number(x.fondo_reparo) + Number(x.descuento_anticipo) + Number(x.multas))),
            h('td', { class: 'num' }, pesos(x.total_factura)), h('td', { class: 'num' }, pesos(x.neto_a_cobrar)));
        }) : h('tr', {}, h('td', { colspan: 8 }, 'Todavía no hay certificados.')))))));
  }

  async function nuevoCertificado() {
    if (!items.length) return error('Primero cargá el ítem del contrato.');
    const hoy = new Date(`${hoyISO()}T12:00:00Z`);
    const lunes = sumarDias(hoyISO(), -((hoy.getUTCDay() + 6) % 7));
    const ok = await modal({
      titulo: 'Nuevo certificado',
      contenido: [campo('Período desde', h('input', { type: 'date', name: 'desde', required: true, value: lunes })),
        campo('Período hasta', h('input', { type: 'date', name: 'hasta', required: true, value: sumarDias(lunes, 4) })),
        h('p', { class: 'campo-ayuda' }, 'Se crea en borrador. Después traés las columnas aprobadas o cargás las cantidades a mano.')],
      aceptar: 'Crear',
      alAceptar: async (form) => {
        const d = leerForm(form);
        if (d.hasta < d.desde) throw new Error('La fecha "hasta" no puede ser anterior a "desde".');
        const [n] = await certificados.crear({ contrato_id: c.id, periodo_desde: d.desde, periodo_hasta: d.hasta });
        return n;
      },
    });
    if (ok) location.hash = `#/certificado/${ok.id}`;
  }

  // ---------------------------------------------------------------- Multas
  async function vistaMultas() {
    const lista = await multas.listar(id);
    const certs = await certificados.listar(id);
    const numCert = Object.fromEntries(certs.map((x) => [x.id, x.numero]));
    const total = lista.filter((m) => m.estado !== 'anulada').reduce((s, m) => s + aCentavos(m.importe), 0);
    vaciar(cuerpo, h('section', { class: 'tarjeta' },
      h('div', { class: 'fila-titulo' }, h('h2', {}, `Multas · total ${cent(total)}`),
        esOperativo ? h('button', { class: 'btn btn-primario btn-chico', type: 'button', onclick: nuevaMulta }, '+ Registrar multa') : null),
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Fecha', 'Motivo', 'Referencia', 'Litros', 'Precio litro', 'Importe', 'Estado', 'Certificado', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, lista.length ? lista.map((m) => h('tr', { class: m.estado === 'anulada' ? 'inactivo' : '' },
          h('td', {}, fechaAR(m.fecha)), h('td', {}, MOTIVOS_MULTA[m.motivo]?.[0] ?? m.motivo), h('td', {}, m.referencia ?? ''),
          h('td', { class: 'num' }, m.litros !== null ? cantidadAR(m.litros) : '—'), h('td', { class: 'num' }, m.precio_litro !== null ? pesos(m.precio_litro) : '—'),
          h('td', { class: 'num' }, pesos(m.importe)), h('td', {}, etiqueta(m.estado, m.estado === 'aplicada' ? 'alerta' : 'neutra')),
          h('td', {}, m.certificado_id ? `N° ${numCert[m.certificado_id] ?? '?'}` : ''),
          h('td', {}, esAdmCont && m.estado === 'aplicada' && !m.certificado_id ? h('button', { class: 'btn btn-chico', type: 'button', onclick: async () => {
            try { await multas.actualizar(m.id, { estado: 'anulada' }); aviso('Multa anulada.'); await mostrar(); } catch (e) { error(e.message); }
          } }, 'Anular') : null)))
          : h('tr', {}, h('td', { colspan: 9 }, 'No hay multas registradas.'))))),
      h('p', { class: 'campo-ayuda' }, 'Según el pliego, las multas se expresan en litros de nafta YPF Premium al precio de ACA en Córdoba y se descuentan con nota de crédito. Para descontarla, asignala a un certificado desde la pantalla del certificado.')));
  }

  async function nuevaMulta() {
    const litros = h('input', { name: 'litros', inputmode: 'decimal', value: '600' });
    const dias = h('input', { name: 'dias', type: 'number', min: 1, value: 1 });
    const precio = h('input', { name: 'precio_litro', inputmode: 'decimal', placeholder: 'Precio ACA Córdoba' });
    const importe = h('output', { class: 'dato-valor' }, '—');
    const motivo = select(Object.entries(MOTIVOS_MULTA).map(([k, [t]]) => [k, t]), 'orden_servicio', { name: 'motivo' });
    const recalcular = () => {
      try {
        const base = MOTIVOS_MULTA[motivo.value][1];
        if (base && document.activeElement !== litros) litros.value = String(base * (motivo.value === 'orden_servicio' ? 1 : Number(dias.value || 1)));
        const p = leerPesos(precio.value); const l = leerCantidad(litros.value);
        importe.textContent = p && l ? cent(importeMulta(l, p)) : '—';
      } catch { importe.textContent = '—'; }
    };
    [motivo, dias, precio, litros].forEach((x) => x.addEventListener('input', recalcular));
    motivo.addEventListener('change', recalcular);
    const ok = await modal({
      titulo: 'Registrar multa',
      contenido: h('div', { class: 'form-grilla' },
        campo('Fecha', h('input', { name: 'fecha', type: 'date', required: true, value: hoyISO() })), campo('Motivo', motivo),
        campo('Referencia', h('input', { name: 'referencia', placeholder: 'Ej.: Orden de servicio N° 3' })), campo('Días de demora', dias),
        campo('Litros de nafta', litros), campo('Precio por litro', precio),
        h('div', { class: 'campo campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Importe de la multa'), importe),
        h('label', { class: 'campo campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Observación'), h('input', { name: 'observacion' }))),
      alAceptar: async (form) => {
        const d = leerForm(form);
        const l = leerCantidad(d.litros, { obligatorio: true }); const p = leerPesos(d.precio_litro, { obligatorio: true });
        await multas.crear({ contrato_id: c.id, fecha: d.fecha, motivo: d.motivo, referencia: d.referencia || null, dias: d.dias ? Number(d.dias) : null,
          litros: l, precio_litro: p, importe: (importeMulta(l, p) / 100).toFixed(2), observacion: d.observacion || null });
      },
    });
    if (ok) { aviso('Multa registrada.'); await mostrar(); }
  }

  // ---------------------------------------------------------------- Pólizas
  async function vistaPolizas() {
    const lista = await polizas.listar(id);
    const hoy = hoyISO();
    vaciar(cuerpo, h('section', { class: 'tarjeta' },
      h('div', { class: 'fila-titulo' }, h('h2', {}, 'Pólizas y garantías'),
        esOperativo ? h('button', { class: 'btn btn-primario btn-chico', type: 'button', onclick: () => editarPoliza(null) }, '+ Nueva póliza') : null),
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Tipo', 'Aseguradora', 'N°', 'Suma asegurada', 'Franquicia', 'Vigencia', 'Estado', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, lista.length ? lista.map((p) => {
          const dias = p.vigencia_hasta ? diasEntre(hoy, p.vigencia_hasta) : null;
          const alerta = p.estado === 'vigente' && dias !== null ? (dias < 0 ? etiqueta('Vencida', 'peligro') : dias <= 15 ? etiqueta(`Vence en ${dias} días`, 'alerta') : null) : null;
          return h('tr', { class: ['anulada', 'vencida'].includes(p.estado) ? 'inactivo' : '' },
            h('td', {}, TIPOS_POLIZA[p.tipo] ?? p.tipo, p.contrato_id ? null : h('small', { class: 'texto-suave' }, ' (general)')),
            h('td', {}, p.aseguradora), h('td', {}, p.numero ?? ''), h('td', { class: 'num' }, pesos(p.suma_asegurada)), h('td', { class: 'num' }, pesos(p.franquicia)),
            h('td', {}, `${fechaAR(p.vigencia_desde)} al ${fechaAR(p.vigencia_hasta)}`), h('td', {}, etiqueta(p.estado), ' ', alerta),
            h('td', {}, esOperativo ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => editarPoliza(p) }, 'Editar') : null));
        }) : h('tr', {}, h('td', { colspan: 8 }, 'No hay pólizas cargadas.'))))),
      h('p', { class: 'campo-ayuda' }, 'El pliego exige póliza de responsabilidad civil por $100.000.000 con franquicia máxima de $10.000.000, con Caminos de las Sierras y la Provincia como coasegurados. Si pedís el anticipo, también la garantía del 20%.')));
  }

  async function editarPoliza(p) {
    const nueva = !p;
    const inp = (name, props = {}) => h('input', { name, value: p?.[name] ?? '', ...props });
    const ok = await modal({
      titulo: nueva ? 'Nueva póliza' : 'Editar póliza',
      contenido: h('div', { class: 'form-grilla' },
        campo('Tipo', select(Object.entries(TIPOS_POLIZA), p?.tipo ?? 'responsabilidad_civil', { name: 'tipo' })),
        campo('Alcance', select([['contrato', `Solo este contrato (${c.codigo})`], ['general', 'General (todas las obras)']], p && !p.contrato_id ? 'general' : 'contrato', { name: 'alcance' })),
        campo('Aseguradora', inp('aseguradora', { required: true })), campo('N° de póliza', inp('numero')),
        campo('Suma asegurada', inp('suma_asegurada', { inputmode: 'decimal' })), campo('Franquicia', inp('franquicia', { inputmode: 'decimal' })),
        campo('Vigencia desde', inp('vigencia_desde', { type: 'date' })), campo('Vigencia hasta', inp('vigencia_hasta', { type: 'date' })),
        campo('Costo', inp('costo', { inputmode: 'decimal' })),
        campo('Estado', select([['solicitada', 'Solicitada'], ['vigente', 'Vigente'], ['vencida', 'Vencida'], ['anulada', 'Anulada']], p?.estado ?? 'vigente', { name: 'estado' })),
        h('label', { class: 'campo campo-ancho' }, h('span', { class: 'campo-etiqueta' }, 'Observación'), inp('observacion'))),
      alAceptar: async (form) => {
        const d = leerForm(form);
        const datos = { tipo: d.tipo, contrato_id: d.alcance === 'general' ? null : c.id, aseguradora: d.aseguradora, numero: d.numero || null,
          suma_asegurada: leerPesos(d.suma_asegurada), franquicia: leerPesos(d.franquicia), vigencia_desde: d.vigencia_desde || null,
          vigencia_hasta: d.vigencia_hasta || null, costo: leerPesos(d.costo), estado: d.estado, observacion: d.observacion || null };
        if (nueva) await polizas.crear(datos); else await polizas.actualizar(p.id, datos);
      },
    });
    if (ok) { aviso('Póliza guardada.'); await mostrar(); }
  }

  // ---------------------------------------------------------------- Redeterminaciones
  async function vistaRedeterminaciones() {
    const lista = await contratos.redeterminaciones(id);
    vaciar(cuerpo, h('section', { class: 'tarjeta' },
      h('div', { class: 'fila-titulo' }, h('h2', {}, 'Redeterminaciones de precio'),
        esAdmCont ? h('button', { class: 'btn btn-primario btn-chico', type: 'button', onclick: () => nuevaRedet(lista) }, '+ Nueva redeterminación') : null),
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['N°', 'Vigencia', 'Factor', 'Precios por ítem', 'Referencia', 'Estado', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, lista.length ? lista.map((r) => h('tr', { class: r.estado === 'anulada' ? 'inactivo' : '' },
          h('td', {}, r.numero), h('td', {}, fechaAR(r.fecha_vigencia)), h('td', {}, r.factor ? numeroAR(r.factor, 4) : '—'),
          h('td', {}, (r.redeterminacion_precios ?? []).map((pp) => `${items.find((i) => i.id === pp.item_id)?.codigo ?? '?'}: ${pesos(pp.precio_unitario)}`).join(' · ') || '—'),
          h('td', {}, r.referencia ?? ''), h('td', {}, etiqueta(r.estado, r.estado === 'aprobada' ? 'ok' : 'neutra')),
          h('td', { class: 'acciones-fila' }, esAdmCont && r.estado === 'borrador' ? [
            h('button', { class: 'btn btn-chico btn-primario', type: 'button', onclick: async () => { try { await contratos.actualizarRedeterminacion(r.id, { estado: 'aprobada' }); aviso('Redeterminación aprobada.'); await mostrar(); } catch (e) { error(e.message); } } }, 'Aprobar'),
            h('button', { class: 'btn btn-chico', type: 'button', onclick: async () => { try { await contratos.actualizarRedeterminacion(r.id, { estado: 'anulada' }); await mostrar(); } catch (e) { error(e.message); } } }, 'Anular')] : null)))
          : h('tr', {}, h('td', { colspan: 7 }, 'No hay redeterminaciones.'))))),
      h('p', { class: 'campo-ayuda' }, 'El pliego de RP-E55 no prevé redeterminación: solo ajusta el precio si cambian los impuestos. Una redeterminación aprobada se aplica a los certificados con fecha igual o posterior a su vigencia.')));
  }

  async function nuevaRedet(lista) {
    const ok = await modal({
      titulo: 'Nueva redeterminación',
      contenido: h('div', { class: 'form-grilla' },
        campo('Vigente desde', h('input', { name: 'fecha', type: 'date', required: true })),
        campo('Factor sobre el precio de oferta', h('input', { name: 'factor', inputmode: 'decimal', placeholder: 'Ej.: 1,0850' }), 'Opcional si cargás precios por ítem'),
        campo('Referencia / acta', h('input', { name: 'referencia' })),
        h('h3', { class: 'campo-ancho' }, 'Precios nuevos por ítem (opcional)'),
        items.map((it) => campo(`${it.codigo} · ${it.unidad} (oferta ${pesos(it.precio_unitario)})`, h('input', { name: `p_${it.id}`, inputmode: 'decimal' })))),
      alAceptar: async (form) => {
        const d = leerForm(form);
        const precios = items.map((it) => ({ item_id: it.id, precio_unitario: leerPesos(d[`p_${it.id}`]) })).filter((x) => x.precio_unitario);
        const factor = d.factor ? leerCantidad(d.factor) : null;
        if (!factor && !precios.length) throw new Error('Cargá un factor o al menos un precio por ítem.');
        await contratos.crearRedeterminacion({ contrato_id: c.id, numero: lista.length + 1, fecha_vigencia: d.fecha, factor, referencia: d.referencia || null }, precios);
      },
    });
    if (ok) { aviso('Redeterminación creada en borrador.'); await mostrar(); }
  }

  // ---------------------------------------------------------------- Archivos
  async function vistaArchivos() {
    vaciar(cuerpo, panelAdjuntos('contratos', id, esOperativo),
      h('p', { class: 'campo-ayuda' }, 'Subí acá el contrato u orden de compra, el pliego, el acta de replanteo y las actas de recepción.'));
  }

  // ---------------------------------------------------------------- Armado
  await pantalla(cont, async () => {
    await recargar();
    const [et, tp] = ESTADOS_CONTRATO[c.estado] ?? [c.estado, 'neutra'];
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/contratos' }, 'Contratos'), ' › ', c.codigo),
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, `${c.codigo} · ${c.descripcion}`),
        h('p', { class: 'descripcion' }, c.cliente, ' ', etiqueta(et, tp)))),
      pestañas([['resumen', 'Resumen'], ['items', 'Ítems'], ['columnas', 'Columnas'], ['certificados', 'Certificados'], ['multas', 'Multas'],
        ['polizas', 'Pólizas'], ['redeterminaciones', 'Redeterminaciones'], ['archivos', 'Archivos']], pestañaActual, (t) => { pestañaActual = t; mostrar(); }),
      cuerpo);
    await mostrar();
  });
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
