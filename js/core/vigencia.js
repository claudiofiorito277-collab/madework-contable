// Búsqueda de valores con fecha de vigencia (parámetros fiscales, costos, etc.).
// Las fechas son texto 'AAAA-MM-DD'; vigente_hasta null = sin fecha de fin.

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function validarFecha(fecha) {
  if (!FECHA.test(String(fecha))) throw new Error(`Fecha inválida: "${fecha}" (formato AAAA-MM-DD)`);
  return fecha;
}

/**
 * Devuelve el registro vigente para (tipo, codigo) en la fecha dada, o null.
 * Si hay más de uno vigente, es un error de configuración y se avisa.
 */
export function buscarVigente(registros, { tipo, codigo, fecha }) {
  validarFecha(fecha);
  const encontrados = registros.filter((r) =>
    (tipo === undefined || r.tipo === tipo) &&
    r.codigo === codigo &&
    r.vigente_desde <= fecha &&
    (r.vigente_hasta === null || r.vigente_hasta === undefined || r.vigente_hasta >= fecha)
  );
  if (encontrados.length > 1) {
    throw new Error(`Hay ${encontrados.length} valores vigentes para ${tipo ?? ''} ${codigo} el ${fecha}. Revisá las vigencias.`);
  }
  return encontrados[0] ?? null;
}
