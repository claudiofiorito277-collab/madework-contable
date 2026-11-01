-- =====================================================================
-- MADEWORK · Sistema contable · Migración 002 · Contratos y certificados
-- Etapa 2 · 01/11/2026
--
-- Crea: clientes, contratos, ítems, tramos, registro de avance por unidad
-- (planilla de columnas), redeterminaciones, certificados, multas, pólizas
-- y adjuntos (con almacenamiento de archivos en Supabase Storage).
--
-- Requiere la migración 001. Se corre UNA sola vez.
-- Importes en pesos con 2 decimales. Cantidades con hasta 3 decimales.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Clientes
-- ---------------------------------------------------------------------
create table public.clientes (
  id             uuid primary key default gen_random_uuid(),
  razon_social   text not null,
  cuit           text unique check (cuit is null or public.fn_cuit_valido(cuit)),
  condicion_iva  text not null default 'RI' references public.condiciones_iva(codigo),
  domicilio      text,
  localidad      text,
  provincia      text default 'Córdoba',
  email          text,
  telefono       text,
  contacto       text,
  observacion    text,
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  modificado_en  timestamptz not null default now()
);
create trigger trg_clientes_mod before update on public.clientes for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Contratos
-- ---------------------------------------------------------------------
create table public.contratos (
  id                        uuid primary key default gen_random_uuid(),
  codigo                    text not null unique,
  cliente_id                uuid not null references public.clientes(id),
  descripcion               text not null,
  tipo_trabajo              text not null default 'pintura_columnas'
                            check (tipo_trabajo in ('pintura_columnas','bacheo','reparacion_calzada','senalizacion','mantenimiento','otro')),
  numero_concurso           text,
  numero_contrato           text,
  orden_compra              text,
  expediente                text,
  ruta                      text,
  tramo                     text,
  km_desde                  numeric(8,3),
  km_hasta                  numeric(8,3),
  localidad                 text,
  sistema_contratacion      text not null default 'unidad_medida' check (sistema_contratacion in ('unidad_medida','ajuste_alzado')),
  estado                    text not null default 'adjudicado'
                            check (estado in ('en_oferta','adjudicado','en_ejecucion','suspendido','recepcion_provisoria','finalizado','rescindido')),
  fecha_oferta              date,
  fecha_adjudicacion        date,
  fecha_firma               date,
  fecha_acta_replanteo      date,
  plazo_dias                integer check (plazo_dias is null or plazo_dias > 0),
  fecha_recepcion_provisoria date,
  plazo_garantia_dias       integer not null default 365,
  fecha_recepcion_definitiva date,
  representante_tecnico     text,
  inspector                 text,
  presupuesto_oficial       numeric(16,2),
  alicuota_iva              text not null default 'IVA_21',
  periodicidad_certificacion text not null default 'semanal' check (periodicidad_certificacion in ('semanal','quincenal','mensual','por_avance')),
  pago_dias                 integer not null default 15 check (pago_dias >= 0),
  pago_dia_semana           smallint check (pago_dia_semana is null or pago_dia_semana between 0 and 6),  -- 5 = viernes
  fondo_reparo_pct          numeric(6,3) not null default 0 check (fondo_reparo_pct between 0 and 100),
  fr_en_factura             boolean not null default false,
  anticipo_pct              numeric(6,3) not null default 0 check (anticipo_pct between 0 and 100),
  anticipo_monto            numeric(16,2) not null default 0 check (anticipo_monto >= 0),
  anticipo_fecha            date,
  anticipo_descuento_pct    numeric(6,3) not null default 0 check (anticipo_descuento_pct between 0 and 100),
  anticipo_en_factura       boolean not null default true,
  multas_en_factura         boolean not null default false,
  multa_unidad              text default 'litros de nafta YPF Premium (precio ACA Córdoba)',
  centro_costo_id           uuid references public.centros_costo(id),
  observaciones             text,
  activo                    boolean not null default true,
  creado_en                 timestamptz not null default now(),
  modificado_en             timestamptz not null default now(),
  check (km_hasta is null or km_desde is null or km_hasta >= km_desde)
);
create trigger trg_contratos_mod before update on public.contratos for each row execute function public.fn_set_modificado();

