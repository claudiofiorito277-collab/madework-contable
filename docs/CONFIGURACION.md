---
title: "Guía de configuración inicial y puesta en marcha"
subtitle: "Sistema contable MADEWORK · Caminos de las Sierras · versión 1.0 · 01/11/2026"
---

# Resumen

Para empezar a usar el sistema con datos reales hay que hacer cuatro cosas, en este orden:

1. **Dejar la base limpia**: un proyecto nuevo (recomendado) o borrar los datos DEMO del de pruebas.
2. **Configurar**: empresa, usuarios, parámetros fiscales, plan de cuentas, imputaciones, cajas y bancos.
3. **Cargar lo inicial**: clientes, el contrato real, proveedores, personal, equipos, materiales y saldos iniciales.
4. **Dejar andando los respaldos.**

La lista para el contador (documento aparte) conviene revisarla **antes** del paso 2: varios valores dependen de lo que él diga.

# 1. Dejar la base limpia

## Opción A (recomendada): un proyecto nuevo en Supabase

Así el sistema real arranca sin ningún rastro de las pruebas, y el proyecto de pruebas queda para probar cambios futuros.

1. En Supabase: **New project** → nombre `madework-contable` → región São Paulo. Anotá la contraseña de la base en un lugar seguro (no en la carpeta del programa).
2. **Authentication** → desactivá "Allow new users to sign up".
3. **SQL Editor**: corré, uno por uno y en orden, `sql/001_base.sql` a `sql/008_seguridad.sql`. Cada uno tiene que decir *Success*.
4. **Authentication → Users → Add user**: primero tu usuario (queda como Administrador), después Mario y el contador (quedan inactivos hasta asignarles el rol).
5. **Connect** → copiá la URL del proyecto y la clave **anon**. En `js/config.js` reemplazá las del proyecto de pruebas. **Nunca** la `service_role`.
6. Subí el cambio a GitHub y recargá con **Ctrl + F5**.

## Opción B: seguir con el proyecto de pruebas, sin los datos DEMO

1. Hacé un **respaldo** (punto 4 de esta guía).
2. **SQL Editor**: si todavía no lo corriste, `sql/008_seguridad.sql`.
3. Abrí `sql/900_borrar_demo.sql`, pegalo en el SQL Editor y **cambiá `'NO'` por `'SI'`** en la línea marcada con `>>>`. **Run**.
4. Al final muestra una tabla con las tablas operativas en 0.
5. **Storage → adjuntos**: borrá las fotos de prueba.

**Qué borra:** clientes, contratos, certificados, facturas, cobranzas, compras, pagos, cuentas de tesorería, cheques, asientos y ejercicios, personal, equipos, materiales, partes, indirectos y la auditoría de las pruebas (queda un único registro del borrado).

**Qué conserva:** empresa, usuarios y roles, parámetros fiscales, tipos de comprobante, plan de cuentas, el centro de costo de administración y la configuración de imputaciones. Revisalos igual: en las pruebas pudieron haber cambiado.

Sin el `'SI'` el script no borra nada. Lo borrado **no se puede recuperar** salvo desde un respaldo.

# 2. Configurar

Todo desde el menú **Configuración**, con usuario administrador.

## 2.1 Empresa

**Configuración → Empresa**: razón social (tu nombre, como figura en ARCA), nombre de fantasía MADEWORK, CUIT, condición frente al IVA (Responsable Inscripto), Ingresos Brutos (número y condición: contribuyente local de Córdoba), domicilio fiscal, inicio de actividades, fecha de inicio del sistema y **cierre del ejercicio** (A CONFIRMAR con el contador). **Guardar cambios**.

## 2.2 Usuarios

1. Cada persona se crea en Supabase: **Authentication → Users → Add user**, con su correo y una contraseña que elige ella (marcá **Auto Confirm User**). El sistema nunca guarda contraseñas.
2. En el sistema, **Configuración → Usuarios**: asignale el rol y activalo.
   - Vos: **Administrador**.
   - Mario (obra): **Operador**.
   - El contador: **Contador**.
   - Alguien que solo mira: **Solo consulta**.

## 2.3 Parámetros fiscales

**Configuración → Parámetros fiscales**. Los marcados **a confirmar** no tienen valor todavía. Con lo que diga el contador, en cada uno: **Nueva vigencia** con la fecha desde la que rige y el valor. Nunca se pisa un valor viejo: el historial queda.

Los más importantes: alícuota de IIBB de la actividad (y si aplica la exención del pliego), tasa municipal, impuesto a los débitos y créditos, y si MADEWORK es agente de retención (mientras esté en 0, el sistema no deja cargar retenciones en los pagos).

## 2.4 Plan de cuentas

**Configuración → Plan de cuentas**. Es un borrador para una unipersonal Responsable Inscripta de servicios viales. Con el contador: **+ Nueva cuenta**, **Editar** nombres o desactivar las que no use. Una cuenta que ya tiene asientos no cambia de código.

## 2.5 Imputaciones contables

**Contabilidad → Configuración**: qué cuenta usa cada concepto (ventas, IVA, retenciones, proveedores, costos por rubro, caja, bancos, cierre). Revisá con el contador las marcadas **A CONFIRMAR**. En **Cajas y bancos** se puede asignar una cuenta contable a cada banco.

## 2.6 Cajas y bancos

**Tesorería y cheques → Cuentas y saldos → + Nueva caja o cuenta**: cada cuenta bancaria (con CBU) y cada caja, con el **saldo real** a la fecha de inicio. El saldo inicial no se puede cambiar después de cargar movimientos.

