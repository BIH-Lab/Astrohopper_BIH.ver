/**
 * AstroHopper KR - Service Worker
 * 핵심 기능(자이로, 별자리, 가이드 패널)을 오프라인에서도 사용 가능하게 합니다.
 *
 * 전략
 *  - 같은 출처(GET) 요청: 네트워크 우선(서버 재검증) → 성공 시 캐시 갱신
 *                          → 실패/지연(3초) 시 캐시 사용
 *    → 온라인이면 index.html과 js가 항상 같은 최신 버전으로 맞춰지고,
 *      관측지처럼 신호가 약하거나 없으면 캐시로 즉시 실행된다.
 *  - 다른 출처 요청(DSS 이미지, 위키, 통계 스크립트 등): 관여하지 않음
 *  - 오프라인 대체 페이지(index.html)는 페이지 이동 요청에만 사용
 *
 * JS/HTML 수정 후 배포 시 CACHE_NAME 버전을 올리면 이전 캐시가 정리된다.
 */

const CACHE_NAME = 'astrohopper-kr-v25';
const NETWORK_TIMEOUT_MS = 3000;

// 배포 경로(/Astrohopper_BIH.ver/)와 로컬 테스트 경로 모두에서 동작하도록 scope 기준으로 계산
const SCOPE = self.registration.scope;
const INDEX_URL = new URL('index.html', SCOPE).href;
const CORE_ASSETS = [
    './',
    'index.html',
    'js/guide.js',
    'js/telrad.js',
    'manifest.json',
    'icons/icon-192.png',
    'icons/icon-192-maskable.png',
    'icons/icon-512.png',
    'icons/icon-180.png',
].map(p => new URL(p, SCOPE).href);

// 설치: 핵심 파일 캐시 (HTTP 캐시를 거치지 않고 서버에서 직접 받음)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_ASSETS.map(u => new Request(u, { cache: 'reload' }))))
            .then(() => self.skipWaiting())
    );
});

// 활성화: 이전 버전 캐시 삭제
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

async function networkFirst(event) {
    const req = event.request;
    const isNav = req.mode === 'navigate';
    const cache = await caches.open(CACHE_NAME);

    // 서버 재검증(ETag → 304)으로 GitHub Pages의 10분 HTTP 캐시에 의한 버전 혼재 방지
    const netReq = isNav ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
                         : new Request(req, { cache: 'no-cache' });
    const network = fetch(netReq).then(res => {
        if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            event.waitUntil(cache.put(req, copy).catch(() => {}));
        }
        return res;
    });

    try {
        // 타임아웃 안에 응답이 오면 네트워크 결과 사용
        return await Promise.race([
            network,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
        ]);
    } catch (e) {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) {
            // 느린 네트워크 응답은 뒤에서 계속 받아 캐시만 갱신
            event.waitUntil(network.catch(() => {}));
            return cached;
        }
        if (isNav) {
            const index = await cache.match(INDEX_URL);
            if (index) return index;
        }
        // 캐시에도 없으면 네트워크 응답을 끝까지 기다림
        return network;
    }
}

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // 외부 요청은 브라우저 기본 처리
    if (!req.url.startsWith(SCOPE)) return;
    event.respondWith(networkFirst(event));
});
