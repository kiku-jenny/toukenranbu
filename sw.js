/* 刀剑乱舞管家 · 离线缓存
   第一次打开正常下载，之后缓存优先，几乎瞬时出页面。

   更新机制（v18 起改为标准 Service Worker 流程）：
   - 去掉了原来「每次打开都发 HEAD 探测」的逻辑：HEAD 返回的 content-length 是
     压缩后的大小，和缓存里 GET 响应的解压大小对不上，会一直误报「有新版本」。
   - 改由 sw.js 自身当版本清单：发版时把 CACHE 版本号 +1，浏览器发现 sw.js 变了
     就会安装新 SW、预缓存新页面；activate 时提示一次「新版本已就绪」。
   - 平时不发任何探测请求，不会误报；不点提示也没关系，下次打开自动就是新版。 */

const CACHE = 'honmaru-cache-v31';
/* build 2026-11-20c 模板页编辑锁+滚动跳转查找：改字节触发重装刷新缓存页，CACHE 名不变故不弹提示 */
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
    caches.keys().then(function(keys){
      /* 存在旧版本缓存 = 这是一次「更新」而非首次安装，提示一次即可 */
      const hadOld = keys.some(function(k){ return k !== CACHE && k.indexOf('honmaru-cache-') === 0; });
      return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); }))
        .then(function(){ return hadOld; });
    })
    .then(function(hadOld){ return self.clients.claim().then(function(){ return hadOld; }); })
    .then(function(hadOld){ if(hadOld) notifyUpdate(); })
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

function notifyUpdate(){
  /* 带上版本号，页面端据此按版本去重：同一版本只提示一次 */
  self.clients.matchAll({type:'window'}).then(function(list){
    list.forEach(function(c){ c.postMessage({type:'hk-update', ver:CACHE}); });
  });
}
