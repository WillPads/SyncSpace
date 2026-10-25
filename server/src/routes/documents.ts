import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Document } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { prisma } from "../db.js";
import {
  MAX_UPLOAD_BYTES,
  checkUploadContent,
  processDocument,
  removeUploads,
  uploadDir,
} from "../lib/documentPipeline.js";
import { HttpError, routeParam } from "../lib/http.js";
import { enqueue } from "../lib/pipelineQueue.js";
import { type RateLimiters, limitBy } from "../lib/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireRoomRole } from "../middleware/requireRoomRole.js";
import { sendToRoom } from "../ws/registry.js";

// The file type is decided by the extension and then verified against the bytes; the
// browser-reported MIME type varies too much between browsers and OSes to be trusted.
const UPLOAD_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir()),
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  // Uploads pass through Vercel's proxy in production, which caps request bodies at about 4.5 MB.
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 },
  // Browsers send UTF-8 file names; without this, "résumé.pdf" arrives garbled.
  defParamCharset: "utf8",
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() in UPLOAD_TYPES) {
      cb(null, true);
    } else {
      cb(new HttpError(400, "UNSUPPORTED_FILE_TYPE", "Only .txt, .md, and .pdf files are supported."));
    }
  },
});

function cleanFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/"));
  return base.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 200) || "document";
}

function serializeDocument(document: Document) {
  return {
    id: document.id,
    filename: document.filename,
    mimeType: document.mimeType,
    status: document.status,
    failureReason: document.failureReason,
    createdAt: document.createdAt.toISOString(),
    uploadedById: document.uploadedById,
  };
}

export function createDocumentsRouter(limits: RateLimiters): Router {
  const router = Router();

  router.post(
    "/:roomId/documents",
    requireAuth,
    requireRoomRole("ADMIN", "MEMBER"),
    limitBy(limits.uploadPerUser, (req) => req.user?.id ?? null, "You've uploaded a lot of files recently. Try again later."),
    upload.single("file"),
    async (req, res) => {
      const file = req.file;
      if (!file) throw new HttpError(400, "NO_FILE", 'No file was uploaded. Send it in the "file" field.');

      const roomId = routeParam(req, "roomId");
      const mimeType = UPLOAD_TYPES[path.extname(file.originalname).toLowerCase()];
      let keepFile = false;
      try {
        const problem = await checkUploadContent(file.path, mimeType === "application/pdf" ? "pdf" : "text");
        if (problem) throw new HttpError(400, "INVALID_FILE", problem);

        const document = await prisma.document.create({
          data: {
            roomId,
            uploadedById: req.user!.id,
            filename: cleanFilename(file.originalname),
            storagePath: file.filename,
            mimeType,
          },
        });
        keepFile = true;

        enqueue(() => processDocument(document.id));
        sendToRoom(roomId, {
          type: "document:update",
          document: { id: document.id, filename: document.filename, status: document.status, failureReason: null },
        });
        res.status(201).json({ document: serializeDocument(document) });
      } finally {
        if (!keepFile) await removeUploads([file.filename]);
      }
    }
  );

  router.get("/:roomId/documents", requireAuth, requireRoomRole("ADMIN", "MEMBER"), async (req, res) => {
    const documents = await prisma.document.findMany({
      where: { roomId: routeParam(req, "roomId") },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    res.json({ documents: documents.map(serializeDocument) });
  });

  return router;
}
