// Botones "Excel" y "PDF" de cada reporte: arman el archivo con los filtros aplicados,
// la fecha de generación y el usuario, y lo descargan.
import { h, error } from './dom.js';
import { reporteXLSX, reportePDF, nombreArchivo } from '../core/exportar.js';

export const sesionExport = { usuario: '' };

const ahora = () => new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function descargar(bytes, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  const a = h('a', { href: url, download: nombre, style: { display: 'none' } });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Completa el reporte con la fecha y el usuario. */
export const completar = (rep) => ({ ...rep, generado: { usuario: sesionExport.usuario, fecha: ahora() } });

/**
 * armar: () => reporte (o promesa). Devuelve los dos botones.
 */
export function botonesExportar(armar, { pdf = true, excel = true } = {}) {
  const hacer = async (formato) => {
    try {
      const rep = completar(await armar());
      if (!rep) return;
      if (formato === 'xlsx') descargar(reporteXLSX(rep), nombreArchivo(rep.archivo ?? rep.titulo, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      else descargar(reportePDF(rep), nombreArchivo(rep.archivo ?? rep.titulo, 'pdf'), 'application/pdf');
    } catch (e) { error(`No se pudo exportar: ${e.message}`); }
  };
  return h('span', { class: 'botones-exportar' },
    excel ? h('button', { class: 'btn', type: 'button', onclick: () => hacer('xlsx'), title: 'Descargar en Excel con los filtros aplicados' }, 'Excel') : null,
    pdf ? h('button', { class: 'btn', type: 'button', onclick: () => hacer('pdf'), title: 'Descargar en PDF con los filtros aplicados' }, 'PDF') : null);
}

/** Columnas abreviadas: col('Fecha', 'fecha'). */
export const col = (titulo, tipo = 'texto', ancho) => ({ titulo, tipo, ...(ancho ? { ancho } : {}) });
export const periodoTexto = (d, hh) => `${d ? d.split('-').reverse().join('/') : '…'} al ${hh ? hh.split('-').reverse().join('/') : '…'}`;
