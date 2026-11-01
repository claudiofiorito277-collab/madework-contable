import test from 'node:test';
import assert from 'node:assert/strict';
import { cuitValido, limpiarCuit, formatearCuit } from '../js/core/cuit.js';

// CUIT ficticios, solo para pruebas.
test('CUIT: dígito verificador correcto e incorrecto', () => {
  assert.equal(cuitValido('20-12345678-6'), true);
  assert.equal(cuitValido('20123456780'), false);
  assert.equal(cuitValido('2012345678'), false);
  assert.equal(cuitValido(''), false);
});

test('CUIT: limpiar y formatear', () => {
  assert.equal(limpiarCuit(' 20.12345678/6 '), '20123456786');
  assert.equal(formatearCuit('20123456786'), '20-12345678-6');
});
