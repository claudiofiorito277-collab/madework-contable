-- =====================================================================
-- MADEWORK · Sistema contable · Migración 007 · Costos de obra
-- Etapa 7 · 01/11/2026
--
-- Crea: personal (sus datos personales y su costo solo los ven el
-- administrador y el contador), tarifas con vigencia, partes diarios de
-- trabajo, vehículos y equipos con uso, combustible y mantenimiento,
-- materiales con depósitos, movimientos y stock, y costos indirectos con
-- su regla de prorrateo entre contratos.
--
-- NO liquida sueldos: solo registra el costo para la obra.
-- El costo por ítem lo calcula el sistema (js/core/costos.js) con estos datos.
--
-- Requiere las migraciones 001 a 006. Se corre UNA sola vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Personal
-- ---------------------------------------------------------------------
create table public.personal (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (trim(nombre) <> ''),
  categoria      text,
  modalidad      text not null default 'dependencia' check (modalidad in ('dependencia','monotributista','subcontratista')),
  cuadrilla      text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);
create trigger trg_personal_mod before update on public.personal for each row execute function public.fn_set_modificado();

-- Datos personales (solo administrador y contador)
create table public.personal_datos (
  id             uuid primary key default gen_random_uuid(),
  personal_id    uuid not null unique references public.personal(id),
  cuil           text check (cuil is null or cuil ~ '^\d{11}$'),
  documento      text,
  telefono       text,
  domicilio      text,
  fecha_ingreso  date,
  cbu            text,
  proveedor_id   uuid references public.proveedores(id),        -- monotributista o subcontratista que factura
  observacion    text,
  modificado_en  timestamptz not null default now()
);
create unique index personal_datos_cuil on public.personal_datos (cuil) where cuil is not null;
create trigger trg_personal_datos_mod before update on public.personal_datos for each row execute function public.fn_set_modificado();

-- Costo por hora o por jornal, con vigencia (solo administrador y contador)
create table public.personal_tarifas (
  id             uuid primary key default gen_random_uuid(),
  personal_id    uuid not null references public.personal(id),
  vigente_desde  date not null,
  costo_hora     numeric(16,2) check (costo_hora is null or costo_hora > 0),
  costo_jornal   numeric(16,2) check (costo_jornal is null or costo_jornal > 0),
  observacion    text,
  creado_por     uuid default auth.uid(),
  creado_en      timestamptz not null default now(),
  unique (personal_id, vigente_desde),
  check (costo_hora is not null or costo_jornal is not null)
);

-- ---------------------------------------------------------------------
-- Vehículos y equipos
-- ---------------------------------------------------------------------
create table public.equipos (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique check (trim(codigo) <> ''),
  nombre         text not null check (trim(nombre) <> ''),
  tipo           text not null default 'equipo' check (tipo in ('vehiculo','equipo','herramienta')),
  patente        text,
  propio         boolean not null default true,
  activo         boolean not null default true,
  observacion    text,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);
create trigger trg_equipos_mod before update on public.equipos for each row execute function public.fn_set_modificado();

create table public.equipo_tarifas (
  id             uuid primary key default gen_random_uuid(),
  equipo_id      uuid not null references public.equipos(id),
  vigente_desde  date not null,
  costo_hora     numeric(16,2) check (costo_hora is null or costo_hora > 0),
  costo_dia      numeric(16,2) check (costo_dia is null or costo_dia > 0),
  observacion    text,
  creado_por     uuid default auth.uid(),
  creado_en      timestamptz not null default now(),
  unique (equipo_id, vigente_desde),
  check (costo_hora is not null or costo_dia is not null)
);

