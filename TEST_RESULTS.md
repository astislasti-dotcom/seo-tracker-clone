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
- Líneas 44-45: Agregadas reglas para `.env.local` y variantes (redundante con `.env*` existente, pero explícito)

### Archivo: `scripts/track-keywords-serpapi.mjs`
- Líneas 9-30: Función `loadEnv()` ahora captura `ENOENT` (archivo no encontrado) y continúa con objeto `env` vacío
- Línea 40: Cambiado de `process.env.SERPAPI_API_KEY` a `process.env.SERPAPI_API_KEY || env.SERPAPI_API_KEY`
- Línea 39: Documentada precedencia (process.env > .env.local)
- Líneas 44-50: Mejorados mensajes de error (sin exponer secretos, indica ambas opciones)

---

## Verificación de seguridad

- ✅ No hay claves hardcodeadas en el código actual
- ✅ `credentials.json` será ignorado por Git
- ✅ Errores de carga no exponen valores secretos
- ✅ Secuencia de validación previene ejecución sin credenciales
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
