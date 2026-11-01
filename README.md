# MADEWORK · Sistema contable y de gestión

Sistema para los trabajos con Caminos de las Sierras. Separado de cualquier otro sistema de MADEWORK.

**Estado:** Etapa 6 de 9 · contabilidad general (sobre las Etapas 1 a 5: base, contratos y certificados, ventas y cobranzas, compras y pagos, tesorería).

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

## Etapa 3 · Ventas y cobranzas

### Instalación (sobre la Etapa 2 ya instalada)

1. Supabase → **SQL Editor** → **New query** → pegar todo `sql/003_ventas.sql` → **Run**. Tiene que decir *Success*. Se corre una sola vez.
2. Subir a GitHub las carpetas `css`, `js`, `sql`, `tests` y los archivos `index.html` y `README.md`.
3. En el navegador, recargar con **Ctrl + F5**.

### Cómo se usa

1. **Facturar un certificado:** emitir la factura en ARCA. Después, en **Ventas y cobranzas → Por facturar → Registrar factura**: el sistema propone neto, IVA y total del certificado; cargás punto de venta, número y CAE. El certificado pasa a *facturado*.
2. **Nota de crédito o débito:** desde la factura, botón **Nota de crédito** / **Nota de débito**. Siempre queda asociada a la factura. Si es por multas, se marcan y quedan *descontadas*.
3. **Cobranza:** **Registrar cobranza** → marcar las facturas que se cobran → cargar lo que entró (transferencia, echeq, cheque, efectivo) → cargar cada **retención** tal como dice su certificado (Ganancias, IVA, IIBB Córdoba, SUSS u otra) → el **fondo de reparo** que retuvo el cliente (se propone solo en el primer cobro) → **Registrar**. Cuando la factura queda en cero, el certificado pasa a *cobrado*.
4. **Adjuntos:** en el recibo se adjunta cada certificado de retención escaneado.
5. **Cuenta corriente:** saldo, antigüedad de deuda y movimientos por cliente.
6. **Fondo de reparo:** saldo retenido por contrato y fecha estimada de devolución. La devolución se registra como cobranza en el punto 5 del formulario.
7. **Retenciones:** listado por período e impuesto para el contador.

### Reglas que aplica la base de datos

- Un comprobante no se repite: tipo + punto de venta + número. Un certificado tiene una sola factura vigente.
- Solo se factura un certificado **aprobado**. Factura A o M exige CUIT del cliente.
- El IVA de cada alícuota se controla contra el parámetro vigente a la fecha (tolerancia de 1 centavo).
- Nota de crédito: misma letra y mismo cliente que la factura, fecha no anterior, y no puede superar lo que queda de la factura.
- Una cobranza no aplica más que el saldo de cada factura ni más de lo cobrado; el resto queda *a cuenta*.
- Un certificado de retención no se carga dos veces. No se devuelve más fondo de reparo que el retenido.
- Los importes registrados no se modifican: ante un error, se **anula** (con motivo) y se carga de nuevo. No se anula una factura con cobros o NC vigentes.
- Solo administrador y contador registran, anulan y modifican. Operador y consulta solo ven.
- Ningún registro se borra; todo queda en la auditoría.

### A confirmar con el contador (Etapa 3)

- Si las multas descontadas por nota de crédito llevan IVA.
- Qué retenciones practica Caminos de las Sierras y sus alícuotas (para el control opcional).
- Tratamiento contable e impositivo del fondo de reparo retenido.
- Si corresponde Factura M o A según la situación de MADEWORK en ARCA.

## Etapa 4 · Compras y pagos

### Instalación (sobre la Etapa 3 ya instalada)

1. Supabase → **SQL Editor** → **New query** → pegar todo `sql/004_compras.sql` → **Run**. Tiene que decir *Success*. Se corre una sola vez y **después** de la 003.
2. Subir a GitHub las carpetas `css`, `js`, `sql`, `tests` y los archivos `index.html`, `README.md` y `package.json`.
3. En el navegador, recargar con **Ctrl + F5**.

### Cómo se usa

#### Proveedores

**Proveedores → + Nuevo proveedor:** razón social, CUIT (se valida), condición frente al IVA, rubro (pinturas, materiales, combustible, alquiler de equipos, subcontratistas, seguridad, transporte, etc.) y datos bancarios (banco, CBU de 22 dígitos, alias, titular). El operador también puede dar de alta un proveedor desde la obra.

#### Cargar una factura de compra

