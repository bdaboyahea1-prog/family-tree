// Photos: shrink in the browser before uploading, and show them through short-lived signed
// links (the storage bucket is private: only members of the tree can see a photo).

const BUCKET = 'photos';
const URL_LIFETIME_S = 6 * 3600;

/**
 * Turns a picked image into a small JPEG (longest side <= max px), usually 30-90 KB.
 * Rejects with an Arabic message when the file is not a readable image.
 */
export async function compressImage(file, { max = 640, quality = 0.82 } = {}) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('اختر ملف صورة (JPG أو PNG)');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('تعذّر قراءة هذه الصورة، جرّب صورة أخرى');
  }
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // PNGs with transparency become white instead of black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('تعذّر تجهيز الصورة');
  return blob;
}

export class PhotoStore {
  constructor(sb) {
    this.sb = sb;
    this.cache = new Map(); // path -> { url, exp }
  }

  /** Current signed URL for a stored path, or undefined if not fetched yet. */
  url(path) {
    return path ? this.cache.get(path)?.url : undefined;
  }

  /** Fetch signed URLs for the paths we do not have (or that are about to expire). Returns true if anything new arrived. */
  async ensure(paths) {
    const now = Date.now();
    const need = [...new Set(paths.filter(Boolean))].filter((p) => {
      const c = this.cache.get(p);
      return !c || c.exp - now < 5 * 60 * 1000;
    });
    let changed = false;
    for (let i = 0; i < need.length; i += 100) {
      const part = need.slice(i, i + 100);
      const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrls(part, URL_LIFETIME_S);
      if (error || !data) continue; // photos are a nicety: never break the page over them
      for (const row of data) {
        if (row.signedUrl) {
          this.cache.set(row.path, { url: row.signedUrl, exp: now + URL_LIFETIME_S * 1000 });
          changed = true;
        }
      }
    }
    return changed;
  }

  /** Uploads a (compressed) photo for a person and returns its storage path. */
  async upload(treeId, personId, blob) {
    const path = `${treeId}/${personId}/${globalThis.crypto.randomUUID()}.jpg`;
    const { error } = await this.sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) throw error;
    return path;
  }

  /** Best effort: a leftover file is harmless, so failures are ignored. */
  async remove(path) {
    if (!path) return;
    this.cache.delete(path);
    try {
      await this.sb.storage.from(BUCKET).remove([path]);
    } catch {
      /* ignore */
    }
  }
}
