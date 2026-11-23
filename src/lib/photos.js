// Photos : compression avant envoi + stockage local dans IndexedDB.

const DB_NAME = 'vinted-publisher';
const STORE = 'photos';

let dbPromise = null;

// Ouverture sans version imposée : on accepte la version courante de la base
// et on ne monte d'un cran que si le magasin manque.
function openWithStore(version) {
  return new Promise((resolve, reject) => {
    const request = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) return resolve(db);
      // Base existante mais magasin absent (montée de version interrompue) :
      // on incrémente la version pour déclencher une nouvelle montée.
      const next = db.version + 1;
      db.close();
      return resolve(openWithStore(next));
    };
    request.onerror = () => reject(request.error);
  });
}

function openDb() {
  if (!dbPromise) {
    dbPromise = openWithStore().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function putPhoto(id, dataUrl) {
  return run('readwrite', (store) => store.put(dataUrl, id));
}

export function getPhoto(id) {
  return run('readonly', (store) => store.get(id));
}

export function deletePhoto(id) {
  return run('readwrite', (store) => store.delete(id));
}

const MAX_DIMENSION = 1600;
const QUALITY = 0.85;

/**
 * Redimensionne et compresse une image (JPEG) pour rester sous la limite
 * Vinted et garder des messages légers.
 */
export async function compressImage(file, { maxSize = MAX_DIMENSION, quality = QUALITY } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Fichier image attendu.');
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  return {
    dataUrl: canvas.toDataURL('image/jpeg', quality),
    width,
    height,
    name: file.name || 'photo.jpg',
  };
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // certains formats passent seulement par <img>
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Ce fichier n'est pas une image lisible."));
    };
    img.src = url;
  });
}

function dataUrlToBase64(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Image locale illisible.');
  return { mime: match[1], base64: match[2] };
}

export async function loadPhotoPayload(photoIds) {
  const out = [];
  for (const id of photoIds) {
    const dataUrl = await getPhoto(id);
    if (!dataUrl) continue;
    out.push({ id, ...dataUrlToBase64(dataUrl) });
  }
  return out;
}
