-- =====================================================================
-- MADEWORK · Sistema contable · Migración 001 · Base del sistema
-- Etapa 1 · 01/11/2026
--
-- Crea: empresa, perfiles de usuario y roles, auditoría, condiciones de IVA,
-- tipos de comprobante, parámetros fiscales con vigencia, plan de cuentas,
-- centros de costo y períodos. Incluye reglas de seguridad (RLS) por rol.
--
-- Cómo aplicarla: Supabase > SQL Editor > New query > pegar todo > Run.
-- Se corre UNA sola vez, en un proyecto nuevo. No editar una vez aplicada:
-- los cambios futuros van en migraciones nuevas (002, 003...).
--
-- Roles: administrador · contador · operador · consulta
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------

-- Actualiza modificado_en en cada UPDATE
create or replace function public.fn_set_modificado()
returns trigger language plpgsql as $$
begin
  new.modificado_en := now();
  return new;
end $$;

-- Valida CUIT/CUIL con dígito verificador (11 dígitos, sin guiones)
create or replace function public.fn_cuit_valido(p_cuit text)
returns boolean language plpgsql immutable as $$
declare
  pesos int[] := array[5,4,3,2,7,6,5,4,3,2];
  suma int := 0;
  dv int;
  i int;
begin
  if p_cuit is null or p_cuit !~ '^\d{11}$' then return false; end if;
  for i in 1..10 loop
    suma := suma + substr(p_cuit, i, 1)::int * pesos[i];
  end loop;
  dv := 11 - (suma % 11);
  if dv = 11 then dv := 0; end if;
  if dv = 10 then return false; end if;
  return dv = substr(p_cuit, 11, 1)::int;
end $$;

-- ---------------------------------------------------------------------
-- Perfiles de usuario y roles
-- Los usuarios se crean en Supabase > Authentication > Users.
-- El PRIMER usuario creado queda como administrador activo.
-- Los siguientes quedan como "consulta" e INACTIVOS hasta que el
-- administrador les asigne rol y los active desde la pantalla Usuarios.
-- ---------------------------------------------------------------------
create table public.perfiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  nombre         text not null default '',
  rol            text not null default 'consulta'
                 check (rol in ('administrador','contador','operador','consulta')),
  activo         boolean not null default false,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);

create or replace function public.fn_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  es_primero boolean;
begin
  select not exists (select 1 from public.perfiles where rol = 'administrador') into es_primero;
  insert into public.perfiles (id, email, nombre, rol, activo)
  values (new.id, new.email, coalesce(split_part(new.email, '@', 1), ''),
          case when es_primero then 'administrador' else 'consulta' end,
          es_primero);
  return new;
end $$;

create trigger trg_nuevo_usuario
  after insert on auth.users
  for each row execute function public.fn_nuevo_usuario();

-- Rol del usuario conectado (null si no está activo)
create or replace function public.fn_rol()
returns text language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid() and activo
$$;

create or replace function public.fn_tiene_rol(variadic p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.fn_rol() = any(p_roles), false)
$$;

-- No permitir quedarse sin administrador activo
create or replace function public.fn_perfiles_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.rol = 'administrador' and old.activo
     and (new.rol <> 'administrador' or not new.activo)
     and not exists (select 1 from public.perfiles
                     where rol = 'administrador' and activo and id <> old.id) then
    raise exception 'No se puede quitar el último administrador activo';
  end if;
  return new;
end $$;

create trigger trg_perfiles_control before update on public.perfiles
  for each row execute function public.fn_perfiles_control();
create trigger trg_perfiles_mod before update on public.perfiles
  for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Auditoría: registra toda alta, modificación y baja de las tablas