1. **Compras y pagos → + Cargar factura** (también desde el celular).
2. Elegir el proveedor: el sistema ofrece solo los tipos que corresponden (Factura A/M/B para un Responsable Inscripto; C para un monotributista).
3. Punto de venta, número, fecha, vencimiento y descripción. Si ese comprobante ya está cargado, avisa en el momento.
4. **Importes:** el neto por alícuota (o el total si es B o C), las **percepciones** (IVA, IIBB Córdoba u otras) y otros tributos. El sistema calcula el IVA, dice si es **crédito fiscal** y cuál es el **costo de obra**.
5. **Imputación a obra:** contrato, ítem, centro de costo y categoría (materiales, mano de obra, equipos, subcontratos, otros). Se puede repartir en porcentajes, por ejemplo 60 % a un ítem y 40 % a otro; tiene que sumar 100 %.
6. **Foto o PDF del comprobante:** en el celular abre la cámara y queda adjunta.
7. **Guardar comprobante.**

Lo que carga el operador queda **a revisar**: el contador o el administrador lo controla y toca **Marcar revisado**. En Inicio aparece el aviso.

#### Notas de crédito, órdenes de compra y pagos

- **Nota de crédito:** desde la factura, **Cargar nota de crédito**. Hereda la imputación de la factura y le baja el saldo.
- **Órdenes de compra** (opcionales): se crean en la pestaña *Órdenes de compra* y se vinculan a la factura al cargarla.
- **Registrar pago:** elegir proveedor → marcar los comprobantes que se pagan → medio de pago (transferencia, echeq, cheque, efectivo) → **Registrar pago**. Se puede pagar en partes o adelantar (queda como anticipo). Se imprime la **orden de pago** con el CBU del proveedor para firmar.
- **Vencimientos:** lo vencido, lo que vence en 7 días, en 30 días y más adelante, con botón **Pagar**.
- **Cuenta corriente:** lo que se le debe a cada proveedor, con todos sus movimientos.

### Reglas que aplica la base de datos

- **Duplicados:** un comprobante del mismo proveedor (CUIT) con el mismo tipo, punto de venta y número no se carga dos veces. Solo el administrador puede forzarlo, escribiendo el motivo, y queda marcado.
- **Crédito fiscal:** solo factura A o M de un Responsable Inscripto. Factura B, C y tickets van completos al costo.
- Un monotributista solo emite comprobantes C; un Responsable Inscripto no emite C.
- El IVA se controla contra la alícuota vigente a la fecha.
- La imputación tiene que sumar 100 % y los importes imputados tienen que sumar el costo; un ítem tiene que ser del contrato elegido.
- Un pago no se aplica por más del saldo ni a comprobantes de otro proveedor.
- **Retenciones que practica MADEWORK:** desactivadas. El sistema no deja cargarlas hasta que el contador confirme que corresponde y se active el parámetro *AGENTE_RETENCION* en Parámetros fiscales.
- Lo registrado no se modifica: ante un error se anula con motivo y se carga de nuevo. Una factura con pagos no se anula hasta anular el pago.
- Cargar facturas: administrador, contador y operador. Pagar, anular y revisar: administrador y contador. Nada se borra y todo queda en la auditoría.

### A confirmar con el contador (Etapa 4)

- Si MADEWORK tiene que actuar como agente de retención (Ganancias, IIBB Córdoba, SUSS) y con qué alícuotas.
- Tratamiento de las percepciones de IIBB y de IVA sufridas.
- Categorías de costo y centros de costo que quiere ver en los reportes.
- Factura M: régimen aplicable si algún proveedor la emite.

## Etapa 5 · Tesorería, bancos y cheques

### Instalación (sobre la Etapa 4 ya instalada)

1. Subir a GitHub las carpetas `css`, `js`, `sql` y `tests`, y los archivos `index.html`, `README.md` y `package.json`.
2. Supabase → **SQL Editor** → correr `sql/005_tesoreria.sql`. Tiene que decir *Success*. Se corre una sola vez.
3. En el navegador, recargar con **Ctrl + F5**.

### Antes de usarla: cargar las cuentas

**Tesorería y cheques → Cuentas y saldos → + Nueva caja o cuenta.** Una por cada cuenta bancaria y cada caja (por ejemplo, *Galicia cta. cte.* y *Caja obra*), con el saldo real al 01/11/2026. Desde esta etapa, cada cobranza y cada pago pide de qué cuenta entra o sale la plata.

### Cómo se usa

#### Cobranzas y pagos mueven la tesorería solos

