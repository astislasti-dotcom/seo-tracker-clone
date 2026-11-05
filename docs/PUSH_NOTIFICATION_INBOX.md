# Buzón de avisos de AUTOMATION-01

Esta pull request **no debe fusionarse ni cerrarse** mientras se use como buzón de notificaciones.

## Propósito

El workflow de Github Actions propuesto en una PR de implementación independiente podrá dejar aquí comentarios de aviso **ya filtrados y deduplicados**, y ChatGPT Work podrá observar únicamente esta pull request si su conector soporta ese filtro. El buzón no debe contener secretos ni información privada.

## Importante

- Esto es una **reserva de buzón**, no una activación. Ningún workflow de publicación ni tarea Work se ha activado.
- Los avisos automáticos los publicaría `github-actions[bot]` mediante `GITHUB_TOKEN`; Work tendría que recibir comentarios de bots y poder limitarse a esta PR.
- Hay que verificar empíricamente que la integración Work recibe ese evento: que GitHub no dispare otros workflows con `GITHUB_TOKEN` no demuestra que las integraciones externas reciban el mismo evento.
- No publicar comentarios de prueba en este buzón hasta acordar la prueba controlada. No hacer merges, sincronizaciones, escrituras en Supabase ni invocar modelos IA desde GitHub.
