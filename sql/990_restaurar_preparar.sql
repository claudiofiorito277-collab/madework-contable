-- =====================================================================
-- MADEWORK · Sistema contable · Preparar una base NUEVA para restaurar un respaldo
--
-- Se usa SOLO en un proyecto de Supabase nuevo, después de correr las
-- migraciones 001 a 008: vacía las tablas que las migraciones llenan con
-- datos iniciales (plan de cuentas, parámetros, empresa...) para que el
-- respaldo entre completo y sin duplicados. Ver docs/RESPALDOS.md.
--
-- NO correr en la base que está en uso: la deja vacía.
-- Para confirmar, cambiá 'NO' por 'SI' en la línea marcada con >>>.
-- =====================================================================
begin;
-- >>> Para confirmar, cambiá 'NO' por 'SI':
select set_config('mw.confirmo_preparar_restauracion', 'NO', true);
do $$
declare t record;
begin
  if current_setting('mw.confirmo_preparar_restauracion', true) is distinct from 'SI' then
    raise exception 'No se vació nada. Para confirmar, cambiá NO por SI en la línea marcada con >>>';
  end if;
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table public.%I restart identity cascade', t.tablename);
  end loop;
end $$;
commit;
