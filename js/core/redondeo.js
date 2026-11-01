// Redondeo y conversión de importes.
// Regla del sistema: todos los importes se manejan en CENTAVOS ENTEROS para evitar
// errores de coma flotante. El redondeo es "mitad hacia arriba" en valor absoluto
// (0,005 -> 0,01 y -0,005 -> -0,01), así una nota de crédito es el espejo exacto
// de la factura que anula. Regla configurable: ver parámetro REDONDEO_MODO.

/**
 * Convierte un importe en pesos a centavos enteros.
 * Acepta números (1234.56) o texto en formato argentino ("1.234,56", "$ 1.234,56")
 * o con punto decimal ("1234.56"). Más de 2 decimales se redondea mitad hacia arriba.
 */
export function aCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'bigint') return Number(valor) * 100;
  let s = String(valor).trim().replace(/\$/g, '').replace(/\s/g, '');
  if (s === '') return 0;
  if (typeof valor === 'string' && s.includes(',')) {
    // formato argentino: punto = miles, coma = decimal
    s = s.replace(/\./g, '').replace(',', '.');
  }
  if (/e/i.test(s)) s = Number(s).toFixed(10); // notación científica
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === '-' || s === '.') {
    throw new Error(`Importe inválido: "${valor}"`);
  }
  const negativo = s.startsWith('-');
  if (negativo) s = s.slice(1);
  const [ent = '0', dec = ''] = s.split('.');
  const dos = (dec + '00').slice(0, 2);
  const resto = dec.slice(2);
  let centavos = BigInt(ent || '0') * 100n + BigInt(dos);
  if (resto.length && Number(resto[0]) >= 5) centavos += 1n;
  const n = Number(centavos);
  if (!Number.isSafeInteger(n)) throw new Error(`Importe fuera de rango: "${valor}"`);
  return negativo ? -n : n;
}

/** Centavos -> número en pesos (solo para mostrar o exportar). */
export function aPesos(centavos) {
  return centavos / 100;
}

/** Centavos -> texto "$ 1.234,56". */
export function formatear(centavos, { simbolo = true } = {}) {
  const neg = centavos < 0;
  const abs = Math.abs(centavos);
  const ent = Math.trunc(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const dec = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${simbolo ? '$ ' : ''}${ent},${dec}`;
}

/**
 * División entera con redondeo mitad hacia arriba en valor absoluto.
 * Usa BigInt para no perder precisión con importes grandes.
 */
export function dividirRedondeando(numerador, denominador) {
  const num = BigInt(numerador);
  const den = BigInt(denominador);
  if (den === 0n) throw new Error('División por cero');
  const negativo = (num < 0n) !== (den < 0n);
  const an = num < 0n ? -num : num;
  const ad = den < 0n ? -den : den;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  const n = Number(q);
  return negativo ? -n : n;
}
