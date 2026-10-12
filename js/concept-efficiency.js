// 소구(컨셉)별 효율 — 광고명 컨셉 토큰 기준, 제품 평균 ROAS 대비 배수
// 성과 분석 탭의 기존 필터(브랜드·날짜·이벤트·제품·캠페인)를 그대로 따름 (getBrandCreatives('performance'))

let conceptSortKey = 'idx';
let conceptExcludeCollab = true;

const CONCEPT_COLLAB_RE = /kitty|collab|キティ|키티/i;
// 6/15 이전 매출은 집계 기준이 달라(ROAS 수천 %) 컨셉 비교에서 제외
const CONCEPT_REV_FROM = '2026-06-15';
const CONCEPT_LABEL = {
    AutumnNeutral: '가을 뉴트럴', EarlyAutunn: '초가을 코랄', AutumnMood: '가을 무드', MoodSwitch: '분위기 변신', AllinOne: '하나로 무한 무드',
    LongLasting: '지속력', AfterWork: '퇴근 후 약속', BusyDay: '바쁜 아침', Vacation: '여행', Rank: '랭킹·1위', Event: '행사 특가', Tone: '톤별 컬러',
    Pinpoint: '세밀 부위', Easy: '쉬운 사용', EvenApply: '균일 밀착', Trip: '여행 휴대', Photo: '사진발', SweatProof: '땀에도 유지',
    Perfect: '완성형', NaturalCover: '자연스러운 커버', SkinTexture: '피부결', Kensho: '지속력 검증', 'Thin-layering': '얇은 레이어링',
    DetailCollage: '컬러 디테일', PaletteSpread: '팔레트 펼침', KamiPalette: '神 팔레트', HowTo: '사용법', OnedayDeal: '원데이딜',
};

// 광고명 → 컨셉 토큰 (예: SoftBlurEye_MoodSwitch_Model_v03 → MoodSwitch, 260525_SoftBlurEye_HowTo_VID → HowTo)
function conceptTokenOf(adName) {
    const t = String(adName || '').trim().split('_');
    if (t.length < 2) return '';
    const tok = /^\d{6}$/.test(t[0]) ? (t[2] || '') : t[1];
    if (/OnedayDeal/i.test(adName)) return 'OnedayDeal';
    return tok;
}

function _ceThumb(c) {
    const raw = c.thumbnail_url || c.media_url || '';
    const fb = `<div class="w-full h-full flex items-center justify-center text-slate-300"><i class="fas fa-${c.media_type === 'video' ? 'video' : 'image'}"></i></div>`;
    if (!raw) return fb;
    const cls = 'w-full h-full object-cover';
    if (typeof window.isDriveUrl === 'function' && window.isDriveUrl(raw) && typeof window.buildDriveImgHtml === 'function')
        return window.buildDriveImgHtml(raw, { className: cls, finalFallbackHtml: fb, loading: 'lazy' });
    return `<img src="${raw}" class="${cls}" loading="lazy" referrerpolicy="no-referrer" alt="">`;
}

