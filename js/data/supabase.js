// Única puerta de entrada a Supabase. Las pantallas no llaman a Supabase directo.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const configurado = !SUPABASE_URL.includes('TU-PROYECTO') && !SUPABASE_ANON_KEY.includes('PEGAR');

export const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

/** Traduce errores técnicos a mensajes comprensibles. */
export function mensajeError(err) {
  const m = err?.message ?? String(err);
  if (/Invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'El usuario todavía no confirmó su correo. Confirmalo desde Supabase > Authentication.';
  if (/rate limit|too many requests/i.test(m)) return 'Demasiados intentos. Esperá unos minutos y volvé a probar.';
  if (/permission denied|row-level security/i.test(m)) return 'No tenés permiso para hacer esto.';
  if (/parametros_sin_superposicion/i.test(m)) return 'Esa vigencia se superpone con otra existente.';
  if (/empresa_cuit_check/i.test(m)) return 'El CUIT no es válido: revisá el dígito verificador.';
  if (/duplicate key/i.test(m)) return 'Ya existe un registro con ese código.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'No hay conexión con el servidor. Revisá internet o la configuración de Supabase.';
  return m; // los mensajes de la base ya vienen en castellano
}

/** Ejecuta una consulta de Supabase y devuelve los datos o lanza un Error legible. */
export async function q(promesa) {
  const { data, error } = await promesa;
  if (error) throw new Error(mensajeError(error));
  return data;
}

/** Para UPDATE: si RLS filtró la fila, Supabase no da error pero no devuelve nada. */
export async function qActualizar(promesa) {
  const data = await q(promesa);
  if (Array.isArray(data) && data.length === 0) throw new Error('No tenés permiso para modificar este registro o ya no existe.');
  return data;
}
