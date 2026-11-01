// Ayudas para armar pantallas con createElement (sin concatenar HTML).

/**
 * h('div', { class: 'x', onclick: fn, style: {...}, dataset: {...} }, hijos...)
 * Hijos: texto, nodos, arreglos, null/false (se ignoran).
 */
export function h(tag, props = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function vaciar(el, ...hijos) {
  // replaceChildren reemplaza todo de una vez: si un campo que se está quitando
  // dispara "change" al perder el foco y ese evento vuelve a dibujar, no se rompe.
  const nuevos = [];
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    nuevos.push(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  el.replaceChildren(...nuevos);
  return el;
}

// ---------- Avisos ----------
let zonaAvisos;
export function aviso(texto, tipo = 'ok', ms = 4000) {
  zonaAvisos ??= document.body.appendChild(h('div', { class: 'avisos', role: 'status', 'aria-live': 'polite' }));
  const a = h('div', { class: `aviso aviso-${tipo}` }, texto);
  zonaAvisos.appendChild(a);
  while (zonaAvisos.children.length > 2) zonaAvisos.firstChild.remove();
  setTimeout(() => a.remove(), ms);
}
export const error = (texto) => aviso(texto, 'error', 7000);

// ---------- Ventana modal ----------
/**
 * Abre una ventana con contenido y botones. Devuelve una promesa con el valor
 * que resuelva la acción (o null si se cancela).
 */
export function modal({ titulo, contenido, aceptar = 'Guardar', peligro = false, alAceptar }) {
  return new Promise((resolver) => {
    const msgError = h('p', { class: 'form-error', hidden: true });
    const btnOk = h('button', { class: peligro ? 'btn btn-peligro' : 'btn btn-primario', type: 'submit' }, aceptar);
    const cerrar = (valor) => { fondo.remove(); document.removeEventListener('keydown', esc); resolver(valor); };
    const esc = (e) => { if (e.key === 'Escape') cerrar(null); };
    const form = h('form', {
      class: 'modal', role: 'dialog', 'aria-modal': 'true',
      onsubmit: async (e) => {
        e.preventDefault();
        msgError.hidden = true;
        btnOk.disabled = true;
        try {
          const r = alAceptar ? await alAceptar(form) : true;
          if (r !== false) cerrar(r ?? true);
        } catch (err) {
          msgError.textContent = err.message;
          msgError.hidden = false;
        } finally { btnOk.disabled = false; }
      },
    },
      h('h2', {}, titulo),
      h('div', { class: 'modal-cuerpo' }, contenido),
      msgError,
      h('div', { class: 'modal-botones' },
        h('button', { class: 'btn', type: 'button', onclick: () => cerrar(null) }, 'Cancelar'),
        btnOk),
    );
    const fondo = h('div', { class: 'modal-fondo', onmousedown: (e) => { if (e.target === fondo) cerrar(null); } }, form);
    document.body.appendChild(fondo);
    document.addEventListener('keydown', esc);
    form.querySelector('input, select, textarea')?.focus();
  });
}

export function confirmar(titulo, texto, aceptar = 'Confirmar') {
  return modal({ titulo, contenido: h('p', {}, texto), aceptar, peligro: true });
}

// ---------- Formularios ----------
export function campo(etiqueta, control, ayuda) {
  return h('label', { class: 'campo' },
    h('span', { class: 'campo-etiqueta' }, etiqueta),
    control,
    ayuda ? h('small', { class: 'campo-ayuda' }, ayuda) : null);
}

export function select(opciones, valor, props = {}) {
  return h('select', props, opciones.map(([v, t]) =>
    h('option', { value: v, selected: String(v) === String(valor) }, t)));
}

/** Lee los campos con name de un formulario como objeto. */
export function leerForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  return o;
}

// ---------- Formatos ----------
export const hoyISO = () => {
  const d = new Date(Date.now() - 3 * 3600 * 1000); // hora de Argentina
  return d.toISOString().slice(0, 10);
};
export const fechaAR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const fechaHoraAR = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' }) : '—');
export const numeroAR = (n, dec = 2) =>
  n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: 4 });

export function etiqueta(texto, tipo = 'neutra') {
  return h('span', { class: `etiqueta etiqueta-${tipo}` }, texto);
}

export function cargando(texto = 'Cargando…') {
  return h('p', { class: 'cargando' }, texto);
}

/** Envuelve una pantalla: muestra "Cargando", y si falla, el error. */
export async function pantalla(contenedor, fn) {
  vaciar(contenedor, cargando());
  try { await fn(); } catch (e) { vaciar(contenedor, h('div', { class: 'tarjeta tarjeta-error' }, h('strong', {}, 'No se pudo cargar. '), e.message)); }
}

// ---------- Importes y estados (pesos guardados en la base como numeric) ----------
import { aCentavos as _aCent, formatear as _fmt } from '../core/redondeo.js';
export const pesos = (v) => (v === null || v === undefined || v === '' ? '—' : _fmt(_aCent(v)));
export const cent = (c) => (c === null || c === undefined ? '—' : _fmt(c));
export const cantidadAR = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-AR', { maximumFractionDigits: 3 }));

/** Barra de progreso accesible. */
export function barra(pct, texto) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return h('div', { class: 'barra', role: 'progressbar', 'aria-valuenow': String(v), 'aria-valuemin': '0', 'aria-valuemax': '100', title: texto ?? `${v}%` },
    h('div', { class: 'barra-relleno', style: { width: `${v}%` } }));
}

/** Tarjeta de dato destacado. */
export function dato(titulo, valor, detalle, tipo) {
  return h('div', { class: `dato${tipo ? ' dato-' + tipo : ''}` },
    h('div', { class: 'dato-titulo' }, titulo), h('div', { class: 'dato-valor' }, valor),
    detalle ? h('div', { class: 'dato-detalle' }, detalle) : null);
}

/** Pestañas simples. pestañas: [[id, texto]]; alCambiar(id) dibuja el contenido. */
export function pestañas(lista, inicial, alCambiar) {
  let actual = inicial;
  const barraTabs = h('div', { class: 'pestañas', role: 'tablist' });
  const dibujar = () => vaciar(barraTabs, lista.map(([id, t]) => h('button', {
    type: 'button', role: 'tab', class: `pestaña${actual === id ? ' activa' : ''}`, 'aria-selected': String(actual === id),
    onclick: () => { actual = id; dibujar(); alCambiar(id); },
  }, t)));
  dibujar();
  return barraTabs;
}

/**
 * Lee un importe escrito por el usuario y lo devuelve como texto con 2 decimales
 * para la base ("172670.00"). Acepta "172.670", "172670", "172.670,50", "172670.5".
 */
export function leerPesos(txt, { obligatorio = false } = {}) {
  const s = String(txt ?? '').trim().replace(/\$|\s/g, '');
  if (!s) { if (obligatorio) throw new Error('Falta un importe.'); return null; }
  let c;
  if (s.includes(',')) c = _aCent(s);                         // formato argentino
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) c = _aCent(s.replace(/\./g, '')); // solo separador de miles
  else c = _aCent(s);
  return (c / 100).toFixed(2);
}

/** Lee una cantidad (hasta 3 decimales). "1.234,5" -> 1234.5 ; "12,5" -> 12.5 */
export function leerCantidad(txt, { obligatorio = false } = {}) {
  const s = String(txt ?? '').trim().replace(/\s/g, '');
  if (!s) { if (obligatorio) throw new Error('Falta una cantidad.'); return null; }
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  if (!Number.isFinite(n)) throw new Error(`Cantidad inválida: ${txt}`);
  return Math.round(n * 1000) / 1000;
}
