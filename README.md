# MADEWORK · Sistema contable y de gestión

Sistema para los trabajos con Caminos de las Sierras. Separado de cualquier otro sistema de MADEWORK.

**Estado:** Etapa 2 de 9 · contratos, planilla de columnas, certificados, multas, pólizas y redeterminaciones (sobre la base de la Etapa 1).

---

## Instalación (una sola vez)

Tiempo estimado: 20 minutos.

### Recomendación: primero un proyecto de PRUEBAS

Mientras construimos las etapas 2 a 8, conviene usar un proyecto de Supabase de pruebas (por ejemplo `madework-contable-pruebas`). Los parámetros y la auditoría **no se pueden borrar** a propósito, así que las pruebas dejarían rastro. En la Etapa 9 se crea el proyecto definitivo, limpio, con tus datos reales.

### Paso 1 · Crear el proyecto en Supabase

1. Entrá a [supabase.com](https://supabase.com) con tu cuenta y tocá **New project**.
2. Nombre: `madework-contable-pruebas`. Región: la más cercana (South America · São Paulo).
3. Anotá la contraseña de la base en un lugar seguro.
4. Esperá a que el proyecto termine de crearse.

### Paso 2 · Cerrar el registro público

Así nadie de afuera puede crearse un usuario.

1. Andá a **Authentication** y buscá la configuración de inicio de sesión (Sign In / Providers).
2. Desactivá la opción que permite que usuarios nuevos se registren solos ("Allow new users to sign up").

### Paso 3 · Crear la base de datos

1. Andá a **SQL Editor** → **New query**.
2. Abrí el archivo `sql/001_base.sql`, copiá **todo** el contenido y pegalo.
3. Tocá **Run**. Tiene que decir *Success*.
4. Si da error, no lo corras dos veces: mandame el mensaje.

### Paso 4 · Crear tu usuario (administrador)

1. Andá a **Authentication** → **Users** → **Add user** → **Create new user**.
2. Cargá tu correo y una contraseña. Marcá **Auto Confirm User**.
3. El **primer** usuario que se crea queda automáticamente como **Administrador**.
4. Los siguientes (Mario, el contador) se crean igual, pero quedan **inactivos** hasta que les asignes el rol desde la pantalla **Usuarios** del sistema.

### Paso 5 · Conectar la aplicación

1. En Supabase andá a **Project Settings** → **API** (o el botón **Connect**).
2. Copiá la **Project URL** y la clave pública **anon** (la larga que empieza con `eyJ...`; si hay pestaña de claves "legacy", es esa).
3. Abrí `js/config.js` y reemplazá `https://TU-PROYECTO.supabase.co` y `PEGAR-ACA-LA-CLAVE-ANON`.
4. **Nunca** pegues la clave `service_role` ni ninguna clave secreta.

### Paso 6 · Publicarla en GitHub Pages

1. Creá un repositorio nuevo en GitHub, por ejemplo `madework-contable`.
2. Subí **todo el contenido** de la carpeta `programa-contable` (menos `node_modules`, si existe).
3. En el repositorio: **Settings** → **Pages** → Source: *Deploy from a branch* → rama `main`, carpeta `/ (root)` → **Save**.
4. En uno o dos minutos queda en `https://TU-USUARIO.github.io/madework-contable/`.

Sobre la privacidad: GitHub Pages en cuenta gratuita necesita repositorio público. El código queda visible, pero **los datos no**: están en Supabase y protegidos por usuario y rol. La clave anon es pública por diseño.

Para que se vea un cambio nuevo, subí el número `?v=1` a `?v=2` en `index.html` (GitHub guarda copias en caché).

### Probarlo sin publicar (opcional)

Los navegadores no abren este sistema con doble clic en `index.html`: necesita un servidor. En VS Code, la extensión **Live Server** sirve: clic derecho en `index.html` → *Open with Live Server*.

---

## Cómo verificar la Etapa 1 (criterios de aceptación)

1. Entrá con tu usuario. Tenés que ver **Inicio** con la lista de configuración pendiente.
2. **Empresa:** cargá un CUIT con un dígito mal → tiene que rechazarlo. Cargá el correcto → se guarda.
3. **Parámetros fiscales:** en *IVA 27%* tocá **Nueva vigencia**, poné 28 desde una fecha futura y un motivo. Tiene que aparecer "2 vigencias" y el historial.
4. **Auditoría:** tiene que figurar el cambio con tu usuario, la fecha y el valor antes y después.
5. **Calculadora de IVA:** Factura A, neto 1.000 al 21% + 500 al 10,5% → total **$ 1.762,50** y crédito fiscal **$ 262,50**. Cambiá a Factura C de monotributista → **no genera crédito fiscal**.
6. **Usuarios:** creá el usuario de Mario en Supabase (paso 4), asignale *Operador* y activalo. Entrando como Mario no tiene que ver *Usuarios* ni *Auditoría*, ni poder cambiar parámetros.

---

## Etapa 2 · Contratos y certificados

### Instalación (sobre la Etapa 1 ya instalada)

1. Supabase → **SQL Editor** → **New query** → pegar todo `sql/002_contratos.sql` → **Run**. Tiene que decir *Success*. Se corre una sola vez.
2. Subir a GitHub los archivos nuevos y modificados (carpetas `css`, `js`, `sql`, `tests` y los archivos `index.html`, `README.md`, `package.json`).
3. En el navegador, recargar con **Ctrl + F5**.

### Cómo se usa (flujo semanal)

1. **Clientes:** cargar Caminos de las Sierras.
2. **Contratos → Nuevo contrato:** código (ej. E55), cliente y obra. Después, en **Editar condiciones**: acta de replanteo, plazo, forma de pago, anticipo, fondo de reparo, multas.
3. **Ítems:** cantidad y precio unitario de la oferta, y el costo presupuestado por unidad.
4. **Columnas:** cargar los tramos y las columnas pintadas (de a rangos, ej. C-1 a C-40). Cuando la inspección firma, seleccionarlas y **Marcar aprobadas**.
5. **Certificados → Nuevo:** período de la semana → **Traer columnas aprobadas** → revisar importes → **Guardar** → **Presentar** → **Imprimir** la planilla para firmar.
6. Cuando Caminos de las Sierras lo aprueba: **Marcar aprobado** (administrador o contador).

### Reglas que aplica la base de datos

- Los certificados se numeran solos y correlativos por contrato; un número no se reutiliza (los anulados quedan).
- Estados: borrador → presentado → aprobado → facturado → cobrado. También observado (vuelve a borrador para corregir) y anulado (con motivo).
- Al presentar, la base verifica que el bruto sea la suma exacta de cantidad × precio de cada ítem.
- Presentado en adelante, las cantidades, importes y columnas incluidas quedan bloqueadas.
- Solo se certifican columnas **aprobadas** por la inspección, y una columna no puede estar en dos certificados.
- Aprobar, anular y marcar facturado o cobrado: solo administrador o contador. El operador carga columnas, arma y presenta certificados, registra multas y pólizas.
- Cada contrato e ítem crea su centro de costo automáticamente.
- Archivos (contratos, certificados) en una carpeta privada de Supabase Storage; no se borran.

### Lógica de certificados (`js/core/certificados.js`)

- Importe = cantidad del período × precio vigente (oferta o redeterminación aprobada).
- Fondo de reparo y descuento de anticipo como % del bruto; el anticipo nunca se descuenta de más.
- Cada descuento puede ir en la factura o aparte (retención en el pago o nota de crédito), configurable por contrato.
- Fecha de pago según pliego: primer viernes a partir de los 15 días corridos de presentada la factura.
- Multas en litros de nafta × precio por litro.

### A confirmar con el contador (Etapa 2)

- **Ingresos Brutos:** el art. 6 del pliego dice que la obra está dentro de las excepciones del inc. 31 del art. 242 del Código Tributario de Córdoba (no incluir IIBB en el precio). Confirmar cómo se declara.
- Si el descuento del anticipo se resta en cada factura o se compensa de otra forma.
- Tratamiento de las multas (nota de crédito con o sin IVA).
- Interpretación de la fecha de pago ("primer viernes siguiente a los 15 días").

## Qué incluye la Etapa 1

| Pantalla | Qué hace | Quién modifica |
|---|---|---|
| Inicio | Configuración pendiente y avance del sistema | — |
| Empresa | Datos fiscales de MADEWORK, CUIT validado | Administrador |
| Parámetros fiscales | Alícuotas de IVA, IIBB, retenciones, tolerancias, con vigencia e historial | Administrador, Contador |
| Tipos de comprobante | Si discrimina IVA y si genera crédito fiscal | Administrador, Contador |
| Calculadora de IVA | Prueba el motor de IVA sin guardar nada | Todos |
| Plan de cuentas | Borrador editable, jerarquía por código | Administrador, Contador |
| Centros de costo | Para imputar ingresos y gastos | Administrador, Contador, Operador |
| Usuarios | Rol y activación | Administrador |
| Auditoría | Todo cambio, con usuario, fecha, antes y después | Solo lectura (Administrador, Contador) |

### Reglas que aplica la base de datos (no se pueden saltear desde la pantalla)

- Cada rol solo ve y modifica lo que le corresponde (Row Level Security).
- Un parámetro con valor no se pisa: se cambia con una nueva vigencia y queda el historial.
- Dos vigencias del mismo parámetro no se pueden superponer.
- No se borra nada: se desactiva. La auditoría no se puede editar ni borrar.
- No se puede quitar el último administrador activo.
- El CUIT se valida por dígito verificador.
- Las cuentas toman su cuenta madre del código y respetan su rubro.

### Motor de IVA (`js/core/iva.js`)

- Calcula desde el neto, desde el total con IVA o valida neto e IVA cargados a mano.
- Varias alícuotas en un mismo comprobante, más exento y no gravado.
- Comprobantes B: calcula el IVA contenido. Comprobantes C y de monotributistas: nunca generan crédito fiscal.
- Notas de crédito con signo negativo.
- Importes en centavos enteros; redondeo mitad hacia arriba por alícuota; con un total cargado, el IVA es total − neto, así siempre cuadra.
- Toma las alícuotas vigentes a la fecha del comprobante desde la base, no del código.

---

## Pruebas automáticas

Requieren [Node.js](https://nodejs.org) 20 o superior.

```
npm test            # 59 pruebas: IVA, redondeo, vigencias, CUIT, certificados
npm install         # una vez, para la prueba de base de datos
npm run test:sql    # 64 pruebas: migraciones 001 y 002, permisos, auditoría, certificados
```

---

## Estructura

```
index.html            Entrada
css/app.css           Estilos (computadora y celular)
js/config.js          Conexión a Supabase (completar)
js/app.js             Arranque, sesión y navegación
js/core/              Lógica pura (IVA, redondeo, vigencias, CUIT, certificados), con pruebas
js/data/              Única capa que habla con Supabase
js/ui/                Pantallas
sql/001_base.sql      Migración de la Etapa 1
sql/002_contratos.sql Migración de la Etapa 2
tests/                Pruebas automáticas
```

---

## Supuestos de esta etapa

- Fecha de inicio del sistema: 01/11/2026. Las alícuotas rigen desde esa fecha.
- Ingresos Brutos: contribuyente local de Córdoba (editable en Empresa).
- Las facturas se emiten en ARCA por fuera del sistema; acá se registran (Etapa 3).
- Ejercicio del 1/1 al 31/12 (editable en Empresa).
- Bloqueo de ingreso: 5 intentos fallidos bloquean 15 minutos en ese navegador. Además, Supabase limita los intentos de inicio de sesión desde el servidor.

## A confirmar con el contador

- Plan de cuentas (es un borrador).
- Alícuota de Ingresos Brutos de la actividad y tasa municipal de Córdoba.
- Impuesto a los débitos y créditos bancarios.
- Retenciones que practica Caminos de las Sierras (Ganancias, IVA, IIBB, SUSS).
- Factura M: tratamiento del crédito fiscal y régimen de retención.
- Códigos de tipos de comprobante (se cargaron los de ARCA como referencia).
- Fecha de cierre del ejercicio.
