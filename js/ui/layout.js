import { h, vaciar, modal, campo, aviso } from './dom.js';
import { sesion } from '../data/repos.js';
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
    { ruta: 'costos', texto: 'Costos de obra' },
    { ruta: 'reportes', texto: 'Reportes', roles: ['administrador', 'contador', 'consulta'] },
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
      h('button', { class: 'btn btn-chico', type: 'button', onclick: cambiarMiClave }, 'Cambiar mi clave'),
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

/** Cada usuario cambia su propia clave (la nueva queda solo en Supabase; el sistema no la guarda). */
async function cambiarMiClave() {
  const ok = await modal({
    titulo: 'Cambiar mi clave',
    aceptar: 'Cambiar clave',
    contenido: [
      h('p', { class: 'texto-suave' }, 'Elegí una clave de al menos 8 caracteres que no uses en otro lado.'),
      h('div', { class: 'form-grilla' },
        campo('Clave nueva', h('input', { name: 'c1', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 })),
        campo('Repetí la clave nueva', h('input', { name: 'c2', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 }))),
    ],
    alAceptar: async (f) => {
      const c1 = f.elements.c1.value; const c2 = f.elements.c2.value;
      if (c1.length < 8) throw new Error('La clave tiene que tener al menos 8 caracteres.');
      if (c1 !== c2) throw new Error('Las dos claves no coinciden.');
      try { await sesion.cambiarClave(c1); }
      catch (e) { throw new Error(/same|igual|different/i.test(e.message) ? 'La clave nueva tiene que ser distinta de la actual.' : e.message); }
      return true;
    },
  });
  if (ok) aviso('Listo: tu clave quedó cambiada. La próxima vez entrá con la nueva.');
}
