# =====================================================================
# MADEWORK · Sistema contable · Respaldo de la base de datos (Windows)
#
# Qué hace: guarda en una carpeta con fecha
#   - esquema.sql         estructura de las tablas (para consulta)
#   - datos_public.sql    todos los datos del sistema
#   - usuarios_auth.sql   los usuarios que inician sesión
#
# Requisitos (una sola vez):
#   1. Instalar las herramientas de PostgreSQL 17 (pg_dump y psql):
#      https://www.postgresql.org/download/windows/  -> "Command Line Tools".
#   2. En Supabase: botón "Connect" -> "Session pooler" -> copiar la cadena
#      de conexión SIN la contraseña (donde dice [YOUR-PASSWORD] dejala vacía).
#
# Uso:  clic derecho -> "Ejecutar con PowerShell", o en una consola:
#   powershell -ExecutionPolicy Bypass -File respaldo.ps1
#   powershell -ExecutionPolicy Bypass -File respaldo.ps1 -Destino "D:\Respaldos MADEWORK"
#
# La contraseña de la base se escribe cada vez (no se guarda). Para que corra
# solo con el Programador de tareas, ver docs/RESPALDOS.md (archivo pgpass).
# Los respaldos NO se suben a GitHub (están en .gitignore).
# =====================================================================
param(
  [string]$Destino = "C:\PROGRAMA CONTABLE\Respaldos",
  [string]$Conexion = $env:MW_DB_URL
)
$ErrorActionPreference = "Stop"

$pgdump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgdump) {
  $cand = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
  if ($cand) { $pgdump = $cand.FullName } else { Write-Host "No encuentro pg_dump. Instalá las herramientas de PostgreSQL 17 (ver arriba)." -ForegroundColor Red; Read-Host "Enter para salir"; exit 1 }
} else { $pgdump = $pgdump.Source }

if (-not $Conexion) {
  $Conexion = Read-Host "Pegá la cadena de conexión de Supabase (Session pooler), sin la contraseña"
}
$Conexion = $Conexion.Trim().Replace(":[YOUR-PASSWORD]@", "@")
if ($Conexion -notmatch "^postgres(ql)?://") { Write-Host "La cadena tiene que empezar con postgresql://" -ForegroundColor Red; exit 1 }

$appdata = [Environment]::GetFolderPath("ApplicationData")
if (-not $env:PGPASSWORD -and -not (Test-Path (Join-Path $appdata "postgresql\pgpass.conf"))) {
  $seg = Read-Host "Contraseña de la base de datos (no se muestra ni se guarda)" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
}

$carpeta = Join-Path $Destino (Get-Date -Format "yyyy-MM-dd_HHmm")
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
Write-Host "Respaldando en $carpeta ..."
try {
  & $pgdump $Conexion --schema-only --schema=public --no-owner --no-privileges -f (Join-Path $carpeta "esquema.sql")
  if ($LASTEXITCODE -ne 0) { throw "Falló el respaldo de la estructura" }
  & $pgdump $Conexion --data-only --schema=public --no-owner --no-privileges -f (Join-Path $carpeta "datos_public.sql")
  if ($LASTEXITCODE -ne 0) { throw "Falló el respaldo de los datos" }
  & $pgdump $Conexion --data-only --table=auth.users --table=auth.identities --no-owner --no-privileges -f (Join-Path $carpeta "usuarios_auth.sql")
  if ($LASTEXITCODE -ne 0) { throw "Falló el respaldo de los usuarios" }
} catch {
  Write-Host $_ -ForegroundColor Red
  Write-Host "Revisá la cadena de conexión y la contraseña." -ForegroundColor Red
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Read-Host "Enter para salir"; exit 1
}
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

$tam = (Get-ChildItem $carpeta | Measure-Object Length -Sum).Sum / 1KB
"Respaldo MADEWORK $(Get-Date -Format 'dd/MM/yyyy HH:mm') - $([math]::Round($tam)) KB" | Out-File (Join-Path $carpeta "LEEME.txt") -Encoding utf8
Write-Host ("Listo: {0:N0} KB en {1}" -f $tam, $carpeta) -ForegroundColor Green
Write-Host "Guardá una copia fuera de esta computadora (pendrive o Google Drive)."
if (-not $env:MW_NO_PAUSA) { Read-Host "Enter para salir" }
