const VERSION='mb-future-beats-layout-v1';
const ASSETS=['/','/icon.svg','/video-placeholder.svg','/future.css?v=stage1','/base.css?v=stage1','/app.js?v=stage1','/layout.css?v=stage1'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([clients.claim(),caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('mb-future-beats-')&&k!==VERSION).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/media/'))return;
 if(!['/','/index.html','/icon.svg','/video-placeholder.svg','/future.css','/layout.css','/base.css','/app.js','/manifest.webmanifest'].includes(u.pathname))return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok&&r.type==='basic'){const response=r.clone();caches.open(VERSION).then(c=>c.put(e.request,response)).catch(()=>{})}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));
});
