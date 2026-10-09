const LIBS = {
  heic: 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
  utif: 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js',
  zip:  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
};
const MAX_SIDE = 16384;

const FORMATS = [
  { id: 'png',  label: 'PNG',  mime: 'image/png',  ext: 'png',  lossy: false, alpha: true },
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg',  lossy: true,  alpha: false },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true,  alpha: true },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', ext: 'avif', lossy: true,  alpha: true },
  { id: 'bmp',  label: 'BMP',  mime: 'image/bmp',  ext: 'bmp',  lossy: false, alpha: false },
  { id: 'ico',  label: 'ICO',  mime: 'image/x-icon', ext: 'ico', lossy: false, alpha: true },
  { id: 'svg',  label: 'SVG',  mime: 'image/svg+xml', ext: 'svg', lossy: false, alpha: true },
];
const HINTS = {
  png: 'Sem perdas, com transparência.',
  jpeg: 'Ideal para fotos. Arquivo menor, sem transparência.',
  webp: 'Formato moderno: menor que JPEG e com transparência.',
  avif: 'Compressão excelente, mas nem todo navegador gera AVIF.',
  bmp: 'Bitmap sem compressão (24 bits).',
  ico: 'Ícone para favicon/Windows. Limitado a 256×256 px.',
  svg: 'SVG de origem continua vetorial. Imagens raster são embutidas dentro de um SVG.',
};

const $ = id => document.getElementById(id);
const items = [];
let nextId = 1;
let gen = 0;
let timer = null;

/* ---------- utilidades ---------- */
const loaded = {};
function loadScript(src) {
  return loaded[src] ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => { delete loaded[src]; rej(new Error('Falha ao carregar biblioteca (sem internet?)')); };
    document.head.appendChild(s);
  });
}
function loadImg(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Formato não suportado pelo navegador'));
    img.src = url;
  });
}
function toBlob(canvas, mime, quality) {
  return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Falha ao gerar imagem')), mime, quality));
}
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}
function baseName(name) { return name.replace(/\.[^.]+$/, '') || 'imagem'; }
function extOf(file) {
  const m = /\.([^.]+)$/.exec(file.name);
  return (m ? m[1] : (file.type.split('/')[1] || '?')).toUpperCase();
}

/* ---------- SVG ---------- */
function parseSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('SVG inválido');
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const px = v => { const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v || ''); return m ? parseFloat(m[1]) : 0; };
  let w = px(svg.getAttribute('width')), h = px(svg.getAttribute('height'));
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (!w && !h) { w = vb[2]; h = vb[3]; }
    else if (!w) w = h * vb[2] / vb[3];
    else if (!h) h = w * vb[3] / vb[2];
  }
  w = w || 512; h = h || 512;
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  return { svg, w, h };
}
function svgString(item, W, H, { fill = null, strip = false } = {}) {
  const s = item.svg.cloneNode(true);
  s.setAttribute('width', W);
  s.setAttribute('height', H);
  if (Math.abs(W / H - item.w / item.h) > 0.01) s.setAttribute('preserveAspectRatio', 'none');
  if (strip) stripSvgBackground(s);
  const bg = fill;
  if (bg) {
    const r = s.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('width', '100%'); r.setAttribute('height', '100%'); r.setAttribute('fill', bg);
    s.insertBefore(r, s.firstChild);
  }
  return new XMLSerializer().serializeToString(s);
}
// Remove retângulos que cobrem todo o SVG antes de qualquer desenho (fundo típico)
const SVG_SKIP = new Set(['defs', 'metadata', 'title', 'desc', 'style', 'script', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'filter', 'symbol', 'marker']);
const SVG_DRAW = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline', 'line', 'image', 'use', 'text', 'foreignobject']);
function stripSvgBackground(svg) {
  const style = svg.getAttribute('style');
  if (style) svg.setAttribute('style', style.replace(/background(-color)?\s*:[^;]+;?/gi, ''));
  const [vx, vy, vw, vh] = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  const num = v => parseFloat(v || '0');
  const covers = el => {
    if (el.localName.toLowerCase() !== 'rect' || el.getAttribute('transform')) return false;
    const w = el.getAttribute('width'), h = el.getAttribute('height');
    const fullW = w === '100%' || num(w) >= vw * 0.98;
    const fullH = h === '100%' || num(h) >= vh * 0.98;
    const x = num(el.getAttribute('x')), y = num(el.getAttribute('y'));
    return fullW && fullH && x <= vx + vw * 0.01 && y <= vy + vh * 0.01;
  };
  const walk = parent => {
    for (const el of [...parent.children]) {
      const tag = el.localName.toLowerCase();
      if (SVG_SKIP.has(tag)) continue;
      if (SVG_DRAW.has(tag)) {
        if (!covers(el)) return false;
        el.remove();
        continue;
      }
      if (walk(el) === false) return false;
    }
  };
  walk(svg);
}

