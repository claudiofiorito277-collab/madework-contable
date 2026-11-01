// Pagos a proveedores (órdenes de pago): alta y detalle con impresión.
import { h, vaciar, pantalla, campo, select, modal, aviso, error, etiqueta, fechaAR, pesos, cent, hoyISO, leerPesos, cargando } from './dom.js';
import { compras, proveedores, fiscal, empresa, tesoreria } from '../data/repos.js';
import { panelAdjuntos } from './adjuntos.js';
import { nombreCompra } from './compras.js';
import { aCentavos } from '../core/redondeo.js';
import { buscarVigente } from '../core/vigencia.js';
import { calcularPago, MEDIOS_PAGO } from '../core/compras.js';
import { sugerirAplicacion } from '../core/ventas.js';
import { formatearCuit } from '../core/cuit.js';

const aTxt = (c) => (c / 100).toFixed(2);
const mostrar = (c) => (c ? cent(c).replace('$ ', '') : '');
const leerCent = (v) => { try { return aCentavos(leerPesos(v) ?? 0); } catch { return NaN; } };
const TIPOS_RET = { RET_GANANCIAS: 'Ganancias', RET_IIBB_CBA: 'IIBB Córdoba', RET_SUSS: 'SUSS', RET_IVA: 'IVA', OTRA: 'Otra' };