-- Ítems del contrato, con presupuesto de costo por unidad para medir el margen esperado
create table public.contrato_items (
  id                 uuid primary key default gen_random_uuid(),
  contrato_id        uuid not null references public.contratos(id),
  codigo             text not null,
  descripcion        text not null,
  unidad             text not null,
  cantidad           numeric(14,3) not null check (cantidad >= 0),
  precio_unitario    numeric(16,2) not null check (precio_unitario >= 0),
  costo_mano_obra    numeric(16,2) not null default 0,
  costo_materiales   numeric(16,2) not null default 0,
  costo_equipos      numeric(16,2) not null default 0,
  costo_subcontratos numeric(16,2) not null default 0,
  costo_otros        numeric(16,2) not null default 0,
  orden              integer not null default 1,
  centro_costo_id    uuid references public.centros_costo(id),
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  modificado_en      timestamptz not null default now(),
  unique (contrato_id, codigo)
);
create trigger trg_items_mod before update on public.contrato_items for each row execute function public.fn_set_modificado();

-- Tramos de obra (para planificar y medir avance por sector)
create table public.contrato_tramos (
  id                 uuid primary key default gen_random_uuid(),
  contrato_id        uuid not null references public.contratos(id),
  orden              integer not null default 1,
  nombre             text not null,
  cantidad_prevista  numeric(14,3) not null default 0,
  observacion        text,
  activo             boolean not null default true,
  creado_en          timestamptz not null default now(),
  modificado_en      timestamptz not null default now(),
  unique (contrato_id, nombre)
);
create trigger trg_tramos_mod before update on public.contrato_tramos for each row execute function public.fn_set_modificado();

-- Centros de costo automáticos para contratos e ítems
create or replace function public.fn_contrato_centro_costo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_cod text;
begin
  if tg_table_name = 'contratos' then
    if new.centro_costo_id is null then
      insert into public.centros_costo (codigo, nombre, tipo)
      values (new.codigo, left('Contrato ' || new.descripcion, 120), 'contrato')
      on conflict (codigo) do update set nombre = excluded.nombre
      returning id into v_id;
      update public.contratos set centro_costo_id = v_id where id = new.id;
    end if;
  else
    if new.centro_costo_id is null then
      select codigo into v_cod from public.contratos where id = new.contrato_id;
      insert into public.centros_costo (codigo, nombre, tipo)
      values (v_cod || '-' || new.codigo, left(v_cod || ' · ' || new.descripcion, 120), 'item')
      on conflict (codigo) do update set nombre = excluded.nombre
      returning id into v_id;
      update public.contrato_items set centro_costo_id = v_id where id = new.id;
    end if;
  end if;
  return null;
end $$;
create trigger trg_contrato_cc after insert on public.contratos for each row execute function public.fn_contrato_centro_costo();
create trigger trg_item_cc after insert on public.contrato_items for each row execute function public.fn_contrato_centro_costo();

-- ---------------------------------------------------------------------
-- Redeterminaciones de precio
-- ---------------------------------------------------------------------
create table public.redeterminaciones (
  id              uuid primary key default gen_random_uuid(),
  contrato_id     uuid not null references public.contratos(id),
  numero          integer not null,
  fecha_vigencia  date not null,
  factor          numeric(12,6) check (factor is null or factor > 0),
  referencia      text,
  estado          text not null default 'borrador' check (estado in ('borrador','aprobada','anulada')),
  observacion     text,
  creado_en       timestamptz not null default now(),
  modificado_en   timestamptz not null default now(),
  unique (contrato_id, numero)
);
create trigger trg_redet_mod before update on public.redeterminaciones for each row execute function public.fn_set_modificado();

create table public.redeterminacion_precios (
  id                 uuid primary key default gen_random_uuid(),
  redeterminacion_id uuid not null references public.redeterminaciones(id),
  item_id            uuid not null references public.contrato_items(id),
  precio_unitario    numeric(16,2) not null check (precio_unitario >= 0),
  unique (redeterminacion_id, item_id)
);

