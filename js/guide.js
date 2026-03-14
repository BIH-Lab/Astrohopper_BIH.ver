/**
 * AstroHopper KR - 관측 가이드 패널 (guide.js)
 * 현재 조준 좌표(RA/Dec) 주변의 천체 목록을 표시합니다.
 *
 * 원본 AstroHopper의 전역 변수에 의존합니다:
 *   allstars[]        - 천체 카탈로그 (RA, DE, AM, t, s, name 필드)
 *   getCameraRays()   - 현재 카메라 방향 반환
 *   gdata             - 위치/시간 데이터
 *   global_use_gyro   - 자이로 정렬 여부
 */

const AHGuide = (() => {
    // ── 상태 ────────────────────────────────────────────────────────────
    let isOpen        = false;
    let clickBlocked  = false;  // body selectionEvent 버블링 차단 플래그
    let sortByDist = true;                    // true=거리순, false=밝기순
    let activeTypes = new Set(['Oc','Gc','Ne','Ga','S']);
    let radiusDeg  = 10.0;
    let limitMag   = 9.0;
    let currentRA  = null;
    let currentDec = null;
    let currentAlt = null;  // 현재 중심 고도 (디버그용)

    // ── 천체 종류 한국어 레이블 ──────────────────────────────────────────
    const TYPE_LABELS = {
        'Oc': '산개성단',
        'Gc': '구상성단',
        'Ne': '성운',
        'Ga': '은하',
        'S' : '이중성',
        'P' : '행성',
        'Ca': '별자리',
        'U' : '사용자',
    };

    // ── 각거리 계산 ─────────────────────────────────────────────────────
    function angularDistance(ra1, dec1, ra2, dec2) {
        const toRad = d => d * Math.PI / 180;
        const cos = Math.cos(toRad(dec1)) * Math.cos(toRad(dec2)) *
                    Math.cos(toRad(ra1 - ra2))
                  + Math.sin(toRad(dec1)) * Math.sin(toRad(dec2));
        return Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
    }

    // ── 현재 중심 RA/Dec 가져오기 ──────────────────────────────────────
    // 원본 getCameraRays()의 forward 벡터 → RA/Dec 역변환
    function getCenterRaDec() {
        try {
            // getCameraRays()는 [right, up, forward] 배열을 반환
            const rays = getCameraRays();
            if (!rays) return null;

            // forward 벡터 = rays[2] = [e, n, u] (ENU 좌표)
            const fwd = rays[2];
            if (!fwd) return null;

            const e = fwd[0], n = fwd[1], u = fwd[2];

            // ENU → 고도각/방위각
            const alt = Math.asin(Math.max(-1, Math.min(1, u)));

            // ENU → 지평좌표 → 적도좌표 역변환
            // 원본 rayFromPos() 역함수: ENU → (AltAz) → (HA, Dec) → (RA, Dec)
            const lat = gdata.lat * Math.PI / 180;
            const sinLat = Math.sin(lat);
            const cosLat = Math.cos(lat);

            // 고도각/방위각 계산
            const az  = Math.atan2(e, n);  // 방위각 (북=0, 동=π/2)

            // 시간각(HA) 계산
            const sinDec = sinLat * Math.sin(alt) + cosLat * Math.cos(alt) * Math.cos(az);
            const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

            const cosHA = (Math.sin(alt) - sinLat * sinDec) /
                          (cosLat * Math.cos(dec) + 1e-10);
            let ha = Math.acos(Math.max(-1, Math.min(1, cosHA)));
            if (Math.sin(az) > 0) ha = -ha;  // 동쪽이면 음수 HA

            // 항성시 → RA
            const now = gdata.time / 1000;  // unix seconds
            const jd = now / 86400.0 + 2440587.5;
            const T  = (jd - 2451545.0) / 36525.0;
            // 그리니치 항성시 (도)
            let gst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
                      + 0.000387933 * T * T - T * T * T / 38710000.0;
            gst = ((gst % 360) + 360) % 360;
            const lst = (gst + gdata.lon) % 360;  // 지방 항성시

            let ra = ((lst - ha * 180 / Math.PI) + 720) % 360;

            currentAlt = alt * 180 / Math.PI;
            return { ra, dec: dec * 180 / Math.PI };
        } catch(e) {
            return null;
        }
    }

    // ── 천체 고도 계산 ─────────────────────────────────────────────────
    function getAltitude(ra, dec) {
        try {
            const lat  = gdata.lat  * Math.PI / 180;
            const lon  = gdata.lon  * Math.PI / 180;
            const raR  = ra  * Math.PI / 180;
            const decR = dec * Math.PI / 180;

            const jd = gdata.time / 1000 / 86400.0 + 2440587.5;
            const T  = (jd - 2451545.0) / 36525.0;
            let gst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
                      + 0.000387933 * T * T - T * T * T / 38710000.0;
            gst = ((gst % 360) + 360) % 360;
            const lst = (gst * Math.PI / 180 + lon + 2 * Math.PI) % (2 * Math.PI);
            const ha  = lst - raR;

            const sinAlt = Math.sin(lat) * Math.sin(decR)
                         + Math.cos(lat) * Math.cos(decR) * Math.cos(ha);
            return Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;
        } catch(e) {
            return 0;
        }
    }

    // ── 목록 생성 ────────────────────────────────────────────────────────
    function buildList(center) {
        if (!center) return [];

        const results = [];
        const types = activeTypes;

        for (let i = 0; i < allstars.length; i++) {
            const s = allstars[i];
            if (!s || s.t === 'Ca' || s.t === 'P') continue;
            if (!types.has(s.t)) continue;
            if (s.AM === undefined || s.AM === null) continue;
            if (s.AM > limitMag) continue;
            if (!s.RA && s.RA !== 0) continue;
            if (!s.DE && s.DE !== 0) continue;

            const dist = angularDistance(center.ra, center.dec, s.RA, s.DE);
            if (dist > radiusDeg) continue;

            const alt = getAltitude(s.RA, s.DE);
            results.push({
                idx  : i,
                id   : s.name || ('obj_' + i),
                name : s.name || '?',
                type : s.t,
                ra   : s.RA,
                dec  : s.DE,
                mag  : s.AM,
                size : s.s || 0,
                dist,
                alt,
            });
        }

        results.sort((a, b) => sortByDist
            ? a.dist - b.dist
            : a.mag  - b.mag);

        return results;
    }

    // ── 목록 렌더링 ──────────────────────────────────────────────────────
    function renderList(items) {
        const el = document.getElementById('guide_list');
        if (!el) return;

        if (items.length === 0) {
            el.innerHTML = '<p style="color:#660000;padding:3mm;">주변 천체 없음 — 반경이나 한계등급을 조정해 보세요.</p>';
            return;
        }

        let html = '';
        for (const obj of items) {
            const typeLabel = TYPE_LABELS[obj.type] || obj.type;
            const dimClass  = obj.alt < 20 ? ' dim' : '';
            const sizeStr   = obj.size > 0 ? `${obj.size.toFixed(0)}'` : '';
            html += `<div class="guide_item${dimClass}" onclick="AHGuide.selectObject(${obj.idx})">
  <span class="gi_dot">●</span>
  <span class="gi_name">${obj.name}</span>
  <span class="gi_type">${typeLabel}</span>
  <span class="gi_dist">${obj.dist.toFixed(1)}°</span>
  <span class="gi_mag">★${obj.mag.toFixed(1)}</span>
  <span class="gi_size">${sizeStr}</span>
</div>`;
        }
        el.innerHTML = html;
    }

    // ── 중심 좌표 표시 업데이트 ──────────────────────────────────────────
    function updateCenterInfo(center) {
        const el = document.getElementById('guide_center_info');
        if (!el) return;
        if (!center) {
            el.textContent = '정렬 필요';
            return;
        }
        const raH  = center.ra / 15;
        const raHH = Math.floor(raH);
        const raM  = Math.floor((raH - raHH) * 60);
        const decSign = center.dec >= 0 ? '+' : '';
        el.textContent = `RA ${raHH}h${raM.toString().padStart(2,'0')}m  Dec ${decSign}${center.dec.toFixed(1)}°`;
    }

    // ── 공개 API ─────────────────────────────────────────────────────────
    function open() {
        const panel    = document.getElementById('guide_panel');
        const backdrop = document.getElementById('guide_backdrop');
        if (!panel) return;
        if (!clickBlocked) {
            const stop = e => e.stopPropagation();
            panel.addEventListener('click',       stop);
            panel.addEventListener('touchstart',  stop);
            panel.addEventListener('touchmove',   stop);
            panel.addEventListener('touchend',    stop);
            panel.addEventListener('touchcancel', stop);
            if (backdrop) {
                backdrop.addEventListener('click',       stop);
                backdrop.addEventListener('touchstart',  stop);
                backdrop.addEventListener('touchmove',   stop);
                backdrop.addEventListener('touchend',    stop);
                backdrop.addEventListener('touchcancel', stop);
            }
            clickBlocked = true;
        }
        isOpen = true;
        panel.style.display = 'block';
        if (backdrop) backdrop.style.display = 'block';
        refresh();
    }

    function close() {
        const panel    = document.getElementById('guide_panel');
        const backdrop = document.getElementById('guide_backdrop');
        if (!panel) return;
        isOpen = false;
        panel.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
    }

    function refresh() {
        if (!isOpen) return;
        const center = getCenterRaDec();
        currentRA  = center ? center.ra  : null;
        currentDec = center ? center.dec : null;
        updateCenterInfo(center);
        const items = buildList(center);
        renderList(items);
    }

    function updateFilters() {
        const rSlider = document.getElementById('guide_radius');
        const mSlider = document.getElementById('guide_mag_range');
        if (rSlider) {
            radiusDeg = parseFloat(rSlider.value);
            const rv = document.getElementById('guide_radius_val');
            if (rv) rv.textContent = radiusDeg;
        }
        if (mSlider) {
            limitMag = parseFloat(mSlider.value) / 10;
            const mv = document.getElementById('guide_mag_val');
            if (mv) mv.textContent = limitMag.toFixed(1);
        }
        refresh();
    }

    function toggleType(type) {
        if (activeTypes.has(type)) {
            activeTypes.delete(type);
        } else {
            activeTypes.add(type);
        }
        const btn = document.getElementById('gf_' + type);
        if (btn) {
            btn.classList.toggle('active', activeTypes.has(type));
        }
        refresh();
    }

    function toggleSort() {
        sortByDist = !sortByDist;
        const btn = document.getElementById('guide_sort_btn');
        if (btn) btn.textContent = sortByDist ? '거리순 ↕' : '밝기순 ↕';
        refresh();
    }

    function selectObject(idx) {
        if (idx >= 0 && idx < allstars.length) {
            global_target_index = idx;
            const star = allstars[idx];
            const nameEl = document.getElementById('search_field_main');
            if (nameEl && star && star.name) {
                nameEl.value = star.name;
            }
            if (typeof showHideInfoIcon === 'function') {
                showHideInfoIcon();
            }
        }
        close();
    }

    return { open, close, refresh, updateFilters, toggleType, toggleSort, selectObject };
})();
