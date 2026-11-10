@echo off
rem Emuladores locales de Firebase (proyecto demo-crm-local, nunca toca Firebase real).
rem - firebase-tools 13: el CLI actual exige Java 21 y este equipo tiene Java 17.
rem - jdk.net.unixdomain.tmpdir: el emulador de Firestore falla en Windows si la carpeta
rem   temporal tiene una ruta larga o con espacios ("Ingenieria Software").
rem - FUNCTIONS_DISCOVERY_TIMEOUT: cargar el codigo de functions tarda mas de los 10 s por defecto.
cd /d "%~dp0.."
if not exist .emu-tmp mkdir .emu-tmp
set "FUNCTIONS_DISCOVERY_TIMEOUT=120"
set "JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=%CD%\.emu-tmp"
call npm --prefix functions run build || exit /b 1
npx -y firebase-tools@13.35.1 emulators:start --project demo-crm-local --only auth,firestore,functions,storage
