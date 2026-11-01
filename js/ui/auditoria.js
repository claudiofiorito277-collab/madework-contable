import { h, vaciar, pantalla, select, campo, fechaHoraAR, etiqueta } from './dom.js';
import { encabezado } from './layout.js';
import { auditoria } from '../data/repos.js';

const TABLAS = [['', 'Todas'], ['parametros_fiscales', 'Parámetros fiscales'], ['tipos_comprobante', 'Tipos de comprobante'],
  ['plan_cuentas', 'Plan de cuentas'], ['centros_costo', 'Centros de costo'], ['empresa', 'Empresa'],
  ['perfiles', 'Usuarios'], ['condiciones_iva', 'Condiciones de IVA'], ['periodos', 'Períodos']];
const NOMBRE_TABLA = Object.fromEntries(TABLAS);
const COLOR = { ALTA: 'ok', MODIFICACION: 'alerta', BAJA: 'peligro' };
const POR_PAGINA = 50;

export async function pantallaAuditoria(cont) {
  const filtros = { tabla: '', accion: '', desde: '', hasta: '', pagina: 0 };
  const cuerpo = h('div');

  const cargar = () => pantalla(cuerpo, async () => {
    const { filas, total } = await auditoria.listar({ ...filtros, porPagina: POR_PAGINA });
    const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
    vaciar(cuerpo,
      h('div', { class: 'tarjeta' }, h('div', { class: 'tabla-scroll' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['Fecha y hora', 'Usuario', 'Sección', 'Acción', 'Registro', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, filas.length ? filas.map((f) => {
          const detalle = h('tr', { class: 'fila-historial', hidden: true }, h('td', { colspan: 6 }, cambios(f)));
          return [h('tr', {},
            h('td', {}, fechaHoraAR(f.fecha)), h('td', {}, f.usuario_email ?? '—'),
            h('td', {}, NOMBRE_TABLA[f.tabla] ?? f.tabla), h('td', {}, etiqueta(f.accion, COLOR[f.accion])),
            h('td', { class: 'mono' }, descripcionRegistro(f)),
            h('td', {}, h('button', { class: 'btn btn-chico', type: 'button', onclick: () => { detalle.hidden = !detalle.hidden; } }, 'Ver cambios'))),
          detalle];
        }) : h('tr', {}, h('td', { colspan: 6 }, 'No hay registros con estos filtros.')))))),
      h('div', { class: 'paginacion' },
        h('button', { class: 'btn btn-chico', type: 'button', disabled: filtros.pagina === 0, onclick: () => { filtros.pagina--; cargar(); } }, '← Anterior'),
        h('span', {}, `Página ${filtros.pagina + 1} de ${paginas} · ${total} registros`),
        h('button', { class: 'btn btn-chico', type: 'button', disabled: filtros.pagina + 1 >= paginas, onclick: () => { filtros.pagina++; cargar(); } }, 'Siguiente →')));
  });

  const cambiar = (k) => (e) => { filtros[k] = e.target.value; filtros.pagina = 0; cargar(); };
  vaciar(cont,
    encabezado('Auditoría', 'Registro de todas las altas y modificaciones. No se puede editar ni borrar.'),
    h('div', { class: 'filtros' },
      campo('Sección', select(TABLAS, '', { onchange: cambiar('tabla') })),
      campo('Acción', select([['', 'Todas'], ['ALTA', 'Alta'], ['MODIFICACION', 'Modificación'], ['BAJA', 'Baja']], '', { onchange: cambiar('accion') })),
      campo('Desde', h('input', { type: 'date', onchange: cambiar('desde') })),
      campo('Hasta', h('input', { type: 'date', onchange: cambiar('hasta') }))),
    cuerpo);
  await cargar();
}

function descripcionRegistro(f) {
  const d = f.despues ?? f.antes ?? {};
  return d.codigo ? `${d.codigo}${d.descripcion ? ' · ' + d.descripcion : d.nombre ? ' · ' + d.nombre : ''}` : d.email ?? d.razon_social ?? f.registro_id ?? '';
}

const OCULTOS = new Set(['id', 'creado_en', 'modificado_en', 'padre_id', 'nivel']);
const mostrarValor = (v) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function cambios(f) {
  const antes = f.antes ?? {};
  const despues = f.despues ?? {};
  const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].filter((k) => !OCULTOS.has(k));
  const filas = claves.filter((k) => f.accion !== 'MODIFICACION' || JSON.stringify(antes[k]) !== JSON.stringify(despues[k]));
  return h('table', { class: 'tabla tabla-interna' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Campo'), f.accion !== 'ALTA' ? h('th', {}, 'Antes') : null, f.accion !== 'BAJA' ? h('th', {}, 'Después') : null)),
    h('tbody', {}, filas.map((k) => h('tr', {}, h('td', {}, k),
      f.accion !== 'ALTA' ? h('td', {}, mostrarValor(antes[k])) : null,
      f.accion !== 'BAJA' ? h('td', {}, mostrarValor(despues[k])) : null))));
}