async function svgImage(str) {
  const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }));
  try { return await loadImg(url); } finally { URL.revokeObjectURL(url); }
}

/* ---------- decodificação ---------- */
async function decode(file) {
  const name = file.name.toLowerCase(), type = file.type;
  if (type === 'image/svg+xml' || name.endsWith('.svg')) {
    const { svg, w, h } = parseSvg(await file.text());
    const item = { kind: 'svg', svg, w, h };
    item.src = await svgImage(svgString(item, Math.round(w), Math.round(h)));
    return item;
  }
  if (/hei[cf]/.test(type) || /\.hei[cf]$/.test(name)) {
    await loadScript(LIBS.heic);
    let out = await heic2any({ blob: file, toType: 'image/png' });
    if (Array.isArray(out)) out = out[0];
    return rasterFromBlob(out);
  }
  if (/tiff/.test(type) || /\.tiff?$/.test(name)) {
    await loadScript(LIBS.utif);
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    UTIF.decodeImage(buf, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const c = document.createElement('canvas');
    c.width = ifds[0].width; c.height = ifds[0].height;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), c.width, c.height), 0, 0);
    return { kind: 'raster', src: c, w: c.width, h: c.height };
  }
  return rasterFromBlob(file);
}
async function rasterFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImg(url);
    await img.decode().catch(() => {});
    return { kind: 'raster', src: img, w: img.naturalWidth, h: img.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- opções ---------- */
function opts() {
  return {
    format: document.querySelector('input[name=fmt]:checked').value,
    quality: +$('quality').value / 100,
    width: +$('width').value || 0,
    height: +$('height').value || 0,
    keep: $('keep').checked,
    scale: +$('scale').value || 100,
    bg: $('bg').value,
    bgMode: document.querySelector('input[name=bgmode]:checked').value,
    tolerance: +$('tolerance').value,
  };
}
function targetSize(item, o, fmt) {
  const { w: w0, h: h0 } = item;
  let W = o.width, H = o.height;
  if (!W && !H) { W = w0 * o.scale / 100; H = h0 * o.scale / 100; }
  else if (o.keep) {
    if (W && !H) H = W * h0 / w0;
    else if (H && !W) W = H * w0 / h0;
    else { const s = Math.min(W / w0, H / h0); W = w0 * s; H = h0 * s; }
  } else { W = W || w0; H = H || h0; }
  if (fmt.id === 'ico') { const s = Math.min(1, 256 / Math.max(W, H)); W *= s; H *= s; }
  W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
  if (W > MAX_SIDE || H > MAX_SIDE) throw new Error(`Tamanho máximo é ${MAX_SIDE}px por lado`);
  return { W, H };
}

/* ---------- codificação ---------- */
async function rasterize(item, W, H, { fill = null, remove = false, tolerance = 20 } = {}) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const src = item.kind === 'svg' ? await svgImage(svgString(item, W, H, { strip: remove })) : item.src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, W, H);
  if (remove) removeBackground(c, tolerance);
  if (fill) {
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  return c;
}

