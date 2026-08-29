import { randomUUID } from "node:crypto";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import { processDocument, uploadDir } from "../lib/documentPipeline.js";
import { enqueue } from "../lib/pipelineQueue.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";

export const documentsRouter = Router();

const ALLOWED_MIME = new Set(["text/plain", "text/markdown", "application/pdf"]);
const ALLOWED_EXT = new Set([".txt", ".md", ".pdf"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir(),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME.has(file.mimetype) || ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only .txt, .md, and .pdf files are supported."));
    }
  },
});

documentsRouter.post(
  "/:roomId/documents",
  requireAuth,
  requireRoomRole("ADMIN", "MEMBER"),
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Upload failed." });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file was uploaded." });
      return;
    }

    const document = await prisma.document.create({
      data: {
        roomId: req.params.roomId,
        uploadedById: req.user!.id,
        filename: req.file.originalname,
        storagePath: req.file.filename,
        mimeType: req.file.mimetype,
      },
    });

    enqueue(() => processDocument(document.id));

    res.status(201).json({
      document: {
        id: document.id,
        filename: document.filename,
        mimeType: document.mimeType,
        status: document.status,
        createdAt: document.createdAt,
      },
    });
  }
);

documentsRouter.get("/:roomId/documents", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
  const documents = await prisma.document.findMany({
    where: { roomId: req.params.roomId },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, mimeType: true, status: true, createdAt: true, uploadedById: true },
  });
  res.json({ documents });
});
