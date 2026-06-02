// ============================================================
//  용어 설명 (Glossary) — 비마케터도 바로 이해
//  - 헤더 "📖 용어" 버튼 → 모달
//  - window.GLOSSARY: 인라인 ⓘ 툴팁에서도 재사용
// ============================================================

window.GLOSSARY = {
    ROAS:        { t:'ROAS (광고 효율)', d:'광고비 대비 매출. 300%면 광고비 1만원 써서 3만원 벌었다는 뜻. 높을수록 좋아요.' },
    CTR:         { t:'CTR (클릭률)', d:'광고를 본 사람 중 몇 %가 클릭했나. 소재(이미지·카피)가 얼마나 시선을 끄는지.' },
    CVR:         { t:'CVR / 구매율', d:'들어온 사람 중 몇 %가 실제로 샀나. 페이지·가격·결제 흐름이 좋은지.' },
    객단가:       { t:'객단가 (AOV)', d:'한 번 살 때 평균 결제 금액. 5만원이면 한 명이 보통 5만원어치 사간다는 뜻.' },
    장바구니율:    { t:'장바구니율 (유입→장바구니)', d:'들어온 사람 중 몇 %가 장바구니에 담았나. 관심도·소재 매력도 신호.' },
    구매율:       { t:'구매율 (장바구니→구매)', d:'장바구니에 담은 사람 중 몇 %가 결제까지 했나. 여기서 많이 새면 가격·결제 점검.' },
    한계ROAS:     { t:'한계 ROAS / 포화 곡선', d:'광고비를 계속 늘려도 어느 순간부터 매출이 잘 안 늘어요. "더 부어봤자 손해"가 시작되는 지점을 보여줘요.' },
    마감페이스:    { t:'마감 페이스', d:'지금 이 속도면 이벤트 기간 안에 목표 매출을 채울 수 있나 없나. 뒤처짐/정상/초과로 표시.' },
    사분면:       { t:'사분면 (증액/유지/감액)', d:'각 소재를 "돈 더 넣자 / 그대로 두자 / 줄이자"로 자동 분류한 신호등.' },
    블렌디드ROAS: { t:'블렌디드 ROAS', d:'특정 소재 하나가 아니라 여러 소재·매체를 다 합친 전체 평균 효율.' },
    소구포인트:    { t:'소구포인트', d:'고객에게 내세운 강점·메시지(예: 보습, 탄력, 콜라겐). 어떤 메시지가 잘 팔리는지.' },
    후킹유형:      { t:'후킹유형', d:'첫 3초/헤드라인에서 시선을 끄는 방식(예: 할인 강조, 후기, 비포애프터).' },
    장바구니담기:  { t:'장바구니 담기 (ATC)', d:'장바구니에 담은 횟수. 구매 직전 단계라 관심의 강한 신호.' },
    달성률:       { t:'목표 달성률', d:'오늘(또는 이벤트) 목표 매출 대비 실제로 얼마나 달성했나. 100% 넘으면 목표 초과.' },
    Q:           { t:'262Q / 261Q', d:'분기(시즌) 내부 코드명. 262Q=이번 시즌, 261Q=작년 동기간(비교용).' },
    이탈손실:     { t:'장바구니 이탈 손실액', d:'담아놓고 안 산 건수 × 객단가 = 놓친 매출 추정액. 금액 큰 제품부터 개선.' },
};

function _glOpen() {
    let m = document.getElementById('glossary-modal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'glossary-modal';
        m.className = 'gl-overlay';
        m.onclick = (e) => { if (e.target === m) _glClose(); };
        document.body.appendChild(m);
    }
    const groups = [
        { h:'📈 효율 지표', keys:['ROAS','CTR','CVR','객단가','블렌디드ROAS'] },
        { h:'🛒 퍼널(구매 흐름)', keys:['장바구니율','구매율','장바구니담기','이탈손실'] },
        { h:'💰 예산·목표', keys:['한계ROAS','사분면','마감페이스','달성률'] },
        { h:'🎨 소재·기타', keys:['소구포인트','후킹유형','Q'] },
    ];
    m.innerHTML = `<div class="gl-box">
        <div class="gl-hd"><span>📖 용어 설명 <span style="font-size:12px;font-weight:400;color:#94a3b8">— 마케팅 처음이어도 OK</span></span>
            <button class="gl-x" onclick="window._glClose()">✕</button></div>
        <div class="gl-body">
            ${groups.map(g => `<div class="gl-group"><div class="gl-group-h">${g.h}</div>
                ${g.keys.map(k => { const e=window.GLOSSARY[k]; return e?`<div class="gl-item"><div class="gl-term">${e.t}</div><div class="gl-desc">${e.d}</div></div>`:''; }).join('')}
            </div>`).join('')}
        </div>
    </div>`;
    m.style.display = 'flex';
}
function _glClose() { const m = document.getElementById('glossary-modal'); if (m) m.style.display = 'none'; }
window._glOpen = _glOpen;
window._glClose = _glClose;

// 인라인 ⓘ 툴팁 HTML 생성 (data-tip CSS 툴팁)
window.infoTip = function(text) {
    return `<span class="info-tip" tabindex="0" data-tip="${String(text).replace(/"/g,'&quot;')}">ⓘ</span>`;
};

// 첫 방문 안내 배너 (1회만)
window._dismissIntro = function() {
    try { localStorage.setItem('intro_seen', '1'); } catch(e) {}
    const b = document.getElementById('intro-banner'); if (b) b.style.display = 'none';
};
document.addEventListener('DOMContentLoaded', () => {
    let seen = false;
    try { seen = localStorage.getItem('intro_seen') === '1'; } catch(e) {}
    if (!seen) { const b = document.getElementById('intro-banner'); if (b) b.style.display = 'flex'; }
});
