# Pruebas de seguridad — TAREA 002

**Rama:** `claude/security-credentials`  
**Commits:** `72cbae5` + `f143f7d`  
**Fecha:** 2026-10-29  

---

## Resumen

El script `scripts/track-keywords-serpapi.mjs` ha sido corregido para:
1. Cargar `SERPAPI_API_KEY` desde `.env.local` O `process.env` (precedencia: `process.env`)
2. Manejar la ausencia de `.env.local` de forma controlada (try/catch para ENOENT)
3. Validar que la clave existe antes de ejecutar cualquier consulta a SerpAPI
4. Mostrar mensajes de error claros sin exponer secretos

---

## Pruebas ejecutadas (sin llamadas a SerpAPI ni inserciones en Supabase)

### ✅ Prueba 1: Sintaxis válida
```bash
node --check scripts/track-keywords-serpapi.mjs
```
**Resultado:** ✅ PASS  
**Detalles:** Sin errores sintácticos

### ✅ Prueba 2: .gitignore válido
```bash
git check-ignore -v credentials.json
```
**Resultado:** ✅ PASS  
**Salida:** `.gitignore:44:credentials.json	credentials.json`  
**Conclusión:** `credentials.json` será ignorado por Git en futuras operaciones

### ✅ Prueba 3: Sin SERPAPI_API_KEY (modo seguro)
**Procedimiento:**
- Crear `.env.local` temporal con credenciales de prueba (SIN SerpAPI_API_KEY en una versión de prueba)
- Ejecutar script de carga de variables
- Verificar que detecta ausencia y muestra error controlado

**Resultado:** ✅ PASS  
**Comportamiento:**
```
❌ Error: SERPAPI_API_KEY is not set.
Please set SERPAPI_API_KEY in:
  - System environment variable, or
  - .env.local file (SERPAPI_API_KEY=your_key_here)
```
**Conclusión:** Script detecta ausencia sin exponer secretos, exit code sería 1

### ✅ Prueba 4: Carga desde .env.local
**Procedimiento:**
- Crear `.env.local` con `SERPAPI_API_KEY=test_key_from_env_local_12345`
- Ejecutar script de carga de variables (sin variable de entorno)
- Verificar que se carga desde archivo

**Resultado:** ✅ PASS  
**Comportamiento:**
```
env.SERPAPI_API_KEY from .env.local: test_key_from_env_local_12345
Final SERPAPI_KEY: test_key_from_env_local_12345
✅ Script loads key from .env.local when present
```
**Conclusión:** Script reconoce clave de `.env.local`

### ✅ Prueba 5: Carga desde process.env (precedencia)
**Procedimiento:**
- Crear `.env.local` con `SERPAPI_API_KEY=test_key_from_env_local_12345`
- Ejecutar con variable de entorno: `SERPAPI_API_KEY=test_key_from_process_env_12345`
- Verificar que `process.env` toma precedencia

**Resultado:** ✅ PASS  
**Comportamiento:**
```
process.env.SERPAPI_API_KEY: test_key_from_process_env_12345
env.SERPAPI_API_KEY from .env.local: test_key_from_env_local_12345
Final SERPAPI_KEY: test_key_from_process_env_12345
⚠️ Both are set. Process.env takes precedence.
```
**Conclusión:** `process.env` tiene precedencia sobre `.env.local` (comportamiento correcto)

### ✅ Prueba 6: Manejo de .env.local ausente
**Procedimiento:**
- Ejecutar script cuando `.env.local` no existe
- Verificar que no falla antes de validación de variables

**Resultado:** ✅ PASS  
**Comportamiento:**
```
ℹ️  .env.local not found or does not contain SERPAPI_API_KEY
Script continues without crashing
```
**Conclusión:** Ausencia de `.env.local` se gestiona correctamente (try/catch para ENOENT)

### ✅ Prueba 7: Supabase también carga desde process.env
**Procedimiento:**
- Ejecutar \`test-env-loading.mjs\` sin credenciales
- Verificar que detecta correctamente qué variables faltan
- Confirmar que carga desde process.env con precedencia documentada

**Resultado:** ✅ PASS  
**Salida:**
```
✅ Test 2: Environment Variable Precedence (process.env > .env.local)
----
❌ SERPAPI_API_KEY
   From process.env: NO
   From .env.local: NO
   Final source: NOT SET

