import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "../server/auth";
import { endpoint } from "../server/http";
import { handleFirebaseAuth } from "../server/firebase-auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => endpoint(() => getAuth().handler(request)),
      POST: async ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.includes("firebase")) {
          return handleFirebaseAuth(request);
        }
        return endpoint(() => getAuth().handler(request));
      },
    },
  },
});