-- Combustible y mantenimiento: control del gasto real de cada equipo
create table public.equipo_gastos (
  id                    uuid primary key default gen_random_uuid(),
  equipo_id             uuid not null references public.equipos(id),
  tipo                  text not null check (tipo in ('combustible','mantenimiento')),
  fecha                 date not null,
  descripcion           text,
  litros                numeric(12,3) check (litros is null or litros > 0),
  odometro              numeric(12,1),                 -- km u horas de motor
  importe               numeric(16,2) not null check (importe >= 0),
  contrato_id           uuid references public.contratos(id),
  comprobante_compra_id uuid references public.comprobantes_compra(id),
  proximo_service       date,
  estado                text not null default 'vigente' check (estado in ('vigente','anulado')),
  motivo                text,
  creado_por            uuid default auth.uid(),
  creado_en             timestamptz not null default now(),
  check (tipo <> 'combustible' or litros is not null),
  check (estado = 'vigente' or coalesce(trim(motivo), '') <> '')
);
create index equipo_gastos_equipo on public.equipo_gastos (equipo_id, fecha);

-- ---------------------------------------------------------------------
-- Partes diarios de trabajo
-- ---------------------------------------------------------------------
create table public.partes_diarios (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null,
  contrato_id         uuid not null references public.contratos(id),
  item_id             uuid references public.contrato_items(id),
  cuadrilla           text,
  cantidad_producida  numeric(14,3) not null default 0 check (cantidad_producida >= 0),
  observaciones       text,
  estado              text not null default 'registrado' check (estado in ('registrado','anulado')),
  motivo              text,
  creado_por          uuid default auth.uid(),
  creado_en           timestamptz not null default now(),
  check (estado = 'registrado' or coalesce(trim(motivo), '') <> '')
);
create index partes_contrato on public.partes_diarios (contrato_id, fecha);

create table public.parte_personal (
  id           uuid primary key default gen_random_uuid(),
  parte_id     uuid not null references public.partes_diarios(id),
  personal_id  uuid not null references public.personal(id),
  horas        numeric(6,2) not null default 0 check (horas >= 0 and horas <= 24),
  jornales     numeric(6,3) not null default 0 check (jornales >= 0 and jornales <= 3),
  unique (parte_id, personal_id),
  check ((horas > 0) <> (jornales > 0))
);
create table public.parte_equipos (
  id         uuid primary key default gen_random_uuid(),
  parte_id   uuid not null references public.partes_diarios(id),
  equipo_id  uuid not null references public.equipos(id),
  horas      numeric(6,2) not null default 0 check (horas >= 0 and horas <= 24),
  dias       numeric(6,3) not null default 0 check (dias >= 0 and dias <= 3),
  unique (parte_id, equipo_id),
  check ((horas > 0) <> (dias > 0))
);

-- Registra un parte con sus personas y equipos.
-- p: { fecha, contrato_id, item_id, cuadrilla, cantidad_producida, observaciones,
--      personal: [{ personal_id, horas, jornales }], equipos: [{ equipo_id, horas, dias }] }
create or replace function public.fn_registrar_parte(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_fecha date := (p->>'fecha')::date; v_ct uuid := nullif(p->>'contrato_id', '')::uuid; v_it uuid := nullif(p->>'item_id', '')::uuid;
begin
  if not public.fn_tiene_rol('administrador','contador','operador') then raise exception 'No tenés permiso para cargar partes diarios'; end if;
  if v_fecha is null then raise exception 'Falta la fecha del parte'; end if;
  if not public.fn_periodo_abierto(v_fecha) then
    raise exception 'El período % está cerrado: no se pueden registrar partes con esa fecha', to_char(v_fecha, 'MM/YYYY');
  end if;
  if v_ct is null then raise exception 'Falta el contrato'; end if;
  if v_it is not null and not exists (select 1 from public.contrato_items where id = v_it and contrato_id = v_ct) then
    raise exception 'El ítem no pertenece al contrato';
  end if;
  if jsonb_array_length(coalesce(p->'personal', '[]')) + jsonb_array_length(coalesce(p->'equipos', '[]')) = 0 then
    raise exception 'Cargá al menos una persona o un equipo';
  end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p->'personal', '[]')) e join public.personal x on x.id = (e->>'personal_id')::uuid where not x.activo) then
    raise exception 'Hay una persona dada de baja en el parte';
  end if;
  insert into public.partes_diarios (fecha, contrato_id, item_id, cuadrilla, cantidad_producida, observaciones)
  values (v_fecha, v_ct, v_it, nullif(trim(p->>'cuadrilla'), ''), coalesce(nullif(p->>'cantidad_producida', '')::numeric, 0), nullif(trim(p->>'observaciones'), ''))
  returning id into v_id;
  insert into public.parte_personal (parte_id, personal_id, horas, jornales)
  select v_id, (e->>'personal_id')::uuid, coalesce(nullif(e->>'horas', '')::numeric, 0), coalesce(nullif(e->>'jornales', '')::numeric, 0)
    from jsonb_array_elements(coalesce(p->'personal', '[]')) e;
  insert into public.parte_equipos (parte_id, equipo_id, horas, dias)
  select v_id, (e->>'equipo_id')::uuid, coalesce(nullif(e->>'horas', '')::numeric, 0), coalesce(nullif(e->>'dias', '')::numeric, 0)
    from jsonb_array_elements(coalesce(p->'equipos', '[]')) e;
  return v_id;
