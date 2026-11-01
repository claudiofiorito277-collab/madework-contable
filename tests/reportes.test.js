import test from 'node:test';
import assert from 'node:assert/strict';
import { ivaVentas, ivaCompras, libroIvaDigital, LARGOS_LID, retencionesYPercepciones, antiguedadSaldos, rentabilidad } from '../js/core/reportes.js';
import { reporteXLSX, reportePDF, textoPesos, textoNumero, crc32, winAnsi, anchoTexto, nombreArchivo } from '../js/core/exportar.js';
import { costoPorItem } from '../js/core/costos.js';

const FV = { id: 'f1', fecha: '2026-11-02', clase: 'factura', tipo_codigo: '1', punto_venta: 3, numero: 125, numero_formateado: '00003-00000125', cliente: 'Caminos de las Sierras S.A.', cliente_cuit: '30712345671',
  neto_gravado: 690680000, exento: 0, no_gravado: 0, iva: 145042800, otros_tributos: 0, total: 835722800, estado: 'emitido', vencimiento: '2026-11-20' };
const NC = { ...FV, id: 'n1', clase: 'nota_credito', tipo_codigo: '3', numero: 7, numero_formateado: '00003-00000007', neto_gravado: 10000000, iva: 2100000, total: 12100000 };
const AN = { ...FV, id: 'x', estado: 'anulado' };
const ALV = [{ comprobante_id: 'f1', porcentaje: '21.0000', neto: 690680000, iva: 145042800 }, { comprobante_id: 'n1', porcentaje: 21, neto: 10000000, iva: 2100000 }, { comprobante_id: 'x', porcentaje: 21, neto: 1, iva: 1 }];

test('R01 · IVA Ventas: la nota de crédito resta y los anulados no cuentan', () => {
  const r = ivaVentas([FV, NC, AN], ALV);
  assert.equal(r.filas.length, 2);
  assert.equal(r.debitoFiscal, 145042800 - 2100000);
  assert.deepEqual(r.porAlicuota, [{ porcentaje: 21, neto: 680680000, iva: 142942800 }]);
  assert.equal(r.totales.total, 835722800 - 12100000);
});

const FA = { id: 'c1', fecha: '2026-11-18', clase: 'factura', tipo_codigo: '1', punto_venta: 4, numero: 1520, numero_formateado: '00004-00001520', proveedor: 'Pinturerías Córdoba S.A.', proveedor_cuit: '30500000003',
  neto_gravado: 170000000, exento: 0, no_gravado: 0, sin_discriminar: 0, iva: 35700000, credito_fiscal: 35700000, percepciones: 8500000, otros_tributos: 0, total: 214200000, estado: 'emitido' };
const FC = { id: 'c2', fecha: '2026-11-19', clase: 'factura', tipo_codigo: '11', punto_venta: 2, numero: 45, numero_formateado: '00002-00000045', proveedor: 'Juan Pérez (monotributo)', proveedor_cuit: '20111111112',
  neto_gravado: 0, exento: 0, no_gravado: 0, sin_discriminar: 30000000, iva: 0, credito_fiscal: 0, percepciones: 0, otros_tributos: 0, total: 30000000, estado: 'emitido' };
const PER = [{ comprobante_id: 'c1', tipo: 'PERC_IVA', importe: 5100000 }, { comprobante_id: 'c1', tipo: 'PERC_IIBB_CBA', importe: 3400000 }];

test('R02 · IVA Compras: crédito fiscal computable, percepciones y factura C sin IVA', () => {
  const r = ivaCompras([FA, FC], [{ comprobante_id: 'c1', porcentaje: 21, neto: 170000000, iva: 35700000 }], PER);
  assert.equal(r.creditoFiscal, 35700000);
  assert.equal(r.totales.perc_iva, 5100000);
  assert.equal(r.totales.perc_iibb, 3400000);
  assert.equal(r.totales.sin_discriminar, 30000000);
  assert.equal(r.totales.total, 244200000);
  assert.deepEqual(r.porAlicuota, [{ porcentaje: 21, neto: 170000000, iva: 35700000, computable: 35700000 }]);
});

test('R03 · Libro IVA Digital: largo fijo de cada registro y campos clave', () => {
  const l = libroIvaDigital([{ ...FV, alicuotas: [{ porcentaje: 21, neto: 690680000, iva: 145042800 }] }],
    [{ ...FA, alicuotas: [{ porcentaje: 21, neto: 170000000, iva: 35700000 }], perc: { perc_iva: 5100000, perc_iibb: 3400000, perc_otras: 0 } }, { ...FC, alicuotas: [] }]);
  for (const [k, largo] of Object.entries(LARGOS_LID)) for (const linea of l[k].split('\r\n').filter(Boolean)) assert.equal(linea.length, largo, `${k}: ${linea.length}`);
  const v = l.ventasCbte.split('\r\n')[0];
  assert.equal(v.slice(0, 8), '20261102');
  assert.equal(v.slice(8, 11), '001');
  assert.equal(v.slice(56, 58), '80');
  assert.equal(v.slice(108, 123), '000000835722800');
  assert.equal(v.slice(108 + 120, 108 + 123), 'PES');
  assert.equal(l.ventasAlicuotas.slice(43, 47), '0005');
  const compras = l.comprasCbte.split('\r\n').filter(Boolean);
  assert.equal(compras.length, 2);
  assert.equal(compras[0].slice(239, 254), '000000035700000');   // crédito fiscal computable
  assert.equal(compras[1].slice(237, 238), '0');                 // factura C: sin alícuotas
  assert.equal(l.comprasAlicuotas.split('\r\n').filter(Boolean).length, 1);
  assert.deepEqual(l.avisos, []);
  assert.equal(libroIvaDigital([{ ...FV, tipo_codigo: 'X' }], []).avisos.length, 1);
});