- **Transferencia o efectivo:** entra o sale en el momento de la cuenta elegida (las transferencias van a un banco, el efectivo a una caja).
- **Cheque o echeq recibido:** queda en la **cartera de cheques** hasta que se deposita.
- **Cheque o echeq propio:** queda *emitido* y sale de la cuenta cuando se marca **Debitado**.
- **Cheque de terceros:** en un pago se puede **endosar** un cheque de la cartera al proveedor.
- Al anular una cobranza o un pago se anula su movimiento; si el cheque ya se depositó o se debitó, el sistema no deja anular.

#### Cheques

**Tesorería → Cheques:** cartera de cheques de terceros, cheques propios a debitar, y todos. Acciones según el estado: **Depositar**, **Acreditado**, **Debitado** y **Rechazado**.

**Cheque rechazado:** se registra con fecha y motivo. Si ya estaba acreditado, el sistema registra el débito del banco. **La deuda se reabre** en las facturas que había cancelado (de la última a la primera), el certificado vuelve a *facturado* y en la cuenta corriente del cliente aparece "Cheque rechazado". Lo mismo con un cheque propio rechazado: vuelve la plata y se reabre la deuda con el proveedor.

**Alertas** (también en Inicio): cheques de terceros que ya se pueden depositar o que están por vencer (vencen a los 30 días de la fecha de pago) y cheques propios que se debitan en los próximos días.

#### Movimientos manuales y transferencias

- **+ Transferencia entre cuentas:** por ejemplo, del banco a la caja de obra. Genera dos movimientos (sale de una, entra en la otra) y no cambia el total.
- **+ Movimiento manual:** gastos e impuestos bancarios, aportes o retiros de los socios, ajustes.
- **Impuesto a los débitos y créditos:** si la cuenta lo tiene marcado y el parámetro *BANCARIO / IMP_DEB_CRED* tiene valor, se calcula solo en cada movimiento (no en transferencias propias). Hoy el parámetro está *a confirmar con el contador*, así que no se calcula.

#### Conciliación bancaria

1. **Tesorería → Conciliación** → elegir la cuenta → **Importar extracto** (CSV o Excel, como lo baja el home banking).
2. La primera vez se indica qué columna es la fecha, la descripción y el importe (o débito y crédito). El sistema lo adivina por los títulos y lo **guarda para ese banco**.
3. El sistema sugiere qué movimiento corresponde a cada línea: mismo importe y fecha cercana (hasta 5 días). **Conciliar las coincidencias sugeridas.**
4. Lo que está en el banco y no en el sistema (comisiones, impuestos, intereses): botón **Cargar**, que lo registra y lo concilia en un paso. Las líneas informativas se pueden **Ignorar**.
5. **Control de saldos:** se escribe el saldo final del extracto y el sistema muestra si la diferencia con el sistema queda explicada por las partidas pendientes (*Cuadra ✓*).

Si se importa dos veces el mismo extracto, las líneas repetidas se saltean.

#### Flujo de fondos

**Tesorería → Flujo de fondos**, por semana o por mes:
- **Real:** lo que entró y salió de cajas y bancos.
- **Proyectado:** suma las facturas a cobrar y los cheques en cartera, y resta las facturas a pagar y los cheques propios por debitar, según su vencimiento. Lo atrasado se cuenta en la semana actual.

Así se ve con anticipación una semana en la que el saldo queda en rojo.

### Reglas que aplica la base de datos

- Los movimientos de cobranzas, pagos, cheques y transferencias los genera el sistema; no se cargan ni se anulan a mano.
- Un cheque no se carga dos veces; un cheque diferido no se deposita antes de su fecha.
- Una cobranza o un pago con un cheque rechazado no se anula (la deuda ya se reabrió).
- Un movimiento conciliado no se anula sin antes desconciliarlo.
- El saldo inicial de una cuenta no se cambia cuando ya tiene movimientos (se carga un ajuste).
- Tesorería la operan administrador y contador; la consulta solo ve; el operador no la ve.

### A confirmar con el contador (Etapa 5)

- Alícuota del impuesto a los débitos y créditos y si se computa como pago a cuenta de Ganancias.
- Tratamiento de los gastos bancarios por cheques rechazados.
- Si conviene una cuenta de caja chica por obra.

## Etapa 6 · Contabilidad general

Contabilidad general: cada factura, nota de crédito, cobranza, compra, pago, movimiento de caja o banco y cheque rechazado genera su **asiento automático**. Las cuentas que usa cada concepto salen de una **tabla de configuración**, no están fijas en el programa. Además: asientos manuales, numeración correlativa por ejercicio, anulación con contraasiento, cierre y reapertura de meses, cierre de ejercicio, y los libros (diario, mayor, sumas y saldos, estado de resultados y situación patrimonial), por período y por contrato.

