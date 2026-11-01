import { h, vaciar } from './dom.js';
import { VERSION } from '../config.js';

export const NOMBRE_ROL = {
  administrador: 'Administrador', contador: 'Contador', operador: 'Operador', consulta: 'Solo consulta',
};

// Menú. "roles" = quién lo ve. "etapa" = módulo todavía no construido.
export const MENU = [
  { grupo: 'General', items: [
    { ruta: 'inicio', texto: 'Inicio' },
  ] },
  { grupo: 'Operación', items: [
    { ruta: 'contratos', texto: 'Contratos y certificados' },
    { ruta: 'clientes', texto: 'Clientes' },
    { ruta: 'ventas', texto: 'Ventas y cobranzas' },
    { ruta: 'compras', texto: 'Compras y pagos' },
    { ruta: 'proveedores', texto: 'Proveedores' },
    { ruta: 'tesoreria', texto: 'Tesorería y cheques', roles: ['administrador', 'contador', 'consulta'] },
    { ruta: 'contabilidad', texto: 'Contabilidad', roles: ['administrador', 'contador', 'consulta'] },
    { texto: 'Costos de obra', etapa: 7 },
    { texto: 'Reportes', etapa: 8 },
  ] },
  { grupo: 'Configuración', items: [
    { ruta: 'empresa', texto: 'Empresa' },
    { ruta: 'parametros', texto: 'Parámetros fiscales' },
    { ruta: 'plan', texto: 'Plan de cuentas' },
    { ruta: 'centros', texto: 'Centros de costo' },
    { ruta: 'usuarios', texto: 'Usuarios', roles: ['administrador'] },
    { ruta: 'auditoria', texto: 'Auditoría', roles: ['administrador', 'contador'] },
  ] },
];

export function puedeVer(item, rol) {
  return !item.roles || item.roles.includes(rol);
}

export function armarLayout(raiz, { perfil, rutaActual, alSalir }) {
  const contenido = h('main', { class: 'contenido', id: 'contenido', tabindex: '-1' });
  const lateral = h('nav', { class: 'lateral', 'aria-label': 'Menú principal' },
    h('div', { class: 'lateral-marca' }, h('span', { class: 'marca-logo' }, 'MW'), h('div', {},
      h('strong', {}, 'MADEWORK'), h('small', {}, 'Contable · Caminos de las Sierras'))),
    MENU.map((g) => h('div', { class: 'menu-grupo' },
      h('div', { class: 'menu-titulo' }, g.grupo),
      g.items.filter((i) => puedeVer(i, perfil.rol)).map((i) => i.etapa
        ? h('span', { class: 'menu-item menu-item-off', title: `Se construye en la Etapa ${i.etapa}` },
            i.texto, h('small', {}, `Etapa ${i.etapa}`))
        : h('a', {
            class: `menu-item${i.ruta === rutaActual ? ' activo' : ''}`,
            href: `#/${i.ruta}`,
            'aria-current': i.ruta === rutaActual ? 'page' : null,
            onclick: () => document.body.classList.remove('menu-abierto'),
          }, i.texto)),
    )),
    h('div', { class: 'lateral-pie' }, `Versión ${VERSION}`),
  );
  const cabecera = h('header', { class: 'cabecera' },
    h('button', { class: 'btn btn-menu', type: 'button', 'aria-label': 'Abrir menú',
      onclick: () => document.body.classList.toggle('menu-abierto') }, '☰'),
    h('div', { class: 'cabecera-usuario' },
      h('span', {}, perfil.nombre || perfil.email),
      h('span', { class: 'etiqueta etiqueta-neutra' }, NOMBRE_ROL[perfil.rol] ?? perfil.rol),
      h('button', { class: 'btn btn-chico', type: 'button', onclick: alSalir }, 'Salir')),
  );
  vaciar(raiz, h('div', { class: 'app' }, lateral, h('div', { class: 'principal' }, cabecera, contenido)));
  return contenido;
}

export function encabezado(titulo, descripcion, ...acciones) {
  return h('div', { class: 'encabezado' },
    h('div', {}, h('h1', {}, titulo), descripcion ? h('p', { class: 'descripcion' }, descripcion) : null),
    acciones.length ? h('div', { class: 'acciones' }, acciones) : null);
}