export async function pantallaNuevoPago(cont, ctx, provParam) {
  if (!['administrador', 'contador'].includes(ctx.perfil.rol)) {
    vaciar(cont, h('div', { class: 'tarjeta tarjeta-error' }, 'Solo el administrador o el contador registran pagos.'));
    return;
  }
  await pantalla(cont, async () => {
    const [provs, catalogo, cuentasT, cartera] = await Promise.all([proveedores.listar(), fiscal.catalogo(), tesoreria.cuentas(), tesoreria.cheques({ tipo: 'recibido', estados: ['en_cartera'] })]);
    const cuentasAct = cuentasT.filter((c) => c.activo);
    const cuentasPara = (medio) => cuentasAct.filter((c) => (medio === 'efectivo' ? c.tipo === 'caja' : ['transferencia', 'echeq', 'cheque'].includes(medio) ? c.tipo === 'banco' : true));
    const est = { proveedor_id: provs.some((p) => p.id === provParam) ? provParam : '', fecha: hoyISO(), medios: [{ medio: 'transferencia', importe: 0 }], retenciones: [], aplic: {}, pendientes: [] };
    const agente = () => { try { return Number(buscarVigente(catalogo.parametros, { tipo: 'AGENTE_RETENCION', codigo: 'ACTIVO', fecha: est.fecha })?.valor) === 1; } catch { return false; } };
    const zPend = h('div'); const zMed = h('div'); const zRet = h('div'); const zRes = h('div'); const zProv = h('div');
    const fProv = select([['', 'Elegí el proveedor'], ...provs.filter((p) => p.activo).map((p) => [p.id, p.razon_social])], est.proveedor_id,
      { required: true, 'aria-label': 'Proveedor', onchange: (e) => { est.proveedor_id = e.target.value; cargar(); } });
    const fFecha = h('input', { type: 'date', value: est.fecha, required: true, 'aria-label': 'Fecha', onchange: (e) => { est.fecha = e.target.value; pintarRet(); pintarRes(); } });
    const fObs = h('textarea', { rows: 2, 'aria-label': 'Observación' });
    const inp = (valor, cb, props = {}) => h('input', { class: 'input-num', inputmode: 'decimal', value: mostrar(valor), ...props,
      onchange: (e) => { const v = leerCent(e.target.value); if (Number.isNaN(v)) { error(`Importe inválido: ${e.target.value}`); return; } cb(v); } });

    const cargar = async () => {
      est.aplic = {};
      const p = provs.find((x) => x.id === est.proveedor_id);
      vaciar(zProv, p ? h('p', { class: 'texto-suave' }, [p.cuit ? `CUIT ${formatearCuit(p.cuit)}` : null, p.banco, p.cbu ? `CBU ${p.cbu}` : null, p.alias_cbu ? `Alias ${p.alias_cbu}` : null, p.titular_cuenta].filter(Boolean).join(' · ') || 'Sin datos bancarios cargados.') : null);
      if (!est.proveedor_id) { est.pendientes = []; pintar(); return; }
      vaciar(zPend, cargando());
      est.pendientes = (await compras.comprobantes({ proveedorId: est.proveedor_id }))
        .filter((c) => c.estado === 'emitido' && c.clase !== 'nota_credito' && aCentavos(c.saldo) > 0)
        .sort((a, b) => (a.vencimiento ?? a.fecha).localeCompare(b.vencimiento ?? b.fecha));
      pintar();
    };
    const pintarPend = () => {
      if (!est.proveedor_id) { vaciar(zPend, h('p', { class: 'texto-suave' }, 'Elegí el proveedor para ver lo que se le debe.')); return; }
      if (!est.pendientes.length) { vaciar(zPend, h('p', { class: 'texto-suave' }, 'No hay comprobantes pendientes: lo que pagues queda como anticipo al proveedor.')); return; }
      vaciar(zPend, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['', 'Comprobante', 'Fecha', 'Vence', 'Saldo', 'Se paga'].map((t, i) => h('th', { class: i >= 4 ? 'num' : null }, t)))),
        h('tbody', {}, est.pendientes.map((c) => h('tr', {},
          h('td', {}, h('input', { type: 'checkbox', checked: !!est.aplic[c.id], 'aria-label': `Pagar ${nombreCompra(c)}`,
            onchange: (e) => { if (e.target.checked) est.aplic[c.id] = aCentavos(c.saldo); else delete est.aplic[c.id]; pintar(); } })),
          h('td', {}, h('a', { href: `#/compra/${c.id}`, target: '_blank' }, nombreCompra(c))), h('td', {}, fechaAR(c.fecha)),
          h('td', {}, c.vencimiento && c.vencimiento < hoyISO() ? etiqueta(fechaAR(c.vencimiento), 'peligro') : fechaAR(c.vencimiento)),
          h('td', { class: 'num' }, pesos(c.saldo)),
          h('td', { class: 'num' }, inp(est.aplic[c.id] ?? 0, (v) => { if (v) est.aplic[c.id] = v; else delete est.aplic[c.id]; pintarRes(); }, { 'aria-label': `Importe a pagar de ${nombreCompra(c)}` })))))),
        h('div', { class: 'botones-agregar' },
          h('button', { class: 'btn btn-chico', type: 'button', onclick: () => {
            const total = Object.values(est.aplic).reduce((s, x) => s + x, 0);
            est.medios = [{ ...est.medios[0], importe: total - est.retenciones.reduce((s, r) => s + (r.importe || 0), 0) }, ...est.medios.slice(1).map((m) => ({ ...m, importe: 0 }))].filter((m, i) => i === 0 || m.importe);
            pintar();
          } }, 'Pagar lo marcado con el primer medio'),
          h('button', { class: 'btn btn-chico', type: 'button', onclick: () => {
            const r = resumen();
            const { aplicaciones } = sugerirAplicacion(r.total, est.pendientes.map((c) => ({ id: c.id, saldo: aCentavos(c.saldo), vencimiento: c.vencimiento, fecha: c.fecha })));
            est.aplic = Object.fromEntries(aplicaciones.map((a) => [a.comprobante_id, a.importe]));
            pintar();
          } }, 'Repartir lo pagado de lo más viejo a lo más nuevo'))));
    };
    const pintarMed = () => vaciar(zMed,
      cuentasAct.length ? null : h('div', { class: 'tarjeta tarjeta-alerta' }, 'Todavía no cargaste cajas ni cuentas bancarias: hacelo en ', h('a', { href: '#/tesoreria/cuentas' }, 'Tesorería'), '.'),
      h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Medio', 'Importe', 'Cuenta / cheque', 'N° operación / cheque', 'Fecha de pago', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, est.medios.map((m, i) => {
        const t = (k, props = {}) => h('input', { value: m[k] ?? '', ...props, onchange: (e) => { m[k] = e.target.value.trim(); } });
        const tercero = m.medio === 'cheque_tercero';
        if (!tercero && !cuentasPara(m.medio).some((c) => c.id === m.cuenta_id)) m.cuenta_id = cuentasPara(m.medio)[0]?.id ?? '';
        const usados = new Set(est.medios.filter((x, j) => j !== i && x.medio === 'cheque_tercero').map((x) => x.cheque_id));
        return h('tr', {},
          h('td', {}, select(Object.entries(MEDIOS_PAGO), m.medio, { 'aria-label': `Medio ${i + 1}`, onchange: (e) => { m.medio = e.target.value; m.cheque_id = ''; pintarMed(); pintarRes(); } })),
          h('td', {}, tercero ? h('span', { class: 'num' }, cent(m.importe)) : inp(m.importe, (v) => { m.importe = v; pintarRes(); }, { 'aria-label': `Importe medio ${i + 1}` })),
          h('td', {}, tercero
            ? select([['', cartera.length ? 'Elegí el cheque de la cartera' : 'No hay cheques en cartera'], ...cartera.filter((c) => !usados.has(c.id)).map((c) => [c.id, `N° ${c.numero} · ${c.banco ?? ''} · ${pesos(c.importe)} · ${fechaAR(c.fecha_pago)}`])], m.cheque_id ?? '',
              { 'aria-label': `Cheque de terceros ${i + 1}`, onchange: (e) => { m.cheque_id = e.target.value; const c = cartera.find((x) => x.id === m.cheque_id); m.importe = c ? aCentavos(c.importe) : 0; pintarMed(); pintarRes(); } })
            : select([['', 'Elegí'], ...cuentasPara(m.medio).map((c) => [c.id, c.nombre])], m.cuenta_id, { 'aria-label': `Cuenta medio ${i + 1}`, onchange: (e) => { m.cuenta_id = e.target.value; } })),
          h('td', {}, m.medio === 'efectivo' || tercero ? '—' : t('numero', { size: 12, 'aria-label': 'Número' })),
          h('td', {}, tercero ? '—' : t('fecha_pago', { type: 'date', 'aria-label': 'Fecha de pago' })),
          h('td', {}, est.medios.length > 1 ? h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.medios.splice(i, 1); pintarMed(); pintarRes(); } }, 'Quitar') : null));
      }))),
      h('p', { class: 'campo-ayuda' }, 'Transferencia y efectivo salen en el momento. El cheque o echeq propio sale de la cuenta cuando se debita (Tesorería > Cheques). El cheque de terceros se endosa al proveedor.'),
      h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.medios.push({ medio: 'echeq', importe: 0 }); pintarMed(); } }, '+ Otro medio')));
    const pintarRet = () => {
      if (!agente()) {
        est.retenciones = [];
        vaciar(zRet, h('p', { class: 'texto-suave' }, 'MADEWORK no está configurado como agente de retención: no se practican retenciones. Si el contador confirma que corresponde, se activa en Parámetros fiscales (AGENTE_RETENCION).'));
        return;
      }
      vaciar(zRet, est.retenciones.length ? h('table', { class: 'tabla' }, h('tbody', {}, est.retenciones.map((r, i) => h('tr', {},
        h('td', {}, select(Object.entries(TIPOS_RET), r.tipo, { 'aria-label': `Retención ${i + 1}`, onchange: (e) => { r.tipo = e.target.value; } })),
        h('td', {}, h('input', { placeholder: 'N° certificado', value: r.numero_certificado ?? '', size: 12, onchange: (e) => { r.numero_certificado = e.target.value.trim(); } })),
        h('td', {}, inp(r.base, (v) => { r.base = v; }, { placeholder: 'Base', 'aria-label': 'Base' })),
        h('td', {}, h('input', { class: 'input-pct', placeholder: '%', value: r.alicuota ?? '', onchange: (e) => { r.alicuota = e.target.value ? Number(e.target.value.replace(',', '.')) : null; } })),
        h('td', {}, inp(r.importe, (v) => { r.importe = v; pintarRes(); }, { 'aria-label': `Importe retención ${i + 1}` })),
        h('td', {}, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.retenciones.splice(i, 1); pintarRet(); pintarRes(); } }, 'Quitar')))))) : null,
        h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { est.retenciones.push({ tipo: 'RET_GANANCIAS', importe: 0 }); pintarRet(); } }, '+ Retención'));
    };
    const datos = () => ({ medios: est.medios.filter((m) => m.importe), retenciones: est.retenciones.filter((r) => r.importe),
      aplicaciones: Object.entries(est.aplic).map(([comprobante_id, importe]) => ({ comprobante_id, importe })) });
    const resumen = () => calcularPago(datos(), { saldos: Object.fromEntries(est.pendientes.map((c) => [c.id, aCentavos(c.saldo)])), agenteRetencion: agente() });
    const pintarRes = () => {
      const r = resumen();
      const fila = (k, v, fuerte) => h('tr', {}, h('td', {}, fuerte ? h('strong', {}, k) : k), h('td', { class: 'num' }, fuerte ? h('strong', {}, v) : v));
      vaciar(zRes, h('table', { class: 'tabla tabla-totales' }, h('tbody', {},
        fila('Medios de pago', cent(r.totalMedios)), r.totalRetenciones ? fila('Retenciones practicadas', cent(r.totalRetenciones)) : null,
        fila('Total del pago', cent(r.total), true), fila('Aplicado a comprobantes', cent(r.totalAplicado)), fila('Anticipo / a cuenta', cent(r.aCuenta), r.aCuenta !== 0))),
      r.errores.length && r.total ? h('div', { class: 'tarjeta tarjeta-error' }, h('ul', {}, r.errores.map((x) => h('li', {}, x)))) : null,
      r.advertencias.length ? h('ul', { class: 'advertencias tarjeta' }, r.advertencias.map((x) => h('li', {}, x))) : null);
    };
    const pintar = () => { pintarPend(); pintarMed(); pintarRet(); pintarRes(); };

    const guardar = async (e) => {
      e.preventDefault();
      const btn = e.submitter; if (btn) btn.disabled = true;
      try {
        if (!est.proveedor_id) throw new Error('Elegí el proveedor.');
        const r = resumen();
        const errs = [...r.errores];
        est.medios.filter((m) => m.importe || m.medio === 'cheque_tercero').forEach((m, i) => {
          if (m.medio === 'cheque_tercero') { if (!m.cheque_id) errs.push(`Medio ${i + 1}: elegí el cheque de terceros.`); return; }
          if (!m.cuenta_id) errs.push(`Medio ${i + 1}: elegí la cuenta o caja de la que sale.`);
          if (['echeq', 'cheque'].includes(m.medio) && (!m.numero || !m.fecha_pago)) errs.push(`Medio ${i + 1}: falta el número o la fecha de pago del cheque propio.`);
        });
        if (errs.length) throw new Error(errs.join(' '));
        const d = datos();
        const id = await compras.registrarPago({ proveedor_id: est.proveedor_id, fecha: est.fecha, observacion: fObs.value,
          medios: d.medios.map((m) => ({ medio: m.medio, importe: aTxt(m.importe), banco: m.banco, numero: m.numero, fecha_pago: m.fecha_pago || null,
            cuenta_id: m.medio === 'cheque_tercero' ? null : (m.cuenta_id || null), cheque_id: m.medio === 'cheque_tercero' ? m.cheque_id : null })),
          retenciones: d.retenciones.map((x) => ({ tipo: x.tipo, numero_certificado: x.numero_certificado, base: x.base ? aTxt(x.base) : null, alicuota: x.alicuota ?? null, importe: aTxt(x.importe) })),
          aplicaciones: d.aplicaciones.map((x) => ({ comprobante_id: x.comprobante_id, importe: aTxt(x.importe) })) });
        aviso('Pago registrado.');
        location.hash = `#/pago/${id}`;
      } catch (err) { error(err.message); } finally { if (btn) btn.disabled = false; }
    };

    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/compras/pagos' }, 'Compras y pagos'), ' › Registrar pago'),
      h('div', { class: 'encabezado' }, h('div', {}, h('h1', {}, 'Registrar pago'), h('p', { class: 'descripcion' }, 'Orden de pago a un proveedor: qué se paga, con qué y a qué facturas se aplica.'))),
      h('form', { onsubmit: guardar },
        h('section', { class: 'tarjeta' }, h('div', { class: 'form-grilla' }, campo('Proveedor', fProv), campo('Fecha', fFecha)), zProv),
        h('section', { class: 'tarjeta' }, h('h2', {}, '1. Comprobantes que se pagan'), zPend),
        h('section', { class: 'tarjeta' }, h('h2', {}, '2. Medios de pago'), zMed),
        h('section', { class: 'tarjeta' }, h('h2', {}, '3. Retenciones que practica MADEWORK'), zRet),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Resumen'), zRes, campo('Observación', fObs),
          h('div', { class: 'acciones' }, h('a', { class: 'btn', href: '#/compras/pagos' }, 'Cancelar'), h('button', { class: 'btn btn-primario', type: 'submit' }, 'Registrar pago')))));
    await cargar();
  });
}

