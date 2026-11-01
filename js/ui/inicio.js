import { h, vaciar, pantalla, etiqueta, fechaAR, hoyISO, pesos, barra } from './dom.js';
import { encabezado } from './layout.js';
import { resumen } from '../data/repos.js';
import { diasEntre } from '../core/certificados.js';

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

    // Configuración pendiente
    const pendientes = [];
    if (!e.cuit) pendientes.push(['Cargar el CUIT de la empresa', '#/empresa']);
    if (!e.iibb_numero) pendientes.push(['Cargar el número de Ingresos Brutos', '#/empresa']);
    if (!e.domicilio) pendientes.push(['Cargar el domicilio fiscal', '#/empresa']);
    for (const p of r.parametrosAConfirmar) pendientes.push([`Confirmar con el contador: ${p.descripcion}`, '#/parametros']);
    if (ctx.perfil.rol === 'administrador') for (const u of r.usuariosInactivos) pendientes.push([`Activar o asignar rol al usuario ${u.email}`, '#/usuarios']);

    const activos = (r.contratos ?? []).filter((c) => !['finalizado', 'rescindido'].includes(c.estado));
    vaciar(cont,
      encabezado(`Hola, ${ctx.perfil.nombre || ctx.perfil.email}`, `${e.nombre_fantasia ?? 'MADEWORK'} · Sistema iniciado el ${fechaAR(e.fecha_inicio_sistema)}`),
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
              h('li', { class: n <= 2 ? 'hecho' : '' }, t, n <= 2 ? etiqueta('En uso', 'ok') : etiqueta(`Etapa ${n}`)))))),
    );
  });
}
