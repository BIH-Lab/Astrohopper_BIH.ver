/**
 * AstroHopper KR - Service Worker
 * 핵심 기능(자이로, 별자리, 가이드 패널)을 오프라인에서도 사용 가능하게 합니다.
 * DSS 이미지는 온라인 전용 (오프라인 시 자동 숨김).
 */

const CACHE_NAME = 'astrohopper-kr-v4';
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/js/guide.js',
    '/manifest.json',
];

// 설치: 핵심 파일 캐시
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(CORE_ASSETS);
        })
    );
    self.skipWaiting();
});

// 활성화: 이전 캐시 삭제
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch: 캐시 우선, DSS API는 네트워크 전용
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // DSS API 요청은 캐시하지 않음
    if (url.includes('archive.stsci.edu')) {
        event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
        return;
    }

    // 나머지: 캐시 우선 → 네트워크 fallback
    event.respondWith(
        caches.match(event.request).then(cached => {
            return cached || fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            });
        }).catch(() => caches.match('/index.html'))
    );
});