# 3. Cargar lo inicial

1. **Clientes → +**: Caminos de las Sierras S.A. con su CUIT.
2. **Contratos y certificados → +**: el contrato real (concurso 2026/0115), con número de concurso, ruta, tramos, plazo, fecha del acta de replanteo, fondo de reparo, anticipo y condiciones de pago. Después, sus **ítems** con unidad, cantidad, precio unitario y el **costo unitario presupuestado** (sirve para comparar con el real). Por último, las **pólizas**.
3. **Proveedores**: los habituales, con CUIT y datos bancarios.
4. **Costos de obra**: personal (con su costo por jornal u hora), vehículos y equipos (con su tarifa), materiales, el obrador de la obra y los costos indirectos fijos.
5. **Saldos iniciales**: con el contador, en **Contabilidad → + Asiento manual** (bancos, deudas, capital). Las facturas pendientes de antes del inicio se cargan como comprobantes, para que queden en las cuentas corrientes.

# 4. Respaldos

## Qué hace Supabase y qué no

- En el **plan gratuito, Supabase no ofrece respaldos automáticos descargables**; los respaldos diarios son de los planes pagos (Pro: 7 días; Team: 14; Enterprise: hasta 30). Para el plan gratuito, Supabase recomienda exportar los datos uno mismo con regularidad.
- Los respaldos de la base **no incluyen los archivos** (fotos de facturas en Storage): solo el registro de que existen.
- Un proyecto gratuito **se pausa** si tiene poca actividad durante unos 7 días. Se reactiva desde el panel y conserva los datos; se puede restaurar hasta 1 año después de pausado. Con uso diario no pasa.

## Respaldo con un clic (Windows)

**Una sola vez:**

1. Instalá las herramientas de **PostgreSQL 17** ("Command Line Tools") desde postgresql.org.
2. En Supabase: **Connect → Session pooler** → copiá la cadena de conexión (empieza con `postgresql://postgres.`).

**Cada vez (recomendado: todos los viernes y siempre antes de cerrar un mes):**

1. Clic derecho en `scripts\respaldo.ps1` → **Ejecutar con PowerShell**.
2. Pegá la cadena de conexión y escribí la contraseña de la base (no se muestra ni se guarda).
3. Queda una carpeta con fecha en `C:\PROGRAMA CONTABLE\Respaldos` con `datos_public.sql`, `usuarios_auth.sql` y `esquema.sql`.
4. **Copiala fuera de la computadora** (pendrive o Google Drive). Los respaldos **nunca** se suben a GitHub.

Una vez por mes, descargá también las fotos: **Storage → adjuntos → Download**.

**Automático (opcional):** para que corra solo con el Programador de tareas de Windows sin pedir la contraseña, creá vos el archivo `%APPDATA%\postgresql\pgpass.conf` con la línea `host:5432:postgres:usuario:contraseña` de tu cadena de conexión, y programá `powershell -ExecutionPolicy Bypass -File "C:\PROGRAMA CONTABLE\...\scripts\respaldo.ps1"` con la variable `MW_DB_URL` (tu cadena) y `MW_NO_PAUSA=1`. Ese archivo guarda la contraseña en tu computadora: protegé la sesión de Windows.

## Restaurar un respaldo

Se restaura en un **proyecto nuevo**, nunca encima del que está en uso.

1. Creá el proyecto nuevo y corré `sql/001` a `sql/008` (como en la Opción A).
2. Corré `sql/990_restaurar_preparar.sql` cambiando `'NO'` por `'SI'` (vacía los datos iniciales de las migraciones para que el respaldo entre sin duplicados).
3. En una consola de Windows, en la carpeta del respaldo:

```
psql "CADENA-DEL-PROYECTO-NUEVO" -v ON_ERROR_STOP=1 --single-transaction -c "SET session_replication_role = replica" -f usuarios_auth.sql -f datos_public.sql
```

4. Cambiá `js/config.js` al proyecto nuevo, subí a GitHub y entrá con tu usuario de siempre.
5. Subí de nuevo las fotos a **Storage → adjuntos**.

**Probá restaurar una vez** en un proyecto de prueba, para saber que el respaldo sirve antes de necesitarlo.

# 5. Seguridad (revisión final)

Revisado automáticamente (`npm run test:sql`, archivo `tests/sql/probar_seguridad.mjs`):

- **RLS activa en las 63 tablas**, y todas tienen sus políticas por rol.
- Sin iniciar sesión **no se puede leer ninguna tabla ni ejecutar ninguna función** (migración 008).
- Las vistas respetan los permisos de quien consulta; las funciones con privilegios fijan su `search_path`.
- Todas las tablas quedan en la **auditoría**, que no se puede modificar ni borrar desde la aplicación.
- Permisos por rol probados (cliente, proveedor, asiento, cierre de mes, personal, materiales) y en cada etapa.
- En el código **solo está la clave pública anon**; ninguna `service_role`, clave secreta ni contraseña. Los respaldos y archivos de claves están excluidos de GitHub.

**Lo que depende de vos:**

- Que el registro público esté **desactivado** en Authentication.
- Contraseñas propias y distintas para cada usuario; desactivar en **Usuarios** a quien deje de trabajar.
- La contraseña de la base y la `service_role` solo en tu gestor de contraseñas, nunca en la carpeta del programa ni en un chat.
- Respaldos guardados fuera de la computadora.
