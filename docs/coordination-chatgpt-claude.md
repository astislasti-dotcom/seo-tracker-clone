# Coordinación ChatGPT ↔ Claude mediante GitHub (AUTOMATION-01)

## Propósito
Reducir al mínimo el trabajo manual del propietario como intermediario entre conversaciones, sin activar tareas recurrentes ni gastar tokens de Claude en segundo plano.

## Lo que ya funciona
1. ChatGPT, con el conector GitHub, crea issues y registra decisiones/correcciones en comentarios de issues o PR.
2. Claude Code abre el issue/PR desde su sesión autorizada, implementa la tarea y deja su resultado en GitHub.
3. El workflow existente `.github/workflows/pr-quality.yml` comprueba lint y tests automáticamente al abrir o actualizar PR contra `main`; **no ejecuta modelos de IA**.
4. ChatGPT lee la PR y la CI desde GitHub y publica su revisión, sin que el propietario copie informes.

## Flujo de una tarea
- **Preparación:** ChatGPT crea un issue completo con objetivo, límites, criterios y presupuesto. Estado: PENDIENTE.
- **Autorización:** el propietario da orden a Claude para trabajar el issue; no se activa Claude automáticamente.
- **Desarrollo:** Claude Code Haiku 5.5 lee issue y comentarios, trabaja en una rama aislada y publica estado. No debe enviar secretos a GitHub.
- **Revisión:** con autorización de publicación, Claude crea PR en borrador. La CI corre automáticamente, sin coste de tokens de Claude. ChatGPT revisa diff y registra observaciones directamente en PR.
- **Correcciones:** Claude lee la PR al iniciar su siguiente ejecución autorizada, implementa solo observaciones pendientes y actualiza la PR. Repetir solo cuando haya un cambio real.
- **Cierre:** el propietario autoriza expresamente merge, despliegue o escrituras externas.

## Mensajes cortos para el propietario
Al iniciar Claude: «Trabaja únicamente sobre el issue #N, leyendo todos sus comentarios. Haiku 5.5, sin push/PR/merge ni cambios externos salvo autorización expresa».
Al revisar ChatGPT: «Revisa la PR #N y la CI directamente en GitHub. Deja correcciones como review en la PR. No hagas merge».

## Límites reales de automatización
- GitHub **no transmite por sí solo mensajes a una conversación de ChatGPT ni inicia la sesión de Claude**.
- Este flujo elimina copiar y pegar *contenido técnico*, pero todavía requiere iniciar manualmente cada sesión o revisión.
- Una coordinación realmente autónoma requeriría un disparador externo (GitHub Action, webhook, servidor/agente o automatización programada) y permisos y presupuesto adicionales. **NO está instalado ni autorizado**.
- No habilitar `claude-code-action` ni API facturable de Anthropic sin revisar facturación y autorización; una cuenta de Claude de chat no garantiza inclusión de API.
- Ni el propietario ni ChatGPT deben compartir `SUPABASE_SERVICE_ROLE_KEY`, tokens Bearer, cuentas de servicio GSC ni secretos en issues/PR.

## Seguridad / gobernanza
- Nunca tocar Production, hacer merge ni cambiar RLS/credenciales sin autorización.
- Pruebas offline por defecto; APIs reales de lectura solo tras aprobación, escrituras externas siempre tras aprobación específica.
- Ejecutar Claude solo bajo petición y con alcance limitado.
- GitHub PR en borrador y CI son la fuente auditable del estado; los chats no son la fuente de verdad.

## Estado de implantación
- Plantillas y procedimiento preparados en PR aislada, pendiente de aprobación y fusión.
- CI existente ya activa.
- El enlace bidireccional automático entre sesiones **no existe aún**. No confundir plantillas + CI con un orquestador autónomo.
