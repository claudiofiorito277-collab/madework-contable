import { h, vaciar, pantalla, etiqueta } from './dom.js';
import { encabezado } from './layout.js';
import { resumen } from '../data/repos.js';

export async function pantallaInicio(cont, ctx) {
  await pantalla(cont, async () => {
    const r = await resumen.pendientes();
    const e = r.empresa ?? {};
    const pendientes = [];
    if (!e.cuit) pendientes.push(['Cargar el CUIT de la empresa', '#/empresa']);
    if (!e.iibb_numero) pendientes.push(['Cargar el número de Ingresos Brutos', '#/empresa']);
    if (!e.domicilio) pendientes.push(['Cargar el domicilio fiscal', '#/empresa']);
    for (const p of r.parametrosAConfirmar) pendientes.push([`Confirmar con el contador: ${p.descripcion}`, '#/parametros']);
    if (ctx.perfil.rol === 'administrador') {
      for (const u of r.usuariosInactivos) pendientes.push([`Activar o asignar rol al usuario ${u.email}`, '#/usuarios']);
    }

    vaciar(cont,
      encabezado(`Hola, ${ctx.perfil.nombre || ctx.perfil.email}`, `${e.nombre_fantasia ?? 'MADEWORK'} · Sistema iniciado el ${(e.fecha_inicio_sistema ?? '').split('-').reverse().join('/')}`),
      h('div', { class: 'grilla-2' },
        h('section', { class: 'tarjeta' },
          h('h2', {}, 'Configuración pendiente ', etiqueta(String(pendientes.length), pendientes.length ? 'alerta' : 'ok')),
          pendientes.length
            ? h('ul', { class: 'lista-tareas' }, pendientes.map(([t, href]) => h('li', {}, h('a', { href }, t))))
            : h('p', {}, 'Todo listo. No hay configuración pendiente.')),
        h('section', { class: 'tarjeta' },
          h('h2', {}, 'Avance del sistema'),
          h('ol', { class: 'lista-etapas' },
            [['Base, usuarios, parámetros fiscales e IVA', 1], ['Contratos y certificados', 2], ['Ventas y cobranzas', 3],
             ['Compras y pagos', 4], ['Tesorería y cheques', 5], ['Contabilidad', 6], ['Costos de obra', 7],
             ['Reportes', 8], ['Manual y puesta en marcha', 9]].map(([t, n]) =>
              h('li', { class: n === 1 ? 'hecho' : '' }, t, n === 1 ? etiqueta('En uso', 'ok') : etiqueta(`Etapa ${n}`))))),
      ),
    );
  });
}
