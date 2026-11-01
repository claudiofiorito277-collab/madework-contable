// Arranque de la aplicación: sesión, perfil, menú y navegación por #/ruta.
import { h, vaciar, error } from './ui/dom.js';
import { configurado, mensajeError } from './data/supabase.js';
import { sesion, perfiles } from './data/repos.js';
import { pantallaLogin } from './ui/login.js';
import { armarLayout, MENU, puedeVer } from './ui/layout.js';
import { pantallaInicio } from './ui/inicio.js';
import { pantallaEmpresa } from './ui/empresa.js';
import { pantallaParametros } from './ui/parametros.js';
import { pantallaPlan } from './ui/plancuentas.js';
import { pantallaCentros } from './ui/centros.js';
import { pantallaUsuarios } from './ui/usuarios.js';
import { pantallaAuditoria } from './ui/auditoria.js';
import { pantallaClientes } from './ui/clientes.js';
import { pantallaContratos } from './ui/contratos.js';
import { pantallaContrato } from './ui/contrato.js';
import { pantallaCertificado } from './ui/certificado.js';
import { pantallaVentas } from './ui/ventas.js';
import { pantallaComprobante, pantallaNuevoComprobante } from './ui/comprobante.js';
import { pantallaCobranza, pantallaNuevaCobranza } from './ui/cobranza.js';
import { pantallaProveedores } from './ui/proveedores.js';
import { pantallaCompras } from './ui/compras.js';
import { pantallaCompra, pantallaNuevaCompra } from './ui/compra.js';
import { pantallaPago, pantallaNuevoPago } from './ui/pago.js';

const PANTALLAS = {
  ventas: pantallaVentas, comprobante: pantallaComprobante, 'nuevo-comprobante': pantallaNuevoComprobante,
  cobranza: pantallaCobranza, 'nueva-cobranza': pantallaNuevaCobranza,
  proveedores: pantallaProveedores, compras: pantallaCompras, compra: pantallaCompra, 'nueva-compra': pantallaNuevaCompra,
  pago: pantallaPago, 'nuevo-pago': pantallaNuevoPago,
  inicio: pantallaInicio, empresa: pantallaEmpresa, parametros: pantallaParametros, plan: pantallaPlan,
  centros: pantallaCentros, usuarios: pantallaUsuarios, auditoria: pantallaAuditoria,
  clientes: pantallaClientes, contratos: pantallaContratos, contrato: pantallaContrato, certificado: pantallaCertificado,
};
// Rutas de detalle: se marcan en el menú con la sección a la que pertenecen
const SECCION = { contrato: 'contratos', certificado: 'contratos', comprobante: 'ventas', 'nuevo-comprobante': 'ventas', cobranza: 'ventas', 'nueva-cobranza': 'ventas',
  compra: 'compras', 'nueva-compra': 'compras', pago: 'compras', 'nuevo-pago': 'compras' };

const raiz = document.getElementById('app');
let perfil = null;

function rutaActual() {
  const r = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0];
  return PANTALLAS[r] ? r : 'inicio';
}
function parametroRuta() {
  return location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[1] ?? null;
}

async function navegar() {
  if (!perfil) return;
  const ruta = rutaActual();
  const seccion = SECCION[ruta] ?? ruta;
  const item = MENU.flatMap((g) => g.items).find((i) => i.ruta === seccion);
  const contenido = armarLayout(raiz, { perfil, rutaActual: seccion, alSalir: salir });
  if (item && !puedeVer(item, perfil.rol)) {
    vaciar(contenido, h('div', { class: 'tarjeta tarjeta-error' }, 'No tenés permiso para ver esta sección.'));
    return;
  }
  try { await PANTALLAS[ruta](contenido, { perfil }, parametroRuta()); } catch (e) { error(mensajeError(e)); }
  contenido.focus({ preventScroll: true });
}

async function salir() {
  await sesion.salir();
}

async function alCambiarSesion(s) {
  if (!s) { perfil = null; pantallaLogin(raiz); return; }
  try {
    const p = await perfiles.mio(s.user.id);
    if (!p || !p.activo) {
      perfil = null;
      vaciar(raiz, h('main', { class: 'login' }, h('div', { class: 'login-caja' },
        h('h2', {}, 'Usuario pendiente de activación'),
        h('p', {}, `Tu usuario (${s.user.email}) todavía no está activo. Pedile al administrador que te asigne un rol.`),
        h('button', { class: 'btn btn-primario', type: 'button', onclick: salir }, 'Volver'))));
      return;
    }
    perfil = p;
    // Si la dirección quedó en una sección que este rol no ve, arrancar en Inicio.
    const item = MENU.flatMap((g) => g.items).find((i) => i.ruta === rutaActual());
    if (item && !puedeVer(item, perfil.rol)) history.replaceState(null, '', '#/inicio');
    await navegar();
  } catch (e) {
    vaciar(raiz, h('main', { class: 'login' }, h('div', { class: 'login-caja' },
      h('h2', {}, 'No se pudo cargar tu perfil'), h('p', {}, mensajeError(e)),
      h('button', { class: 'btn', type: 'button', onclick: salir }, 'Salir'))));
  }
}

if (!configurado) {
  vaciar(raiz, h('main', { class: 'login' }, h('div', { class: 'login-caja' },
    h('h2', {}, 'Falta configurar la conexión'),
    h('p', {}, 'Abrí el archivo js/config.js y completá la URL y la clave pública (anon) de tu proyecto de Supabase. Ver README, paso 3.'))));
} else {
  let ultimoUsuario;
  sesion.alCambiar((s) => {
    const id = s?.user?.id ?? null;
    if (id === ultimoUsuario) return; // ignora renovaciones de token
    ultimoUsuario = id;
    // Supabase recomienda no esperar otras consultas dentro de este aviso: se difiere.
    setTimeout(() => alCambiarSesion(s), 0);
  });
  window.addEventListener('hashchange', navegar);
}
