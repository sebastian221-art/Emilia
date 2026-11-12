// ARCHIVO: src/motor/texto-documento.ts
// ─────────────────────────────────────────────────────────────────────────────
//  Texto de un documento (adjuntos de correo, páginas, archivos del jefe):
//  PDF (pdf-parse v2 y v1), Word (mammoth), Excel/CSV (xlsx), HTML y texto.
// ─────────────────────────────────────────────────────────────────────────────

const quitarHtml = (h: string) => h
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
export { quitarHtml };

/** Extrae texto legible. Devuelve "" si el tipo no se puede leer. Nunca lanza. */
export async function textoDeDocumento(contenido: Buffer, mime = "", nombre = "", maxChars = 20000): Promise<string> {
  const ext = (nombre.split(".").pop() || "").toLowerCase();
  try {
    if (mime.includes("pdf") || ext === "pdf") {
      const mod: any = await import("pdf-parse");
      let texto = "";
      if (mod.PDFParse) { const p = new mod.PDFParse({ data: new Uint8Array(contenido) }); try { texto = (await p.getText()).text || ""; } finally { await p.destroy?.().catch?.(() => {}); } }
      else { const parse = mod.default || mod; texto = String((await parse(contenido)).text || ""); }
      return texto.replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
    }
    if (mime.includes("wordprocessingml") || ext === "docx") {
      const mammoth: any = await import("mammoth");
      return String((await (mammoth.default || mammoth).extractRawText({ buffer: contenido })).value || "").trim().slice(0, maxChars);
    }
    if (mime.includes("spreadsheetml") || mime.includes("ms-excel") || ["xlsx", "xls", "csv"].includes(ext)) {
      const XLSX: any = await import("xlsx");
      const wb = (XLSX.default || XLSX).read(contenido, { type: "buffer" });
      const partes: string[] = [];
      for (const hoja of wb.SheetNames.slice(0, 5)) {
        const csv = (XLSX.default || XLSX).utils.sheet_to_csv(wb.Sheets[hoja]).split("\n").filter((l: string) => l.replace(/,/g, "").trim()).slice(0, 80).join("\n");
        partes.push(`[Hoja ${hoja}]\n${csv}`);
      }
      return partes.join("\n\n").slice(0, maxChars);
    }
    if (mime.includes("html") || ["html", "htm"].includes(ext)) return quitarHtml(contenido.toString("utf8")).slice(0, maxChars);
    if (mime.startsWith("text/") || ["txt", "md", "json", "xml", "log", "ics"].includes(ext)) return contenido.toString("utf8").slice(0, maxChars);
  } catch { /* documento dañado o protegido */ }
  return "";
}