-- auditadas. Nadie puede modificarla ni borrarla desde la aplicación.
-- ---------------------------------------------------------------------
create table public.auditoria (
  id             bigint generated always as identity primary key,
  fecha          timestamptz not null default now(),
  usuario_id     uuid,
  usuario_email  text,
  tabla          text not null,
  registro_id    text,
  accion         text not null check (accion in ('ALTA','MODIFICACION','BAJA')),
  antes          jsonb,
  despues        jsonb
);
create index auditoria_tabla_fecha on public.auditoria (tabla, fecha desc);
create index auditoria_fecha on public.auditoria (fecha desc);

create or replace function public.fn_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes jsonb;
  v_despues jsonb;
  v_email text;
begin
  if tg_op = 'UPDATE' then
    v_antes := to_jsonb(old) - 'modificado_en';
    v_despues := to_jsonb(new) - 'modificado_en';
    if v_antes = v_despues then return new; end if;  -- sin cambios reales
  elsif tg_op = 'INSERT' then
    v_despues := to_jsonb(new);
  else
    v_antes := to_jsonb(old);
  end if;
  select email into v_email from public.perfiles where id = auth.uid();
  insert into public.auditoria (usuario_id, usuario_email, tabla, registro_id, accion, antes, despues)
  values (auth.uid(), coalesce(v_email, 'sistema'), tg_table_name,
          coalesce(v_despues->>'id', v_antes->>'id',
                   v_despues->>'codigo', v_antes->>'codigo',
                   concat_ws('-', coalesce(v_despues, v_antes)->>'anio', coalesce(v_despues, v_antes)->>'mes')),
          case tg_op when 'INSERT' then 'ALTA' when 'UPDATE' then 'MODIFICACION' else 'BAJA' end,
          v_antes, v_despues);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- Empresa (una sola fila)
-- ---------------------------------------------------------------------
create table public.empresa (
  id                     smallint primary key default 1 check (id = 1),
  razon_social           text not null,
  nombre_fantasia        text not null default 'MADEWORK',
  cuit                   text check (cuit is null or public.fn_cuit_valido(cuit)),
  condicion_iva          text not null default 'RI',
  iibb_condicion         text not null default 'local_cordoba'
                         check (iibb_condicion in ('local_cordoba','convenio_multilateral','exento','no_inscripto')),
  iibb_numero            text,
  domicilio              text,
  localidad              text,
  provincia              text default 'Córdoba',
  codigo_postal          text,
  email                  text,
  telefono               text,
  inicio_actividades     date,
  fecha_inicio_sistema   date not null,
  cierre_ejercicio_mes   smallint not null default 12 check (cierre_ejercicio_mes between 1 and 12),
  cierre_ejercicio_dia   smallint not null default 31 check (cierre_ejercicio_dia between 1 and 31),
  observaciones          text,
  modificado_en          timestamptz not null default now()
);
create trigger trg_empresa_mod before update on public.empresa
  for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Condiciones frente al IVA y tipos de comprobante
-- ---------------------------------------------------------------------
create table public.condiciones_iva (
  codigo       text primary key,
  descripcion  text not null,
  activo       boolean not null default true
);

create table public.tipos_comprobante (
  codigo                 text primary key,     -- código ARCA de referencia
  letra                  text not null check (letra in ('A','B','C','M','X')),
  clase                  text not null check (clase in ('factura','nota_debito','nota_credito','recibo','ticket','otro')),
  descripcion            text not null,
  discrimina_iva         boolean not null,
  genera_credito_fiscal  boolean not null,
  activo                 boolean not null default true,
  observacion            text,
  modificado_en          timestamptz not null default now(),
  check (not genera_credito_fiscal or discrimina_iva)
);
create trigger trg_tipos_comprobante_mod before update on public.tipos_comprobante
  for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Parámetros fiscales con vigencia