// Apaga o fundo a partir das bordas (flood fill pela cor predominante dos cantos)
function removeBackground(c, tolPct) {
  const w = c.width, h = c.height, ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const tol = Math.max(1, tolPct / 100 * 255), tol2 = tol * tol;
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(p => [d[p * 4], d[p * 4 + 1], d[p * 4 + 2], d[p * 4 + 3]]);
  const near = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 <= tol2;
  const ref = corners.reduce((best, c1) => {
    const n = corners.filter(c2 => near(c1, c2)).length;
    return n > best.n ? { c: c1, n } : best;
  }, { c: corners[0], n: 0 }).c;
  if (ref[3] < 16) return; // a imagem já tem fundo transparente
  const dist2 = p => {
    const i = p * 4;
    if (d[i + 3] < 16) return 0;
    return (d[i] - ref[0]) ** 2 + (d[i + 1] - ref[1]) ** 2 + (d[i + 2] - ref[2]) ** 2;
  };
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let top = 0;
  const push = p => { if (!seen[p] && dist2(p) <= tol2) { seen[p] = 1; stack[top++] = p; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const p = stack[--top], x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  // Suaviza a borda: pixels vizinhos ao fundo e parecidos com ele ficam semitransparentes
  for (let p = 0; p < w * h; p++) {
    if (seen[p]) { d[p * 4 + 3] = 0; continue; }
    const x = p % w;
    const edge = (x > 0 && seen[p - 1]) || (x < w - 1 && seen[p + 1]) || (p >= w && seen[p - w]) || (p < w * (h - 1) && seen[p + w]);
    if (!edge) continue;
    const dist = Math.sqrt(dist2(p));
    if (dist < tol * 2) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * (dist - tol) / tol);
  }
  ctx.putImageData(img, 0, 0);
}
function encodeBMP(c) {
  const w = c.width, h = c.height;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  const row = Math.ceil(w * 3 / 4) * 4, size = 54 + row * h;
  const buf = new ArrayBuffer(size), v = new DataView(buf), u = new Uint8Array(buf);
  v.setUint16(0, 0x4D42, true); v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true); v.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      u[o++] = d[i + 2]; u[o++] = d[i + 1]; u[o++] = d[i];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}
