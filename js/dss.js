/**
 * AstroHopper KR - DSS 이미지 배경 (dss.js)
 * 현재 조준 좌표의 DSS(Digitized Sky Survey) 이미지를 배경에 표시합니다.
 *
 * DSS API: https://archive.stsci.edu/cgi-bin/dss_search
 * ※ CORS 없이 img src 직접 사용으로 동작합니다.
 * ※ 온라인 전용 — 오프라인 시 이미지 숨김 처리.
 */

const AHDSS = (() => {
    let enabled      = false;
    let lastRA       = null;
    let lastDec      = null;
    let updateTimer  = null;
    const UPDATE_INTERVAL_MS = 3000;   // 3초마다 좌표 체크
    const MOVE_THRESHOLD_DEG = 0.3;    // 0.3° 이상 이동 시 이미지 갱신
    const SIZE_ARCMIN        = 40;     // DSS 이미지 크기 (각분)

    // ── DSS URL 생성 ──────────────────────────────────────────────────
    function getDSSUrl(ra, dec, sizeArcmin) {
        const base = 'https://archive.stsci.edu/cgi-bin/dss_search';
        return `${base}?v=poss2ukstu_red&r=${ra.toFixed(4)}&d=${dec.toFixed(4)}&e=J2000&h=${sizeArcmin}&w=${sizeArcmin}&f=gif&c=none`;
    }

    // ── 현재 중심 RA/Dec 가져오기 (guide.js와 동일한 방식) ───────────
    function getCenterRaDec() {
        try {
            const rays = getCameraRays();
            if (!rays || !rays[2]) return null;

            const fwd = rays[2];
            const e = fwd[0], n = fwd[1], u = fwd[2];

            const alt = Math.asin(Math.max(-1, Math.min(1, u)));
            const lat = gdata.lat * Math.PI / 180;
            const sinLat = Math.sin(lat);
            const cosLat = Math.cos(lat);
            const az  = Math.atan2(e, n);

            const sinDec = sinLat * Math.sin(alt) + cosLat * Math.cos(alt) * Math.cos(az);
            const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));

            const cosHA = (Math.sin(alt) - sinLat * sinDec) /
                          (cosLat * Math.cos(dec) + 1e-10);
            let ha = Math.acos(Math.max(-1, Math.min(1, cosHA)));
            if (Math.sin(az) > 0) ha = -ha;

            const jd = gdata.time / 1000 / 86400.0 + 2440587.5;
            const T  = (jd - 2451545.0) / 36525.0;
            let gst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
                      + 0.000387933 * T * T - T * T * T / 38710000.0;
            gst = ((gst % 360) + 360) % 360;
            const lst = (gst + gdata.lon) % 360;
            const ra = ((lst - ha * 180 / Math.PI) + 720) % 360;

            return { ra, dec: dec * 180 / Math.PI };
        } catch(e) {
            return null;
        }
    }

    // ── 이미지 업데이트 ────────────────────────────────────────────────
    function updateImage() {
        if (!enabled) return;

        const center = getCenterRaDec();
        if (!center) return;

        // 이전과 충분히 다를 때만 갱신 (API 과호출 방지)
        if (lastRA !== null && lastDec !== null) {
            const moved = Math.abs(center.ra - lastRA) + Math.abs(center.dec - lastDec);
            if (moved < MOVE_THRESHOLD_DEG) return;
        }

        lastRA  = center.ra;
        lastDec = center.dec;

        const img = document.getElementById('dss_img');
        if (!img) return;

        const url = getDSSUrl(center.ra, center.dec, SIZE_ARCMIN);

        // 이미지 로딩 중 투명도 낮추기
        img.style.opacity = '0';
        img.onload = () => {
            img.style.opacity = '0.45';
            img.style.transition = 'opacity 0.8s ease';
        };
        img.onerror = () => {
            // 로드 실패 시 숨김 (오프라인 또는 API 오류)
            img.style.opacity = '0';
        };
        img.src = url;
    }

    // ── 주기적 업데이트 루프 ──────────────────────────────────────────
    function startLoop() {
        stopLoop();
        updateImage();
        updateTimer = setInterval(updateImage, UPDATE_INTERVAL_MS);
    }

    function stopLoop() {
        if (updateTimer) {
            clearInterval(updateTimer);
            updateTimer = null;
        }
    }

    // ── 공개 API ──────────────────────────────────────────────────────
    function toggle(checked) {
        enabled = checked;
        const overlay = document.getElementById('dss_overlay');
        if (!overlay) return;

        if (enabled) {
            overlay.style.display = 'block';
            startLoop();
        } else {
            overlay.style.display = 'none';
            stopLoop();
            lastRA  = null;
            lastDec = null;
        }
    }

    return { toggle };
})();