-- Cada valor vale entre vigente_desde y vigente_hasta (null = sin fin).
-- La base impide que dos vigencias del mismo parámetro se superpongan.
-- Para cambiar un valor se usa fn_nueva_vigencia (cierra la anterior y
-- crea la nueva); así queda el historial completo.
-- ---------------------------------------------------------------------
create table public.parametros_fiscales (
  id             uuid primary key default gen_random_uuid(),
  tipo           text not null,
  codigo         text not null,
  descripcion    text not null,
  valor          numeric(14,4),             -- null = todavía sin definir
  unidad         text not null default '%',
  vigente_desde  date not null,
  vigente_hasta  date,
  a_confirmar    boolean not null default false,
  observacion    text,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now(),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde),
  constraint parametros_sin_superposicion exclude using gist (
    tipo with =, codigo with =,
    daterange(vigente_desde, vigente_hasta, '[]') with &&
  )
);
create trigger trg_parametros_mod before update on public.parametros_fiscales
  for each row execute function public.fn_set_modificado();

-- Un valor ya definido no se pisa: se cambia con una nueva vigencia.
-- Solo se permite completar un valor que estaba vacío (null), y no se puede
-- cambiar tipo, código ni fecha de inicio de una vigencia existente.
create or replace function public.fn_parametros_control()
returns trigger language plpgsql as $$
begin
  if new.tipo <> old.tipo or new.codigo <> old.codigo or new.vigente_desde <> old.vigente_desde then
    raise exception 'No se puede cambiar tipo, código ni fecha de inicio de una vigencia. Creá una nueva vigencia.';
  end if;
  if old.valor is not null and new.valor is distinct from old.valor then
    raise exception 'Para cambiar un valor ya definido usá "Nueva vigencia": así queda el historial.';
  end if;
  return new;
end $$;
create trigger trg_parametros_control before update on public.parametros_fiscales
  for each row execute function public.fn_parametros_control();

create or replace function public.fn_nueva_vigencia(
  p_tipo text, p_codigo text, p_valor numeric, p_desde date,
  p_observacion text default null, p_a_confirmar boolean default false
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_actual public.parametros_fiscales;
  v_id uuid;
begin
  if not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Solo el administrador o el contador pueden cambiar parámetros fiscales';
  end if;
  if p_desde is null then raise exception 'Falta la fecha de vigencia'; end if;

  select * into v_actual from public.parametros_fiscales
   where tipo = p_tipo and codigo = p_codigo and vigente_hasta is null
   for update;
  if not found then
    raise exception 'No existe el parámetro % / % con vigencia abierta', p_tipo, p_codigo;
  end if;
  if p_desde <= v_actual.vigente_desde then
    raise exception 'La nueva vigencia debe empezar después del % (inicio de la vigencia actual)',
      to_char(v_actual.vigente_desde, 'DD/MM/YYYY');
  end if;

  update public.parametros_fiscales set vigente_hasta = p_desde - 1 where id = v_actual.id;
  insert into public.parametros_fiscales (tipo, codigo, descripcion, valor, unidad, vigente_desde, a_confirmar, observacion)
  values (p_tipo, p_codigo, v_actual.descripcion, p_valor, v_actual.unidad, p_desde, p_a_confirmar, p_observacion)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Plan de cuentas
-- El código define la jerarquía: 1 > 1.1 > 1.1.1 > 1.1.1.01
-- La cuenta madre se asigna sola a partir del código.
-- Solo las cuentas imputables reciben asientos.
-- ---------------------------------------------------------------------
create table public.plan_cuentas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique check (codigo ~ '^\d+(\.\d+)*$'),
  nombre         text not null,
  rubro          text not null check (rubro in ('activo','pasivo','patrimonio_neto','ingreso','egreso')),
  imputable      boolean not null default false,
  padre_id       uuid references public.plan_cuentas(id),
  nivel          smallint generated always as (array_length(string_to_array(codigo, '.'), 1)) stored,
  activo         boolean not null default true,
  observacion    text,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);

create or replace function public.fn_plan_cuentas_control()
returns trigger language plpgsql as $$
declare
  v_codigo_padre text;
  v_padre public.plan_cuentas;
