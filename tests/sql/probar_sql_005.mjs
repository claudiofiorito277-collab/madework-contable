// Prueba la migración 005 (tesorería) sobre la 001 a 004, en un Postgres embebido (PGlite).
// Requiere "npm install". Correr con: npm run test:sql
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';

const db = new PGlite({ extensions: { btree_gist } });
let ok = 0, mal = 0;
const check = (n, c, extra = '') => { if (c) { ok++; console.log('  OK  ', n); } else { mal++; console.log('  FALLA', n, extra); } };
const U1 = '11111111-1111-1111-1111-111111111111';  // administrador
const U2 = '22222222-2222-2222-2222-222222222222';  // operador
const U3 = '33333333-3333-3333-3333-333333333333';  // contador
const U4 = '44444444-4444-4444-4444-444444444444';  // consulta
const como = async (uid, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
};
const comoE = (uid, sql) => como(uid, () => db.exec(sql));
const comoQ = (uid, sql, params) => como(uid, () => db.query(sql, params));
const falla = async (nombre, uid, sql, patron, params) => {
  try { await comoQ(uid, sql, params); check(nombre, false, '(no dio error)'); }
  catch (e) { check(nombre, patron.test(e.message), `-> ${e.message}`); }
};
const uno = async (sql) => (await db.query(sql)).rows[0];
const n = (x) => Number(x);

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth; create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant usage on schema auth, public, storage to authenticated, anon;
  grant all on storage.objects to authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
const leer = (f) => readFileSync(new URL(`../../sql/${f}`, import.meta.url), 'utf8');

console.log('\n1) Aplicar migraciones 001 a 005');
for (const f of ['001_base.sql', '002_contratos.sql', '003_ventas.sql', '004_compras.sql']) await db.exec(leer(f));
try { await db.exec(leer('005_tesoreria.sql')); check('migración 005 aplicada sin errores', true); }
catch (e) { check('migración 005 aplicada sin errores', false, e.message); process.exit(1); }
await db.exec(`insert into auth.users values ('${U1}','claudio@demo.test'),('${U2}','mario@demo.test'),('${U3}','contador@demo.test'),('${U4}','consulta@demo.test');
               update perfiles set rol='operador', activo=true where id='${U2}';
               update perfiles set rol='contador', activo=true where id='${U3}';
               update perfiles set rol='consulta', activo=true where id='${U4}';`);

// Datos: cliente, contrato E55, certificado aprobado y facturado; proveedor y una factura de compra
await comoE(U1, `insert into clientes (razon_social, cuit) values ('Caminos de las Sierras S.A. (DEMO)', '30712345671')`);
const cli = (await uno(`select id from clientes`)).id;
await comoE(U1, `insert into contratos (codigo, cliente_id, descripcion) values ('E55', '${cli}', 'Pintura columnas RP-E55')`);
const ctr = (await uno(`select id from contratos`)).id;
await comoE(U1, `insert into contrato_items (contrato_id, codigo, descripcion, unidad, cantidad, precio_unitario) values ('${ctr}', '1', 'Pintado', 'CU', 539, 172670)`);
const it = (await uno(`select id from contrato_items`)).id;
await comoE(U1, `insert into certificados (contrato_id, periodo_desde, periodo_hasta) values ('${ctr}', '2026-11-16', '2026-11-20')`);
const cert = (await uno(`select id from certificados`)).id;
await comoE(U1, `insert into certificado_items (certificado_id, item_id, cantidad, precio_unitario, importe) values ('${cert}', '${it}', 40, 172670, 6906800);
  update certificados set bruto = 6906800, base_factura = 6906800, iva = 1450428, total_factura = 8357228, neto_a_cobrar = 8357228 where id = '${cert}';
  update certificados set estado = 'presentado' where id = '${cert}'; update certificados set estado = 'aprobado' where id = '${cert}';`);