async function encodeICO(c) {
  const png = new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer());
  const buf = new ArrayBuffer(22 + png.length), v = new DataView(buf);
  v.setUint16(2, 1, true); v.setUint16(4, 1, true);
  v.setUint8(6, c.width >= 256 ? 0 : c.width); v.setUint8(7, c.height >= 256 ? 0 : c.height);
  v.setUint16(10, 1, true); v.setUint16(12, 32, true);
  v.setUint32(14, png.length, true); v.setUint32(18, 22, true);
  new Uint8Array(buf).set(png, 22);
  return new Blob([buf], { type: 'image/x-icon' });
}
async function convert(item, o) {
  const fmt = FORMATS.find(f => f.id === o.format);
  const { W, H } = targetSize(item, o, fmt);
  const fill = (o.bgMode === 'color' || !fmt.alpha) ? o.bg : null;
  const ropts = { fill, remove: o.bgMode === 'remove', tolerance: o.tolerance };
  let blob;
  if (fmt.id === 'svg') {
    if (item.kind === 'svg') blob = new Blob([svgString(item, W, H, { fill, strip: ropts.remove })], { type: fmt.mime });
    else {
      const png = (await rasterize(item, W, H, ropts)).toDataURL('image/png');
      const str = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><image width="${W}" height="${H}" href="${png}" xlink:href="${png}"/></svg>`;
      blob = new Blob([str], { type: fmt.mime });
    }
  } else {
    const c = await rasterize(item, W, H, ropts);
    if (fmt.id === 'bmp') blob = encodeBMP(c);
    else if (fmt.id === 'ico') blob = await encodeICO(c);
    else blob = await toBlob(c, fmt.mime, fmt.lossy ? o.quality : undefined);
  }
  return { blob, W, H, fmt };
}

/* ---------- interface ---------- */
function buildFormats() {
  const box = $('formats');
  FORMATS.forEach((f, i) => {
    const l = document.createElement('label');
    l.innerHTML = `<input type="radio" name="fmt" value="${f.id}"${i === 0 ? ' checked' : ''}><span>${f.label}</span>`;
    box.appendChild(l);
  });
  box.addEventListener('change', onOptsChange);
  // Desativa formatos que o navegador não consegue gerar
  const c = document.createElement('canvas'); c.width = c.height = 1;
  ['image/webp', 'image/avif'].forEach(mime => c.toBlob(b => {
    if (!b || b.type !== mime) {
      const input = box.querySelector(`input[value="${mime.split('/')[1]}"]`);
      input.disabled = true;
      input.parentElement.title = 'Seu navegador não gera este formato';
      if (input.checked) { box.querySelector('input[value=png]').checked = true; onOptsChange(); }
    }
  }, mime));
}

function makeThumb(item, src = item.src) {
  const c = document.createElement('canvas');
  const s = Math.min(1, 128 / Math.max(item.w, item.h));
  c.width = Math.max(1, Math.round(item.w * s)); c.height = Math.max(1, Math.round(item.h * s));
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function addItemEl(item) {
  const el = document.createElement('div');
  el.className = 'item';
  el.innerHTML = `<div class="thumb"></div>
    <div class="info"><div class="name"></div><div class="meta"><span class="src"></span><br><span class="out"></span></div></div>
    <div class="btns"><a class="dl" aria-disabled="true">Baixar</a><button type="button" aria-label="Remover">✕</button></div>`;
  el.querySelector('.name').textContent = item.file.name;
  el.querySelector('.name').title = item.file.name;
  el.querySelector('button').onclick = () => removeItem(item);
  item.el = el;
  $('list').appendChild(el);
  renderItem(item);
}

function renderItem(item) {
  const el = item.el;
  const src = el.querySelector('.src'), out = el.querySelector('.out'), dl = el.querySelector('.dl');
  const dims = item.w ? ` · ${Math.round(item.w)}×${Math.round(item.h)}` : '';
  src.textContent = `${extOf(item.file)}${dims} · ${fmtBytes(item.file.size)}`;
  const thumbBox = el.querySelector('.thumb'), want = (!item.error && item.outThumb) || item.thumb;
  if (want && thumbBox.firstChild !== want) thumbBox.replaceChildren(want);
  out.className = 'out';
  if (item.error) {
    out.innerHTML = ''; out.className = 'out err'; out.textContent = item.error;
  } else if (item.status === 'working' || item.status === 'decoding') {
    out.innerHTML = `<span class="spin"></span>${item.status === 'decoding' ? 'Lendo…' : 'Convertendo…'}`;
  } else if (item.result) {
    const r = item.result, diff = Math.round((r.blob.size / item.file.size - 1) * 100);
    out.textContent = `→ ${r.fmt.label} · ${r.W}×${r.H} · ${fmtBytes(r.blob.size)} `;
    const d = document.createElement('span');
    d.className = diff <= 0 ? 'ok' : '';
    d.textContent = `(${diff > 0 ? '+' : ''}${diff}%)`;
    out.appendChild(d);
  } else out.textContent = '';
  if (item.result && !item.error) {
    dl.href = item.url; dl.download = item.outName; dl.removeAttribute('aria-disabled');
  } else {
    dl.removeAttribute('href'); dl.setAttribute('aria-disabled', 'true');
  }
}

function updateToolbar() {
  $('empty').hidden = items.length > 0;
  $('clearBtn').disabled = items.length === 0;
  $('zipBtn').disabled = !items.some(i => i.result && !i.error);
}

async function addFiles(files) {
  const added = [];
  for (const file of files) {
    if (!file || !(file.type.startsWith('image/') || /\.(svg|hei[cf]|tiff?|ico|bmp|avif)$/i.test(file.name))) continue;
    const item = { id: nextId++, file, status: 'decoding' };
    items.push(item); added.push(item);
    addItemEl(item);
  }
  updateToolbar();
  await Promise.all(added.map(async item => {
    try {
      Object.assign(item, await decode(item.file));
      item.thumb = makeThumb(item);
      item.status = 'ready';
    } catch (e) {
      item.error = e.message || 'Não foi possível ler a imagem';
      item.status = 'failed';
    }
    renderItem(item);
  }));
  scheduleConvert(0);
}

function removeItem(item) {
  const i = items.indexOf(item);
  if (i >= 0) items.splice(i, 1);
  if (item.url) URL.revokeObjectURL(item.url);
  item.el.remove();
  updateToolbar();
}

async function resultThumb(r) {
  try {
    const { src } = await rasterFromBlob(r.blob);
    return makeThumb({ w: r.W, h: r.H }, src);
  } catch { return null; }
}

function scheduleConvert(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(convertAll, delay);
}

async function convertAll() {
  const g = ++gen, o = opts(), key = JSON.stringify(o);
  for (const item of [...items]) {
    if (g !== gen) return;
    if (item.status === 'decoding' || item.status === 'failed' || item.key === key) continue;
    item.status = 'working'; item.error = null; renderItem(item);
    try {
      const r = await convert(item, o);
      if (g !== gen) return;
      if (item.url) URL.revokeObjectURL(item.url);
      item.result = r; item.url = URL.createObjectURL(r.blob);
      item.outName = `${baseName(item.file.name)}.${r.fmt.ext}`;
      item.key = key;
      item.outThumb = await resultThumb(r);
    } catch (e) {
      item.error = e.message || 'Falha na conversão'; item.result = null; item.key = null;
    }
    item.status = 'ready';
    renderItem(item);
    updateToolbar();
  }
}

function onOptsChange() {
  const fmt = FORMATS.find(f => f.id === opts().format);
  $('qualityField').hidden = !fmt.lossy;
  $('fmtHint').textContent = HINTS[fmt.id];
  $('qval').textContent = $('quality').value + '%';
  const mode = document.querySelector('input[name=bgmode]:checked').value;
  $('tolVal').textContent = $('tolerance').value + '%';
  $('tolField').hidden = mode !== 'remove';
  $('colorField').hidden = mode !== 'color' && fmt.alpha;
  $('bgHint').textContent = {
    transparent: 'Mantém o fundo como está no original. SVG sem fundo continua sem fundo.',
    remove: 'Apaga a cor de fundo a partir das bordas. Em SVG, remove o retângulo de fundo. Aumente a tolerância se sobrar fundo.',
    color: 'Preenche o fundo com a cor escolhida.',
  }[mode] + (fmt.alpha ? '' : ` ${fmt.label} não suporta transparência: o fundo vira a cor escolhida.`);
  scheduleConvert();
}

async function downloadZip() {
  const btn = $('zipBtn');
  btn.disabled = true; btn.textContent = 'Gerando zip…';
  try {
    await loadScript(LIBS.zip);
    const zip = new JSZip(), used = new Set();
    for (const item of items) {
      if (!item.result || item.error) continue;
      let name = item.outName, n = 2;
      while (used.has(name)) name = item.outName.replace(/(\.[^.]+)$/, `-${n++}$1`);
      used.add(name);
      zip.file(name, item.result.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'imagens-convertidas.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.textContent = 'Baixar todas (.zip)';
    updateToolbar();
  }
}

/* ---------- eventos ---------- */
buildFormats();
onOptsChange();
updateToolbar();

['quality', 'width', 'height', 'keep', 'scale', 'bg', 'tolerance'].forEach(id => $(id).addEventListener('input', onOptsChange));
$('bgModes').addEventListener('change', onOptsChange);
$('file').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
$('zipBtn').addEventListener('click', downloadZip);
$('clearBtn').addEventListener('click', () => [...items].forEach(removeItem));

const drop = $('drop');
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());
document.addEventListener('paste', e => {
  const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile());
  if (files.length) addFiles(files);
});