-- ---------------------------------------------------------------------
-- Certificados de avance
-- ---------------------------------------------------------------------
create table public.certificados (
  id                    uuid primary key default gen_random_uuid(),
  contrato_id           uuid not null references public.contratos(id),
  numero                integer,
  periodo_desde         date not null,
  periodo_hasta         date not null,
  fecha_emision         date not null default current_date,
  estado                text not null default 'borrador'
                        check (estado in ('borrador','presentado','observado','aprobado','facturado','cobrado','anulado')),
  motivo                text,
  bruto                 numeric(16,2) not null default 0,
  fondo_reparo          numeric(16,2) not null default 0 check (fondo_reparo >= 0),
  descuento_anticipo    numeric(16,2) not null default 0 check (descuento_anticipo >= 0),
  multas                numeric(16,2) not null default 0 check (multas >= 0),
  base_factura          numeric(16,2) not null default 0,
  iva                   numeric(16,2) not null default 0,
  total_factura         numeric(16,2) not null default 0,
  neto_a_cobrar         numeric(16,2) not null default 0,
  fecha_presentacion    date,
  fecha_aprobacion      date,
  observacion           text,
  creado_en             timestamptz not null default now(),
  modificado_en         timestamptz not null default now(),
  check (periodo_hasta >= periodo_desde),
  check (total_factura = base_factura + iva),
  unique (contrato_id, numero)
);
create trigger trg_cert_mod before update on public.certificados for each row execute function public.fn_set_modificado();

create table public.certificado_items (
  id                  uuid primary key default gen_random_uuid(),
  certificado_id      uuid not null references public.certificados(id),
  item_id             uuid not null references public.contrato_items(id),
  cantidad            numeric(14,3) not null check (cantidad > 0),
  precio_unitario     numeric(16,2) not null check (precio_unitario >= 0),
  importe             numeric(16,2) not null,
  cantidad_anterior   numeric(14,3) not null default 0,
  unique (certificado_id, item_id)
);

