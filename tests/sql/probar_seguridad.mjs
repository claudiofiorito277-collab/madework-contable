// Revisión final de seguridad (Etapa 9): RLS en todas las tablas, nada para el rol anónimo,
// funciones con search_path fijo, permisos por rol y ninguna clave secreta en el código.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const db = new PGlite({ extensions: { btree_gist } });
let ok = 0, mal = 0;
const check = (n, c, extra = '') => { if (c) { ok++; console.log('  OK  ', n); } else { mal++; console.log('  FALLA', n, extra); } };
const filas = async (sql) => (await db.query(sql)).rows;
const RAIZ = new URL('../../', import.meta.url).pathname;

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
const MIG = ['001_base.sql', '002_contratos.sql', '003_ventas.sql', '004_compras.sql', '005_tesoreria.sql', '006_contabilidad.sql', '007_costos.sql', '008_seguridad.sql'];
for (const f of MIG) await db.exec(readFileSync(join(RAIZ, 'sql', f), 'utf8'));

console.log('\n1) Base de datos (con las migraciones 001 a 008, y los permisos más abiertos posibles por defecto)');
const tablas = await filas(`select c.relname, c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`);
const sinRls = tablas.filter((t) => !t.rls).map((t) => t.relname);
check(`RLS activa en las ${tablas.length} tablas`, !sinRls.length, sinRls.join(', '));
const sinPol = (await filas(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_policy p where p.polrelid = c.oid)`)).map((r) => r.relname);
check('todas las tablas tienen al menos una política (si no, nadie podría leerlas)', !sinPol.length, sinPol.join(', '));
const anonTablas = await filas(`select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'`);
check('el rol anónimo (sin iniciar sesión) no tiene permiso sobre ninguna tabla ni vista', !anonTablas.length, JSON.stringify(anonTablas.slice(0, 8)));
const anonFn = (await filas(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.prosecdef`)).map((r) => r.proname);
check('el rol anónimo no puede ejecutar funciones con privilegios elevados', !anonFn.length, anonFn.join(', '));
const sinPath = (await filas(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)).map((r) => r.proname);
check('todas las funciones con privilegios elevados fijan su search_path', !sinPath.length, sinPath.join(', '));
const vistas = await filas(`select c.relname, coalesce(array_to_string(c.reloptions, ','), '') op from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v'`);
const inseguras = vistas.filter((v) => !/security_invoker=(true|on)/.test(v.op)).map((v) => v.relname);
check(`las ${vistas.length} vistas respetan los permisos de quien consulta (security_invoker)`, !inseguras.length, inseguras.join(', '));
const internas = ['fn_insertar_asiento', 'fn_ejercicio_de'];
const expuestas = (await filas(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any($1) and has_function_privilege('authenticated', p.oid, 'execute')`.replace('$1', `array['${internas.join("','")}']`))).map((r) => r.proname);
check('las funciones internas de contabilidad no se pueden llamar desde la aplicación', !expuestas.length, expuestas.join(', '));
const audit = (await filas(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
  and c.relname <> 'auditoria' and not exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid where t.tgrelid = c.oid and f.proname = 'fn_auditar')`)).map((r) => r.relname);
check('todas las tablas (salvo la propia auditoría) quedan auditadas', !audit.length, audit.join(', '));
const authAud = await filas(`select privilege_type from information_schema.role_table_grants where grantee = 'authenticated' and table_name = 'auditoria' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`);
check('la auditoría no se puede modificar ni borrar desde la aplicación', !authAud.length, JSON.stringify(authAud));

// Que el borrado DEMO contemple todas las tablas: cada tabla se vacía o se conserva a propósito
const borrado = readFileSync(join(RAIZ, 'sql', '900_borrar_demo.sql'), 'utf8');
const CONSERVA = ['perfiles', 'empresa', 'condiciones_iva', 'tipos_comprobante', 'parametros_fiscales', 'plan_cuentas', 'centros_costo', 'imputaciones_contables'];
const sinDecidir = tablas.map((t) => t.relname).filter((t) => !CONSERVA.includes(t) && !borrado.includes(`public.${t}`));
check('el borrado de datos DEMO contempla todas las tablas', !sinDecidir.length, sinDecidir.join(', '));

console.log('\n2) Permisos por rol (con la 008 aplicada)');
const U = { administrador: '11111111-1111-1111-1111-111111111111', operador: '22222222-2222-2222-2222-222222222222', contador: '33333333-3333-3333-3333-333333333333', consulta: '44444444-4444-4444-4444-444444444444' };
await db.exec(`insert into auth.users values ('${U.administrador}','a@demo.test'),('${U.operador}','o@demo.test'),('${U.contador}','c@demo.test'),('${U.consulta}','q@demo.test'),('55555555-5555-5555-5555-555555555555','sinrol@demo.test');
  update perfiles set rol='operador', activo=true where id='${U.operador}'; update perfiles set rol='contador', activo=true where id='${U.contador}'; update perfiles set rol='consulta', activo=true where id='${U.consulta}';`);
const puede = async (uid, sql) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try { await db.exec(`savepoint s; ${sql}; rollback to savepoint s;`); return true; } catch { await db.exec('rollback to savepoint s').catch(() => {}); return false; } finally { await db.exec('reset role;'); }
};
await db.exec('begin');
const banco = (await filas(`select id from plan_cuentas where codigo='1.1.1.02'`))[0].id; const cap = (await filas(`select id from plan_cuentas where codigo='3.1.01'`))[0].id;
const asiento = `select fn_registrar_asiento('${JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), tipo: 'manual', descripcion: 'x', lineas: [{ cuenta_id: banco, debe: 1 }, { cuenta_id: cap, haber: 1 }] })}'::jsonb)`;
const ACC = [
  ['ver clientes', `select 1 from clientes`, { administrador: 1, contador: 1, operador: 1, consulta: 1, anon: 0 }],
  ['dar de alta un cliente', `insert into clientes (razon_social, cuit) values ('X', '30712345671')`, { administrador: 1, contador: 1, operador: 0, consulta: 0, anon: 0 }],
  ['dar de alta un proveedor', `insert into proveedores (razon_social) values ('X')`, { administrador: 1, contador: 1, operador: 1, consulta: 0, anon: 0 }],
  ['registrar un asiento', asiento, { administrador: 1, contador: 1, operador: 0, consulta: 0, anon: 0 }],
  ['cerrar un mes', `select fn_cerrar_periodo(2030, 1)`, { administrador: 1, contador: 1, operador: 0, consulta: 0, anon: 0 }],
  ['cargar un material del catálogo', `insert into materiales (codigo, nombre, unidad) values ('X', 'X', 'l')`, { administrador: 1, contador: 1, operador: 0, consulta: 0, anon: 0 }],
  ['dar de alta personal', `insert into personal (nombre) values ('X')`, { administrador: 1, contador: 1, operador: 0, consulta: 0, anon: 0 }],
  ['usar funciones sin iniciar sesión', `select fn_parametro_vigente('IVA', 'IVA_21', current_date)`, { administrador: 1, contador: 1, operador: 1, consulta: 1, anon: 0 }],
];
for (const [que, sql, esperado] of ACC) {
  const r = {};
  for (const rol of ['administrador', 'contador', 'operador', 'consulta', 'anon']) r[rol] = (await puede(U[rol], sql)) ? 1 : 0;
  check(`${que}: ${Object.entries(esperado).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nadie'}`, JSON.stringify(r) === JSON.stringify({ administrador: esperado.administrador, contador: esperado.contador, operador: esperado.operador, consulta: esperado.consulta, anon: esperado.anon }), JSON.stringify(r));
}
await db.exec('rollback');

console.log('\n3) Código (carpetas js, sql, css, tests e index.html)');
const archivos = [];
const recorrer = (d) => { for (const x of readdirSync(d)) { const p = join(d, x); if (x === 'node_modules' || x.startsWith('.')) continue; if (statSync(p).isDirectory()) recorrer(p); else archivos.push(p); } };
for (const d of ['js', 'sql', 'css', 'tests']) recorrer(join(RAIZ, d));
archivos.push(join(RAIZ, 'index.html'));
const texto = Object.fromEntries(archivos.map((p) => [p.replace(RAIZ, ''), readFileSync(p, 'utf8')]));
const jwts = [];
for (const [p, s] of Object.entries(texto)) for (const m of s.matchAll(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g)) {
  let rol = '?'; try { rol = JSON.parse(Buffer.from(m[0].split('.')[1], 'base64url').toString()).role; } catch { /* no es un JWT válido */ }
  jwts.push({ p, rol });
}
check('ninguna clave JWT con rol distinto de "anon" (la service_role nunca está en el código)', jwts.every((j) => j.rol === 'anon'), JSON.stringify(jwts));
const secretas = Object.entries(texto).filter(([p, s]) => /sb_secret_[\w-]{10,}|SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"][^'"]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(s)).map(([p]) => p);
check('ninguna clave secreta, service_role ni clave privada en los archivos', !secretas.length, secretas.join(', '));
const contras = Object.entries(texto).filter(([p, s]) => !p.startsWith('tests/') && /(password|passwd|contrase(ñ|n)a)\s*[:=]\s*['"][^'"]{4,}['"]/i.test(s)).map(([p]) => p);
check('ninguna contraseña escrita en el programa', !contras.length, contras.join(', '));
const conf = texto['js/config.js'];
check('config.js solo tiene la dirección del proyecto y la clave pública anon', /SUPABASE_ANON_KEY/.test(conf) && !/service_role['"]?\s*[:=]/i.test(conf));
const gi = readFileSync(join(RAIZ, '.gitignore'), 'utf8');
check('.gitignore excluye archivos de claves y respaldos', /\.env/.test(gi) && /respaldos/i.test(gi), gi);

console.log(`\nResultado: ${ok} OK, ${mal} fallas`);
if (mal) process.exit(1);
