import { Router } from "express";
import multer from "multer";
import { subirDocumento, documentosDe, borrarDocumento } from "../dominio/documentos.js";

export const rutasDocumentos = Router();

// Guarda el archivo en memoria (no en disco) — leemos su texto y lo mandamos a la base.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

rutasDocumentos.get("/api/agentes/:id/documentos", async (req, res, next) => {
  try { res.json(await documentosDe(req.params.id)); } catch (e) { next(e); }
});

// Subir un archivo de texto (md, txt, csv, json...).
rutasDocumentos.post("/api/agentes/:id/documentos", upload.single("archivo"), async (req, res, next) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: "No se recibió ningún archivo" });
    const contenido = f.buffer.toString("utf-8");
    const tipo = (f.originalname.split(".").pop() || "txt").toLowerCase();
    const doc = await subirDocumento(req.params.id, f.originalname, tipo, contenido);
    res.json(doc);
  } catch (e) { next(e); }
});

// Agregar contexto como texto pegado (sin archivo).
rutasDocumentos.post("/api/agentes/:id/documentos/texto", async (req, res, next) => {
  try {
    const { nombre, contenido } = req.body;
    if (!contenido?.trim()) return res.status(400).json({ error: "Contenido vacío" });
    const doc = await subirDocumento(req.params.id, nombre || "nota.txt", "txt", contenido);
    res.json(doc);
  } catch (e) { next(e); }
});

rutasDocumentos.delete("/api/documentos/:docId", async (req, res, next) => {
  try { await borrarDocumento(req.params.docId); res.json({ ok: true }); } catch (e) { next(e); }
});