const fac = (await comoQ(U1, `select fn_registrar_comprobante_venta($1::jsonb) id`, [JSON.stringify({ cliente_id: cli, certificado_id: cert, tipo_codigo: '1', punto_venta: 3, numero: 125,
  fecha: '2026-11-23', vencimiento: '2026-12-11', alicuotas: [{ alicuota: 'IVA_21', neto: 6906800, iva: 1450428 }] })])).rows[0].id;
await comoE(U1, `insert into proveedores (razon_social, cuit, condicion_iva, categoria) values ('Pinturerías Córdoba (DEMO)', '30500000003', 'RI', 'pinturas')`);
const prov = (await uno(`select id from proveedores`)).id;
const fcompra = (await comoQ(U1, `select fn_registrar_comprobante_compra($1::jsonb) id`, [JSON.stringify({ proveedor_id: prov, tipo_codigo: '1', punto_venta: 4, numero: 1520,
  fecha: '2026-11-18', alicuotas: [{ alicuota: 'IVA_21', neto: 1000000, iva: 210000 }], imputaciones: [{ contrato_id: ctr, porcentaje: 100, importe: 1000000 }] })])).rows[0].id;
const saldoV = async (id) => n((await uno(`select saldo from v_comprobantes_venta where id='${id}'`)).saldo);
const saldoC = async (id) => n((await uno(`select saldo from v_comprobantes_compra where id='${id}'`)).saldo);
const saldoCta = async (id) => n((await uno(`select saldo from v_saldos_cuentas where id='${id}'`)).saldo);

console.log('\n2) Cuentas');
await comoE(U3, `insert into cuentas_tesoreria (nombre, tipo, banco, cbu, saldo_inicial, aplica_imp_deb_cred) values ('Galicia cta. cte.', 'banco', 'Galicia', '0070999030004001234567', 1000000, true)`);
await comoE(U3, `insert into cuentas_tesoreria (nombre, tipo, saldo_inicial) values ('Caja obra', 'caja', 50000)`);
const gal = (await uno(`select id from cuentas_tesoreria where tipo='banco'`)).id;
const caja = (await uno(`select id from cuentas_tesoreria where tipo='caja'`)).id;
check('el contador crea una cuenta bancaria y una caja con saldo inicial', (await saldoCta(gal)) === 1000000 && (await saldoCta(caja)) === 50000);
await comoE(U2, `insert into cuentas_tesoreria (nombre, tipo) values ('Caja operador', 'caja')`).catch(() => {});
check('el operador no crea cuentas', (await uno(`select count(*)::int c from cuentas_tesoreria`)).c === 2);
await falla('una caja no lleva CBU', U3, `insert into cuentas_tesoreria (nombre, tipo, cbu) values ('Caja 2', 'caja', '0070999030004001234567')`, /check/);

console.log('\n3) Transferencia entre cuentas (prueba pedida)');
const tr = (await comoQ(U3, `select fn_transferencia($1, $2, '2026-11-20', 200000, 'Fondos para la obra') t`, [gal, caja])).rows[0].t;
check('transferencia: Galicia $800.000 y caja $250.000', (await saldoCta(gal)) === 800000 && (await saldoCta(caja)) === 250000);
check('dos movimientos con el mismo código de transferencia', (await uno(`select count(*)::int c from movimientos_tesoreria where transferencia_id='${tr}'`)).c === 2);
check('la transferencia no genera impuesto a los débitos y créditos', (await uno(`select count(*)::int c from movimientos_tesoreria where categoria='imp_deb_cred'`)).c === 0);
await falla('origen igual al destino es rechazado', U3, `select fn_transferencia('${gal}', '${gal}', '2026-11-20', 1)`, /distintas/);
await falla('el operador no transfiere', U2, `select fn_transferencia('${gal}', '${caja}', '2026-11-20', 1)`, /Solo el administrador o el contador/);
const patas = (await db.query(`select id from movimientos_tesoreria where transferencia_id='${tr}'`)).rows;
await falla('una pata de transferencia no se anula a mano', U3, `update movimientos_tesoreria set estado='anulado', motivo='x' where id='${patas[0].id}'`, /lo generó el sistema/);
await comoQ(U3, `select fn_anular_movimiento($1, 'Error de carga')`, [patas[0].id]);
check('anular la transferencia anula las dos patas y vuelven los saldos', (await saldoCta(gal)) === 1000000 && (await saldoCta(caja)) === 50000);
await comoQ(U3, `select fn_transferencia($1, $2, '2026-11-20', 200000, 'Fondos para la obra')`, [gal, caja]);

