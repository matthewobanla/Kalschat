import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "../server/auth";
import { endpoint } from "../server/http";
import { handleFirebaseAuth } from "../server/firebase-auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => endpoint(() => getAuth().handler(request)),
      POST: ({ request }) =>
        endpoint(async () => {
          const url = new URL(request.url);
          if (url.pathname.endsWith("/firebase")) {
            return handleFirebaseAuth(request);
          }
          return getAuth().handler(request);
        }),
    },
  },
});
