/* Service Worker — Simulador CDB (offline: Android + iOS)
   Para publicar uma nova versão: altere VERSAO abaixo (ex.: 'cdb-v2'). */
const VERSAO = 'cdb-v1';
const CACHE_APP = VERSAO + '-app';
const CACHE_FONTES = VERSAO + '-fontes';

const APP = ['./', 'index.html', 'manifest.webmanifest',
             'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'apple-touch-icon.png'];

const FONTES_CSS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap';
const HOSTS_FONTES = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const TIMEOUT_REDE_MS = 4000; // rede lenta/instável: cai para o cache

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const app = await caches.open(CACHE_APP);
    await app.addAll(APP.map(u => new Request(u, { cache: 'reload' })));
    // Fontes: melhor esforço (se falhar, o app usa a fonte do sistema)
    try {
      const fontes = await caches.open(CACHE_FONTES);
      const resp = await fetch(FONTES_CSS);
      await fontes.put(FONTES_CSS, resp.clone());
      const css = await resp.text();
      const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
      await Promise.all(urls.map(u => fetch(u).then(r => fontes.put(u, r)).catch(() => {})));
    } catch (e) {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => !n.startsWith(VERSAO)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function redeComTimeout(req) {
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error('timeout')), TIMEOUT_REDE_MS);
    fetch(req).then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); falha(e); });
  });
}

// App: rede primeiro (pega atualização quando online), cache como reserva (offline)
async function redePrimeiro(req) {
  const cache = await caches.open(CACHE_APP);
  try {
    const resp = await redeComTimeout(req);
    if (resp && resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    const guardado = await cache.match(req, { ignoreSearch: true });
    if (guardado) return guardado;
    if (req.mode === 'navigate') {
      const pagina = (await cache.match('index.html')) || (await cache.match('./'));
      if (pagina) return pagina;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

// Fontes: usa o cache na hora e atualiza em segundo plano
async function cacheEAtualiza(req) {
  const cache = await caches.open(CACHE_FONTES);
  const guardado = await cache.match(req, { ignoreVary: true });
  const rede = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) cache.put(req, r.clone()); return r; }).catch(() => null);
  return guardado || (await rede) || new Response('', { status: 504 });
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (HOSTS_FONTES.includes(url.hostname)) { ev.respondWith(cacheEAtualiza(req)); return; }
  if (url.origin === self.location.origin) ev.respondWith(redePrimeiro(req));
});
