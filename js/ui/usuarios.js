import { h, vaciar, pantalla, select, aviso, error, confirmar } from './dom.js';
import { encabezado, NOMBRE_ROL } from './layout.js';
import { perfiles } from '../data/repos.js';

const ROLES = Object.entries(NOMBRE_ROL);
const PERMISOS = [
  ['Administrador', 'Todo: configuración, usuarios, auditoría y operaciones.'],
  ['Contador', 'Parámetros fiscales, plan de cuentas, contabilidad y auditoría. No administra usuarios.'],
  ['Operador', 'Carga operaciones de obra (gastos, partes, centros de costo). No cambia configuración fiscal.'],
  ['Solo consulta', 'Ve la información, no modifica nada.'],
];

export async function pantallaUsuarios(cont, ctx) {
  const cuerpo = h('div');
  const cargar = async () => {
    const lista = await perfiles.listar();
    vaciar(cuerpo, h('div', { class: 'tarjeta' }, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
      h('thead', {}, h('tr', {}, ['Correo', 'Nombre', 'Rol', 'Activo', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, lista.map((p) => {
        const nombre = h('input', { value: p.nombre ?? '', 'aria-label': `Nombre de ${p.email}` });
        const rol = select(ROLES, p.rol, { 'aria-label': `Rol de ${p.email}` });
        const activo = h('input', { type: 'checkbox', checked: p.activo, 'aria-label': `Activo ${p.email}` });
        return h('tr', { class: p.activo ? '' : 'inactivo' },
          h('td', {}, p.email, p.id === ctx.perfil.id ? h('small', { class: 'texto-suave' }, ' (vos)') : null),
          h('td', {}, nombre), h('td', {}, rol), h('td', {}, activo),
          h('td', {}, h('button', {
            class: 'btn btn-chico btn-primario', type: 'button',
            onclick: async () => {
              if (p.id === ctx.perfil.id && (rol.value !== 'administrador' || !activo.checked)) {
                const ok = await confirmar('Cambiar tu propio acceso', 'Vas a quitarte el rol de administrador o desactivarte. ¿Seguro?');
                if (!ok) return;
              }
              try {
                await perfiles.actualizar(p.id, { nombre: nombre.value.trim(), rol: rol.value, activo: activo.checked });
                aviso('Usuario actualizado.');
                await cargar();
              } catch (err) { error(err.message); }
            },
          }, 'Guardar')));
      }))))));
  };

  vaciar(cont,
    encabezado('Usuarios', 'Asigná el rol y activá a cada persona. Los cambios quedan en la auditoría.'),
    h('div', { class: 'tarjeta tarjeta-info' },
      h('strong', {}, 'Para crear un usuario nuevo: '),
      'entrá a Supabase > Authentication > Users > Add user, cargá el correo y una contraseña y marcá "Auto Confirm User". ',
      'Va a aparecer acá como "Solo consulta" e inactivo hasta que le asignes el rol.'),
    cuerpo,
    h('section', { class: 'tarjeta' }, h('h2', {}, 'Qué puede hacer cada rol'),
      h('dl', { class: 'lista-roles' }, PERMISOS.map(([r, d]) => [h('dt', {}, r), h('dd', {}, d)]))));
  await pantalla(cuerpo, cargar);
}