function renderConceptEfficiency() {
    const box = document.getElementById('concept-efficiency-content');
    if (!box || typeof getBrandCreatives !== 'function') return;

    let rows = getBrandCreatives('performance').filter(c => !isNoConvPlatform((c.platform || '').toString().trim()) && (c.start_date || '').slice(0, 10) >= CONCEPT_REV_FROM);
    if (conceptExcludeCollab) rows = rows.filter(c => !CONCEPT_COLLAB_RE.test(c.ad_name || ''));
    const ads = aggregateByAdName(rows).filter(c => (c.spend || 0) > 0);
    if (!ads.length) { box.innerHTML = '<div class="text-center text-slate-400 text-sm py-10">해당 조건의 데이터가 없습니다</div>'; return; }

    // 제품 → 컨셉 → 소재
    const prodMap = new Map();
    ads.forEach(c => {
        const p = (c.product || '기타').toString().trim() || '기타';
        const tok = conceptTokenOf(c.ad_name || c.creative_name);
        if (!tok) return;
        if (!prodMap.has(p)) prodMap.set(p, { product: p, spend: 0, revenue: 0, concepts: new Map() });
        const P = prodMap.get(p); P.spend += c.spend || 0; P.revenue += c.revenue || 0;
        if (!P.concepts.has(tok)) P.concepts.set(tok, { tok, ads: [] });
        P.concepts.get(tok).ads.push(c);
    });

    const sum = (arr, f) => arr.reduce((s, c) => s + (Number(c[f]) || 0), 0);
    const products = [...prodMap.values()].filter(P => P.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 6);
    const fmtW = v => '₩' + (typeof formatKoreanShort === 'function' ? formatKoreanShort(v) : Math.round(v).toLocaleString());

    box.innerHTML = products.map(P => {
        const avg = P.revenue / P.spend;
        const minSp = Math.max(P.spend * 0.02, 300000); // 표본 기준: 제품 광고비 2% 또는 30만 원
        let list = [...P.concepts.values()].map(g => {
            const sp = sum(g.ads, 'spend'), rev = sum(g.ads, 'revenue'), imp = sum(g.ads, 'impressions'), clk = sum(g.ads, 'clicks'), cv = sum(g.ads, 'conversions'), atc = sum(g.ads, 'add_to_cart');
            const roas = sp ? rev / sp : 0;
            const rep = [...g.ads].filter(c => c.thumbnail_url || c.media_url).sort((a, b) => (b.spend || 0) - (a.spend || 0))[0] || g.ads[0];
            return { ...g, sp, rev, roas, idx: avg ? roas / avg : 0, ctr: imp ? clk / imp : 0, cvr: clk ? cv / clk : 0, cpatc: atc ? sp / atc : 0, n: g.ads.length, rep, small: sp < minSp };
        }).filter(g => g.sp >= 100000);
        if (!list.length) return '';
        const key = conceptSortKey;
        list.sort((a, b) => {
            if (a.small !== b.small) return a.small ? 1 : -1; // 표본 작은 컨셉은 뒤로
            if (key === 'cpatc') return (a.cpatc || 1e12) - (b.cpatc || 1e12);
            return (b[key] || 0) - (a[key] || 0);
        });
        const solid = list.filter(g => !g.small);
        const best = solid[0], worst = solid.length > 1 ? solid[solid.length - 1] : null;
        const lab = t => CONCEPT_LABEL[t] ? `${CONCEPT_LABEL[t]} <span class="text-slate-400 font-normal">${t}</span>` : t;
        const tag = g => g.small ? '<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-bold">표본 작음</span>'
            : g.idx >= 1.2 ? '<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold">확대</span>'
            : g.idx >= 0.8 ? '<span class="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold">유지</span>'
            : '<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-bold">지양</span>';
        const cards = list.slice(0, 10).map(g => `
            <div class="rounded-lg border border-slate-200 bg-white overflow-hidden ${g.small ? 'opacity-60' : ''}" title="${(g.rep.ad_name || '').replace(/"/g, '&quot;')}">
                <div class="aspect-square bg-slate-50">${_ceThumb(g.rep)}</div>
                <div class="p-2 text-[11px] leading-snug">
                    <div class="font-bold text-slate-800 text-xs truncate">${lab(g.tok)}</div>
                    <div class="mt-0.5"><b class="text-sm text-slate-900">${Math.round(g.roas * 100)}%</b>
                        <b class="${g.idx >= 1 ? 'text-emerald-600' : 'text-rose-600'}">${g.idx.toFixed(1)}배</b></div>
                    <div class="text-slate-500 tabular-nums">CTR ${(g.ctr * 100).toFixed(2)}% · CVR ${(g.cvr * 100).toFixed(1)}%</div>
                    <div class="text-slate-500 tabular-nums">장바구니 ${g.cpatc ? fmtW(g.cpatc) : '-'} · ${fmtW(g.sp)}</div>
                    <div class="mt-1 flex items-center gap-1">${tag(g)}<span class="text-slate-400">소재 ${g.n}</span></div>
                </div>
            </div>`).join('');
        const summary = best ? `<span class="text-emerald-700">▲ ${CONCEPT_LABEL[best.tok] || best.tok} ${best.idx.toFixed(1)}배</span>` +
            (worst && worst !== best ? ` <span class="text-slate-300">|</span> <span class="text-rose-700">▼ ${CONCEPT_LABEL[worst.tok] || worst.tok} ${worst.idx.toFixed(1)}배</span>` : '') : '';
        return `<div class="mb-5">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                <span class="font-bold text-slate-900">${P.product}</span>
                <span class="text-xs text-slate-500">평균 ROAS <b>${Math.round(avg * 100)}%</b> · 광고비 ${fmtW(P.spend)} · 컨셉 ${list.length}개</span>
                <span class="text-xs font-semibold">${summary}</span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-10 gap-2">${cards}</div>
        </div>`;
    }).join('') || '<div class="text-center text-slate-400 text-sm py-10">컨셉으로 묶을 수 있는 광고명이 없습니다</div>';
}

function initConceptEfficiency() {
    const sel = document.getElementById('concept-sort');
    if (sel && !sel._bound) { sel._bound = true; sel.addEventListener('change', () => { conceptSortKey = sel.value; renderConceptEfficiency(); }); }
    const cb = document.getElementById('concept-exclude-collab');
    if (cb && !cb._bound) { cb._bound = true; cb.addEventListener('change', () => { conceptExcludeCollab = cb.checked; renderConceptEfficiency(); }); }
}
window.renderConceptEfficiency = renderConceptEfficiency;
window.initConceptEfficiency = initConceptEfficiency;
