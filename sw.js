/* 刀剑乱舞管家 · 离线缓存
   目的只有一个：第二次打开时几乎瞬时出页面，而不是每次都等那 150 KB 下载。
   策略：缓存优先 + 后台核对（stale-while-revalidate）。
   发现线上内容变了（ETag 不同），就更新缓存并通知页面「新版本已就绪」。 */

const CACHE = 'honmaru-cache-v1';
const PAGE = './';

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE)
      .then(function(c){ return c.add(new Request(PAGE, {cache:'reload'})); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){
        return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); }));
      })
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

  const netP = fetch(req).then(function(res){
    if(res && res.ok && res.type === 'basic'){
      const nowStamp = stamp(res);
      const oldStamp = hit ? stamp(hit) : '';
      if(!hit || (nowStamp && nowStamp !== oldStamp)){
        cache.put(key, res.clone());
        if(hit && nowStamp !== oldStamp) notifyUpdate();   /* 线上已经换了新版本 */
      }
    }
    return res;
  }).catch(function(){ return null; });

  if(hit){
    netP.catch(function(){});            /* 后台核对，失败也不影响这次打开 */
    return hit;
  }
  const res = await netP;
  return res || new Response('现在打不开，也没有本地缓存。等网络恢复后再试。',
    {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
}

function notifyUpdate(){
  self.clients.matchAll({type:'window'}).then(function(list){
    list.forEach(function(c){ c.postMessage({type:'hk-update'}); });
  });
}

/* 用能拿到的头部拼个指纹：GitHub Pages 有 ETag，普通服务器常只有 Last-Modified / 长度 */
function stamp(res){
  if(!res || !res.headers) return '';
  const h = res.headers;
  return [h.get('etag') || '', h.get('last-modified') || '', h.get('content-length') || ''].join('|');
}
