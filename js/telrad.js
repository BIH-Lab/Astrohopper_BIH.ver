/**
 * AstroHopper KR — 텔라드 오버레이 (AHTelrad)
 *
 * 화면 중심에 텔라드 파인더 동심원을 SVG로 그립니다.
 *   내원: 0.5° 지름  (0.25° 반경)
 *   중원: 2°   지름  (1°    반경)
 *   외원: 4°   지름  (2°    반경)
 *
 * global_fov(긴 변 기준 전체 시야각)를 읽어 픽셀 반경을 계산하며,
 * FOV가 바뀔 때(핀치 줌) requestAnimationFrame으로 자동 갱신합니다.
 * 설정창의 #telrad_checked 체크박스와 연동됩니다.
 */

const AHTelrad = (() => {
    let visible  = false;
    let svg      = null;
    let rafId    = null;
    let lastFov  = null;
    let lastW    = null;
    let lastH    = null;

    // 텔라드 동심원 — 지름(°), 색, 선 굵기
    const RINGS = [
        { diam: 0.5, color: 'rgba(210,50,10,0.95)', w: 1.5 },
        { diam: 2.0, color: 'rgba(210,50,10,0.80)', w: 1.5 },
        { diam: 4.0, color: 'rgba(210,50,10,0.55)', w: 1.5 },
    ];

    function ensureSvg() {
        if (svg) return;
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.style.cssText = [
            'position:fixed', 'top:0', 'left:0',
            'width:100%', 'height:100%',
            'pointer-events:none',
            'z-index:49',
            'display:none',
        ].join(';');
        document.body.appendChild(svg);
    }

    function syncCheckbox() {
        const cb = document.getElementById('telrad_checked');
        if (cb) cb.checked = visible;
        const btn = document.getElementById('guide_telrad_btn');
        if (btn) btn.classList.toggle('active', visible);
    }

    function draw() {
        if (!visible) return;

        const fov = (typeof global_fov !== 'undefined') ? global_fov : 60;
        const w   = window.innerWidth;
        const h   = window.innerHeight;

        // FOV·화면 크기가 바뀌지 않았으면 재렌더 생략
        if (fov === lastFov && w === lastW && h === lastH) {
            rafId = requestAnimationFrame(draw);
            return;
        }
        lastFov = fov; lastW = w; lastH = h;

        const cx = w / 2;
        const cy = h / 2;
        // global_fov = 긴 변 전체 시야각 → 픽셀/도 변환
        const pxDeg = Math.max(w, h) / fov;

        let html = '';

        // ── 동심원 ──────────────────────────────────────────────────────
        for (const r of RINGS) {
            const rpx = (r.diam / 2) * pxDeg;
            if (rpx < 3) continue;
            html += `<circle`
                  + ` cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}"`
                  + ` r="${rpx.toFixed(1)}"`
                  + ` fill="none"`
                  + ` stroke="${r.color}"`
                  + ` stroke-width="${r.w}"`
                  + `/>`;
        }

        // ── 십자선 (내원 안쪽에서 중심 방향으로 짧게) ────────────────────
        const gap = (0.25 * pxDeg) * 0.55;
        const arm = Math.min(w, h) * 0.055;
        const cs  = 'rgba(210,50,10,0.85)';
        const sw  = '1.2';
        html += `<line x1="${f(cx-gap-arm)}" y1="${f(cy)}" x2="${f(cx-gap)}" y2="${f(cy)}" stroke="${cs}" stroke-width="${sw}"/>`;
        html += `<line x1="${f(cx+gap)}" y1="${f(cy)}" x2="${f(cx+gap+arm)}" y2="${f(cy)}" stroke="${cs}" stroke-width="${sw}"/>`;
        html += `<line x1="${f(cx)}" y1="${f(cy-gap-arm)}" x2="${f(cx)}" y2="${f(cy-gap)}" stroke="${cs}" stroke-width="${sw}"/>`;
        html += `<line x1="${f(cx)}" y1="${f(cy+gap)}" x2="${f(cx)}" y2="${f(cy+gap+arm)}" stroke="${cs}" stroke-width="${sw}"/>`;

        svg.innerHTML = html;
        rafId = requestAnimationFrame(draw);
    }

    function f(n) { return n.toFixed(1); }

    function show() {
        visible = true;
        ensureSvg();
        svg.style.display = 'block';
        lastFov = null;
        rafId = requestAnimationFrame(draw);
        syncCheckbox();
    }

    function hide() {
        visible = false;
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (svg) svg.style.display = 'none';
        syncCheckbox();
    }

    function toggle() {
        visible ? hide() : show();
    }

    return { show, hide, toggle, syncCheckbox };
})();
