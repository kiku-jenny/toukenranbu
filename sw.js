/* 刀剑乱舞管家 · 离线缓存
   第一次打开正常下载，之后缓存优先，几乎瞬时出页面。

   更新机制（v53 起：打开即主动核对 + 静默自动刷新）：
   - sw.js 当版本清单：发版时把 CACHE 版本号 +1，浏览器发现 sw.js 变了就安装新 SW、
     预缓存新页面，activate 时清掉旧缓存并自动接管（skipWaiting + clients.claim）。
   - 页面每次打开都会主动 reg.update() 核对 sw.js，不再等浏览器慢节奏（可能一天）才检查。
   - 新 SW 接管(controllerchange)时前端静默 location.reload() 一次，一次打开即最新版；
     正在输入或开着弹窗时不刷新，避免打断。全程不弹提示条。
   - 离线时用缓存照常可用。 */

const CACHE = 'honmaru-cache-v53';
/* build 2026-11-25i 更新提速：前端每次打开主动 reg.update() 核对、新SW接管时静默自动刷新一次；
   每版仍升 CACHE，确保浏览器能识别 sw.js 变化并重新预缓存。 */
const PAGE = './';

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE)
      /* reload：绕过 HTTP 缓存，确保新装的 SW 里存的一定是这次发的新页面 */
      .then(function(c){ return c.add(new Request(PAGE, {cache:'reload'})); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){ return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); })); })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  const req = e.request;
  if(req.method !== 'GET') return;
  let url;
  try{ url = new URL(req.url); }catch(err){ return; }
  if(url.origin !== self.location.origin) return;          /* 云同步等跨域请求一律不插手 */
  if(url.pathname.indexOf(new URL(PAGE, self.location.href).pathname) !== 0) return;
  e.respondWith(serve(req));
});

async function serve(req){
  const cache = await caches.open(CACHE);
  const isPage = req.mode === 'navigate';
  const key = isPage ? PAGE : req;
  let hit = null;
  try{ hit = await cache.match(key, {ignoreSearch:true}); }catch(e){}

  if(hit) return hit;                                       /* 缓存优先，不再后台探测 */
  try{
    const res = await fetch(req);
    if(res && res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  }catch(err){
    return new Response('现在打不开，也没有本地缓存。等网络恢复后再试。',
      {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
}