-- Número correlativo por contrato y control de estados
create or replace function public.fn_certificados_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_permitidos text[];
  v_suma numeric(16,2);
  v_mal integer;
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' then raise exception 'Un certificado nuevo tiene que empezar en borrador'; end if;
    perform pg_advisory_xact_lock(hashtext(new.contrato_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from public.certificados where contrato_id = new.contrato_id;
    return new;
  end if;

  if new.numero <> old.numero or new.contrato_id <> old.contrato_id then
    raise exception 'No se puede cambiar el número ni el contrato de un certificado';
  end if;

  -- Solo un borrador se puede editar
  if old.estado <> 'borrador' and (
       new.bruto <> old.bruto or new.fondo_reparo <> old.fondo_reparo or new.descuento_anticipo <> old.descuento_anticipo
       or new.multas <> old.multas or new.base_factura <> old.base_factura or new.iva <> old.iva
       or new.periodo_desde <> old.periodo_desde or new.periodo_hasta <> old.periodo_hasta) then
    raise exception 'El certificado N° % está %: solo se pueden modificar importes en borrador', old.numero, old.estado;
  end if;

  if new.estado <> old.estado then
    v_permitidos := case old.estado
      when 'borrador'   then array['presentado','anulado']
      when 'presentado' then array['observado','aprobado','anulado']
      when 'observado'  then array['borrador','presentado','anulado']
      when 'aprobado'   then array['facturado','anulado']
      when 'facturado'  then array['cobrado']
      else array[]::text[] end;
    if not new.estado = any(v_permitidos) then
      raise exception 'No se puede pasar un certificado de "%" a "%"', old.estado, new.estado;
    end if;
    if new.estado in ('aprobado','facturado','cobrado','anulado') and not public.fn_tiene_rol('administrador','contador') then
      raise exception 'Solo el administrador o el contador pueden marcar un certificado como %', new.estado;
    end if;
    if new.estado in ('anulado','observado') and coalesce(trim(new.motivo), '') = '' then
      raise exception 'Indicá el motivo para marcar el certificado como %', new.estado;
    end if;
    if new.estado = 'presentado' then
      -- Verificación: el bruto coincide con la suma de los ítems y cada importe con cantidad × precio
      select coalesce(sum(importe), 0),
             count(*) filter (where importe <> round(cantidad * precio_unitario, 2))
        into v_suma, v_mal
        from public.certificado_items where certificado_id = new.id;
      if v_suma = 0 then raise exception 'El certificado no tiene ítems'; end if;
      if v_mal > 0 then raise exception 'Hay ítems cuyo importe no coincide con cantidad × precio'; end if;
      if v_suma <> new.bruto then raise exception 'El bruto (%) no coincide con la suma de los ítems (%)', new.bruto, v_suma; end if;
      new.fecha_presentacion := coalesce(new.fecha_presentacion, current_date);
    end if;
    if new.estado = 'aprobado' then new.fecha_aprobacion := coalesce(new.fecha_aprobacion, current_date); end if;
  end if;
  return new;
end $$;
create trigger trg_cert_control before insert or update on public.certificados for each row execute function public.fn_certificados_control();

-- Los ítems solo cambian mientras el certificado está en borrador
create or replace function public.fn_cert_items_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  select estado into v_estado from public.certificados where id = coalesce(new.certificado_id, old.certificado_id);
  if v_estado <> 'borrador' then
    raise exception 'El certificado está %: sus ítems ya no se pueden modificar', v_estado;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_cert_items_control before insert or update or delete on public.certificado_items
  for each row execute function public.fn_cert_items_control();

-- ---------------------------------------------------------------------
-- Registro de avance por unidad (planilla de columnas del pliego)
-- ---------------------------------------------------------------------
create table public.avance_unidades (
  id                uuid primary key default gen_random_uuid(),
  contrato_id       uuid not null references public.contratos(id),
  item_id           uuid not null references public.contrato_items(id),
  tramo_id          uuid references public.contrato_tramos(id),
  identificador     text not null,                 -- N° o código de la columna
  progresiva_km     numeric(8,3),
  lado              text,
  ubicacion         text,
  cantidad          numeric(14,3) not null default 1 check (cantidad > 0),
  fecha_ejecucion   date,
  estado            text not null default 'ejecutada' check (estado in ('pendiente','ejecutada','aprobada','observada','rechazada')),
  inspector         text,
  fecha_aprobacion  date,
  certificado_id    uuid references public.certificados(id),
  observacion       text,
  creado_en         timestamptz not null default now(),
  modificado_en     timestamptz not null default now(),
  unique (contrato_id, item_id, identificador),
  check (estado <> 'aprobada' or fecha_aprobacion is not null)
);
create index avance_contrato_estado on public.avance_unidades (contrato_id, estado);
create trigger trg_avance_mod before update on public.avance_unidades for each row execute function public.fn_set_modificado();

create or replace function public.fn_avance_control()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  -- Una unidad ya certificada (en un certificado no borrador) no se modifica
  if tg_op in ('UPDATE','DELETE') and old.certificado_id is not null then
    select estado into v_estado from public.certificados where id = old.certificado_id;
    if v_estado not in ('borrador','anulado') then
      if tg_op = 'DELETE' or new.certificado_id is distinct from old.certificado_id or new.estado <> old.estado
         or new.cantidad <> old.cantidad or new.item_id <> old.item_id then
        raise exception 'La unidad % ya está en el certificado (estado %): no se puede modificar', old.identificador, v_estado;
      end if;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.certificado_id is not null and new.certificado_id is distinct from old.certificado_id then
    if new.estado <> 'aprobada' then raise exception 'Solo se certifican unidades aprobadas por la inspección'; end if;
    select estado into v_estado from public.certificados where id = new.certificado_id;
    if v_estado <> 'borrador' then raise exception 'Solo se pueden agregar unidades a un certificado en borrador'; end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger trg_avance_control before insert or update or delete on public.avance_unidades
  for each row execute function public.fn_avance_control();

-- Al anular un certificado o volverlo a borrador, sus unidades quedan libres
create or replace function public.fn_cert_libera_unidades()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'anulado' and old.estado <> 'anulado' then
    update public.avance_unidades set certificado_id = null where certificado_id = new.id;
  end if;
  return null;
end $$;
create trigger trg_cert_libera after update on public.certificados for each row execute function public.fn_cert_libera_unidades();

-- ---------------------------------------------------------------------
-- Multas (el pliego las expresa en litros de nafta Premium)
-- ---------------------------------------------------------------------
create table public.multas (
  id               uuid primary key default gen_random_uuid(),
  contrato_id      uuid not null references public.contratos(id),
  certificado_id   uuid references public.certificados(id),
  fecha            date not null,
  motivo           text not null check (motivo in ('demora_inicio','demora_plazo','orden_servicio','otra')),
  referencia       text,                       -- N° de orden de servicio, nota, etc.
  dias             integer,
  litros           numeric(12,3),
  precio_litro     numeric(16,2),
  importe          numeric(16,2) not null check (importe >= 0),
  estado           text not null default 'aplicada' check (estado in ('aplicada','descontada','anulada')),
  observacion      text,
  creado_en        timestamptz not null default now(),
  modificado_en    timestamptz not null default now()
);
create trigger trg_multas_mod before update on public.multas for each row execute function public.fn_set_modificado();

-- ---------------------------------------------------------------------
-- Pólizas y garantías
-- ---------------------------------------------------------------------
create table public.polizas (
  id               uuid primary key default gen_random_uuid(),
  contrato_id      uuid references public.contratos(id),   -- null = general (ART, vida, etc.)
  tipo             text not null check (tipo in ('responsabilidad_civil','caucion_anticipo','caucion_cumplimiento','caucion_oferta','art','vida_obligatorio','accidentes_personales','tecnico_equipos','automotor','otro')),
  aseguradora      text not null,
  numero           text,
  suma_asegurada   numeric(16,2),
  franquicia       numeric(16,2),
  vigencia_desde   date,
  vigencia_hasta   date,
  costo            numeric(16,2),
  estado           text not null default 'vigente' check (estado in ('solicitada','vigente','vencida','anulada')),
  observacion      text,
  creado_en        timestamptz not null default now(),
  modificado_en    timestamptz not null default now(),
  check (vigencia_hasta is null or vigencia_desde is null or vigencia_hasta >= vigencia_desde)
);
create trigger trg_polizas_mod before update on public.polizas for each row execute function public.fn_set_modificado();

insert into public.parametros_fiscales (tipo, codigo, descripcion, valor, unidad, vigente_desde, a_confirmar, observacion)
values ('ALERTA', 'POLIZA_DIAS_AVISO', 'Días de anticipación para avisar vencimientos de pólizas', 15, 'días', '2026-11-01', false, null);

-- ---------------------------------------------------------------------
-- Adjuntos (archivos en Supabase Storage, carpeta privada "adjuntos")
-- ---------------------------------------------------------------------
create table public.adjuntos (
  id             uuid primary key default gen_random_uuid(),
  tabla          text not null check (tabla in ('contratos','certificados','polizas','multas','avance_unidades','redeterminaciones','clientes')),
  registro_id    uuid not null,
  nombre         text not null,
  ruta           text not null unique,
  tipo_mime      text,
  tamano         bigint,
  descripcion    text,
  subido_por     uuid default auth.uid(),
  creado_en      timestamptz not null default now()
);
create index adjuntos_registro on public.adjuntos (tabla, registro_id);

insert into storage.buckets (id, name, public) values ('adjuntos', 'adjuntos', false) on conflict (id) do nothing;
create policy adjuntos_archivos_ver on storage.objects for select to authenticated
  using (bucket_id = 'adjuntos' and public.fn_rol() is not null);
create policy adjuntos_archivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'adjuntos' and public.fn_tiene_rol('administrador','contador','operador'));

-- ---------------------------------------------------------------------
-- Vista resumen de contratos (respeta los permisos de quien consulta)
-- ---------------------------------------------------------------------
create view public.v_contratos with (security_invoker = true) as
select c.*,
       cl.razon_social as cliente,
       coalesce(i.monto, 0)            as monto_contractual,
       coalesce(i.cantidad, 0)         as cantidad_contratada,
       coalesce(ce.bruto, 0)           as certificado_bruto,
       coalesce(ce.cantidad, 0)        as cantidad_certificada,
       coalesce(ce.anticipo, 0)        as anticipo_descontado,
       c.anticipo_monto - coalesce(ce.anticipo, 0) as anticipo_pendiente,
       case when c.fecha_acta_replanteo is not null and c.plazo_dias is not null
            then c.fecha_acta_replanteo + c.plazo_dias end as fecha_fin_prevista,
       coalesce(av.aprobadas_sin_certificar, 0) as unidades_por_certificar
  from public.contratos c
  join public.clientes cl on cl.id = c.cliente_id
  left join (select contrato_id, sum(round(cantidad * precio_unitario, 2)) monto, sum(cantidad) cantidad
               from public.contrato_items where activo group by contrato_id) i on i.contrato_id = c.id
  left join (select ce.contrato_id, sum(ce.bruto) bruto, sum(ce.descuento_anticipo) anticipo,
                    sum((select coalesce(sum(ci.cantidad), 0) from public.certificado_items ci where ci.certificado_id = ce.id)) cantidad
               from public.certificados ce
              where ce.estado in ('presentado','observado','aprobado','facturado','cobrado')
              group by ce.contrato_id) ce on ce.contrato_id = c.id
  left join (select contrato_id, sum(cantidad) aprobadas_sin_certificar
               from public.avance_unidades where estado = 'aprobada' and certificado_id is null
              group by contrato_id) av on av.contrato_id = c.id;

-- =====================================================================
-- Seguridad
-- =====================================================================
alter table public.clientes               enable row level security;
alter table public.contratos              enable row level security;
alter table public.contrato_items         enable row level security;
alter table public.contrato_tramos        enable row level security;
alter table public.redeterminaciones      enable row level security;
alter table public.redeterminacion_precios enable row level security;
alter table public.certificados           enable row level security;
alter table public.certificado_items      enable row level security;
alter table public.avance_unidades        enable row level security;
alter table public.multas                 enable row level security;
alter table public.polizas                enable row level security;
alter table public.adjuntos               enable row level security;

-- Lectura: todo usuario activo
create policy clientes_ver   on public.clientes               for select to authenticated using (public.fn_rol() is not null);
create policy contratos_ver  on public.contratos              for select to authenticated using (public.fn_rol() is not null);
create policy items_ver      on public.contrato_items         for select to authenticated using (public.fn_rol() is not null);
create policy tramos_ver     on public.contrato_tramos        for select to authenticated using (public.fn_rol() is not null);
create policy redet_ver      on public.redeterminaciones      for select to authenticated using (public.fn_rol() is not null);
create policy redetp_ver     on public.redeterminacion_precios for select to authenticated using (public.fn_rol() is not null);
create policy cert_ver       on public.certificados           for select to authenticated using (public.fn_rol() is not null);
create policy certi_ver      on public.certificado_items      for select to authenticated using (public.fn_rol() is not null);
create policy avance_ver     on public.avance_unidades        for select to authenticated using (public.fn_rol() is not null);
create policy multas_ver     on public.multas                 for select to authenticated using (public.fn_rol() is not null);
create policy polizas_ver    on public.polizas                for select to authenticated using (public.fn_rol() is not null);
create policy adjuntos_ver   on public.adjuntos               for select to authenticated using (public.fn_rol() is not null);

-- Condiciones del contrato: administrador y contador
create policy clientes_alta  on public.clientes  for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy clientes_mod   on public.clientes  for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy contratos_alta on public.contratos for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy contratos_mod  on public.contratos for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy items_alta     on public.contrato_items for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy items_mod      on public.contrato_items for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy redet_alta     on public.redeterminaciones for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy redet_mod      on public.redeterminaciones for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy redetp_alta    on public.redeterminacion_precios for insert to authenticated with check (public.fn_tiene_rol('administrador','contador'));
create policy redetp_mod     on public.redeterminacion_precios for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));

