// Validación de CUIT/CUIL por dígito verificador (misma regla que la base: fn_cuit_valido).

/** Deja solo los dígitos: "20-12345678-6" -> "20123456786" */
export function limpiarCuit(texto) {
  return String(texto ?? '').replace(/\D/g, '');
}

export function cuitValido(texto) {
  const c = limpiarCuit(texto);
  if (!/^\d{11}$/.test(c)) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((s, p, i) => s + p * Number(c[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(c[10]);
}

/** "20123456786" -> "20-12345678-6" */
export function formatearCuit(texto) {
  const c = limpiarCuit(texto);
  return c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : texto ?? '';
}