end $$;

create or replace function public.fn_anular_parte(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.partes_diarios;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador anulan partes'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into v from public.partes_diarios where id = p_id for update;
  if not found then raise exception 'No existe el parte'; end if;
  if v.estado = 'anulado' then raise exception 'El parte ya está anulado'; end if;
  if not public.fn_periodo_abierto(v.fecha) then raise exception 'El período % está cerrado', to_char(v.fecha, 'MM/YYYY'); end if;
  update public.partes_diarios set estado = 'anulado', motivo = p_motivo where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Materiales, depósitos y movimientos
-- ---------------------------------------------------------------------
create table public.materiales (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null unique check (trim(codigo) <> ''),
  nombre         text not null check (trim(nombre) <> ''),
  unidad         text not null check (trim(unidad) <> ''),
  categoria      text,
  stock_minimo   numeric(14,3) not null default 0 check (stock_minimo >= 0),
  activo         boolean not null default true,
  observacion    text,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);
create trigger trg_materiales_mod before update on public.materiales for each row execute function public.fn_set_modificado();

create table public.depositos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null unique check (trim(nombre) <> ''),
  tipo           text not null default 'deposito' check (tipo in ('deposito','obra')),
  contrato_id    uuid references public.contratos(id),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now(),
  check (tipo = 'deposito' or contrato_id is not null)
);
create trigger trg_depositos_mod before update on public.depositos for each row execute function public.fn_set_modificado();
insert into public.depositos (nombre, tipo) values ('Depósito central', 'deposito');

create table public.material_movimientos (
  id                    uuid primary key default gen_random_uuid(),
  fecha                 date not null,
  material_id           uuid not null references public.materiales(id),
  tipo                  text not null check (tipo in ('ingreso','consumo','transferencia','ajuste')),
  deposito_origen_id    uuid references public.depositos(id),
  deposito_destino_id   uuid references public.depositos(id),
  cantidad              numeric(14,3) not null check (cantidad > 0),
  costo_unitario        numeric(16,2) check (costo_unitario is null or costo_unitario >= 0),
  contrato_id           uuid references public.contratos(id),
  item_id               uuid references public.contrato_items(id),
  comprobante_compra_id uuid references public.comprobantes_compra(id),
  parte_id              uuid references public.partes_diarios(id),
  observacion           text,
  estado                text not null default 'vigente' check (estado in ('vigente','anulado')),
  motivo                text,
  creado_por            uuid default auth.uid(),
  creado_en             timestamptz not null default now(),
  check (tipo <> 'ingreso' or (deposito_destino_id is not null and deposito_origen_id is null and costo_unitario is not null)),
  check (tipo <> 'consumo' or (deposito_origen_id is not null and deposito_destino_id is null and contrato_id is not null)),
  check (tipo <> 'transferencia' or (deposito_origen_id is not null and deposito_destino_id is not null and deposito_origen_id <> deposito_destino_id)),
  check (tipo <> 'ajuste' or ((deposito_origen_id is null) <> (deposito_destino_id is null))),
  check (item_id is null or contrato_id is not null),
  check (estado = 'vigente' or coalesce(trim(motivo), '') <> '')
);
create index matmov_material on public.material_movimientos (material_id, fecha);
create index matmov_contrato on public.material_movimientos (contrato_id);

