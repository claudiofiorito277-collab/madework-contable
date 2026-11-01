-- =====================================================================
-- MADEWORK · Sistema contable · Migración 008 · Ajuste final de permisos
-- Etapa 9 · 01/11/2026
--
-- Resultado de la revisión final de seguridad:
--  - Supabase deja ejecutar cualquier función a cualquiera (también sin
--    iniciar sesión). Acá se saca ese permiso al rol anónimo: solo los
--    usuarios con sesión iniciada usan las funciones del sistema.
--  - Las funciones internas de contabilidad y ventas siguen sin poder
--    llamarse desde la aplicación.
--  - Nadie puede crear disparadores ni referencias sobre las tablas desde
--    la aplicación.
--
-- No cambia datos. Requiere las migraciones 001 a 007. Se corre UNA sola vez
-- (si se corre de nuevo no pasa nada).
-- =====================================================================

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on all functions in schema public to service_role';
  end if;
end $$;

-- Funciones internas: solo las usan otras funciones del sistema
revoke execute on function public.fn_sync_certificado(uuid), public.fn_insertar_asiento(jsonb, boolean), public.fn_ejercicio_de(date)
  from authenticated;

-- Las funciones que se creen más adelante tampoco quedan abiertas al rol anónimo
alter default privileges in schema public revoke execute on functions from public, anon;

-- Permisos de estructura que la aplicación no necesita
revoke references, trigger, truncate on all tables in schema public from anon, authenticated;

-- Fin de la migración 008