-- Operación de obra: administrador, contador y operador
create policy tramos_alta    on public.contrato_tramos for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy tramos_mod     on public.contrato_tramos for update to authenticated using (public.fn_tiene_rol('administrador','contador','operador')) with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy avance_alta    on public.avance_unidades for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy avance_mod     on public.avance_unidades for update to authenticated using (public.fn_tiene_rol('administrador','contador','operador')) with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy avance_borrar  on public.avance_unidades for delete to authenticated using (public.fn_tiene_rol('administrador') and certificado_id is null);
create policy cert_alta      on public.certificados for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy cert_mod       on public.certificados for update to authenticated using (public.fn_tiene_rol('administrador','contador','operador')) with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy certi_alta     on public.certificado_items for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy certi_mod      on public.certificado_items for update to authenticated using (public.fn_tiene_rol('administrador','contador','operador')) with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy certi_borrar   on public.certificado_items for delete to authenticated using (public.fn_tiene_rol('administrador','contador','operador'));
create policy multas_alta    on public.multas  for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy multas_mod     on public.multas  for update to authenticated using (public.fn_tiene_rol('administrador','contador')) with check (public.fn_tiene_rol('administrador','contador'));
create policy polizas_alta   on public.polizas for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy polizas_mod    on public.polizas for update to authenticated using (public.fn_tiene_rol('administrador','contador','operador')) with check (public.fn_tiene_rol('administrador','contador','operador'));
create policy adjuntos_alta  on public.adjuntos for insert to authenticated with check (public.fn_tiene_rol('administrador','contador','operador'));