begin
  if position('.' in new.codigo) > 0 then
    v_codigo_padre := regexp_replace(new.codigo, '\.[^.]+$', '');
    select * into v_padre from public.plan_cuentas where codigo = v_codigo_padre;
    if not found then
      raise exception 'No existe la cuenta madre % para la cuenta %', v_codigo_padre, new.codigo;
    end if;
    if v_padre.imputable then
      raise exception 'La cuenta madre % es imputable: no puede tener subcuentas', v_codigo_padre;
    end if;
    if v_padre.rubro <> new.rubro then
      raise exception 'La cuenta % debe ser del mismo rubro que su madre (%)', new.codigo, v_padre.rubro;
    end if;
    new.padre_id := v_padre.id;
  else
    new.padre_id := null;
  end if;
  if tg_op = 'UPDATE' then
    if new.codigo <> old.codigo and exists (select 1 from public.plan_cuentas where padre_id = old.id) then
      raise exception 'No se puede cambiar el código de una cuenta que tiene subcuentas';
    end if;
    if new.imputable and exists (select 1 from public.plan_cuentas where padre_id = old.id) then
      raise exception 'Una cuenta con subcuentas no puede ser imputable';
    end if;
  end if;
  return new;
end $$;

create trigger trg_plan_cuentas_control before insert or update on public.plan_cuentas
  for each row execute function public.fn_plan_cuentas_control();
create trigger trg_plan_cuentas_mod before update on public.plan_cuentas
  for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Centros de costo (en la Etapa 2 se vinculan a contratos e ítems)
-- ---------------------------------------------------------------------
create table public.centros_costo (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique,
  nombre         text not null,
  tipo           text not null default 'otro'
                 check (tipo in ('contrato','item','administracion','equipo','otro')),
  activo         boolean not null default true,
  observacion    text,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);
create trigger trg_centros_costo_mod before update on public.centros_costo
  for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Períodos contables (el cierre se usa desde la Etapa 6)
-- ---------------------------------------------------------------------
create table public.periodos (
  anio           smallint not null,
  mes            smallint not null check (mes between 1 and 12),
  estado         text not null default 'abierto' check (estado in ('abierto','cerrado')),
  cerrado_por    uuid references public.perfiles(id),
  cerrado_en     timestamptz,
  motivo         text,
  modificado_en  timestamptz not null default now(),
  primary key (anio, mes)
);
create trigger trg_periodos_mod before update on public.periodos
  for each row execute function public.fn_set_modificado();

-- =====================================================================
-- Seguridad: Row Level Security
-- =====================================================================
alter table public.perfiles            enable row level security;
alter table public.auditoria           enable row level security;
alter table public.empresa             enable row level security;
alter table public.condiciones_iva     enable row level security;
alter table public.tipos_comprobante   enable row level security;
alter table public.parametros_fiscales enable row level security;
alter table public.plan_cuentas        enable row level security;
alter table public.centros_costo       enable row level security;
alter table public.periodos            enable row level security;

-- Perfiles: cada uno ve el suyo; los usuarios activos ven la lista (nombres para auditoría);
-- solo el administrador modifica.
create policy perfiles_ver on public.perfiles for select to authenticated
  using (id = auth.uid() or public.fn_rol() is not null);
create policy perfiles_admin on public.perfiles for update to authenticated
  using (public.fn_tiene_rol('administrador')) with check (public.fn_tiene_rol('administrador'));

-- Auditoría: solo lectura para administrador y contador. Nadie escribe directo.
create policy auditoria_ver on public.auditoria for select to authenticated
  using (public.fn_tiene_rol('administrador','contador'));
revoke insert, update, delete, truncate on public.auditoria from anon, authenticated;

-- Empresa: todos los activos leen; administrador modifica.
create policy empresa_ver on public.empresa for select to authenticated using (public.fn_rol() is not null);
create policy empresa_mod on public.empresa for update to authenticated
  using (public.fn_tiene_rol('administrador')) with check (public.fn_tiene_rol('administrador'));

