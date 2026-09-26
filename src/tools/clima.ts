// ARCHIVO: src/tools/clima.ts
// ─────────────────────────────────────────────────────────────────────────────
//  TOOLS DE CLIMA — Open-Meteo (sin clave)
//  Geocodifica el nombre de una ciudad con la API de geocoding de Open-Meteo
//  y consulta el clima actual con la API de forecast. Ninguna de las dos
//  requiere credenciales, así que no hay variables de entorno que configurar.
// ─────────────────────────────────────────────────────────────────────────────

import type { DefTool } from "../registro/tipos.js";

const MODULO = "clima";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

interface ResultadoGeocoding {
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
}

async function geocodificar(ciudad: string): Promise<ResultadoGeocoding | null> {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(ciudad)}&count=1&language=es&format=json`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} consultando geocodificación`);
  const data: any = await resp.json();
  const primero = data?.results?.[0];
  if (!primero) return null;
  return { latitude: primero.latitude, longitude: primero.longitude, name: primero.name, country: primero.country };
}

export const climaConsultar: DefTool = {
  nombre: "clima_consultar",
  modulo: MODULO,
  descripcion: "Consulta el clima actual de una ciudad por su nombre (ej. 'Bogotá', 'Madrid'). Geocodifica la ciudad y devuelve temperatura, velocidad del viento y código de clima de Open-Meteo. No necesita credenciales.",
  parametros: {
    type: "object",
    properties: {
      ciudad: { type: "string", description: "Nombre de la ciudad a consultar.", minLength: 2 },
    },
    required: ["ciudad"],
  },
  riesgo: "lectura",
  requiereAprobacion: false,
  async ejecutar(args) {
    const ciudad = String(args.ciudad || "").trim();
    if (!ciudad) return { ok: false, error: "Falta el nombre de la ciudad." };

    let ubicacion: ResultadoGeocoding | null;
    try {
      ubicacion = await geocodificar(ciudad);
    } catch (e: any) {
      return { ok: false, error: `No se pudo geocodificar "${ciudad}": ${e?.message || String(e)}` };
    }
    if (!ubicacion) return { ok: false, error: `No encontré la ciudad "${ciudad}". Probá con otro nombre o agregá el país (ej. "París, Francia").` };

    try {
      const url = `${FORECAST_URL}?latitude=${ubicacion.latitude}&longitude=${ubicacion.longitude}&current_weather=true`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status} consultando el clima de "${ciudad}".` };
      const data: any = await resp.json();
      const actual = data?.current_weather;
      if (!actual) return { ok: false, error: `Open-Meteo no devolvió clima actual para "${ciudad}".` };

      const nombreResuelto = [ubicacion.name, ubicacion.country].filter(Boolean).join(", ");
      const datos = {
        ciudad: nombreResuelto,
        temperature: actual.temperature,
        windspeed: actual.windspeed,
        weathercode: actual.weathercode,
        timestamp: actual.time,
      };
      return {
        ok: true,
        datos,
        resumen: `${nombreResuelto}: ${actual.temperature}°C, viento ${actual.windspeed} km/h (código de clima ${actual.weathercode}).`,
      };
    } catch (e: any) {
      return { ok: false, error: `No se pudo hablar con Open-Meteo: ${e?.message || String(e)}` };
    }
  },
};

export const toolsClima: DefTool[] = [climaConsultar];
