---
name: "Tarea de desarrollo para Claude"
about: "Trabajo acotado, revisable por ChatGPT y ejecutado solo bajo autorización"
title: "DEV — "
labels: []
assignees: []
---

## Objetivo y contexto
Referencia al issue principal, PR anterior y rama base.

## Alcance autorizado
- 

## Fuera de alcance
- No hacer cambios en Production ni variables de entorno.
- No modificar Supabase (esquema, RLS o datos) ni llamar a APIs facturables sin autorización explícita.
- No hacer merge. No crear PR ni hacer push salvo autorización en este issue.

## Contrato y criterios de aceptación
- 

## Validación offline
- Tests unitarios, lint de archivos modificados y build local cuando aplique.
- No lanzar pruebas que escriban en servicios reales.

## Presupuesto de ejecución
- Modelo Claude Haiku 5.5, salvo indicación distinta.
- Una sola implementación acotada, sin reintentos ilimitados ni exploración sin fin.
- Si hay bloqueo, escribirlo en este issue y detenerse.

## Handoff / estado
- Estado: PENDIENTE / AUTORIZADO / EN CURSO / BLOQUEADO / LISTO PARA REVISIÓN
- Rama / commit:
- Tests:
- Riesgos y decisiones pendientes:

> Regla: la conversación es prescindible; toda instrucción relevante debe quedar registrada aquí. No publicar secretos ni tokens.