-- Configuración fiscal: todos los activos leen; administrador y contador modifican. Sin borrado.
create policy condiciones_ver on public.condiciones_iva for select to authenticated using (public.fn_rol() is not null);
create policy condiciones_alta on public.condiciones_iva for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy condiciones_mod on public.condiciones_iva for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

create policy tipos_ver on public.tipos_comprobante for select to authenticated using (public.fn_rol() is not null);
create policy tipos_alta on public.tipos_comprobante for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy tipos_mod on public.tipos_comprobante for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

create policy parametros_ver on public.parametros_fiscales for select to authenticated using (public.fn_rol() is not null);
create policy parametros_alta on public.parametros_fiscales for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy parametros_mod on public.parametros_fiscales for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

create policy plan_ver on public.plan_cuentas for select to authenticated using (public.fn_rol() is not null);
create policy plan_alta on public.plan_cuentas for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy plan_mod on public.plan_cuentas for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

-- Centros de costo: también el operador puede crear y editar.
create policy cc_ver on public.centros_costo for select to authenticated using (public.fn_rol() is not null);
create policy cc_alta on public.centros_costo for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy cc_mod on public.centros_costo for update to authenticated
  using (public.fn_tiene_rol('administrador','contador','operador')) with check (public.fn_tiene_rol('administrador','contador','operador'));

create policy periodos_ver on public.periodos for select to authenticated using (public.fn_rol() is not null);
create policy periodos_alta on public.periodos for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy periodos_mod on public.periodos for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

-- Sin borrado físico en ninguna tabla de esta etapa (se desactiva con "activo").
revoke delete, truncate on public.empresa, public.condiciones_iva, public.tipos_comprobante,
  public.parametros_fiscales, public.plan_cuentas, public.centros_costo, public.periodos,
  public.perfiles from anon, authenticated;
revoke all on public.perfiles, public.auditoria, public.empresa, public.condiciones_iva,
  public.tipos_comprobante, public.parametros_fiscales, public.plan_cuentas,
  public.centros_costo, public.periodos from anon;
revoke insert on public.perfiles from authenticated;

-- =====================================================================
-- Datos iniciales (configuración, no datos de prueba)
-- =====================================================================
insert into public.empresa (razon_social, nombre_fantasia, condicion_iva, iibb_condicion,
                            localidad, provincia, fecha_inicio_sistema, observaciones)
values ('Claudio Esteban Fiorito', 'MADEWORK', 'RI', 'local_cordoba',
        'Córdoba', 'Córdoba', '2026-11-01',
        'Empresa unipersonal (persona humana). Completar CUIT, número de IIBB y domicilio desde la pantalla Empresa.');

insert into public.condiciones_iva (codigo, descripcion) values
  ('RI', 'Responsable Inscripto'),
  ('MT', 'Monotributista'),
  ('EX', 'Exento'),
  ('CF', 'Consumidor Final'),
  ('NR', 'No Responsable / Sujeto no categorizado');

-- Códigos ARCA de referencia. Verificar con el contador antes de producción.
insert into public.tipos_comprobante (codigo, letra, clase, descripcion, discrimina_iva, genera_credito_fiscal, observacion) values
  ('1',  'A', 'factura',      'Factura A',          true,  true,  null),
  ('2',  'A', 'nota_debito',  'Nota de débito A',   true,  true,  null),
  ('3',  'A', 'nota_credito', 'Nota de crédito A',  true,  true,  null),
  ('4',  'A', 'recibo',       'Recibo A',           false, false, 'Verificar uso con el contador'),
  ('6',  'B', 'factura',      'Factura B',          false, false, 'IVA contenido, no discriminado'),
  ('7',  'B', 'nota_debito',  'Nota de débito B',   false, false, null),
  ('8',  'B', 'nota_credito', 'Nota de crédito B',  false, false, null),
  ('9',  'B', 'recibo',       'Recibo B',           false, false, null),
  ('11', 'C', 'factura',      'Factura C',          false, false, 'Monotributo / exentos: no genera crédito fiscal'),
  ('12', 'C', 'nota_debito',  'Nota de débito C',   false, false, null),
  ('13', 'C', 'nota_credito', 'Nota de crédito C',  false, false, null),
  ('15', 'C', 'recibo',       'Recibo C',           false, false, null),
  ('51', 'M', 'factura',      'Factura M',          true,  true,  'A CONFIRMAR CON CONTADOR: régimen de retención aplicable'),
  ('52', 'M', 'nota_debito',  'Nota de débito M',   true,  true,  'A CONFIRMAR CON CONTADOR'),
  ('53', 'M', 'nota_credito', 'Nota de crédito M',  true,  true,  'A CONFIRMAR CON CONTADOR'),
  ('TIQUE', 'X', 'ticket',    'Ticket / comprobante sin código', false, false, 'Gastos menores sin IVA discriminado');

