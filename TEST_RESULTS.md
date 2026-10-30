# Pruebas de seguridad — TAREA 002

**Rama:** `claude/security-credentials` (PR #2)
**Fecha de la última ejecución:** 2026-10-30

Este documento solo recoge pruebas que se han ejecutado realmente. No se han
realizado consultas a SerpAPI ni escrituras en Supabase.

## Cambios en esta corrección

- `test-env-scenarios.mjs` reescrito:
  - Las aserciones comparan el **valor resuelto** de cada variable
    (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SERPAPI_API_KEY`)
    con el valor esperado. Antes solo se comprobaba que hubiera algún valor.
  - Escenario 4 (archivo vacío) separado del 5 (archivo ausente).
  - Escenario 6 añadido: mezcla parcial entre `process.env` y `.env.local`.
  - Cada escenario escribe su archivo en un directorio único creado con
    `fs.mkdtempSync` dentro de `os.tmpdir()`. Se elimina solo ese directorio al final.
    El `.env.local` real no se lee ni se modifica.
  - Solo se usan valores ficticios (`*.example.invalid`, `*-fixture`).

## Resultados

### 1. Sintaxis
```
node --check test-env-scenarios.mjs
node --check scripts/track-keywords-serpapi.mjs
```
Resultado: PASS (sin errores de sintaxis).

### 2. Escenarios de precedencia (`node test-env-scenarios.mjs`)
```
PASS  S1 solo process.env (sin archivo)
PASS  S2 solo .env.local
PASS  S3 ambas fuentes (gana process.env)
PASS  S4 archivo vacio, sin process.env
PASS  S5 archivo ausente, sin process.env
PASS  S6 mezcla parcial

Resultado: 6/6   (exit=0)
```

### 3. Comprobación de que la aserción de precedencia detecta fallos
Se generó una copia temporal con el orden invertido (`env[...] || processEnv[...]`)
y se ejecutó. Resultado: S3 falla con `https://file.example.invalid` en lugar de
`https://proc.example.invalid`. Exit code 1. La copia se eliminó después.

### 4. `.gitignore`
```
git check-ignore -v credentials.json
```
Resultado: `.gitignore:44:credentials.json` (ignorado).

### 5. Entorno real
No se ha creado ni modificado ningún `.env.local` en el repositorio durante estas pruebas.

## Limitaciones

- `npm run lint` y `npm run build` no se han podido ejecutar localmente: faltan
  dependencias en el entorno de trabajo (`eslint` no resuelve, `next` no instalado).
- Los checks de GitHub Actions (`ESLint y sintaxis`) y Vercel no ejecutan
  `test-env-scenarios.mjs`. Su estado se verifica en el PR, no aquí.
- `test-env-loading.mjs` inspecciona el entorno actual y no sustituye a los escenarios aislados.
  Ya no imprime valores de variables, ni completos ni parciales.

## Seguridad

- La clave SerpAPI antigua sigue presente en el historial del repositorio público.
  Debe revocarse y rotarse en SerpAPI por su propietario. Eliminarla del código actual
  no la invalida.
- Ningún documento, script o comentario de este PR contiene valores reales de credenciales.