test('R04 · retenciones sufridas y percepciones por tipo', () => {
  const r = retencionesYPercepciones(
    [{ fecha: '2026-11-20', tipo: 'RET_IIBB_CBA', importe: 5000000, estado_cobranza: 'registrada' }, { fecha: '2026-11-20', tipo: 'RET_GANANCIAS', importe: 1000000, estado_cobranza: 'anulada' }],
    [{ fecha: '2026-11-18', tipo: 'PERC_IVA', clase: 'factura', importe: 5100000 }, { fecha: '2026-11-25', tipo: 'PERC_IVA', clase: 'nota_credito', importe: 100000 }]);
  assert.equal(r.retenciones.length, 1);
  assert.deepEqual(r.resumen, [['Percepción de IVA', 5000000], ['Retención de IIBB Córdoba', 5000000]]);
  assert.equal(r.total, 10000000);
});

test('R05 · antigüedad de saldos', () => {
  const r = antiguedadSaldos([{ tercero: 'A', vencimiento: '2026-11-30', saldo: 100 }, { tercero: 'A', vencimiento: '2026-10-01', saldo: 50 }, { tercero: 'B', vencimiento: '2026-06-01', saldo: 10 }, { tercero: 'C', saldo: 0, vencimiento: '2026-01-01' }], '2026-11-15');
  assert.deepEqual(r.filas.map((f) => [f.tercero, f.tramos, f.total]), [['A', [100, 0, 50, 0, 0], 150], ['B', [0, 0, 0, 0, 10], 10]]);
  assert.equal(r.totales.total, 160);
});

test('R06 · rentabilidad por ítem: ingreso certificado, costo presupuestado, real, desvío y margen', () => {
  const items = [{ id: 'it1', codigo: '1', descripcion: 'Pintura de columnas', unidad: 'u', precio_unitario: 17267000, costo_previsto: 6000000 }];
  const costo = costoPorItem({ items, partes: [{ item_id: 'it1', mano_obra: 102000000, equipos: 100000000, cantidad_producida: 60000 }], consumos: [{ item_id: 'it1', costo_total: 120000000 }], compras: [], indirecto: 17500000 });
  const r = rentabilidad(items, [{ item_id: 'it1', cantidad: 60000, importe: 1036020000 }], costo);
  const f = r.filas[0];
  assert.equal(f.ingreso, 1036020000);
  assert.equal(f.costo_real, 339500000);
  assert.equal(f.costo_presupuestado, 360000000);
  assert.equal(f.desvio, -20500000);
  assert.equal(f.margen, 1036020000 - 339500000);
  assert.equal(f.margen_pct, 67.2);
  assert.equal(f.costo_unitario, 5658333);
  assert.equal(r.totales.margen, f.margen);
});

test('R07 · formatos de texto', () => {
  assert.equal(textoPesos(123456789), '1.234.567,89');
  assert.equal(textoPesos(-5), '-0,05');
  assert.equal(textoNumero(1234.5), '1.234,5');
  assert.equal(nombreArchivo('IVA Compras · 11/2026', 'xlsx'), 'IVA_Compras_11_2026.xlsx');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.deepEqual(winAnsi('Año — €'), [65, 0xF1, 111, 32, 0x97, 32, 0x80]);
  assert.ok(anchoTexto('MMM', 10) > anchoTexto('iii', 10));
});

const REP = { titulo: 'Prueba', filtros: [['Período', '11/2026']], generado: { usuario: 'claudio', fecha: '01/11/2026' },
  secciones: [{ titulo: 'Datos', columnas: [{ titulo: 'Fecha', tipo: 'fecha' }, { titulo: 'Importe', tipo: 'pesos' }], filas: [['2026-11-02', 123456]], totales: ['Total', 123456] }] };

test('R08 · Excel: es un zip válido con libro, hoja y el importe como número', () => {
  const b = reporteXLSX(REP);
  assert.deepEqual([...b.slice(0, 4)], [0x50, 0x4B, 0x03, 0x04]);
  const s = new TextDecoder().decode(b);
  assert.ok(s.includes('xl/workbook.xml') && s.includes('xl/worksheets/sheet1.xml'));
  assert.ok(s.includes('<v>1234.56</v>'));
  assert.ok(s.includes('Generado el 01/11/2026 por claudio'));
});

test('R09 · PDF: encabezado, título, fecha de generación y número de página', () => {
  const b = reportePDF(REP);
  const s = String.fromCharCode(...b);
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.ok(s.includes('(Prueba)') && s.includes('1.234,56') && s.includes('P\\341gina 1 de 1'));
  const xref = Number(s.match(/startxref\n(\d+)/)[1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
});