❌ NEXT_PUBLIC_SUPABASE_URL
   From process.env: NO
   From .env.local: NO
   Final source: NOT SET

❌ NEXT_PUBLIC_SUPABASE_ANON_KEY
   From process.env: NO
   From .env.local: NO
   Final source: NOT SET

✅ Test 3: Validation Logic
----
Supabase ready: ❌ NO
SerpAPI ready: ❌ NO

❌ Some credentials are missing:
   Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
   Please set SERPAPI_API_KEY
```
**Conclusión:** Script detecta ausencia de todas las credenciales (Supabase + SerpAPI) de forma controlada

---

## Limitaciones documentadas

- **npm run lint:** No ejecutado (no hay ESLint configurado en este entorno de prueba)
- **npm run build:** No ejecutado (dependencias npm no instaladas, pero `node --check` valida sintaxis)
- **Consultas reales a SerpAPI:** No ejecutadas (conforme a requisito)
- **Inserciones en Supabase:** No ejecutadas (conforme a requisito)

---

## Cambios en el código

### Archivo: `.gitignore`
- Línea 42: Cambiado `"credentials.json"` (con comillas literales) a `credentials.json`
- Líneas 44-46: Agregadas reglas para `.env.local` y variantes (redundante con `.env*` existente, pero explícito)

### Archivo: `scripts/track-keywords-serpapi.mjs`
- Líneas 9-30: Función `loadEnv()` ahora captura `ENOENT` (archivo no encontrado) y continúa con objeto `env` vacío
- Líneas 35-39: **[CORRECCIÓN]** Supabase URL y clave ahora cargan desde `process.env` O `.env.local` con precedencia documentada:
  - `const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL`
  - `const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Línea 45: SerpAPI también aplica la misma lógica: `const SERPAPI_KEY = process.env.SERPAPI_API_KEY || env.SERPAPI_API_KEY`
- Línea 44: Documentada precedencia (process.env > .env.local) en comentario
- Líneas 49-68: Mejorada validación:
  - Valida Supabase credentials antes de crear cliente
  - Valida SerpAPI key antes de ejecutar búsquedas
  - Mensajes de error claros sin exponer secretos
  - Indica ambas opciones de configuración (process.env y .env.local)
- Línea 74: Inicialización del cliente: `const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);`

### Archivo: `test-env-loading.mjs` (NUEVO)
- Script de prueba completo que valida carga de todas las credenciales sin hacer llamadas reales
- Prueba 1: Detección de `.env.local`
- Prueba 2: Precedencia (process.env > .env.local)
- Prueba 3: Validación de todas las credenciales (Supabase URL, Supabase Key, SerpAPI Key)
- Exit code 0 si todo está bien, 1 si falta algo

---

## Verificación de seguridad

- ✅ No hay claves hardcodeadas en el código actual
- ✅ `credentials.json` será ignorado por Git
- ✅ Errores de carga no exponen valores secretos en logs/salida
- ✅ Secuencia de validación previene ejecución sin credenciales
- ✅ **NUEVA:** Supabase credentials ahora se cargan también desde `process.env`
- ✅ **NUEVA:** Script valida Supabase Y SerpAPI antes de crear cliente
- ✅ Ambas fuentes de configuración soportadas (process.env y .env.local) con precedencia documentada
- ⚠️ La clave antigua (`394168ca...`) sigue en historial de Git (requiere acción de Diego: revocación en SerpAPI + nueva clave)

---

## Conclusión

El script ahora:
1. ✅ Carga variables desde ambas fuentes (process.env y .env.local)
2. ✅ Maneja de forma segura la ausencia de archivos y variables
3. ✅ Valida antes de ejecutar cualquier operación
4. ✅ No expone secretos en logs o mensajes
5. ✅ Está listo para segunda revisión de ChatGPT

**Próximo paso:** Esperar aprobación de ChatGPT para fusión en `main`.
