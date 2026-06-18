// Convierte cualquier error (ClientResponseError de PocketBase, TypeError de red,
// o cualquier otra cosa) en { status, message, hint }.
//
// PRIVACIDAD: ni los mensajes de UI ni los logs exponen informacion sensible
// (URL del backend, token, ni el nombre de la coleccion). Solo se registra el
// codigo de estado y, como mucho, los NOMBRES de los campos rechazados.
export function formatPbError(err, ctx = {}) {
  const status = err?.status ?? err?.response?.code ?? null;
  const pbMsg =
    err?.response?.message || err?.message || (typeof err === "string" ? err : "");
  // Errores por campo que devuelve PocketBase: { campo: { code, message } }
  const data = err?.response?.data || err?.data?.data || err?.data || null;

  // Solo los NOMBRES de los campos rechazados (no valores).
  function fieldNames() {
    if (!data || typeof data !== "object") return "";
    return Object.keys(data).join(", ");
  }

  // Mensaje generico segun el tipo de fallo. Nunca incluye URL, token ni coleccion.
  let hint = "";
  if (!status && (err?.name === "TypeError" || /fetch|network/i.test(pbMsg))) {
    hint = "No se pudo contactar con el servidor. Revisa tu conexion.";
  } else if (status === 400) {
    const fn = fieldNames();
    hint = fn ? "Datos no validos (campos: " + fn + ")." : "Los datos enviados no son validos.";
  } else if (status === 401) {
    hint = "No autorizado. Revisa la configuracion de acceso.";
  } else if (status === 403) {
    hint = "Accion no permitida por las reglas del servidor.";
  } else if (status === 404) {
    hint = "Recurso no encontrado. Revisa la configuracion del servidor.";
  } else if (status >= 500) {
    hint = "Error interno del servidor. Intenta mas tarde.";
  } else if (status) {
    hint = "El servidor respondio con un error (HTTP " + status + ").";
  } else {
    hint = "Ocurrio un error inesperado.";
  }

  // Log minimo para depurar SIN datos sensibles: estado, contexto y campos.
  const where = ctx.where || "desconocido";
  /* eslint-disable no-console */
  console.groupCollapsed("[taggings] Error " + (status ?? "ERR") + " en " + where);
  console.error(hint);
  console.log("status :", status ?? "(sin codigo)");
  const fn = fieldNames();
  if (fn) console.log("campos :", fn);
  console.groupEnd();
  /* eslint-enable no-console */

  return { status, hint };
}