-- Sin borrado físico (salvo ítems de un certificado en borrador y unidades sin certificar, por el administrador)
revoke delete, truncate on public.clientes, public.contratos, public.contrato_items, public.contrato_tramos,
  public.redeterminaciones, public.redeterminacion_precios, public.certificados, public.multas,
  public.polizas, public.adjuntos from anon, authenticated;
revoke truncate on public.certificado_items, public.avance_unidades from anon, authenticated;
revoke all on public.clientes, public.contratos, public.contrato_items, public.contrato_tramos,
  public.redeterminaciones, public.redeterminacion_precios, public.certificados, public.certificado_items,
  public.avance_unidades, public.multas, public.polizas, public.adjuntos, public.v_contratos from anon;

-- =====================================================================
-- Auditoría
-- =====================================================================
create trigger trg_audit_clientes  after insert or update or delete on public.clientes               for each row execute function public.fn_auditar();
create trigger trg_audit_contratos after insert or update or delete on public.contratos              for each row execute function public.fn_auditar();
create trigger trg_audit_items     after insert or update or delete on public.contrato_items         for each row execute function public.fn_auditar();
create trigger trg_audit_tramos    after insert or update or delete on public.contrato_tramos        for each row execute function public.fn_auditar();
create trigger trg_audit_redet     after insert or update or delete on public.redeterminaciones      for each row execute function public.fn_auditar();
create trigger trg_audit_redetp    after insert or update or delete on public.redeterminacion_precios for each row execute function public.fn_auditar();
create trigger trg_audit_cert      after insert or update or delete on public.certificados           for each row execute function public.fn_auditar();
create trigger trg_audit_certi     after insert or update or delete on public.certificado_items      for each row execute function public.fn_auditar();
create trigger trg_audit_avance    after insert or update or delete on public.avance_unidades        for each row execute function public.fn_auditar();
create trigger trg_audit_multas    after insert or update or delete on public.multas                 for each row execute function public.fn_auditar();
create trigger trg_audit_polizas   after insert or update or delete on public.polizas                for each row execute function public.fn_auditar();
create trigger trg_audit_adjuntos  after insert or update or delete on public.adjuntos               for each row execute function public.fn_auditar();

-- Fin de la migración 002