console.log('\n4) Movimientos manuales');
await comoE(U3, `insert into movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion) values ('${caja}', '2026-11-21', 'egreso', 'otro', 15000, 'Viáticos')`);
check('gasto de caja manual', (await saldoCta(caja)) === 235000);
await falla('un movimiento manual no puede simular una cobranza', U3, `insert into movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe) values ('${caja}', '2026-11-21', 'ingreso', 'cobranza', 1)`, /lo genera el sistema/);
await falla('fecha anterior al saldo inicial', U3, `insert into movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe) values ('${caja}', '2026-10-20', 'egreso', 'otro', 1)`, /anterior al saldo inicial/);
await falla('importes de un movimiento no se modifican', U3, `update movimientos_tesoreria set importe = 1 where categoria = 'otro'`, /no se modifican/);
await falla('nadie borra movimientos', U1, `delete from movimientos_tesoreria`, /permission denied/);

console.log('\n5) Cobranza con transferencia y echeq: tesorería automática');
const cobrar = (j) => comoQ(U3, `select fn_registrar_cobranza($1::jsonb) id`, [JSON.stringify(j)]).then((r) => r.rows[0].id);
await falla('transferencia sin cuenta es rechazada', U3, `select fn_registrar_cobranza($1::jsonb)`, /Elegí la cuenta/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-11-25', medios: [{ medio: 'transferencia', importe: 100 }], aplicaciones: [] })]);
await falla('efectivo en una cuenta bancaria es rechazado', U3, `select fn_registrar_cobranza($1::jsonb)`, /a una caja/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-11-25', medios: [{ medio: 'efectivo', importe: 100, cuenta_id: gal }], aplicaciones: [] })]);
const cob = await cobrar({ cliente_id: cli, fecha: '2026-11-25', medios: [
  { medio: 'transferencia', importe: 3357228, cuenta_id: gal, numero: 'TRF-889' },
  { medio: 'echeq', importe: 5000000, numero: 'E-778899', banco: 'Banco Nación', librador: 'Caminos de las Sierras S.A.', cuit_librador: '30712345671', fecha_pago: '2026-12-10' }],
  aplicaciones: [{ comprobante_id: fac, importe: 8357228 }] });
check('la transferencia entra sola a Galicia ($800.000 + $3.357.228)', (await saldoCta(gal)) === 4157228);
const ech = await uno(`select * from cheques where cobranza_id='${cob}'`);
check('el echeq queda en cartera, del cliente', ech.estado === 'en_cartera' && ech.tipo === 'recibido' && ech.formato === 'echeq' && ech.cliente_id === cli);
check('la factura queda cobrada y el certificado "cobrado"', (await saldoV(fac)) === 0 && (await uno(`select estado from certificados where id='${cert}'`)).estado === 'cobrado');
await falla('echeq sin fecha de pago es rechazado', U3, `select fn_registrar_cobranza($1::jsonb)`, /fecha de pago/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-11-25', medios: [{ medio: 'echeq', importe: 1, numero: 'E-1' }] })]);
await falla('el mismo echeq no se carga dos veces', U3, `select fn_registrar_cobranza($1::jsonb)`, /duplicate key/,
  [JSON.stringify({ cliente_id: cli, fecha: '2026-11-25', medios: [{ medio: 'echeq', importe: 1, numero: 'E-778899', banco: 'Banco Nación', cuit_librador: '30712345671', fecha_pago: '2026-12-10' }] })]);
await falla('los cheques no se cargan a mano', U1, `insert into cheques (tipo, numero, fecha_pago, importe, estado) values ('recibido', '1', '2026-12-01', 1, 'en_cartera')`, /permission denied|se cargan desde/);

console.log('\n6) Rechazo de cheque (prueba pedida)');
await falla('no se deposita antes de la fecha de pago', U3, `select fn_cheque_depositar('${ech.id}', '${gal}', '2026-12-01')`, /pago diferido/);
await comoQ(U3, `select fn_cheque_depositar($1, $2, '2026-12-10')`, [ech.id, gal]);
await comoQ(U3, `select fn_cheque_acreditar($1, '2026-12-11')`, [ech.id]);
check('echeq acreditado: entra a Galicia ($9.157.228)', (await saldoCta(gal)) === 9157228 && (await uno(`select estado from cheques where id='${ech.id}'`)).estado === 'cobrado');
await falla('rechazar sin motivo es rechazado', U3, `select fn_cheque_rechazar('${ech.id}', '2026-12-12', '')`, /motivo/);
await comoQ(U3, `select fn_cheque_rechazar($1, '2026-12-12', 'Sin fondos suficientes')`, [ech.id]);
check('rechazo: el banco lo debita de vuelta (Galicia $4.157.228)', (await saldoCta(gal)) === 4157228);
check('rechazo: la deuda del cliente se reabre por $5.000.000', (await saldoV(fac)) === 5000000);
check('rechazo: el certificado vuelve a "facturado"', (await uno(`select estado from certificados where id='${cert}'`)).estado === 'facturado');
check('el cheque queda "rechazado" con su motivo', (await uno(`select estado, motivo from cheques where id='${ech.id}'`)).motivo === 'Sin fondos suficientes');
await falla('un cheque rechazado no se vuelve a rechazar', U3, `select fn_cheque_rechazar('${ech.id}', '2026-12-12', 'x')`, /no se puede rechazar/);
await falla('la cobranza con un cheque rechazado no se anula', U3, `select fn_anular_cobranza('${cob}', 'x')`, /cheque rechazado/);
await cobrar({ cliente_id: cli, fecha: '2026-12-15', medios: [{ medio: 'transferencia', importe: 5000000, cuenta_id: gal }], aplicaciones: [{ comprobante_id: fac, importe: 5000000 }] });
check('el cliente vuelve a pagar: la factura queda en cero y el certificado "cobrado"', (await saldoV(fac)) === 0 && (await uno(`select estado from certificados where id='${cert}'`)).estado === 'cobrado');

console.log('\n7) Pagos: cheque propio, endoso de terceros y rechazo del propio');
const cob2 = await cobrar({ cliente_id: cli, fecha: '2026-12-16', medios: [{ medio: 'cheque', importe: 400000, numero: '00012345', banco: 'Macro', librador: 'Tercero SA', fecha_pago: '2026-12-16' }] });
const chT = await uno(`select id from cheques where cobranza_id='${cob2}'`);
const pagar = (j) => comoQ(U3, `select fn_registrar_pago($1::jsonb) id`, [JSON.stringify(j)]).then((r) => r.rows[0].id);
await falla('un cheque de terceros por otro importe es rechazado', U3, `select fn_registrar_pago($1::jsonb)`, /se está usando por/,
  [JSON.stringify({ proveedor_id: prov, fecha: '2026-12-17', medios: [{ medio: 'cheque_tercero', importe: 300000, cheque_id: chT.id }] })]);
const pg = await pagar({ proveedor_id: prov, fecha: '2026-12-17', medios: [
  { medio: 'cheque_tercero', importe: 400000, cheque_id: chT.id },
  { medio: 'echeq', importe: 810000, cuenta_id: gal, numero: 'P-0001', fecha_pago: '2026-12-30' }],
  aplicaciones: [{ comprobante_id: fcompra, importe: 1210000 }] });
check('el cheque de terceros queda endosado al proveedor', (await uno(`select estado, endosado_a_proveedor_id p from cheques where id='${chT.id}'`)).p === prov);
const chP = await uno(`select * from cheques where pago_id='${pg}'`);
check('el echeq propio queda emitido, sin debitar todavía', chP.estado === 'emitido' && (await saldoCta(gal)) === 9157228);
check('la factura de compra queda pagada', (await saldoC(fcompra)) === 0);
await comoQ(U3, `select fn_cheque_debitar($1, '2026-12-30')`, [chP.id]);
check('al debitarse sale de Galicia ($8.347.228)', (await saldoCta(gal)) === 8347228);
await comoQ(U3, `select fn_cheque_rechazar($1, '2026-12-30', 'Error de firma')`, [chP.id]);
check('rechazo del cheque propio: vuelve la plata y se reabre la deuda con el proveedor ($810.000)', (await saldoCta(gal)) === 9157228 && (await saldoC(fcompra)) === 810000);
await falla('un pago con cheque rechazado no se anula', U3, `select fn_anular_pago('${pg}', 'x')`, /cheque rechazado/);
const pg2 = await pagar({ proveedor_id: prov, fecha: '2026-12-31', medios: [{ medio: 'echeq', importe: 810000, cuenta_id: gal, numero: 'P-0002', fecha_pago: '2027-01-05' }],
  aplicaciones: [{ comprobante_id: fcompra, importe: 810000 }] });
await comoQ(U3, `select fn_anular_pago($1, 'Se pagó por otro medio')`, [pg2]);
check('anular un pago con echeq sin debitar anula el echeq', (await uno(`select estado from cheques where pago_id='${pg2}'`)).estado === 'anulado');

console.log('\n8) Impuesto a los débitos y créditos (con alícuota cargada)');
await comoQ(U1, `select fn_nueva_vigencia('BANCARIO', 'IMP_DEB_CRED', 0.6, '2027-01-01', 'Prueba', false)`);
await comoE(U3, `insert into movimientos_tesoreria (cuenta_id, fecha, tipo, categoria, importe, descripcion) values ('${gal}', '2027-01-02', 'egreso', 'gasto_bancario', 100000, 'Comisión')`);
const imp = await uno(`select importe, automatico from movimientos_tesoreria where categoria='imp_deb_cred' and estado='vigente'`);
check('una comisión de $100.000 genera $600 de impuesto, automático', n(imp.importe) === 600 && imp.automatico === true);
const com = (await uno(`select id from movimientos_tesoreria where categoria='gasto_bancario'`)).id;
await comoQ(U3, `select fn_anular_movimiento($1, 'Bonificada')`, [com]);
check('al anular la comisión se anula su impuesto', (await uno(`select count(*)::int c from movimientos_tesoreria where categoria='imp_deb_cred' and estado='vigente'`)).c === 0);

console.log('\n9) Conciliación con diferencias (prueba pedida)');
const ext = (await comoQ(U3, `select fn_importar_extracto($1::jsonb) id`, [JSON.stringify({ cuenta_id: gal, archivo: 'galicia_nov.csv', lineas: [
  { fecha: '2026-11-25', descripcion: 'TRANSF CAMINOS SIERRAS', referencia: 'TRF-889', importe: 3357228 },
  { fecha: '2026-11-26', descripcion: 'COMISION MANT CTA', importe: -12100 },
  { fecha: '2026-11-20', descripcion: 'TRANSF A CAJA', importe: -200001 }] })])).rows[0].id;
const lin = Object.fromEntries((await db.query(`select id, descripcion from extracto_lineas`)).rows.map((r) => [r.descripcion, r.id]));
const movCob = (await uno(`select id from movimientos_tesoreria where cobranza_id='${cob}' and estado='vigente'`)).id;
await comoQ(U3, `select fn_conciliar($1, $2)`, [lin['TRANSF CAMINOS SIERRAS'], movCob]);
check('la cobranza por transferencia se concilia con la línea del banco', (await uno(`select conciliado from movimientos_tesoreria where id='${movCob}'`)).conciliado === true);
const movTr = (await uno(`select id from movimientos_tesoreria where cuenta_id='${gal}' and categoria='transferencia' and estado='vigente'`)).id;
await falla('importes distintos (diferencia de $0,01) no se concilian', U3, `select fn_conciliar('${lin['TRANSF A CAJA']}', '${movTr}')`, /no coinciden/);
await comoQ(U3, `select fn_movimiento_desde_linea($1, 'gasto_bancario')`, [lin['COMISION MANT CTA']]);
check('la comisión que no estaba en el sistema se carga desde el extracto y queda conciliada',
  (await uno(`select estado from extracto_lineas where id='${lin['COMISION MANT CTA']}'`)).estado === 'conciliado');
await falla('un movimiento conciliado no se anula', U3, `select fn_anular_movimiento((select movimiento_id from extracto_lineas where id='${lin['COMISION MANT CTA']}'), 'x')`, /conciliado/);
const rep = (await comoQ(U3, `select fn_importar_extracto($1::jsonb) id`, [JSON.stringify({ cuenta_id: gal, lineas: [{ fecha: '2026-11-25', descripcion: 'TRANSF CAMINOS SIERRAS', referencia: 'TRF-889', importe: 3357228 }, { fecha: '2026-12-01', descripcion: 'INTERESES', importe: 55 }] })])).rows[0].id;
check('al importar de nuevo, las líneas repetidas se saltean', (await uno(`select lineas, repetidas from extractos_bancarios where id='${rep}'`)).repetidas === 1);
await comoQ(U3, `select fn_desconciliar($1)`, [lin['TRANSF CAMINOS SIERRAS']]);
check('desconciliar deja la línea pendiente y el movimiento libre', (await uno(`select conciliado from movimientos_tesoreria where id='${movCob}'`)).conciliado === false);
await falla('la conciliación no se toca a mano', U3, `update movimientos_tesoreria set conciliado = true where id='${movCob}'`, /pantalla de conciliación/);
await falla('el operador no concilia', U2, `select fn_conciliar('${lin['TRANSF CAMINOS SIERRAS']}', '${movCob}')`, /Solo el administrador o el contador/);

console.log('\n10) Anulaciones con cheques');
const cob3 = await cobrar({ cliente_id: cli, fecha: '2026-12-20', medios: [{ medio: 'cheque', importe: 1000, numero: '777', banco: 'Credicoop', fecha_pago: '2026-12-20' }] });
const ch3 = (await uno(`select id from cheques where cobranza_id='${cob3}'`)).id;
await comoQ(U3, `select fn_cheque_depositar($1, $2, '2026-12-21')`, [ch3, gal]);
await falla('no se anula una cobranza con su cheque ya depositado', U3, `select fn_anular_cobranza('${cob3}', 'x')`, /ya está "depositado"/);
const cob4 = await cobrar({ cliente_id: cli, fecha: '2026-12-20', medios: [{ medio: 'cheque', importe: 2000, numero: '778', banco: 'Credicoop', fecha_pago: '2026-12-20' }] });
await comoQ(U3, `select fn_anular_cobranza($1, 'Error')`, [cob4]);
check('anular una cobranza con el cheque en cartera anula el cheque', (await uno(`select estado from cheques where cobranza_id='${cob4}'`)).estado === 'anulado');

console.log('\n11) Auditoría');
const au = await uno(`select count(distinct tabla)::int t from auditoria where tabla in ('cuentas_tesoreria','movimientos_tesoreria','cheques','reversiones_cheque','extractos_bancarios','extracto_lineas')`);
check('auditoría registra las tablas de tesorería', au.t === 6, au.t);

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
if (mal) process.exit(1);
