// Panel reutilizable de archivos adjuntos (Supabase Storage, carpeta privada).
import { h, vaciar, aviso, error, fechaHoraAR, cargando } from './dom.js';
import { adjuntos } from '../data/repos.js';

const tamano = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil((b ?? 0) / 1024)} KB`);

export function panelAdjuntos(tabla, registroId, puedeSubir) {
  const lista = h('div');
  const cargar = async () => {
    vaciar(lista, cargando());
    try {
      const filas = await adjuntos.listar(tabla, registroId);
      vaciar(lista, filas.length
        ? h('table', { class: 'tabla' }, h('tbody', {}, filas.map((a) => h('tr', {},
            h('td', {}, h('button', { class: 'btn-link', type: 'button', onclick: async () => {
              try { window.open(await adjuntos.urlTemporal(a.ruta), '_blank', 'noopener'); } catch (e) { error(e.message); }
            } }, a.nombre)),
            h('td', { class: 'texto-suave' }, a.descripcion ?? ''),
            h('td', { class: 'texto-suave' }, tamano(a.tamano)),
            h('td', { class: 'texto-suave' }, fechaHoraAR(a.creado_en))))))
        : h('p', { class: 'texto-suave' }, 'Todavía no hay archivos.'));
    } catch (e) { vaciar(lista, h('p', { class: 'form-error' }, e.message)); }
  };
  const input = h('input', { type: 'file', multiple: true, accept: '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc', 'aria-label': 'Elegir archivos' });
  const desc = h('input', { placeholder: 'Descripción (opcional)', 'aria-label': 'Descripción del archivo' });
  const btn = h('button', { class: 'btn btn-primario', type: 'button', onclick: async () => {
    if (!input.files.length) return error('Elegí al menos un archivo.');
    btn.disabled = true; btn.textContent = 'Subiendo…';
    try {
      for (const f of input.files) await adjuntos.subir(tabla, registroId, f, desc.value.trim());
      aviso('Archivo(s) subido(s).'); input.value = ''; desc.value = '';
      await cargar();
    } catch (e) { error(e.message); } finally { btn.disabled = false; btn.textContent = 'Subir'; }
  } }, 'Subir');
  const panel = h('section', { class: 'tarjeta' }, h('h2', {}, 'Archivos'),
    puedeSubir ? h('div', { class: 'filtros' }, input, desc, btn) : null,
    h('p', { class: 'campo-ayuda' }, 'PDF, imágenes, Excel o Word. Máximo 20 MB por archivo. Los archivos no se borran.'),
    lista);
  cargar();
  return panel;
}