-- Stock de un material en un depósito (movimientos vigentes)
create or replace function public.fn_stock(p_material uuid, p_deposito uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when deposito_destino_id = p_deposito then cantidad else 0 end)
                - sum(case when deposito_origen_id = p_deposito then cantidad else 0 end), 0)
    from public.material_movimientos
   where material_id = p_material and estado = 'vigente' and p_deposito in (deposito_origen_id, deposito_destino_id)
$$;

-- Registra un movimiento de material controlando período y stock.
-- p: { fecha, material_id, tipo, deposito_origen_id, deposito_destino_id, cantidad, costo_unitario,
--      contrato_id, item_id, comprobante_compra_id, parte_id, observacion }
create or replace function public.fn_movimiento_material(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_fecha date := (p->>'fecha')::date; v_tipo text := p->>'tipo';
  v_mat uuid := nullif(p->>'material_id', '')::uuid; v_ori uuid := nullif(p->>'deposito_origen_id', '')::uuid;
  v_des uuid := nullif(p->>'deposito_destino_id', '')::uuid; v_cant numeric := nullif(p->>'cantidad', '')::numeric;
  v_ct uuid := nullif(p->>'contrato_id', '')::uuid; v_it uuid := nullif(p->>'item_id', '')::uuid; v_disp numeric;
  v_cu numeric := nullif(p->>'costo_unitario', '')::numeric;
begin
  if not public.fn_tiene_rol('administrador','contador','operador') then raise exception 'No tenés permiso para mover materiales'; end if;
  if v_tipo in ('ingreso','ajuste') and not public.fn_tiene_rol('administrador','contador') then
    raise exception 'Los ingresos y ajustes de stock los cargan el administrador o el contador';
  end if;
  if v_fecha is null then raise exception 'Falta la fecha'; end if;
  if not public.fn_periodo_abierto(v_fecha) then
    raise exception 'El período % está cerrado: no se pueden registrar movimientos con esa fecha', to_char(v_fecha, 'MM/YYYY');
  end if;
  if v_cant is null or v_cant <= 0 then raise exception 'La cantidad tiene que ser mayor que cero'; end if;
  if not exists (select 1 from public.materiales where id = v_mat and activo) then raise exception 'El material no existe o está dado de baja'; end if;
  if v_tipo = 'consumo' and v_ct is null then
    select contrato_id into v_ct from public.depositos where id = v_ori;    -- el depósito de obra sabe su contrato
  end if;
  if v_it is not null and not exists (select 1 from public.contrato_items where id = v_it and contrato_id = v_ct) then
    raise exception 'El ítem no pertenece al contrato';
  end if;
  if v_tipo = 'ajuste' and v_des is not null and v_cu is null then
    -- ajuste positivo sin costo: al costo promedio actual
    select case when sum(case when tipo in ('ingreso') or (tipo = 'ajuste' and deposito_destino_id is not null) then cantidad end) > 0
                then sum(case when tipo in ('ingreso') or (tipo = 'ajuste' and deposito_destino_id is not null) then cantidad * costo_unitario end)
                   / sum(case when tipo in ('ingreso') or (tipo = 'ajuste' and deposito_destino_id is not null) then cantidad end) end
      into v_cu from public.material_movimientos where material_id = v_mat and estado = 'vigente';
    v_cu := round(coalesce(v_cu, 0), 2);
  end if;
  if v_ori is not null then
    perform pg_advisory_xact_lock(hashtext('stock'), hashtext(v_mat::text || v_ori::text));
    v_disp := public.fn_stock(v_mat, v_ori);
    if v_cant > v_disp then raise exception 'Stock insuficiente: en ese depósito hay % y se quieren sacar %', v_disp, v_cant; end if;
  end if;
  insert into public.material_movimientos (fecha, material_id, tipo, deposito_origen_id, deposito_destino_id, cantidad, costo_unitario,
      contrato_id, item_id, comprobante_compra_id, parte_id, observacion)
  values (v_fecha, v_mat, v_tipo, v_ori, v_des, v_cant, case when v_tipo in ('ingreso','ajuste') then v_cu end,
      v_ct, v_it, nullif(p->>'comprobante_compra_id', '')::uuid, nullif(p->>'parte_id', '')::uuid, nullif(trim(p->>'observacion'), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fn_anular_movimiento_material(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.material_movimientos;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador anulan movimientos de stock'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into v from public.material_movimientos where id = p_id for update;
  if not found then raise exception 'No existe el movimiento'; end if;
  if v.estado = 'anulado' then raise exception 'El movimiento ya está anulado'; end if;
  if not public.fn_periodo_abierto(v.fecha) then raise exception 'El período % está cerrado', to_char(v.fecha, 'MM/YYYY'); end if;
  if v.deposito_destino_id is not null and public.fn_stock(v.material_id, v.deposito_destino_id) < v.cantidad then
    raise exception 'No se puede anular: ese material ya se usó o se movió del depósito de destino';
  end if;
  update public.material_movimientos set estado = 'anulado', motivo = p_motivo where id = p_id;
end $$;

-- Ingreso al stock desde una factura de compra: el costo unitario sale de la factura
-- p: { comprobante_compra_id, deposito_id, fecha, lineas: [{ material_id, cantidad, costo_unitario }] }
create or replace function public.fn_ingreso_desde_compra(p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_k public.comprobantes_compra; v_n int := 0; e jsonb;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Los ingresos de stock los cargan el administrador o el contador'; end if;
  select * into v_k from public.comprobantes_compra where id = (p->>'comprobante_compra_id')::uuid;
  if not found or v_k.estado <> 'emitido' then raise exception 'La factura de compra no existe o está anulada'; end if;
  for e in select * from jsonb_array_elements(coalesce(p->'lineas', '[]')) loop
    perform public.fn_movimiento_material(jsonb_build_object('fecha', coalesce(p->>'fecha', v_k.fecha::text), 'tipo', 'ingreso',
      'material_id', e->>'material_id', 'deposito_destino_id', p->>'deposito_id', 'cantidad', e->>'cantidad',
      'costo_unitario', e->>'costo_unitario', 'comprobante_compra_id', v_k.id, 'observacion', 'Ingreso desde compra'));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Cargá al menos un material'; end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Costos indirectos y su prorrateo
-- ---------------------------------------------------------------------
create table public.costos_indirectos (
  id                    uuid primary key default gen_random_uuid(),
  fecha                 date not null,                         -- el mes de la fecha es el período que se prorratea
  concepto              text not null check (trim(concepto) <> ''),
  categoria             text not null default 'otros' check (categoria in ('seguros','polizas','administracion','otros')),
  importe               numeric(16,2) not null check (importe > 0),
  regla                 text not null default 'costo_directo' check (regla in ('costo_directo','monto_contractual','partes_iguales','porcentajes')),
  comprobante_compra_id uuid references public.comprobantes_compra(id),
  estado                text not null default 'vigente' check (estado in ('vigente','anulado')),
  motivo                text,
  observacion           text,
  creado_por            uuid default auth.uid(),
  creado_en             timestamptz not null default now(),
  check (estado = 'vigente' or coalesce(trim(motivo), '') <> '')
);
create table public.indirecto_porcentajes (
  id           uuid primary key default gen_random_uuid(),
  indirecto_id uuid not null references public.costos_indirectos(id),
  contrato_id  uuid not null references public.contratos(id),
  porcentaje   numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 100),
  unique (indirecto_id, contrato_id)
);

-- p: { fecha, concepto, categoria, importe, regla, comprobante_compra_id, observacion, porcentajes: [{ contrato_id, porcentaje }] }
create or replace function public.fn_registrar_indirecto(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_suma numeric; v_fecha date := (p->>'fecha')::date;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador cargan costos indirectos'; end if;
  if v_fecha is null then raise exception 'Falta la fecha'; end if;
  if not public.fn_periodo_abierto(v_fecha) then raise exception 'El período % está cerrado', to_char(v_fecha, 'MM/YYYY'); end if;
  if p->>'regla' = 'porcentajes' then
    select coalesce(sum((e->>'porcentaje')::numeric), 0) into v_suma from jsonb_array_elements(coalesce(p->'porcentajes', '[]')) e;
    if v_suma <> 100 then raise exception 'Los porcentajes suman % %% (tienen que sumar 100 %%)', v_suma; end if;
  end if;
  if exists (select 1 from public.comprobante_compra_imputaciones where comprobante_id = nullif(p->>'comprobante_compra_id', '')::uuid and contrato_id is not null) then
    raise exception 'Esa factura de compra ya está imputada a un contrato: se contaría dos veces';
  end if;
  insert into public.costos_indirectos (fecha, concepto, categoria, importe, regla, comprobante_compra_id, observacion)
  values (v_fecha, p->>'concepto', coalesce(nullif(p->>'categoria', ''), 'otros'), (p->>'importe')::numeric, coalesce(nullif(p->>'regla', ''), 'costo_directo'),
          nullif(p->>'comprobante_compra_id', '')::uuid, nullif(trim(p->>'observacion'), ''))
  returning id into v_id;
  if p->>'regla' = 'porcentajes' then
    insert into public.indirecto_porcentajes (indirecto_id, contrato_id, porcentaje)
    select v_id, (e->>'contrato_id')::uuid, (e->>'porcentaje')::numeric from jsonb_array_elements(p->'porcentajes') e;
  end if;
  return v_id;
end $$;

create or replace function public.fn_anular_indirecto(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.costos_indirectos;
begin
  if not public.fn_tiene_rol('administrador','contador') then raise exception 'Solo el administrador o el contador anulan costos indirectos'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indicá el motivo de la anulación'; end if;
  select * into v from public.costos_indirectos where id = p_id for update;
  if not found or v.estado = 'anulado' then raise exception 'El costo indirecto no existe o ya está anulado'; end if;
  if not public.fn_periodo_abierto(v.fecha) then raise exception 'El período % está cerrado', to_char(v.fecha, 'MM/YYYY'); end if;
  update public.costos_indirectos set estado = 'anulado', motivo = p_motivo where id = p_id;
end $$;

-- Gastos de equipos: período abierto
create or replace function public.fn_equipo_gastos_control()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_periodo_abierto(coalesce(new.fecha, old.fecha)) then
    raise exception 'El período % está cerrado', to_char(coalesce(new.fecha, old.fecha), 'MM/YYYY');
  end if;
  if tg_op = 'UPDATE' and (new.equipo_id, new.tipo, new.fecha, new.importe, new.litros) is distinct from (old.equipo_id, old.tipo, old.fecha, old.importe, old.litros) then
    raise exception 'Un gasto registrado no se modifica: se anula y se carga de nuevo';
  end if;
  return new;
end $$;
create trigger trg_equipo_gastos_control before insert or update on public.equipo_gastos for each row execute function public.fn_equipo_gastos_control();

-- Tarifas: no se cambian una vez cargadas (se carga una nueva con otra vigencia)
create or replace function public.fn_tarifas_inmutables()
returns trigger language plpgsql as $$
begin raise exception 'Una tarifa no se modifica: cargá una nueva con la fecha desde la que rige'; end $$;
create trigger trg_ptar_inmut before update on public.personal_tarifas for each row execute function public.fn_tarifas_inmutables();
create trigger trg_etar_inmut before update on public.equipo_tarifas   for each row execute function public.fn_tarifas_inmutables();

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
create view public.v_partes with (security_invoker = true) as
select pd.*, ct.codigo as contrato_codigo, it.codigo as item_codigo, it.descripcion as item_descripcion, it.unidad as item_unidad,
       (select count(*) from public.parte_personal x where x.parte_id = pd.id) as personas,
       (select coalesce(sum(horas), 0) from public.parte_personal x where x.parte_id = pd.id) as horas,
       (select coalesce(sum(jornales), 0) from public.parte_personal x where x.parte_id = pd.id) as jornales,
       (select string_agg(e.nombre, ', ' order by e.nombre) from public.parte_equipos x join public.equipos e on e.id = x.equipo_id where x.parte_id = pd.id) as equipos,
       pf.email as cargado_por
  from public.partes_diarios pd
  join public.contratos ct on ct.id = pd.contrato_id
  left join public.contrato_items it on it.id = pd.item_id
  left join public.perfiles pf on pf.id = pd.creado_por;

create view public.v_stock with (security_invoker = true) as
select m.id as material_id, m.codigo, m.nombre, m.unidad, m.categoria, m.stock_minimo, d.id as deposito_id, d.nombre as deposito, d.tipo as deposito_tipo,
       sum(case when mv.deposito_destino_id = d.id then mv.cantidad else -mv.cantidad end) as cantidad
  from public.material_movimientos mv
  join public.materiales m on m.id = mv.material_id
  join public.depositos d on d.id in (mv.deposito_origen_id, mv.deposito_destino_id)
 where mv.estado = 'vigente'
 group by m.id, d.id;

create view public.v_material_movimientos with (security_invoker = true) as
select mv.*, m.codigo as material_codigo, m.nombre as material, m.unidad, o.nombre as deposito_origen, d.nombre as deposito_destino,
       ct.codigo as contrato_codigo, it.codigo as item_codigo, it.descripcion as item_descripcion
  from public.material_movimientos mv
  join public.materiales m on m.id = mv.material_id
  left join public.depositos o on o.id = mv.deposito_origen_id
  left join public.depositos d on d.id = mv.deposito_destino_id
  left join public.contratos ct on ct.id = mv.contrato_id
  left join public.contrato_items it on it.id = mv.item_id;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table public.personal               enable row level security;
alter table public.personal_datos         enable row level security;
alter table public.personal_tarifas       enable row level security;
alter table public.equipos                enable row level security;
alter table public.equipo_tarifas         enable row level security;
alter table public.equipo_gastos          enable row level security;
alter table public.partes_diarios         enable row level security;
alter table public.parte_personal         enable row level security;
alter table public.parte_equipos          enable row level security;
alter table public.materiales             enable row level security;
alter table public.depositos              enable row level security;
alter table public.material_movimientos   enable row level security;
alter table public.costos_indirectos      enable row level security;
alter table public.indirecto_porcentajes  enable row level security;

-- Todos los usuarios activos ven el nombre del personal, los equipos, materiales, partes y movimientos
create policy per_ver on public.personal             for select to authenticated using (public.fn_rol() is not null);
create policy equ_ver on public.equipos              for select to authenticated using (public.fn_rol() is not null);
create policy egs_ver on public.equipo_gastos        for select to authenticated using (public.fn_rol() is not null);
create policy pd_ver  on public.partes_diarios       for select to authenticated using (public.fn_rol() is not null);
create policy pp_ver  on public.parte_personal       for select to authenticated using (public.fn_rol() is not null);
create policy pe_ver  on public.parte_equipos        for select to authenticated using (public.fn_rol() is not null);
create policy mat_ver on public.materiales           for select to authenticated using (public.fn_rol() is not null);
create policy dep_ver on public.depositos            for select to authenticated using (public.fn_rol() is not null);
create policy mmv_ver on public.material_movimientos for select to authenticated using (public.fn_rol() is not null);
create policy ind_ver on public.costos_indirectos    for select to authenticated using (public.fn_rol() is not null);
create policy inp_ver on public.indirecto_porcentajes for select to authenticated using (public.fn_rol() is not null);
-- Datos personales y costos: solo administrador y contador
create policy pdat_ver on public.personal_datos   for select to authenticated using (public.fn_tiene_rol('administrador','contador'));
create policy ptar_ver on public.personal_tarifas for select to authenticated using (public.fn_tiene_rol('administrador','contador'));
create policy etar_ver on public.equipo_tarifas   for select to authenticated using (public.fn_tiene_rol('administrador','contador'));

-- Altas y cambios de catálogos: administrador y contador
create policy per_alta  on public.personal       for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy per_mod   on public.personal       for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy pdat_alta on public.personal_datos for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy pdat_mod  on public.personal_datos for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy ptar_alta on public.personal_tarifas for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy equ_alta  on public.equipos        for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy equ_mod   on public.equipos        for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy etar_alta on public.equipo_tarifas for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy mat_alta  on public.materiales     for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy mat_mod   on public.materiales     for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy dep_alta  on public.depositos      for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy dep_mod   on public.depositos      for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
-- Combustible y mantenimiento: también el operador (carga desde la obra); anular, administrador y contador
create policy egs_alta on public.equipo_gastos for insert to authenticated
  with check (public.fn_tiene_rol('administrador','contador','operador') and estado = 'vigente');
create policy egs_mod  on public.equipo_gastos for update to authenticated
  using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

-- Partes, movimientos de stock e indirectos: solo por las funciones
revoke insert, update, delete, truncate on public.partes_diarios, public.parte_personal, public.parte_equipos,
  public.material_movimientos, public.costos_indirectos, public.indirecto_porcentajes from anon, authenticated;
revoke update, delete, truncate on public.personal_tarifas, public.equipo_tarifas from anon, authenticated;
revoke delete, truncate on public.personal, public.personal_datos, public.equipos, public.equipo_gastos, public.materiales, public.depositos from anon, authenticated;
revoke all on public.personal, public.personal_datos, public.personal_tarifas, public.equipos, public.equipo_tarifas, public.equipo_gastos,
  public.partes_diarios, public.parte_personal, public.parte_equipos, public.materiales, public.depositos, public.material_movimientos,
  public.costos_indirectos, public.indirecto_porcentajes, public.v_partes, public.v_stock, public.v_material_movimientos from anon;

revoke execute on function public.fn_stock(uuid, uuid) from public, anon;
grant execute on function public.fn_stock(uuid, uuid) to authenticated;
revoke execute on function public.fn_registrar_parte(jsonb), public.fn_anular_parte(uuid, text), public.fn_movimiento_material(jsonb),
  public.fn_anular_movimiento_material(uuid, text), public.fn_ingreso_desde_compra(jsonb), public.fn_registrar_indirecto(jsonb),
  public.fn_anular_indirecto(uuid, text) from public, anon;
grant execute on function public.fn_registrar_parte(jsonb), public.fn_anular_parte(uuid, text), public.fn_movimiento_material(jsonb),
  public.fn_anular_movimiento_material(uuid, text), public.fn_ingreso_desde_compra(jsonb), public.fn_registrar_indirecto(jsonb),
  public.fn_anular_indirecto(uuid, text) to authenticated;

-- =====================================================================
-- Auditoría
-- =====================================================================
create trigger trg_audit_personal  after insert or update or delete on public.personal             for each row execute function public.fn_auditar();
create trigger trg_audit_pdatos    after insert or update or delete on public.personal_datos       for each row execute function public.fn_auditar();
create trigger trg_audit_ptarifas  after insert or update or delete on public.personal_tarifas     for each row execute function public.fn_auditar();
create trigger trg_audit_equipos   after insert or update or delete on public.equipos              for each row execute function public.fn_auditar();
create trigger trg_audit_etarifas  after insert or update or delete on public.equipo_tarifas       for each row execute function public.fn_auditar();
create trigger trg_audit_egastos   after insert or update or delete on public.equipo_gastos        for each row execute function public.fn_auditar();
create trigger trg_audit_partes    after insert or update or delete on public.partes_diarios       for each row execute function public.fn_auditar();
create trigger trg_audit_pperso    after insert or update or delete on public.parte_personal       for each row execute function public.fn_auditar();
create trigger trg_audit_pequi     after insert or update or delete on public.parte_equipos        for each row execute function public.fn_auditar();
create trigger trg_audit_mat       after insert or update or delete on public.materiales           for each row execute function public.fn_auditar();
create trigger trg_audit_dep       after insert or update or delete on public.depositos            for each row execute function public.fn_auditar();
create trigger trg_audit_matmov    after insert or update or delete on public.material_movimientos for each row execute function public.fn_auditar();
create trigger trg_audit_indir     after insert or update or delete on public.costos_indirectos    for each row execute function public.fn_auditar();
create trigger trg_audit_indpct    after insert or update or delete on public.indirecto_porcentajes for each row execute function public.fn_auditar();

-- Fin de la migración 007
