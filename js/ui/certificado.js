// Editor de un certificado: cantidades (a mano o desde las columnas aprobadas), multas,
// cálculo en el momento, cambio de estado e impresión de la planilla.
import { h, vaciar, pantalla, campo, modal, aviso, error, etiqueta, fechaAR, pesos, cent, cantidadAR, leerCantidad, confirmar } from './dom.js';
import { contratos, certificados, avance, multas, fiscal, empresa } from '../data/repos.js';
import { ESTADOS_CERT } from './contrato.js';
import { panelAdjuntos } from './adjuntos.js';
import { calcularCertificado, cantidadesDesdeAvance, fechaPago } from '../core/certificados.js';
import { alicuotaVigente } from '../core/iva.js';
import { formatearCuit } from '../core/cuit.js';

export async function pantallaCertificado(cont, ctx, id) {
  const rol = ctx.perfil.rol;
  const esAdmCont = ['administrador', 'contador'].includes(rol);
  const esOperativo = esAdmCont || rol === 'operador';

  await pantalla(cont, async () => {
    const cert = await certificados.obtener(id);
    if (!cert) throw new Error('No se encontró el certificado.');
    const [c, items, redets, todos, unidades, multasC, catalogo, emp] = await Promise.all([
      contratos.obtener(cert.contrato_id), contratos.items(cert.contrato_id), contratos.redeterminaciones(cert.contrato_id),
      certificados.listar(cert.contrato_id), avance.listar(cert.contrato_id), multas.listar(cert.contrato_id), fiscal.catalogo(), empresa.obtener(),
    ]);
    const tramos = await contratos.tramos(cert.contrato_id);
    const editable = cert.estado === 'borrador' && esOperativo;
    const redeterminaciones = redets.map((r) => ({ ...r, precios: Object.fromEntries((r.redeterminacion_precios ?? []).map((p) => [p.item_id, p.precio_unitario])) }));
    const previos = todos.map((x) => ({ id: x.id, estado: x.estado, descuento_anticipo: x.descuento_anticipo, items: x.certificado_items }));

    // Estado editable
    const cantidades = Object.fromEntries((cert.certificado_items ?? []).map((i) => [i.item_id, Number(i.cantidad)]));
    let unidadesSel = new Set(unidades.filter((u) => u.certificado_id === id).map((u) => u.id));
    let multasSel = new Set(multasC.filter((m) => m.certificado_id === id).map((m) => m.id));
    let resultado = null;

    const bp = () => { try { return alicuotaVigente(catalogo, c.alicuota_iva, cert.periodo_hasta) ?? 2100; } catch { return 2100; } };
    const calcular = () => calcularCertificado({
      contrato: c, items: items.filter((i) => i.activo), redeterminaciones, previos, certificadoId: id, cantidades,
      fecha: cert.periodo_hasta, multas: multasC.filter((m) => multasSel.has(m.id)), alicuotaIvaBp: bp(),
    });

    const zonaLineas = h('div');
    const zonaTotales = h('div');
    const zonaMultas = h('div');
    const zonaAvisos = h('div');

    const redibujar = () => {
      resultado = calcular();
      vaciar(zonaAvisos, resultado.ok
        ? (resultado.advertencias.length ? h('ul', { class: 'advertencias tarjeta' }, resultado.advertencias.map((a) => h('li', {}, a))) : null)
        : h('div', { class: 'tarjeta tarjeta-error' }, h('ul', {}, resultado.errores.map((e) => h('li', {}, e)))));
      // Líneas
      vaciar(zonaLineas, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Ítem', 'Descripción', 'Contratado', 'Anterior', 'Este certificado', 'Acumulado', '% avance', 'Precio', 'Importe'].map((t) => h('th', {}, t)))),
        h('tbody', {}, items.filter((i) => i.activo).map((it) => {
          const l = resultado.ok ? resultado.lineas.find((x) => x.item_id === it.id) : null;
          const anterior = l ? l.anterior : (resultado.ok ? 0 : null);
          return h('tr', {},
            h('td', {}, it.codigo), h('td', {}, it.descripcion), h('td', { class: 'num' }, `${cantidadAR(it.cantidad)} ${it.unidad}`),
            h('td', { class: 'num' }, l ? cantidadAR(l.anterior) : anterior === null ? '—' : cantidadAR(anterior)),
            h('td', { class: 'num' }, editable
              ? h('input', { class: 'input-num', inputmode: 'decimal', value: cantidades[it.id] ?? '', 'aria-label': `Cantidad del ítem ${it.codigo}`,
                  onchange: (e) => { try { cantidades[it.id] = leerCantidad(e.target.value) ?? 0; redibujar(); } catch (err) { error(err.message); } } })
              : cantidadAR(cantidades[it.id] ?? 0)),
            h('td', { class: 'num' }, l ? cantidadAR(l.acumulado) : '—'), h('td', { class: 'num' }, l && l.pctAcumulado !== null ? `${l.pctAcumulado.toLocaleString('es-AR')} %` : '—'),
            h('td', { class: 'num' }, l ? cent(l.precio) : pesos(it.precio_unitario)), h('td', { class: 'num' }, l ? h('strong', {}, cent(l.importe)) : '—'));
        })))));
      // Totales
      const r = resultado;
      const fila = (k, v, fuerte, nota) => h('tr', {}, h('td', {}, k, nota ? h('small', { class: 'texto-suave' }, ` ${nota}`) : null), h('td', { class: 'num' }, fuerte ? h('strong', {}, v) : v));
      vaciar(zonaTotales, r.ok ? h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
        fila('Bruto certificado', cent(r.bruto), true),
        r.fondoReparo ? fila('Fondo de reparo', `− ${cent(r.fondoReparo)}`, false, c.fr_en_factura ? '(en factura)' : '(se retiene en el pago)') : null,
        r.descuentoAnticipo ? fila('Descuento de anticipo', `− ${cent(r.descuentoAnticipo)}`, false, `(queda pendiente ${cent(r.anticipoPendienteDespues)})`) : null,
        r.multas ? fila('Multas', `− ${cent(r.multas)}`, false, c.multas_en_factura ? '(en factura)' : '(por nota de crédito)') : null,
        fila('Neto a facturar', cent(r.baseFactura), true),
        fila(`IVA ${(bp() / 100).toLocaleString('es-AR')} %`, cent(r.iva)),
        fila('Total factura', cent(r.totalFactura), true),
        r.totalFactura !== r.netoACobrar ? fila('Neto a cobrar estimado', cent(r.netoACobrar), true, '(antes de retenciones impositivas)') : null,
        fila('Fecha de pago estimada', fechaAR(fechaPago(cert.fecha_presentacion ?? cert.periodo_hasta, c.pago_dias, c.pago_dia_semana ?? 5)), false,
          cert.fecha_presentacion ? '' : '(si la factura se presenta al cierre del período)'))) : null);
      // Multas
      const disponibles = multasC.filter((m) => m.estado === 'aplicada' && (!m.certificado_id || m.certificado_id === id));
      vaciar(zonaMultas, disponibles.length ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Multas a descontar'),
        disponibles.map((m) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: multasSel.has(m.id), disabled: !editable, onchange: (e) => { e.target.checked ? multasSel.add(m.id) : multasSel.delete(m.id); redibujar(); } }),
          ` ${fechaAR(m.fecha)} · ${m.referencia ?? m.motivo} · ${pesos(m.importe)}`))) : null);
    };

    // ---- Acciones
    const guardar = async ({ silencioso = false } = {}) => {
      const r = calcular();
      if (!r.ok) throw new Error(r.errores.join(' '));
      const filas = r.lineas.map((l) => ({ item_id: l.item_id, cantidad: l.actual, precio_unitario: (l.precio / 100).toFixed(2), importe: (l.importe / 100).toFixed(2), cantidad_anterior: l.anterior }));
      const toP = (x) => (x / 100).toFixed(2);
      await certificados.guardarBorrador(id, filas, { bruto: toP(r.bruto), fondo_reparo: toP(r.fondoReparo), descuento_anticipo: toP(r.descuentoAnticipo),
        multas: toP(r.multas), base_factura: toP(r.baseFactura), iva: toP(r.iva), total_factura: toP(r.totalFactura), neto_a_cobrar: toP(r.netoACobrar) });
      const antes = unidades.filter((u) => u.certificado_id === id).map((u) => u.id);
      await avance.actualizarVarios(antes.filter((x) => !unidadesSel.has(x)), { certificado_id: null });
      await avance.actualizarVarios([...unidadesSel].filter((x) => !antes.includes(x)), { certificado_id: id });
      for (const m of multasC) {
        const debe = multasSel.has(m.id);
        if (debe && m.certificado_id !== id) await multas.actualizar(m.id, { certificado_id: id });
        if (!debe && m.certificado_id === id) await multas.actualizar(m.id, { certificado_id: null });
      }
      if (!silencioso) aviso('Certificado guardado.');
    };

    const cambiarEstado = async (nuevo, pedirMotivo) => {
      let motivo = null;
      if (pedirMotivo) {
        const ok = await modal({ titulo: nuevo === 'anulado' ? 'Anular certificado' : 'Observar certificado', peligro: nuevo === 'anulado',
          contenido: campo('Motivo', h('input', { name: 'motivo', required: true })), aceptar: nuevo === 'anulado' ? 'Anular' : 'Guardar',
          alAceptar: (form) => form.elements.motivo.value.trim() });
        if (!ok) return;
        motivo = ok;
      }
      try {
        if (nuevo === 'presentado' && cert.estado === 'borrador') await guardar({ silencioso: true });
        await certificados.actualizar(id, motivo ? { estado: nuevo, motivo } : { estado: nuevo });
        aviso(`Certificado ${ESTADOS_CERT[nuevo][0].toLowerCase()}.`);
        await pantallaCertificado(cont, ctx, id);
      } catch (e) { error(e.message); }
    };

    const traerColumnas = () => {
      const candidatas = unidades.filter((u) => u.estado === 'aprobada' && (!u.certificado_id || u.certificado_id === id))
        .map((u) => (u.certificado_id === id ? { ...u, certificado_id: null } : u));
      const { cantidades: q, ids } = cantidadesDesdeAvance(candidatas, cert.periodo_hasta);
      if (!ids.length) { aviso('No hay columnas aprobadas sin certificar hasta el fin del período.', 'error'); return; }
      for (const it of items) cantidades[it.id] = q[it.id] ?? 0;
      unidadesSel = new Set(ids);
      aviso(`Se tomaron ${ids.length} columna(s) aprobadas.`);
      redibujar();
      vaciar(zonaUnidades, listaUnidades());
    };

    const zonaUnidades = h('div');
    const listaUnidades = () => {
      const us = unidades.filter((u) => unidadesSel.has(u.id));
      const nombreTramo = (t) => tramos.find((x) => x.id === t)?.nombre ?? '';
      return h('details', { class: 'tarjeta' }, h('summary', {}, h('strong', {}, `Columnas incluidas (${us.length})`)),
        us.length ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
          h('thead', {}, h('tr', {}, ['Columna', 'Tramo', 'Pintada', 'Aprobada', 'Inspector'].map((t) => h('th', {}, t)))),
          h('tbody', {}, us.map((u) => h('tr', {}, h('td', { class: 'mono' }, u.identificador), h('td', {}, nombreTramo(u.tramo_id)),
            h('td', {}, fechaAR(u.fecha_ejecucion)), h('td', {}, fechaAR(u.fecha_aprobacion)), h('td', {}, u.inspector ?? ''))))))
          : h('p', { class: 'texto-suave' }, 'No hay columnas vinculadas. Si cargás cantidades a mano, el certificado no queda asociado a la planilla de columnas.'));
    };

    const imprimir = () => {
      const r = calcular();
      const us = unidades.filter((u) => unidadesSel.has(u.id));
      const nombreTramo = (t) => tramos.find((x) => x.id === t)?.nombre ?? '';
      const hoja = h('div', { class: 'solo-impresion' },
        h('div', { class: 'imp-cabecera' },
          h('div', {}, h('strong', {}, emp?.razon_social ?? ''), h('br'), `${emp?.nombre_fantasia ?? ''} · CUIT ${emp?.cuit ? formatearCuit(emp.cuit) : ''}`, h('br'),
            `${emp?.domicilio ?? ''} · ${emp?.localidad ?? ''}`),
          h('div', { class: 'imp-derecha' }, h('strong', {}, `CERTIFICADO N° ${cert.numero}`), h('br'), `Período ${fechaAR(cert.periodo_desde)} al ${fechaAR(cert.periodo_hasta)}`, h('br'),
            `Estado: ${ESTADOS_CERT[cert.estado][0]}`)),
        h('p', {}, h('strong', {}, 'Comitente: '), c.cliente, h('br'), h('strong', {}, 'Obra: '), c.descripcion,
          c.numero_concurso ? ` · Concurso de precios ${c.numero_concurso}` : '', c.numero_contrato ? ` · Contrato ${c.numero_contrato}` : ''),
        r.ok ? h('table', { class: 'tabla' },
          h('thead', {}, h('tr', {}, ['Ítem', 'Descripción', 'Unidad', 'Contratado', 'Anterior', 'Presente', 'Acumulado', '%', 'P. unitario', 'Importe'].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.lineas.map((l) => h('tr', {}, h('td', {}, l.codigo), h('td', {}, l.descripcion), h('td', {}, l.unidad), h('td', { class: 'num' }, cantidadAR(l.contratado)),
            h('td', { class: 'num' }, cantidadAR(l.anterior)), h('td', { class: 'num' }, cantidadAR(l.actual)), h('td', { class: 'num' }, cantidadAR(l.acumulado)),
            h('td', { class: 'num' }, `${(l.pctAcumulado ?? 0).toLocaleString('es-AR')}%`), h('td', { class: 'num' }, cent(l.precio)), h('td', { class: 'num' }, cent(l.importe)))))) : null,
        r.ok ? h('table', { class: 'tabla imp-totales' }, h('tbody', {},
          h('tr', {}, h('td', {}, 'Bruto certificado'), h('td', { class: 'num' }, cent(r.bruto))),
          r.fondoReparo ? h('tr', {}, h('td', {}, 'Fondo de reparo'), h('td', { class: 'num' }, `− ${cent(r.fondoReparo)}`)) : null,
          r.descuentoAnticipo ? h('tr', {}, h('td', {}, 'Descuento de anticipo financiero'), h('td', { class: 'num' }, `− ${cent(r.descuentoAnticipo)}`)) : null,
          r.multas ? h('tr', {}, h('td', {}, 'Multas'), h('td', { class: 'num' }, `− ${cent(r.multas)}`)) : null,
          h('tr', {}, h('td', {}, h('strong', {}, 'Neto a facturar (sin IVA)')), h('td', { class: 'num' }, h('strong', {}, cent(r.baseFactura)))))) : null,
        us.length ? [h('h3', {}, `Planilla de columnas certificadas (${us.length})`),
          h('table', { class: 'tabla imp-chica' }, h('thead', {}, h('tr', {}, ['Columna', 'Tramo', 'Km', 'Pintada', 'Aprobada', 'Inspector'].map((t) => h('th', {}, t)))),
            h('tbody', {}, us.map((u) => h('tr', {}, h('td', {}, u.identificador), h('td', {}, nombreTramo(u.tramo_id)), h('td', {}, u.progresiva_km ?? ''),
              h('td', {}, fechaAR(u.fecha_ejecucion)), h('td', {}, fechaAR(u.fecha_aprobacion)), h('td', {}, u.inspector ?? '')))))] : null,
        h('div', { class: 'imp-firmas' },
          h('div', {}, h('span', {}, 'Contratista / Representante técnico'), h('br'), c.representante_tecnico ?? ''),
          h('div', {}, h('span', {}, 'Inspección'), h('br'), c.inspector ?? '')),
        h('p', { class: 'imp-pie' }, `Emitido con el sistema contable MADEWORK el ${new Date().toLocaleString('es-AR')}`));
      document.body.appendChild(hoja);
      document.body.classList.add('imprimiendo');
      const limpiar = () => { hoja.remove(); document.body.classList.remove('imprimiendo'); window.removeEventListener('afterprint', limpiar); };
      window.addEventListener('afterprint', limpiar);
      window.print();
      setTimeout(limpiar, 1000);
    };

    // ---- Botones según estado
    const b = (texto, fn, clase = 'btn') => h('button', { class: clase, type: 'button', onclick: fn }, texto);
    const acciones = [];
    if (editable) {
      acciones.push(b('Traer columnas aprobadas', traerColumnas));
      acciones.push(b('Guardar borrador', async () => { try { await guardar(); await pantallaCertificado(cont, ctx, id); } catch (e) { error(e.message); } }, 'btn btn-primario'));
      acciones.push(b('Presentar', async () => {
        if (await confirmar('Presentar certificado', 'Al presentarlo se bloquean las cantidades e importes. ¿Seguís?', 'Presentar')) cambiarEstado('presentado');
      }, 'btn btn-primario'));
    }
    if (cert.estado === 'presentado') {
      if (esAdmCont) acciones.push(b('Marcar aprobado', () => cambiarEstado('aprobado'), 'btn btn-primario'));
      if (esOperativo) acciones.push(b('Marcar observado', () => cambiarEstado('observado', true)));
    }
    if (cert.estado === 'observado' && esOperativo) {
      acciones.push(b('Volver a borrador para corregir', () => cambiarEstado('borrador')));
      acciones.push(b('Presentar de nuevo', () => cambiarEstado('presentado'), 'btn btn-primario'));
    }
    if (esAdmCont && ['borrador', 'presentado', 'observado', 'aprobado'].includes(cert.estado)) acciones.push(b('Anular', () => cambiarEstado('anulado', true), 'btn btn-peligro'));
    acciones.push(b('Imprimir', imprimir));

    const [et, tp] = ESTADOS_CERT[cert.estado];
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/contratos' }, 'Contratos'), ' › ', h('a', { href: `#/contrato/${c.id}` }, c.codigo), ' › ', `Certificado N° ${cert.numero}`),
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, `Certificado N° ${cert.numero} `, etiqueta(et, tp)),
          h('p', { class: 'descripcion' }, `${c.codigo} · ${c.descripcion} · Período ${fechaAR(cert.periodo_desde)} al ${fechaAR(cert.periodo_hasta)}`),
          cert.motivo ? h('p', { class: 'nota' }, h('strong', {}, 'Motivo: '), cert.motivo) : null,
          cert.fecha_presentacion ? h('p', { class: 'texto-suave' }, `Presentado el ${fechaAR(cert.fecha_presentacion)}${cert.fecha_aprobacion ? ` · Aprobado el ${fechaAR(cert.fecha_aprobacion)}` : ''}`) : null),
        h('div', { class: 'acciones acciones-envolver' }, acciones)),
      zonaAvisos,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Cantidades'), zonaLineas,
        editable ? h('p', { class: 'campo-ayuda' }, '"Traer columnas aprobadas" toma las columnas aprobadas por la inspección hasta el fin del período que todavía no se certificaron. También podés escribir la cantidad a mano.') : null),
      zonaUnidades,
      zonaMultas,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Importes'), zonaTotales,
        h('p', { class: 'campo-ayuda' }, 'La factura se registra en la Etapa 3 (Ventas y cobranzas). Tratamiento del anticipo, fondo de reparo y multas en la factura: A CONFIRMAR CON CONTADOR.')),
      panelAdjuntos('certificados', id, esOperativo));
    vaciar(zonaUnidades, listaUnidades());
    redibujar();
  });
}