export async function pantallaPago(cont, ctx, id) {
  const puede = ['administrador', 'contador'].includes(ctx.perfil.rol);
  await pantalla(cont, async () => {
    const p = await compras.pago(id);
    if (!p) throw new Error('No se encontró el pago.');
    const vigente = p.estado === 'registrado';
    const numComp = (c) => `${c.letra} ${String(c.punto_venta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`;
    const anular = async () => {
      const motivo = await modal({ titulo: `Anular orden de pago N° ${p.numero}`, peligro: true, aceptar: 'Anular',
        contenido: [h('p', {}, 'Los comprobantes vuelven a quedar con saldo.'), campo('Motivo', h('input', { name: 'm', required: true }))], alAceptar: (f) => f.elements.m.value.trim() });
      if (!motivo) return;
      try { await compras.anularPago(id, motivo); aviso('Pago anulado.'); await pantallaPago(cont, ctx, id); } catch (e) { error(e.message); }
    };
    const imprimir = async () => {
      const emp = await empresa.obtener();
      const hoja = h('div', { class: 'solo-impresion' },
        h('div', { class: 'imp-cabecera' },
          h('div', {}, h('strong', {}, emp?.razon_social ?? ''), h('br'), `${emp?.nombre_fantasia ?? ''} · CUIT ${emp?.cuit ? formatearCuit(emp.cuit) : ''}`),
          h('div', { class: 'imp-derecha' }, h('strong', {}, `ORDEN DE PAGO N° ${p.numero}`), h('br'), `Fecha ${fechaAR(p.fecha)}`)),
        h('p', {}, h('strong', {}, 'Proveedor: '), p.proveedor, p.proveedor_cuit ? ` · CUIT ${formatearCuit(p.proveedor_cuit)}` : '',
          p.proveedor_cbu ? ` · CBU ${p.proveedor_cbu}` : '', p.proveedor_alias ? ` · Alias ${p.proveedor_alias}` : ''),
        h('h3', {}, 'Comprobantes que se cancelan'),
        h('table', { class: 'tabla' }, h('tbody', {}, p.aplicaciones.map((a) => h('tr', {}, h('td', {}, `${numComp(a.comprobantes_compra)} del ${fechaAR(a.comprobantes_compra.fecha)}`), h('td', { class: 'num' }, pesos(a.importe)))),
          aCentavos(p.a_cuenta) ? h('tr', {}, h('td', {}, 'Anticipo a cuenta'), h('td', { class: 'num' }, pesos(p.a_cuenta))) : null)),
        h('h3', {}, 'Forma de pago'),
        h('table', { class: 'tabla' }, h('tbody', {},
          p.medios.map((m) => h('tr', {}, h('td', {}, `${MEDIOS_PAGO[m.medio]}${m.banco ? ' · ' + m.banco : ''}${m.numero ? ' N° ' + m.numero : ''}${m.fecha_pago ? ' · ' + fechaAR(m.fecha_pago) : ''}`), h('td', { class: 'num' }, pesos(m.importe)))),
          p.retenciones.map((r) => h('tr', {}, h('td', {}, `Retención ${TIPOS_RET[r.tipo]}${r.numero_certificado ? ' · certificado ' + r.numero_certificado : ''}`), h('td', { class: 'num' }, pesos(r.importe)))),
          h('tr', {}, h('td', {}, h('strong', {}, 'Total')), h('td', { class: 'num' }, h('strong', {}, pesos(p.total)))))),
        h('div', { class: 'imp-firmas' }, h('div', {}, h('span', {}, 'Autorizó')), h('div', {}, h('span', {}, 'Recibí conforme'))),
        h('p', { class: 'imp-pie' }, `Emitido con el sistema contable MADEWORK el ${new Date().toLocaleString('es-AR')}`));
      document.body.appendChild(hoja);
      document.body.classList.add('imprimiendo');
      const limpiar = () => { hoja.remove(); document.body.classList.remove('imprimiendo'); };
      window.addEventListener('afterprint', limpiar, { once: true });
      window.print();
      setTimeout(limpiar, 1000);
    };
    const t = (cab, filas) => h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' }, h('thead', {}, h('tr', {}, cab.map((x) => h('th', {}, x)))), h('tbody', {}, filas)));
    vaciar(cont,
      h('p', { class: 'miga' }, h('a', { href: '#/compras/pagos' }, 'Compras y pagos'), ' › ', `Orden de pago N° ${p.numero}`),
      h('div', { class: 'encabezado' },
        h('div', {}, h('h1', {}, `Orden de pago N° ${p.numero} `, vigente ? etiqueta('Registrado', 'ok') : etiqueta('Anulado', 'neutra')),
          h('p', { class: 'descripcion' }, `${p.proveedor} · ${fechaAR(p.fecha)}`),
          !vigente ? h('p', { class: 'nota' }, h('strong', {}, 'Anulado: '), p.motivo ?? '') : null, p.observacion ? h('p', { class: 'nota' }, p.observacion) : null),
        h('div', { class: 'acciones acciones-envolver' }, h('button', { class: 'btn', type: 'button', onclick: imprimir }, 'Imprimir orden de pago'),
          puede && vigente ? h('button', { class: 'btn btn-peligro', type: 'button', onclick: anular }, 'Anular') : null)),
      h('div', { class: 'datos' },
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Total'), h('div', { class: 'dato-valor' }, pesos(p.total))),
        h('div', { class: 'dato' }, h('div', { class: 'dato-titulo' }, 'Aplicado'), h('div', { class: 'dato-valor' }, pesos(p.importe_aplicado))),
        aCentavos(p.a_cuenta) ? h('div', { class: 'dato dato-alerta' }, h('div', { class: 'dato-titulo' }, 'Anticipo a cuenta'), h('div', { class: 'dato-valor' }, pesos(p.a_cuenta))) : null),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Medios de pago'), t(['Medio', 'Banco', 'Número', 'Fecha de pago', 'Importe'], p.medios.map((m) => h('tr', {},
        h('td', {}, MEDIOS_PAGO[m.medio]), h('td', {}, m.banco ?? ''), h('td', { class: 'mono' }, m.numero ?? ''), h('td', {}, fechaAR(m.fecha_pago)), h('td', { class: 'num' }, pesos(m.importe)))))),
      p.retenciones.length ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Retenciones practicadas'), t(['Impuesto', 'Certificado', 'Base', 'Alícuota', 'Importe'], p.retenciones.map((r) => h('tr', {},
        h('td', {}, TIPOS_RET[r.tipo]), h('td', {}, r.numero_certificado ?? ''), h('td', { class: 'num' }, pesos(r.base)), h('td', {}, r.alicuota ? `${r.alicuota} %` : '—'), h('td', { class: 'num' }, pesos(r.importe)))))) : null,
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Aplicado a'), p.aplicaciones.length ? t(['Comprobante', 'Fecha', 'Total', 'Aplicado'], p.aplicaciones.map((a) => h('tr', {},
        h('td', {}, h('a', { href: `#/compra/${a.comprobante_id}` }, numComp(a.comprobantes_compra))), h('td', {}, fechaAR(a.comprobantes_compra.fecha)),
        h('td', { class: 'num' }, pesos(a.comprobantes_compra.total)), h('td', { class: 'num' }, pesos(a.importe)))))
        : h('p', { class: 'texto-suave' }, 'No se aplicó a comprobantes: es un anticipo.')),
      panelAdjuntos('pagos', id, puede));
  });
}
