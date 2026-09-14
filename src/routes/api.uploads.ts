import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getDb } from "../server/db";
import { uploadSchema } from "../lib/contracts";
import {
  completeUpload,
  prepareUpload,
  discardUpload,
} from "../server/uploads";
import {
  endpoint,
  json,
  readJson,
  requireOrigin,
  requireUser,
  HttpError,
} from "../server/http";
import { takeLimit } from "../server/access";
import { getPostHogClient } from "../lib/posthog-server";
export const Route = createFileRoute("/api/uploads")({
  server: {
    handlers: {
      PUT: ({ request }) =>
        endpoint(async () => {
          requireOrigin(request);
          const viewer = await requireUser(request);
          const url = new URL(request.url);
          const path = url.searchParams.get("path");
          const uploadId = url.searchParams.get("uploadId");
          if (!path || !uploadId)
            throw new HttpError(400, "Missing upload parameters.");
          if (!path.includes(`/${viewer.id}/`))
            throw new HttpError(403, "Unauthorized upload destination.");

          const bucket =
            process.env.VITE_FIREBASE_STORAGE_BUCKET ||
            process.env.FIREBASE_STORAGE_BUCKET ||
            "kalschat.firebasestorage.app";
          const apiKey =
            process.env.VITE_FIREBASE_API_KEY ||
            process.env.FIREBASE_API_KEY ||
            "AIzaSyBAW9CM6Z2Obcx6y_tULpmaos51H17d4yY";
          const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(path)}&key=${apiKey}`;

          const contentType =
            request.headers.get("content-type") || "application/octet-stream";
          const body = await request.arrayBuffer();
          const res = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": contentType },
            body,
          });
          if (!res.ok) {
            console.error(
              "[Firebase Storage Upload Error]:",
              res.status,
              await res.text(),
            );
            throw new HttpError(502, "Failed to store uploaded file.");
          }
          return json({ ok: true });
        }),
      POST: ({ request }) =>
        endpoint(async () => {
          requireOrigin(request);
          const viewer = await requireUser(request);
          const db = getDb();
          await takeLimit(db, viewer.id, "uploads", 30);
          const input = z
            .discriminatedUnion("type", [
              uploadSchema.extend({ type: z.literal("prepare") }),
              z.object({ type: z.literal("complete"), id: z.uuid() }),
              z.object({ type: z.literal("discard"), id: z.uuid() }),
            ])
            .parse(await readJson(request));
          const result =
            input.type === "prepare"
              ? await prepareUpload(db, viewer.id, input)
              : input.type === "discard"
                ? await discardUpload(db, viewer.id, input.id)
                : await completeUpload(db, viewer.id, input.id);
          if (input.type === "complete") {
            const posthog = getPostHogClient();
            if (posthog) {
              const sessionId = request.headers.get("X-PostHog-Session-Id");
              posthog.capture({
                distinctId: viewer.id,
                event: "file_uploaded",
                properties: {
                  $session_id: sessionId || undefined,
                  upload_id: input.id,
                },
              });
              await posthog.flush();
            }
          }
          return json(result);
        }),
    },
  },
});