-- Parámetros fiscales vigentes desde el inicio del sistema (01/11/2026).
-- Los valores en null quedan para completar con el contador.
insert into public.parametros_fiscales (tipo, codigo, descripcion, valor, unidad, vigente_desde, a_confirmar, observacion) values
  ('ALICUOTA_IVA', 'IVA_21',   'IVA general 21%',         21.0000, '%', '2026-11-01', false, null),
  ('ALICUOTA_IVA', 'IVA_10_5', 'IVA reducido 10,5%',      10.5000, '%', '2026-11-01', false, null),
  ('ALICUOTA_IVA', 'IVA_27',   'IVA 27%',                 27.0000, '%', '2026-11-01', false, null),
  ('ALICUOTA_IVA', 'IVA_0',    'IVA 0%',                   0.0000, '%', '2026-11-01', false, null),
  ('TOLERANCIA',   'CUADRE_IVA_CENTAVOS', 'Diferencia máxima aceptada al cargar IVA a mano, por alícuota', 1, 'centavos', '2026-11-01', false, null),
  ('REDONDEO',     'DECIMALES', 'Decimales de los importes', 2, 'decimales', '2026-11-01', false, 'Redondeo mitad hacia arriba por alícuota'),
  ('IIBB',         'ALICUOTA_CBA_SERVICIOS', 'Ingresos Brutos Córdoba - alícuota de la actividad', null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR'),
  ('MUNICIPAL',    'TASA_COMERCIO_CBA', 'Contribución municipal comercio e industria - Córdoba Capital', null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR: si corresponde'),
  ('BANCARIO',     'IMP_DEB_CRED', 'Impuesto a los débitos y créditos bancarios', null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR'),
  ('RETENCION_SUFRIDA', 'RET_GANANCIAS', 'Retención de Ganancias sufrida', null, '%', '2026-11-01', true, 'Se carga lo que figura en cada certificado. Valor de control a confirmar'),
  ('RETENCION_SUFRIDA', 'RET_IVA',       'Retención de IVA sufrida',       null, '%', '2026-11-01', true, 'Se carga lo que figura en cada certificado. Valor de control a confirmar'),
  ('RETENCION_SUFRIDA', 'RET_IIBB_CBA',  'Retención de IIBB Córdoba sufrida', null, '%', '2026-11-01', true, 'Se carga lo que figura en cada certificado. Valor de control a confirmar'),
  ('RETENCION_SUFRIDA', 'RET_SUSS',      'Retención de SUSS sufrida',      null, '%', '2026-11-01', true, 'A CONFIRMAR CON CONTADOR: si corresponde a esta actividad');

-- Plan de cuentas BORRADOR para una unipersonal RI de servicios viales.
-- A CONFIRMAR CON CONTADOR. Se puede editar, agregar y desactivar cuentas.
insert into public.plan_cuentas (codigo, nombre, rubro, imputable) values
  ('1',          'ACTIVO',                                   'activo', false),
  ('1.1',        'Activo corriente',                         'activo', false),
  ('1.1.1',      'Caja y bancos',                            'activo', false),
  ('1.1.1.01',   'Caja',                                     'activo', true),
  ('1.1.1.02',   'Banco cuenta corriente',                   'activo', true),
  ('1.1.1.03',   'Valores a depositar (cheques y echeqs en cartera)', 'activo', true),
  ('1.1.2',      'Créditos por ventas',                      'activo', false),
  ('1.1.2.01',   'Deudores por servicios',                   'activo', true),
  ('1.1.2.02',   'Fondo de reparo a cobrar',                 'activo', true),
  ('1.1.2.03',   'Certificados aprobados a facturar',        'activo', true),
  ('1.1.3',      'Créditos fiscales',                        'activo', false),
  ('1.1.3.01',   'IVA crédito fiscal',                       'activo', true),
  ('1.1.3.02',   'Retenciones de IVA sufridas',              'activo', true),
  ('1.1.3.03',   'Percepciones de IVA sufridas',             'activo', true),
  ('1.1.3.04',   'Retenciones de Ganancias sufridas',        'activo', true),
  ('1.1.3.05',   'Retenciones de IIBB Córdoba sufridas',     'activo', true),
  ('1.1.3.06',   'Percepciones de IIBB sufridas',            'activo', true),
  ('1.1.3.07',   'Retenciones de SUSS sufridas',             'activo', true),
  ('1.1.3.08',   'Saldo a favor de IVA',                     'activo', true),
  ('1.1.4',      'Otros créditos',                           'activo', false),
  ('1.1.4.01',   'Anticipos a proveedores',                  'activo', true),
  ('1.1.4.02',   'Seguros y pólizas pagados por adelantado', 'activo', true),
  ('1.1.5',      'Bienes de cambio',                         'activo', false),
  ('1.1.5.01',   'Materiales y pinturas en depósito',        'activo', true),
  ('1.2',        'Activo no corriente',                      'activo', false),
  ('1.2.1',      'Bienes de uso',                            'activo', false),
  ('1.2.1.01',   'Rodados',                                  'activo', true),
  ('1.2.1.02',   'Maquinarias y equipos',                    'activo', true),
  ('1.2.1.03',   'Herramientas',                             'activo', true),
  ('1.2.1.04',   'Amortización acumulada bienes de uso',     'activo', true),
  ('2',          'PASIVO',                                   'pasivo', false),
  ('2.1',        'Pasivo corriente',                         'pasivo', false),
  ('2.1.1',      'Deudas comerciales',                       'pasivo', false),
  ('2.1.1.01',   'Proveedores',                              'pasivo', true),
  ('2.1.1.02',   'Cheques diferidos emitidos',               'pasivo', true),
  ('2.1.1.03',   'Anticipos de clientes (anticipo financiero de obra)', 'pasivo', true),
  ('2.1.2',      'Deudas fiscales',                          'pasivo', false),
  ('2.1.2.01',   'IVA débito fiscal',                        'pasivo', true),
  ('2.1.2.02',   'IVA a pagar',                              'pasivo', true),
  ('2.1.2.03',   'Ingresos Brutos a pagar',                  'pasivo', true),
  ('2.1.2.04',   'Impuesto a las Ganancias a pagar',         'pasivo', true),
  ('2.1.2.05',   'Tasas municipales a pagar',                'pasivo', true),
  ('2.1.3',      'Deudas sociales',                          'pasivo', false),
  ('2.1.3.01',   'Sueldos y jornales a pagar',               'pasivo', true),
  ('2.1.3.02',   'Cargas sociales a pagar',                  'pasivo', true),
  ('2.1.4',      'Otras deudas',                             'pasivo', false),
  ('2.1.4.01',   'Acreedores varios',                        'pasivo', true),
  ('3',          'PATRIMONIO NETO',                          'patrimonio_neto', false),
  ('3.1',        'Capital y resultados',                     'patrimonio_neto', false),
  ('3.1.01',     'Capital',                                  'patrimonio_neto', true),
  ('3.1.02',     'Resultados no asignados',                  'patrimonio_neto', true),
  ('3.1.03',     'Resultado del ejercicio',                  'patrimonio_neto', true),
  ('3.1.04',     'Cuenta particular del titular',            'patrimonio_neto', true),
  ('4',          'INGRESOS',                                 'ingreso', false),
  ('4.1',        'Ingresos por servicios',                   'ingreso', false),
  ('4.1.01',     'Certificados de obra / servicios viales',  'ingreso', true),
  ('4.1.02',     'Redeterminación de precios',               'ingreso', true),
  ('4.2',        'Otros ingresos',                           'ingreso', false),
  ('4.2.01',     'Intereses ganados',                        'ingreso', true),
  ('4.2.02',     'Ingresos varios',                          'ingreso', true),
  ('5',          'COSTOS DE OBRA',                           'egreso', false),
  ('5.1',        'Costos directos',                          'egreso', false),
  ('5.1.01',     'Pinturas y materiales',                    'egreso', true),
  ('5.1.02',     'Mano de obra',                             'egreso', true),
  ('5.1.03',     'Cargas sociales de obra',                  'egreso', true),
  ('5.1.04',     'Subcontratos',                             'egreso', true),
  ('5.1.05',     'Combustible',                              'egreso', true),
  ('5.1.06',     'Alquiler de equipos',                      'egreso', true),
  ('5.1.07',     'Mantenimiento de equipos y rodados',       'egreso', true),
  ('5.1.08',     'Elementos de seguridad',                   'egreso', true),
  ('5.1.09',     'Fletes y transporte',                      'egreso', true),
  ('5.1.10',     'Seguros y pólizas de obra',                'egreso', true),
  ('5.1.11',     'Herramientas y consumibles',               'egreso', true),
  ('6',          'GASTOS',                                   'egreso', false),
  ('6.1',        'Gastos de administración',                 'egreso', false),
  ('6.1.01',     'Honorarios profesionales',                 'egreso', true),
  ('6.1.02',     'Gastos de oficina',                        'egreso', true),
  ('6.1.03',     'Amortizaciones',                           'egreso', true),
  ('6.2',        'Gastos financieros e impuestos',           'egreso', false),
  ('6.2.01',     'Gastos bancarios',                         'egreso', true),
  ('6.2.02',     'Impuesto a los débitos y créditos',        'egreso', true),
  ('6.2.03',     'Ingresos Brutos',                          'egreso', true),
  ('6.2.04',     'Tasas municipales',                        'egreso', true),
  ('6.2.05',     'Intereses y recargos',                     'egreso', true);

insert into public.centros_costo (codigo, nombre, tipo) values
  ('ADM', 'Administración general', 'administracion');

insert into public.periodos (anio, mes) values (2026, 11);

-- =====================================================================
-- Auditoría activada (después de los datos iniciales)
-- =====================================================================
create trigger trg_audit_perfiles   after insert or update or delete on public.perfiles            for each row execute function public.fn_auditar();
create trigger trg_audit_empresa    after insert or update or delete on public.empresa             for each row execute function public.fn_auditar();
create trigger trg_audit_condic     after insert or update or delete on public.condiciones_iva     for each row execute function public.fn_auditar();
create trigger trg_audit_tipos      after insert or update or delete on public.tipos_comprobante   for each row execute function public.fn_auditar();
create trigger trg_audit_param      after insert or update or delete on public.parametros_fiscales for each row execute function public.fn_auditar();
create trigger trg_audit_plan       after insert or update or delete on public.plan_cuentas        for each row execute function public.fn_auditar();
create trigger trg_audit_cc         after insert or update or delete on public.centros_costo       for each row execute function public.fn_auditar();
create trigger trg_audit_periodos   after insert or update or delete on public.periodos            for each row execute function public.fn_auditar();

-- Fin de la migración 001
