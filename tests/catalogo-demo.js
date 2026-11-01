// Catálogo de prueba: mismo formato que devuelve Supabase (tablas parametros_fiscales
// y tipos_comprobante). Valores DEMO para pruebas, no reemplazan la configuración real.
export const catalogo = {
  parametros: [
    { tipo: 'ALICUOTA_IVA', codigo: 'IVA_21', valor: 21, vigente_desde: '2026-11-01', vigente_hasta: null },
    { tipo: 'ALICUOTA_IVA', codigo: 'IVA_10_5', valor: 10.5, vigente_desde: '2026-11-01', vigente_hasta: null },
    { tipo: 'ALICUOTA_IVA', codigo: 'IVA_27', valor: 27, vigente_desde: '2026-11-01', vigente_hasta: null },
    { tipo: 'ALICUOTA_IVA', codigo: 'IVA_0', valor: 0, vigente_desde: '2026-11-01', vigente_hasta: null },
    { tipo: 'TOLERANCIA', codigo: 'CUADRE_IVA_CENTAVOS', valor: 1, vigente_desde: '2026-11-01', vigente_hasta: null },
  ],
  tiposComprobante: [
    { codigo: '1', letra: 'A', clase: 'factura', descripcion: 'Factura A', discrimina_iva: true, genera_credito_fiscal: true },
    { codigo: '2', letra: 'A', clase: 'nota_debito', descripcion: 'Nota de débito A', discrimina_iva: true, genera_credito_fiscal: true },
    { codigo: '3', letra: 'A', clase: 'nota_credito', descripcion: 'Nota de crédito A', discrimina_iva: true, genera_credito_fiscal: true },
    { codigo: '6', letra: 'B', clase: 'factura', descripcion: 'Factura B', discrimina_iva: false, genera_credito_fiscal: false },
    { codigo: '8', letra: 'B', clase: 'nota_credito', descripcion: 'Nota de crédito B', discrimina_iva: false, genera_credito_fiscal: false },
    { codigo: '11', letra: 'C', clase: 'factura', descripcion: 'Factura C', discrimina_iva: false, genera_credito_fiscal: false },
    { codigo: '13', letra: 'C', clase: 'nota_credito', descripcion: 'Nota de crédito C', discrimina_iva: false, genera_credito_fiscal: false },
    { codigo: '51', letra: 'M', clase: 'factura', descripcion: 'Factura M', discrimina_iva: true, genera_credito_fiscal: true },
  ],
};

/** Copia del catálogo con un cambio de alícuota a partir de una fecha. */
export function conCambioDeAlicuota(codigo, nuevoValor, desde, hastaAnterior) {
  return {
    ...catalogo,
    parametros: catalogo.parametros.flatMap((p) => {
      if (p.codigo !== codigo) return [p];
      return [
        { ...p, vigente_hasta: hastaAnterior },
        { ...p, valor: nuevoValor, vigente_desde: desde, vigente_hasta: null },
      ];
    }),
  };
}
