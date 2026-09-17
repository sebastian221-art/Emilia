import ngrok from "@ngrok/ngrok";

/**
 * Levanta el túnel ngrok al arrancar el servidor. Si NGROK_AUTHTOKEN no está
 * configurado, no hace nada (el sistema funciona igual sin webhook externo).
 * Imprime la URL exacta lista para pegar en Meta.
 */
export async function iniciarTunel(puerto: number): Promise<string | null> {
  const authtoken = process.env.NGROK_AUTHTOKEN;
  if (!authtoken) {
    console.log("(ngrok no configurado — el webhook de WhatsApp no estará disponible. Agregá NGROK_AUTHTOKEN al .env para activarlo.)");
    return null;
  }
  try {
    const opciones: any = { addr: puerto, authtoken };
    // Si tenés un dominio fijo, ponelo en NGROK_DOMAIN del .env.
    if (process.env.NGROK_DOMAIN) opciones.domain = process.env.NGROK_DOMAIN;

    const listener = await ngrok.forward(opciones);
    const url = listener.url();
    console.log("\n════════════════════════════════════════");
    console.log(" Túnel ngrok activo");
    console.log(`   URL pública:   ${url}`);
    console.log(`   Webhook Meta:  ${url}/webhook/whatsapp`);
    console.log(`   Verify token:  ${process.env.WHATSAPP_VERIFY_TOKEN ?? "(falta WHATSAPP_VERIFY_TOKEN)"}`);
    console.log("════════════════════════════════════════\n");
    return url ?? null;
  } catch (e: any) {
    console.error("No se pudo levantar ngrok:", e?.message ?? e);
    return null;
  }
}