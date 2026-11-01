import { h, vaciar, pantalla, etiqueta, fechaAR, hoyISO, pesos, barra } from './dom.js';
import { encabezado } from './layout.js';
import { resumen } from '../data/repos.js';
import { diasEntre } from '../core/certificados.js';
import { alertasCheques } from '../core/tesoreria.js';
import { aCentavos } from '../core/redondeo.js';
import { cent } from './dom.js';
import { margenContratos } from '../data/reportes.js';

const TIPOS_POLIZA = { responsabilidad_civil: 'Responsabilidad civil', caucion_anticipo: 'Caución de anticipo', caucion_cumplimiento: 'Caución de cumplimiento',
  art: 'ART', vida_obligatorio: 'Vida obligatorio', accidentes_personales: 'Accidentes personales' };

export async function pantallaInicio(cont, ctx) {
  await pantalla(cont, async () => {
    const r = await resumen.pendientes();
    const e = r.empresa ?? {};
    const hoy = hoyISO();

    // Alertas de obra
    const alertas = [];
    for (const c of r.contratos ?? []) {
      if (Number(c.unidades_por_certificar)) alertas.push([`${c.codigo}: ${Number(c.unidades_por_certificar)} columna(s) aprobadas sin certificar`, `#/contrato/${c.id}`, 'alerta']);
      if (c.fecha_fin_prevista && ['adjudicado', 'en_ejecucion'].includes(c.estado)) {
        const d = diasEntre(hoy, c.fecha_fin_prevista);
        if (d < 0) alertas.push([`${c.codigo}: plazo vencido hace ${-d} días (${fechaAR(c.fecha_fin_prevista)}). Riesgo de multa.`, `#/contrato/${c.id}`, 'peligro']);
        else if (d <= 15) alertas.push([`${c.codigo}: el plazo vence en ${d} días (${fechaAR(c.fecha_fin_prevista)})`, `#/contrato/${c.id}`, 'alerta']);
      }
    }
    for (const p of r.polizas ?? []) {
      if (!p.vigencia_hasta || p.estado !== 'vigente') continue;
      const d = diasEntre(hoy, p.vigencia_hasta);
      const link = p.contrato_id ? `#/contrato/${p.contrato_id}` : '#/contratos';
      if (d < 0) alertas.push([`Póliza ${TIPOS_POLIZA[p.tipo] ?? p.tipo} (${p.aseguradora}) vencida el ${fechaAR(p.vigencia_hasta)}`, link, 'peligro']);
      else if (d <= 15) alertas.push([`Póliza ${TIPOS_POLIZA[p.tipo] ?? p.tipo} (${p.aseguradora}) vence en ${d} días`, link, 'alerta']);
    }

    // Ventas
    for (const c of r.porFacturar ?? []) alertas.push([`Certificado N° ${c.numero} aprobado sin factura registrada`, `#/nuevo-comprobante/cert:${c.id}`, 'alerta']);
    const sinCae = (r.comprobantes ?? []).filter((c) => !c.cae);
    if (sinCae.length) alertas.push([`${sinCae.length} comprobante(s) de venta sin CAE cargado`, '#/ventas/comprobantes', 'alerta']);
    for (const c of (r.comprobantes ?? []).filter((x) => x.clase !== 'nota_credito' && Number(x.saldo) > 0 && x.vencimiento && x.vencimiento < hoy)) {
      alertas.push([`${c.cliente}: factura ${c.numero_formateado} vencida el ${fechaAR(c.vencimiento)}, saldo ${pesos(c.saldo)}`, `#/comprobante/${c.id}`, 'peligro']);
    }

    // Compras
    const comprasR = r.compras ?? [];
    const aRevisar = comprasR.filter((c) => !c.revisado).length;
    if (aRevisar && ['administrador', 'contador'].includes(ctx.perfil.rol)) alertas.push([`${aRevisar} comprobante(s) de compra cargados desde la obra a revisar`, '#/compras/comprobantes', 'alerta']);
    const debe = comprasR.filter((c) => c.clase !== 'nota_credito' && Number(c.saldo) > 0 && c.vencimiento);
    const vencidas = debe.filter((c) => c.vencimiento < hoy);
    if (vencidas.length) alertas.push([`${vencidas.length} factura(s) de proveedores vencidas sin pagar (${pesos(vencidas.reduce((s, c) => s + Number(c.saldo), 0))})`, '#/compras/vencimientos', 'peligro']);
    const semana = debe.filter((c) => c.vencimiento >= hoy && diasEntre(hoy, c.vencimiento) <= 7);
    if (semana.length) alertas.push([`${semana.length} factura(s) de proveedores vencen esta semana (${pesos(semana.reduce((s, c) => s + Number(c.saldo), 0))})`, '#/compras/vencimientos', 'alerta']);

    // Cheques
    for (const a of alertasCheques(r.cheques ?? [], hoy)) {
      const ch = a.cheque;
      alertas.push([`Cheque ${ch.tipo === 'recibido' ? `de ${ch.cliente ?? 'terceros'}` : `propio a ${ch.proveedor ?? ''}`} N° ${ch.numero} (${pesos(ch.importe)}): ${a.texto.replace(/\d{4}-\d{2}-\d{2}/g, (x) => fechaAR(x))}`, '#/tesoreria/cheques', a.tipo]);
    }

    // Contabilidad
    const pc = r.contables ?? [];
    if (pc.length && ['administrador', 'contador'].includes(ctx.perfil.rol)) {
      const mesAnt = new Date(`${hoy.slice(0, 7)}-01T00:00:00Z`); mesAnt.setUTCDate(0);
      const viejos = pc.filter((x) => x.fecha <= mesAnt.toISOString().slice(0, 10)).length;
      alertas.push([`${pc.length} operación(es) sin contabilizar${viejos ? ` (${viejos} de meses anteriores: hay que contabilizarlas para cerrar el mes)` : ''}`, '#/contabilidad/pendientes', viejos ? 'peligro' : 'alerta']);
    }

    // Configuración pendiente
    const pendientes = [];
    if (!e.cuit) pendientes.push(['Cargar el CUIT de la empresa', '#/empresa']);
    if (!e.iibb_numero) pendientes.push(['Cargar el número de Ingresos Brutos', '#/empresa']);
    if (!e.domicilio) pendientes.push(['Cargar el domicilio fiscal', '#/empresa']);
    for (const p of r.parametrosAConfirmar) pendientes.push([`Confirmar con el contador: ${p.descripcion}`, '#/parametros']);
    if (ctx.perfil.rol === 'administrador') for (const u of r.usuariosInactivos) pendientes.push([`Activar o asignar rol al usuario ${u.email}`, '#/usuarios']);

    const activos = (r.contratos ?? []).filter((c) => !['finalizado', 'rescindido'].includes(c.estado));
    // Panel de cifras
    const C = (x) => aCentavos(x ?? 0);
    const veCostos = ['administrador', 'contador'].includes(ctx.perfil.rol);
    const en7 = new Date(Date.parse(`${hoy}T00:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);
    const en30 = new Date(Date.parse(`${hoy}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    const cobrar = (r.comprobantes ?? []).filter((x) => x.clase !== 'nota_credito' && C(x.saldo) > 0);
    const vencidasV = cobrar.filter((x) => x.vencimiento && x.vencimiento < hoy);
    const pagar7 = (r.compras ?? []).filter((x) => x.clase !== 'nota_credito' && C(x.saldo) > 0 && (x.vencimiento ?? hoy) <= en7);
    const chProp7 = (r.cheques ?? []).filter((x) => x.estado === 'emitido' && x.fecha_pago <= en7);
    const chTerc = (r.cheques ?? []).filter((x) => x.estado === 'en_cartera');
    const chVencen = chTerc.filter((x) => { const lim = new Date(Date.parse(`${x.fecha_pago}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10); return lim <= en7 || x.fecha_pago <= hoy; });
    const polizas30 = (r.polizas ?? []).filter((x) => x.estado === 'vigente' && x.vigencia_hasta && x.vigencia_hasta <= en30);
    const suma = (l, k) => l.reduce((t, x) => t + C(x[k]), 0);
    const tarjeta = (titulo, valor, detalle, href, neg) => h('a', { class: 'dato', href, style: { textDecoration: 'none', color: 'inherit' } },
      h('div', { class: 'dato-titulo' }, titulo), h('div', { class: `dato-valor ${neg ? 'negativo' : ''}` }, valor), detalle ? h('div', { class: 'dato-detalle' }, detalle) : null);
    const panel = h('div', { class: 'panel-cifras' },
      tarjeta('Cajas y bancos', cent(suma(r.saldosCuentas ?? [], 'saldo')), `${(r.saldosCuentas ?? []).length} cuenta(s)`, '#/tesoreria/cuentas'),
      tarjeta('Facturas por cobrar', cent(suma(cobrar, 'saldo')), vencidasV.length ? `${vencidasV.length} vencida(s): ${cent(suma(vencidasV, 'saldo'))}` : 'Ninguna vencida', '#/ventas/comprobantes', vencidasV.length > 0),
      tarjeta('Certificados sin aprobar', String((r.presentados ?? []).length), (r.presentados ?? []).length ? `Presentados por ${cent(suma(r.presentados, 'bruto'))}` : 'Nada pendiente', '#/contratos'),
      tarjeta('Pagos próximos 7 días', cent(suma(pagar7, 'saldo') + suma(chProp7, 'importe')), `${pagar7.length} factura(s) y ${chProp7.length} cheque(s) propio(s)`, '#/compras/vencimientos'),
      tarjeta('Cheques en cartera', cent(suma(chTerc, 'importe')), chVencen.length ? `${chVencen.length} para depositar ya o por vencer` : 'Ninguno por vencer', '#/tesoreria/cheques', chVencen.length > 0),
      tarjeta('Pólizas por vencer', String(polizas30.length), polizas30.length ? 'En los próximos 30 días' : 'Ninguna en 30 días', '#/contratos', polizas30.length > 0));
    const zonaMargen = h('div', {}, veCostos ? h('p', { class: 'texto-suave' }, 'Calculando el margen de los contratos…') : null);
    if (veCostos) {
      margenContratos(hoy).then((ms) => vaciar(zonaMargen, ms.length ? h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Contrato', 'Ingreso certificado', 'Costo real', 'Margen', 'Margen %'].map((t, i) => h('th', { class: i ? 'num' : null }, t)))),
        h('tbody', {}, ms.map((m) => h('tr', {}, h('td', {}, h('a', { href: '#/reportes/rentabilidad' }, `${m.contrato.codigo} · ${m.contrato.descripcion}`)),
          h('td', { class: 'num' }, cent(m.ingreso)), h('td', { class: 'num' }, cent(m.costo_real)),
          h('td', { class: `num ${m.margen < 0 ? 'texto-negativo' : ''}` }, h('strong', {}, cent(m.margen))),
          h('td', { class: 'num' }, m.margen_pct === null ? '—' : `${String(m.margen_pct).replace('.', ',')} %`)))))) : h('p', { class: 'texto-suave' }, 'No hay contratos activos.')))
        .catch((err) => vaciar(zonaMargen, h('p', { class: 'texto-suave' }, `No se pudo calcular el margen: ${err.message}`)));
    }

    vaciar(cont,
      encabezado(`Hola, ${ctx.perfil.nombre || ctx.perfil.email}`, `${e.nombre_fantasia ?? 'MADEWORK'} · Sistema iniciado el ${fechaAR(e.fecha_inicio_sistema)}`),
      ['administrador', 'contador', 'consulta'].includes(ctx.perfil.rol) ? panel : null,
      veCostos ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Margen real de los contratos activos'), zonaMargen,
        h('p', { class: 'campo-ayuda' }, 'Desde el inicio hasta hoy: certificados aprobados menos el costo real (compras, personal, equipos, materiales e indirectos).')) : null,
      alertas.length ? h('section', { class: 'tarjeta tarjeta-alerta' }, h('h2', {}, 'Atención'),
        h('ul', { class: 'lista-tareas' }, alertas.map(([t, href, tipo]) => h('li', {}, etiqueta(tipo === 'peligro' ? 'Urgente' : 'Aviso', tipo), ' ', h('a', { href }, t))))) : null,
      activos.length ? h('section', { class: 'tarjeta' }, h('h2', {}, 'Contratos activos'),
        activos.map((c) => {
          const pct = Number(c.monto_contractual) ? Math.round((Number(c.certificado_bruto) / Number(c.monto_contractual)) * 1000) / 10 : 0;
          return h('a', { class: 'fila-contrato', href: `#/contrato/${c.id}` },
            h('div', {}, h('strong', {}, c.codigo), ' · ', c.descripcion),
            h('div', { class: 'texto-suave' }, `${pesos(c.certificado_bruto)} de ${pesos(c.monto_contractual)} · ${pct.toLocaleString('es-AR')} %`),
            barra(pct));
        })) : null,
      h('div', { class: 'grilla-2' },
        h('section', { class: 'tarjeta' },
          h('h2', {}, 'Configuración pendiente ', etiqueta(String(pendientes.length), pendientes.length ? 'alerta' : 'ok')),
          pendientes.length ? h('ul', { class: 'lista-tareas' }, pendientes.map(([t, href]) => h('li', {}, h('a', { href }, t))))
            : h('p', {}, 'Todo listo. No hay configuración pendiente.')),
        h('section', { class: 'tarjeta' },
          h('h2', {}, 'Avance del sistema'),
          h('ol', { class: 'lista-etapas' },
            [['Base, usuarios, parámetros fiscales e IVA', 1], ['Contratos y certificados', 2], ['Ventas y cobranzas', 3],
             ['Compras y pagos', 4], ['Tesorería y cheques', 5], ['Contabilidad', 6], ['Costos de obra', 7],
             ['Reportes', 8], ['Manual y puesta en marcha', 9]].map(([t, n]) =>
              h('li', { class: n <= 9 ? 'hecho' : '' }, t, n <= 9 ? etiqueta('En uso', 'ok') : etiqueta(`Etapa ${n}`)))))),
    );
  });
}
