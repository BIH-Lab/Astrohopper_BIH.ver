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
    // ── 번역 헬퍼 (index.html의 _tr() 연동) ─────────────────────────────
    function t(s) { return typeof window._tr === 'function' ? window._tr(s) : s; }

    // ── 상태 ────────────────────────────────────────────────────────────
    let isOpen        = false;
    let clickBlocked  = false;  // body selectionEvent 버블링 차단 플래그
    let sortByDist = true;
    let activeTypes = new Set(['Oc','Gc','Ne','Ga']);
    let radiusDeg  = 10.0;
    let limitMag   = 9.0;
    let currentRA  = null;
    let currentDec = null;
    let currentAlt = null;

    // ── 천체 종류 기본 레이블 (영어 키 → 번역 적용) ──────────────────────
    const TYPE_KEYS = {
        'Oc': 'Open Cl.',
        'Gc': 'Glob. Cl.',
        'Ne': 'Nebula',
        'Ga': 'Galaxy',
        'S' : 'Dbl. Star',
        'P' : 'Planet',
        'Ca': 'Const.',
        'U' : 'User',
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

    // ── DSS2 미리보기 이미지 ─────────────────────────────────────────────
    // 모든 대상을 같은 시야(fov)로 보여 줘 대상 크기를 서로 비교할 수 있게 한다.
    // 1순위: CDS hips2fits DSS2 컬러(Aladin Lite와 같은 데이터, JPEG)
    // 2순위: NASA SkyView DSS2 Red(JPEG) — CDS 접속이 안 되는 망 대비
    const FOV_OPTIONS = [0.5, 1, 2];               // 도(°)
    let previewFov = 1;
    try { localStorage.removeItem('kr_dss_fov'); } catch (e) {}   // 매 실행 1°로 시작 (이전 버전 저장값 정리)

    const PREVIEW_PX = 300;
    const DSS_SOURCES = [
        { label: 'DSS2 color', timeout: 7000, url: (ra, dec, fov) =>
            'https://alasky.cds.unistra.fr/hips-image-services/hips2fits'
            + `?hips=CDS%2FP%2FDSS2%2Fcolor&width=${PREVIEW_PX}&height=${PREVIEW_PX}`
            + `&fov=${fov}&projection=TAN&coordsys=icrs`
            + `&ra=${ra.toFixed(5)}&dec=${dec.toFixed(5)}&format=jpg` },
        { label: 'DSS2 Red', timeout: 15000, url: (ra, dec, fov) =>
            'https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl'
            + `?Survey=DSS2+Red&Position=${ra.toFixed(5)},${dec.toFixed(5)}`
            + `&Size=${fov}&Pixels=${PREVIEW_PX}&Scaling=Linear&Return=JPEG` },
    ];

    let cdsUnavailable = false;
    function firstSource() { return cdsUnavailable ? 1 : 0; }

    function fovText(fov) { return fov < 1 ? Math.round(fov * 60) + '′' : fov + '°'; }

    // ── 현재 열린 미리보기 추적 (한 번에 하나만) ─────────────────────────
    let activePreviewIdx = null;

    function closePreview(idx) {
        const box = document.getElementById('gi_preview_' + idx);
        if (!box) return;
        const img = box.querySelector('img');
        if (img) {
            clearTimeout(img._krTimer);
            img.onload  = null;
            img.onerror = null;
            img.removeAttribute('src');   // 브라우저 메모리 해제
        }
        delete box.dataset.loaded;  // 다음 열기 시 재로드 가능
        box.style.display = 'none';
    }

    // 시야(fov)에 맞춰 이미지 로드. 소스가 실패/지연되면 다음 소스로 넘어간다.
    function loadPreview(box, srcIdx) {
        const img     = box.querySelector('img');
        const loading = box.querySelector('.gi_loading');
        const label   = box.querySelector('.gi_preview_src');
        const ra  = parseFloat(box.dataset.ra), dec = parseFloat(box.dataset.dec);
        const src = DSS_SOURCES[srcIdx];

        clearTimeout(img._krTimer);
        img.onload = img.onerror = null;

        if (!src) {                                   // 모든 소스 실패
            delete box.dataset.loaded;
            if (loading) { loading.style.display = 'block'; loading.textContent = t('No image'); }
            return;
        }

        box.dataset.loaded = '1';
        if (loading) { loading.style.display = 'block'; loading.textContent = t('Loading...'); }
        img.style.display = 'none';

        const next = () => {
            img.onload = img.onerror = null;
            img.removeAttribute('src');
            // 컬러 소스(CDS)가 이 망에서 안 되면 이번 실행 동안은 건너뛰어 매번 기다리지 않게 함
            if (srcIdx === 0) cdsUnavailable = true;
            loadPreview(box, srcIdx + 1);
        };
        img._krTimer = setTimeout(next, src.timeout);
        img.onload = () => {
            clearTimeout(img._krTimer);
            img.onload = img.onerror = null;
            if (srcIdx === 0) cdsUnavailable = false;
            if (loading) loading.style.display = 'none';
            img.className = srcIdx === 0 ? '' : 'gi_mono';
            img.style.display = 'block';
            if (label) label.textContent = `${t(src.label)} · ${t('FOV')} ${fovText(previewFov)}`;
        };
        img.onerror = () => { clearTimeout(img._krTimer); next(); };
        img.src = src.url(ra, dec, previewFov);
    }

    // 시야 변경(이번 실행 동안만 유지): 열려 있는 미리보기를 다시 불러온다
    function setPreviewFov(fov, event) {
        if (event) event.stopPropagation();
        if (!FOV_OPTIONS.includes(fov)) return;
        previewFov = fov;
        document.querySelectorAll('.gi_fov_btn').forEach(b =>
            b.classList.toggle('on', parseFloat(b.dataset.fov) === fov));
        if (activePreviewIdx !== null) {
            const box = document.getElementById('gi_preview_' + activePreviewIdx);
            if (box && box.style.display === 'block') loadPreview(box, firstSource());
        }
    }

    // ── DSS 미리보기 토글 ─────────────────────────────────────────────────
    function togglePreview(idx, ra, dec, size, event) {
        event.stopPropagation();

        // 다른 미리보기가 열려 있으면 먼저 닫고 메모리 해제
        if (activePreviewIdx !== null && activePreviewIdx !== idx) {
            closePreview(activePreviewIdx);
            activePreviewIdx = null;
        }

        const box = document.getElementById('gi_preview_' + idx);
        if (!box) return;

        if (box.style.display === 'block') {
            closePreview(idx);
            activePreviewIdx = null;
            return;
        }

        activePreviewIdx = idx;
        box.style.display = 'block';

        if (!box.dataset.loaded) {
            box.dataset.ra  = ra;
            box.dataset.dec = dec;
            loadPreview(box, firstSource());
        }
    }

    // ── 목록 렌더링 ──────────────────────────────────────────────────────
    function renderList(items) {
        const el = document.getElementById('guide_list');
        if (!el) return;

        if (items.length === 0) {
            el.innerHTML = `<p style="color:#660000;padding:3mm;">${t('No objects nearby')}</p>`;
            return;
        }

        let html = `<div class="guide_item guide_header">
  <span class="gi_dot"></span>
  <span class="gi_name">${t('Object')}</span>
  <span class="gi_type">${t('Type')}</span>
  <span class="gi_mag">${t('Mag')}</span>
  <span class="gi_dist">${t('Dist')}</span>
  <span class="gi_prev_btn"></span>
</div>`;
        for (const obj of items) {
            const typeLabel = t(TYPE_KEYS[obj.type] || obj.type);
            const dimClass  = obj.alt < 20 ? ' dim' : '';
            html += `<div class="guide_item${dimClass}" onclick="AHGuide.selectObject(${obj.idx})">
  <span class="gi_dot">●</span>
  <span class="gi_name">${obj.name}</span>
  <span class="gi_type">${typeLabel}</span>
  <span class="gi_mag">★${obj.mag.toFixed(1)}</span>
  <span class="gi_dist">${obj.dist.toFixed(1)}°</span>
  <button class="gi_prev_btn" onclick="AHGuide.togglePreview(${obj.idx},${obj.ra},${obj.dec},${obj.size},event)">🔭</button>
</div>
<div class="gi_preview_box" id="gi_preview_${obj.idx}">
  <div class="gi_preview_frame">
    <span class="gi_loading">${t('Loading...')}</span>
    <img alt="${obj.name}" style="display:none" />
  </div>
  <div class="gi_preview_label">
    <span>${obj.name}${obj.size ? ' (' + obj.size + '′)' : ''} — <span class="gi_preview_src">DSS2</span></span>
    <span class="gi_fov_row">${FOV_OPTIONS.map(f =>
        `<button class="gi_fov_btn${f === previewFov ? ' on' : ''}" data-fov="${f}" onclick="AHGuide.setPreviewFov(${f},event)">${fovText(f)}</button>`).join('')}</span>
  </div>
</div>`;
        }
        el.innerHTML = html;
    }

    // ── 중심 좌표 표시 업데이트 ──────────────────────────────────────────
    function updateCenterInfo(center) {
        const el = document.getElementById('guide_center_info');
        if (!el) return;
        if (!center) {
            el.textContent = t('Alignment needed');
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
        if (typeof AHTelrad !== 'undefined') AHTelrad.syncCheckbox();
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
        if (btn) btn.textContent = sortByDist ? t('By Dist ↕') : t('By Brightness ↕');
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

    return { open, close, refresh, updateFilters, toggleType, toggleSort, selectObject, togglePreview, setPreviewFov };
})();
