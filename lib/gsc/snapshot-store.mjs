// GSC-06C · único adaptador de escritura para los snapshots. Escribe SOLO mediante la función
// public.gsc_publish_dimension_snapshot (PR #35), con rpc(). Nunca usa from(), insert(),
// update() ni delete() sobre gsc_dimension_snapshots: la función inserta y aplica la retención
// en una sola transacción.
//
// Solo servidor: usa la clave service_role, que no debe llegar al navegador ni a los logs.
// Los errores se reducen a un código fijo; el texto de Supabase no se reenvía.
import { createClient } from '@supabase/supabase-js';

export const PUBLISH_FUNCTION = 'gsc_publish_dimension_snapshot';

export class SnapshotStorageError extends Error {
  constructor() {
    super('storage_error');
    this.code = 'storage_error';
  }
}

function fail() {
  throw new SnapshotStorageError();
}

// `client` se inyecta en las pruebas. En producción se crea con la URL pública y la clave de
// servidor, sin sesión persistente.
export function createSnapshotRepo({ url, serviceKey, client }) {
  const db =
    client ??
    createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

  return {
    // Devuelve el id de la captura insertada. Cualquier fallo se reduce a storage_error.
    async publish(record) {
      if (record === null || typeof record !== 'object') fail();
      const { data, error } = await db.rpc(PUBLISH_FUNCTION, record);
      if (error) fail();
      if (data === null || data === undefined) fail();
      return data;
    },
  };
}