### Instalación (sobre la Etapa 5 ya instalada)

1. Subir a GitHub las carpetas `css`, `js`, `sql` y `tests`, y los archivos `index.html`, `README.md` y `package.json`.
2. Supabase → **SQL Editor** → correr `sql/006_contabilidad.sql`. Tiene que decir *Success*. Se corre una sola vez.
3. En el navegador, recargar con **Ctrl + F5**.

### Primer paso: revisar la configuración con el contador

**Contabilidad → Configuración.** Ahí está cada concepto (deudores por ventas, ventas, IVA débito, retenciones sufridas, proveedores, costos por rubro, caja, bancos, gastos bancarios, resultado del ejercicio…) con la cuenta del plan que usa. Ya viene cargado con el plan borrador. Las marcadas **A CONFIRMAR** conviene revisarlas con el contador. En **Cajas y bancos** se puede asignar a cada banco su propia cuenta contable; si no, usa "Bancos" o "Caja".

Si se cambia una cuenta, los asientos nuevos usan la nueva. Para rehacer los de un mes abierto: **Contabilizar → Regenerar asientos de un período**. Solo se rehacen los que cambian (se anulan con contraasiento y se registran de nuevo).

### Cómo se usa

#### Contabilizar

**Contabilidad → Contabilizar** muestra lo que todavía no tiene asiento. **Ver asiento** muestra el asiento propuesto antes de registrarlo. **Contabilizar todo** los registra de una vez.

Qué asiento arma cada cosa:

- **Factura de venta:** Deudores por ventas al debe; Ventas (por contrato) e IVA débito fiscal al haber. La nota de crédito, al revés.
- **Cobranza:** el banco, la caja o "Valores a depositar" (cheques y echeqs), las retenciones sufridas y el fondo de reparo al debe; Deudores por ventas (y Anticipos de clientes si queda a cuenta) al haber.
- **Factura de compra:** el costo por rubro y por contrato, el IVA crédito fiscal y las percepciones al debe; Proveedores al haber. Si el IVA no se discrimina, va todo al costo.
- **Pago:** Proveedores (o Anticipos a proveedores) al debe; banco, caja, "Cheques diferidos emitidos" o el cheque de terceros endosado al haber.
- **Tesorería:** transferencias entre cuentas, gastos e impuestos bancarios, aportes y retiros, acreditación y débito de cheques. Los movimientos que vienen de una cobranza o un pago no repiten asiento.
- **Cheque rechazado:** vuelve la deuda del cliente (o con el proveedor) y se da de baja el cheque.
- **Descuento del anticipo en un certificado:** cuando el contrato lo prevé.

Si se anula un comprobante que ya estaba contabilizado, aparece en la lista como **Anular su asiento**: al contabilizar se registra el contraasiento.

Cada asiento tiene un botón **Ver … de origen** que abre su factura, recibo, compra, orden de pago o movimiento. Y cada línea queda con su contrato y centro de costo.

#### Asiento manual

**+ Asiento manual**: para lo que no viene de un comprobante (aporte de capital, saldos iniciales, amortizaciones, ajustes que indique el contador). Se eligen las cuentas e importes; el sistema muestra la diferencia y **no deja registrar si el debe no es igual al haber**.

#### Un asiento no se modifica

Un asiento registrado no se edita: se **anula** con un contraasiento (las mismas cuentas invertidas) y un **motivo** obligatorio. Los dos quedan vinculados y en la auditoría. Si el mes del asiento está cerrado, se puede poner fecha del contraasiento en un mes abierto.

#### Cierre de meses

**Contabilidad → Cierre de meses.**

- **Cerrar mes:** solo se puede si no queda nada pendiente de contabilizar en ese mes. Un mes cerrado **bloquea** la carga y la anulación de facturas, compras, cobranzas, pagos, movimientos y asientos con fecha de ese mes.
- **Reabrir:** solo administrador o contador, con **motivo obligatorio**. Queda registrado quién y por qué.

En Inicio aparece el aviso cuando hay operaciones sin contabilizar de meses anteriores.

#### Cierre de ejercicio

En la misma pantalla, **Cerrar ejercicio** registra la refundición de resultados (ingresos y gastos contra "Resultado del ejercicio"), el asiento de cierre y la apertura del ejercicio siguiente, y cierra todos sus meses. **Hacerlo junto con el contador.**

**Ajuste por inflación: no se calcula. A CONFIRMAR CON CONTADOR.**

