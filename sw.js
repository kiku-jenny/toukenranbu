/* 刀剑乱舞管家 · 离线缓存
   目的只有一个：第二次打开时几乎瞬时出页面，而不是每次都等那 150 KB 下载。
   策略：缓存优先 + 后台只发一个 HEAD 核对（比整页重新下载省得多）。
   线上内容变了（ETag / 修改时间 / 长度不同）才重新拉一份，并通知页面「新版本已就绪」。 */

const CACHE = 'honmaru-cache-v16';
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

  if(hit){
    revalidate(req, cache, key, hit);      /* 后台核对，不占这次打开的时间 */
    return hit;
  }
  try{
    const res = await fetch(req);
    if(res && res.ok && res.type === 'basic') cache.put(key, res.clone());
    return res;
  }catch(err){
    return new Response('现在打不开，也没有本地缓存。等网络恢复后再试。',
      {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
  }
}

/* 只发 HEAD：正常情况一个往返就够，不用再把整页拉一遍 */
async function revalidate(req, cache, key, hit){
  try{
    let head = null;
    try{
      head = await fetch(req.url, {method:'HEAD', cache:'no-store'});
    }catch(e){ head = null; }
    if(head && head.status === 405){       /* 服务器不认 HEAD：退回整页比对 */
      const res = await fetch(req, {cache:'no-store'});
      if(res && res.ok && res.type === 'basic' && stamp(res) !== stamp(hit)){
        await cache.put(key, res.clone());
        notifyUpdate();
      }
      return;
    }
    if(!head || !head.ok) return;
    const now = stamp(head), old = stamp(hit);
    if(!now || !old || now === old) return;
    const res = await fetch(req, {cache:'no-store'});
    if(res && res.ok && res.type === 'basic'){
      await cache.put(key, res.clone());
      notifyUpdate();
    }
  }catch(e){}
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
