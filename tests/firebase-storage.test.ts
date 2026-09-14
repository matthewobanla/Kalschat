import assert from "node:assert/strict";
import { test } from "node:test";
import { FirebaseStorageClient } from "../src/server/firebase-storage";
import { getStorage } from "../src/server/uploads";

test("FirebaseStorageClient generates valid upload URLs and headers", async () => {
  const client = new FirebaseStorageClient({
    bucket: "kalschat.firebasestorage.app",
    apiKey: "test-api-key",
  });

  const created = await client.createFileUpload("attachments/user-1/file-1/file", {
    byteSize: 1024,
    contentType: "image/png",
  });

  assert.ok(created.file.id.startsWith("fb_up_"));
  assert.equal(created.file.status, "pending");
  assert.match(created.upload.url, /^\/api\/uploads\?uploadId=fb_up_/);
  assert.match(created.upload.url, /path=attachments%2Fuser-1%2Ffile-1%2Ffile/);
  assert.equal(created.upload.headers["Content-Type"], "image/png");

  const completed = await client.completePathUpload("attachments/user-1/file-1/file", {
    uploadId: created.upload.id,
  });
  assert.deepEqual(completed, { ok: true });

  const signed = await client.createSignedUrl("attachments/user-1/file-1/file");
  assert.match(
    signed.signedUrl.url,
    /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/kalschat\.firebasestorage\.app\/o\/attachments%2Fuser-1%2Ffile-1%2Ffile\?alt=media&key=test-api-key$/,
  );
});

test("getStorage defaults to FirebaseStorageClient when Byteship API key is unset", () => {
  const oldKey = process.env.BYTESHIP_API_KEY;
  try {
    delete process.env.BYTESHIP_API_KEY;
    const storage = getStorage();
    assert.ok(storage instanceof FirebaseStorageClient);
  } finally {
    if (oldKey) process.env.BYTESHIP_API_KEY = oldKey;
  }
});