#### Libros

- **Libro diario:** asientos del período con sus líneas, numerados por ejercicio. Muestra si balancea.
- **Mayor:** una cuenta, con saldo anterior, movimientos y saldo corrido.
- **Sumas y saldos:** todas las cuentas con debe, haber y saldo; muestra si **cuadra**. Se puede filtrar por contrato.
- **Resultados:** ingresos menos costos y gastos del período, de toda la empresa o de un contrato.
- **Patrimonio:** activo, pasivo y patrimonio neto a una fecha, con el resultado del período todavía no cerrado.

Todos tienen botón **Imprimir** (o guardar como PDF desde la impresión).

### Reglas que aplica la base de datos

- Cada asiento balancea (debe = haber), usa solo cuentas imputables y activas, y tiene al menos dos líneas.
- Numeración correlativa por ejercicio, sin huecos.
- Un comprobante tiene un solo asiento vigente.
- Los asientos no se editan ni se borran: se anulan con contraasiento y motivo.
- Un mes cerrado bloquea cargas y anulaciones con fecha de ese mes; no se cierra con pendientes; se reabre solo con motivo.
- Un ejercicio cerrado no se reabre.
- Una cuenta con asientos no cambia de código ni de rubro.
- Registran asientos y cierran meses el administrador y el contador; la consulta solo ve; el operador no ve la contabilidad.

### A confirmar con el contador (Etapa 6)

- Las cuentas de la **configuración de imputaciones**, en especial las marcadas A CONFIRMAR (anticipo financiero facturado, multas por nota de crédito).
- Plan de cuentas definitivo y si conviene una subcuenta por banco.
- **Ajuste por inflación contable:** no se calcula.
- Saldos iniciales al 01/11/2026 (se cargan con un asiento manual).
- Tratamiento del fondo de reparo y del anticipo financiero.

### Pruebas (Etapa 6)

- 121 pruebas de cálculo (18 nuevas de contabilidad: asiento de cada tipo de comprobante, contraasiento, validación debe = haber, sumas y saldos, mayor, resultados, situación patrimonial, refundición, cierre y apertura).
- 275 pruebas de base de datos (Etapas 1 a 6; 44 nuevas de contabilidad: numeración, inmutabilidad, anulación, períodos, cierre de ejercicio y permisos).
- 37 pruebas de pantallas con el **criterio de aceptación** sobre los datos DEMO de las etapas anteriores: el balance de sumas y saldos cuadra, cada uno de los asientos automáticos abre su comprobante, y con el mes cerrado no se puede cargar factura, compra, cobranza, pago ni asiento, ni anular. También: asiento manual desbalanceado rechazado, anulación con contraasiento, reapertura con motivo y regeneración tras cambiar una cuenta.
- Se volvieron a correr las pruebas de pantallas de las Etapas 2 a 5: sin cambios.

---

## Pruebas automáticas

Requieren [Node.js](https://nodejs.org) 20 o superior.

```
npm test            # 121 pruebas: IVA, redondeo, vigencias, CUIT, certificados, ventas, compras, tesorería, contabilidad
npm install         # una vez, para la prueba de base de datos
npm run test:sql    # 275 pruebas: migraciones 001 a 006, permisos, auditoría, certificados, ventas, compras, tesorería, contabilidad
```

---

## Estructura

```
index.html            Entrada
css/app.css           Estilos (computadora y celular)
js/config.js          Conexión a Supabase (completar)
js/app.js             Arranque, sesión y navegación
js/core/              Lógica pura (IVA, redondeo, vigencias, CUIT, certificados, ventas, compras, tesorería, asientos), con pruebas
js/data/              Única capa que habla con Supabase
js/ui/                Pantallas
sql/001_base.sql      Migración de la Etapa 1
sql/002_contratos.sql Migración de la Etapa 2
sql/003_ventas.sql    Migración de la Etapa 3
sql/004_compras.sql   Migración de la Etapa 4
sql/005_tesoreria.sql Migración de la Etapa 5
sql/006_contabilidad.sql Migración de la Etapa 6
tests/                Pruebas automáticas
```

---

## Supuestos de esta etapa

- Fecha de inicio del sistema: 01/11/2026. Las alícuotas rigen desde esa fecha.
- Ingresos Brutos: contribuyente local de Córdoba (editable en Empresa).
- Las facturas se emiten en ARCA por fuera del sistema; acá se registran con su número y CAE.
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
- Cuentas de la configuración de imputaciones contables.
- Ajuste por inflación contable (no se calcula).
