export class FirebaseStorageClient {
  private bucket: string;
  private apiKey: string;

  constructor(options?: { bucket?: string; apiKey?: string }) {
    this.bucket =
      options?.bucket ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      process.env.FIREBASE_STORAGE_BUCKET ||
      "kalschat.firebasestorage.app";
    this.apiKey =
      options?.apiKey ||
      process.env.VITE_FIREBASE_API_KEY ||
      process.env.FIREBASE_API_KEY ||
      "AIzaSyBAW9CM6Z2Obcx6y_tULpmaos51H17d4yY";
  }

  async createFileUpload(
    path: string,
    options: {
      byteSize?: number;
      contentType?: string;
      method?: "single" | "multipart";
      visibility?: "private" | "public";
    } = {},
  ) {
    const uploadId = `fb_up_${crypto.randomUUID()}`;
    const contentType = options.contentType || "application/octet-stream";
    return {
      file: {
        id: uploadId,
        status: "pending",
      },
      upload: {
        id: uploadId,
        url: `/api/uploads?uploadId=${encodeURIComponent(uploadId)}&path=${encodeURIComponent(path)}`,
        headers: {
          "Content-Type": contentType,
        },
      },
    };
  }

  async completePathUpload(path: string, options: { uploadId: string }) {
    return { ok: true };
  }

  async getFile(path: string) {
    const url = `https://firebasestorage.googleapis.com/v0/b/${this.bucket}/o/${encodeURIComponent(path)}?key=${this.apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.status === 404) {
      const err = new Error("File not found in storage");
      (err as { status?: number }).status = 404;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Firebase storage metadata error: ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    const data = (await res.json()) as {
      size?: string;
      contentType?: string;
      updated?: string;
    };
    return {
      file: {
        status: "ready",
        visibility: "private",
        byteSize: Number(data.size) || 0,
        contentType: data.contentType || "application/octet-stream",
        updatedAt: data.updated,
      },
    };
  }

  async createSignedUrl(path: string, options?: { expiresInSeconds?: number }) {
    const url = `https://firebasestorage.googleapis.com/v0/b/${this.bucket}/o/${encodeURIComponent(path)}?alt=media&key=${this.apiKey}`;
    return {
      signedUrl: {
        url,
      },
    };
  }

  async deleteFile(path: string) {
    const url = `https://firebasestorage.googleapis.com/v0/b/${this.bucket}/o/${encodeURIComponent(path)}?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "DELETE",
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) {
      const err = new Error("File not found");
      (err as { status?: number }).status = 404;
      throw err;
    }
    if (!res.ok && res.status !== 204) {
      const err = new Error(`Firebase storage delete error: ${res.status}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    return { ok: true };
  }
}
