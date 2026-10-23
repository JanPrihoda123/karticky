/* Image helpers: downscale uploaded photos and convert to/from data URLs for backups. */
(function (global) {
  'use strict';

  const MAX_SIDE = 1600;
  const JPEG_QUALITY = 0.85;

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unsupported image')); };
      img.src = url;
    });
  }

  // Phone photos are often 3–10 MB; shrinking them keeps storage and backups small.
  // Throws if the browser cannot decode the file at all.
  async function compress(file) {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
    return blob && blob.size < file.size ? blob : file;
  }

  function toDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function fromDataURL(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/data:([^;]+)/)[1];
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  global.Img = { compress, toDataURL, fromDataURL };
})(window);
