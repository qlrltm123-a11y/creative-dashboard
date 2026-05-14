/* ============================
   gallery.js - 소재 갤러리 & 모달
   ============================ */

let currentView = 'grid'; // 'grid' | 'list'
let compareSelected = [null, null, null]; // 최대 3개

/* ────────────────────────────────────────
   갤러리 렌더링
──────────────────────────────────────── */
function renderGallery(brand = 'ALL', type = 'ALL', status = 'ALL', search = '', sort = 'roas', perfData = PERFORMANCE) {
  let creatives = [...CREATIVES];

  // 필터
  if (brand !== 'ALL')  creatives = creatives.filter(c => c.brand === brand);
  if (type !== 'ALL')   creatives = creatives.filter(c => c.type === type);
  if (status !== 'ALL') creatives = creatives.filter(c => c.status === status);
  if (search.trim())    creatives = creatives.filter(c =>
    c.title.includes(search) || c.concept.includes(search) || c.copy.includes(search)
  );

  // 퍼포먼스 집계
  const withPerf = creatives.map(cr => {
    const rows = perfData.filter(p => p.creative_id === cr.id);
    const perf = rows.length ? aggregatePerf(rows) : { roas: 0, ctr: 0, cpa: 0, spend: 0, conversions: 0, clicks: 0, impressions: 0 };
    return { ...cr, perf };
  });

  // 정렬
  const sortKey = { roas: 'roas', spend: 'spend', conversions: 'conversions', ctr: 'ctr' }[sort] || 'roas';
  withPerf.sort((a, b) => (b.perf[sortKey] || 0) - (a.perf[sortKey] || 0));

  if (currentView === 'grid') {
    renderGridView(withPerf);
  } else {
    renderListView(withPerf);
  }
}

function renderGridView(items) {
  const grid = document.getElementById('creativeGrid');
  const list = document.getElementById('creativeList');
  grid.classList.remove('hidden');
  list.classList.add('hidden');

  if (!items.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-dim)">
      <i class="fa-solid fa-photo-film" style="font-size:40px;display:block;margin-bottom:12px"></i>
      검색 결과가 없습니다.
    </div>`;
    return;
  }

  grid.innerHTML = items.map(cr => {
    const p = cr.perf;
    const roasCls = roasClass(p.roas);
    return `
    <article class="creative-card" onclick="openModal('${cr.id}')">
      <div class="card-media">
        <img src="${cr.media_url}" alt="${cr.title}" loading="lazy" />
        <div class="card-type-badge ${cr.type}">
          <i class="fa-solid fa-${cr.type === 'video' ? 'circle-play' : 'image'}"></i>
          ${cr.type === 'video' ? '영상' : '이미지'}
        </div>
        <div class="card-overlay"><i class="fa-solid fa-expand"></i></div>
      </div>
      <div class="card-info">
        <p class="card-title">${cr.title}</p>
        <div class="card-meta">
          ${brandBadge(cr.brand)}
          ${statusBadge(cr.status)}
          <span class="card-format">${cr.format}</span>
        </div>
        <div class="card-kpis">
          <div class="card-kpi">
            <p class="card-kpi-label">ROAS</p>
            <p class="card-kpi-val ${roasCls}">${p.roas ? p.roas + '%' : '—'}</p>
          </div>
          <div class="card-kpi">
            <p class="card-kpi-label">CTR</p>
            <p class="card-kpi-val">${p.ctr ? p.ctr.toFixed(2) + '%' : '—'}</p>
          </div>
          <div class="card-kpi">
            <p class="card-kpi-label">전환수</p>
            <p class="card-kpi-val">${p.conversions ? p.conversions.toLocaleString() : '—'}</p>
          </div>
        </div>
      </div>
    </article>`;
  }).join('');
}

function renderListView(items) {
  const grid = document.getElementById('creativeGrid');
  const list = document.getElementById('creativeList');
  grid.classList.add('hidden');
  list.classList.remove('hidden');

  if (!items.length) {
    list.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-dim)">
      <i class="fa-solid fa-photo-film" style="font-size:40px;display:block;margin-bottom:12px"></i>
      검색 결과가 없습니다.
    </div>`;
    return;
  }

  list.innerHTML = items.map(cr => {
    const p = cr.perf;
    const roasCls = roasClass(p.roas);
    return `
    <article class="creative-list-item" onclick="openModal('${cr.id}')">
      <img class="list-thumb" src="${cr.media_url}" alt="${cr.title}" loading="lazy" />
      <div class="list-info">
        <p class="list-title">${cr.title}</p>
        <div class="list-meta">
          ${brandBadge(cr.brand)}
          ${statusBadge(cr.status)}
          <span class="card-format">${cr.format}</span>
          <span class="card-type-badge ${cr.type}" style="position:static;background:var(--bg3)">
            <i class="fa-solid fa-${cr.type === 'video' ? 'circle-play' : 'image'}"></i>
            ${cr.type === 'video' ? '영상' : '이미지'}
          </span>
        </div>
      </div>
      <div class="list-kpis">
        <div class="list-kpi">
          <div class="list-kpi-label">ROAS</div>
          <div class="list-kpi-val ${roasCls}">${p.roas ? p.roas + '%' : '—'}</div>
        </div>
        <div class="list-kpi">
          <div class="list-kpi-label">CTR</div>
          <div class="list-kpi-val">${p.ctr ? p.ctr.toFixed(2) + '%' : '—'}</div>
        </div>
        <div class="list-kpi">
          <div class="list-kpi-label">집행금액</div>
          <div class="list-kpi-val">${p.spend ? fmtWon(p.spend) : '—'}</div>
        </div>
        <div class="list-kpi">
          <div class="list-kpi-label">전환수</div>
          <div class="list-kpi-val">${p.conversions ? p.conversions.toLocaleString() : '—'}</div>
        </div>
        <div class="list-kpi">
          <div class="list-kpi-label">CPA</div>
          <div class="list-kpi-val">${p.cpa ? fmtWon(p.cpa) : '—'}</div>
        </div>
      </div>
    </article>`;
  }).join('');
}

/* ────────────────────────────────────────
   소재 모달
──────────────────────────────────────── */
function openModal(creativeId) {
  const cr = CREATIVES.find(c => c.id === creativeId);
  if (!cr) return;

  const allPerf = PERFORMANCE.filter(p => p.creative_id === creativeId);
  const agg = allPerf.length ? aggregatePerf(allPerf) : {};

  // 매체별 집계
  const channels = [...new Set(allPerf.map(p => p.channel))];
  const channelCards = channels.map(ch => {
    const rows = allPerf.filter(p => p.channel === ch);
    const a = aggregatePerf(rows);
    const color = CHANNEL_COLORS[ch] || '#888';
    const icon = CHANNEL_ICONS[ch] || 'fa-solid fa-globe';
    return `
    <div class="channel-perf-card" style="border-left-color:${color}">
      <div class="channel-perf-name" style="color:${color}">
        <i class="${icon}"></i>${ch}
      </div>
      <div class="channel-perf-stats">
        <div class="ch-stat"><strong class="${roasClass(a.roas)}">${a.roas}%</strong>ROAS</div>
        <div class="ch-stat"><strong>${a.ctr.toFixed(2)}%</strong>CTR</div>
        <div class="ch-stat"><strong>${fmtWon(a.cpa)}</strong>CPA</div>
        <div class="ch-stat"><strong>${a.conversions.toLocaleString()}</strong>전환</div>
      </div>
    </div>`;
  }).join('');

  const modalHtml = `
    <div class="modal-grid">
      <div class="modal-media-wrap">
        <img src="${cr.media_url}" alt="${cr.title}" loading="lazy" decoding="async" />
      </div>
      <div class="modal-creative-info">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          ${brandBadge(cr.brand)}
          ${statusBadge(cr.status)}
          <span class="card-type-badge ${cr.type}" style="position:static;background:var(--bg3)">
            <i class="fa-solid fa-${cr.type === 'video' ? 'circle-play' : 'image'}"></i>
            ${cr.type === 'video' ? '영상' : '이미지'}
          </span>
        </div>
        <h2>${cr.title}</h2>
        <div class="modal-info-row"><strong>포맷</strong>${cr.format}</div>
        <div class="modal-info-row"><strong>컨셉</strong>${cr.concept}</div>
        <div class="modal-info-row"><strong>기간</strong>${cr.start_date} ~ ${cr.end_date}</div>
        <div class="modal-info-row"><strong>랜딩</strong>
          <a href="${cr.landing_url}" style="color:#60a5fa" target="_blank">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> 랜딩 페이지
          </a>
        </div>
        <div class="modal-copy-box">"${cr.copy}"</div>
      </div>
    </div>

    <p class="modal-section-title"><i class="fa-solid fa-gauge-high"></i> 통합 퍼포먼스</p>
    <div class="modal-kpi-grid">
      <div class="modal-kpi">
        <div class="modal-kpi-label">노출수</div>
        <div class="modal-kpi-val">${agg.impressions ? fmtNum(agg.impressions) : '—'}</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-label">클릭수</div>
        <div class="modal-kpi-val">${agg.clicks ? fmtNum(agg.clicks) : '—'}</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-label">CTR</div>
        <div class="modal-kpi-val">${agg.ctr ? agg.ctr.toFixed(2) + '%' : '—'}</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-label">집행금액</div>
        <div class="modal-kpi-val">${agg.spend ? fmtWon(agg.spend) : '—'}</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-label">전환수</div>
        <div class="modal-kpi-val">${agg.conversions ? agg.conversions.toLocaleString() : '—'}</div>
      </div>
      <div class="modal-kpi">
        <div class="modal-kpi-label">CPA</div>
        <div class="modal-kpi-val">${agg.cpa ? fmtWon(agg.cpa) : '—'}</div>
      </div>
      <div class="modal-kpi" style="grid-column:1/-1;background:${agg.roas >= 1000 ? 'rgba(16,185,129,0.15)' : 'var(--bg3)'}">
        <div class="modal-kpi-label">ROAS (전체)</div>
        <div class="modal-kpi-val ${roasClass(agg.roas || 0)}" style="font-size:22px">${agg.roas ? agg.roas + '%' : '—'}</div>
      </div>
    </div>

    ${channelCards ? `
    <p class="modal-section-title"><i class="fa-solid fa-layer-group"></i> 매체별 성과</p>
    <div class="modal-channel-grid">${channelCards}</div>
    ` : ''}
  `;

  document.getElementById('modalBody').innerHTML = modalHtml;
  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

/* ────────────────────────────────────────
   소재 비교 기능
──────────────────────────────────────── */
function renderComparePickList(brand = 'ALL') {
  const creatives = brand === 'ALL' ? CREATIVES : CREATIVES.filter(c => c.brand === brand);
  const container = document.getElementById('comparePickList');
  container.innerHTML = `
    <p class="compare-pick-title">소재를 선택하세요 (최대 3개)</p>
    <div class="pick-grid">
      ${creatives.map(cr => {
        const isSelected = compareSelected.some(s => s && s.id === cr.id);
        return `
        <div class="pick-item ${isSelected ? 'selected' : ''}" onclick="toggleCompareItem('${cr.id}')">
          <img class="pick-thumb" src="${cr.media_url}" alt="${cr.title}" loading="lazy" />
          <div class="pick-info">
            <div class="pick-name">${cr.title}</div>
            <div class="pick-brand">${cr.brand} · ${cr.type === 'video' ? '영상' : '이미지'}</div>
          </div>
          <i class="fa-solid ${isSelected ? 'fa-circle-check' : 'fa-circle'} pick-check"></i>
        </div>`;
      }).join('')}
    </div>
  `;
}

function toggleCompareItem(creativeId) {
  const cr = CREATIVES.find(c => c.id === creativeId);
  if (!cr) return;

  const existIdx = compareSelected.findIndex(s => s && s.id === creativeId);
  if (existIdx !== -1) {
    // 이미 선택됨 → 제거
    compareSelected[existIdx] = null;
  } else {
    // 빈 슬롯에 추가
    const emptyIdx = compareSelected.findIndex(s => s === null);
    if (emptyIdx === -1) {
      alert('최대 3개까지 선택할 수 있습니다.');
      return;
    }
    compareSelected[emptyIdx] = cr;
  }

  updateCompareSlots();
  renderComparePickList(getCurrentBrand());

  // 2개 이상 선택 시 결과 표시
  const filled = compareSelected.filter(Boolean);
  if (filled.length >= 2) {
    document.getElementById('compareResult').classList.remove('hidden');
    const perfData = getFilteredPerformance(getCurrentBrand(), getCurrentChannel(), getCurrentDatePrefix());
    renderCompareCharts(filled, perfData);
    renderCompareTable(filled, perfData);
  } else {
    document.getElementById('compareResult').classList.add('hidden');
  }
}

function updateCompareSlots() {
  compareSelected.forEach((cr, i) => {
    const slot = document.getElementById(`slot${i}`);
    if (!slot) return;
    if (cr) {
      slot.classList.add('filled');
      slot.innerHTML = `
        <div class="slot-filled">
          <img class="slot-img" src="${cr.media_url}" alt="${cr.title}" loading="lazy" decoding="async" />
          <div>
            <div class="slot-name">${cr.title}</div>
            <div style="display:flex;gap:6px;margin-top:4px">${brandBadge(cr.brand)}</div>
          </div>
          <button class="slot-remove" onclick="removeCompareItem(${i}, event)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>`;
    } else {
      slot.classList.remove('filled');
      const placeholder = i === 2
        ? '<i class="fa-solid fa-plus"></i><span>소재 선택 (선택)</span>'
        : '<i class="fa-solid fa-plus"></i><span>소재 선택</span>';
      slot.innerHTML = `<div class="slot-placeholder">${placeholder}</div>`;
    }
  });
}

function removeCompareItem(idx, e) {
  e.stopPropagation();
  compareSelected[idx] = null;
  // 빈 슬롯 앞으로 당기기
  const filled = compareSelected.filter(Boolean);
  compareSelected = [...filled, null, null, null].slice(0, 3);
  updateCompareSlots();
  renderComparePickList(getCurrentBrand());

  const validFilled = compareSelected.filter(Boolean);
  if (validFilled.length >= 2) {
    const perfData = getFilteredPerformance(getCurrentBrand(), getCurrentChannel(), getCurrentDatePrefix());
    renderCompareCharts(validFilled, perfData);
    renderCompareTable(validFilled, perfData);
  } else {
    document.getElementById('compareResult').classList.add('hidden');
  }
}

function renderCompareTable(selectedCreatives, perfData) {
  const wrap = document.getElementById('compareTableWrap');
  const aggs = selectedCreatives.map(cr => {
    const rows = perfData.filter(p => p.creative_id === cr.id);
    return rows.length ? aggregatePerf(rows) : {};
  });

  const metrics = [
    { label: '노출수', key: 'impressions', fmt: v => fmtNum(v) },
    { label: '클릭수', key: 'clicks', fmt: v => fmtNum(v) },
    { label: 'CTR', key: 'ctr', fmt: v => v.toFixed(2) + '%' },
    { label: '집행금액', key: 'spend', fmt: v => fmtWon(v) },
    { label: '전환수', key: 'conversions', fmt: v => v.toLocaleString() },
    { label: 'CPA', key: 'cpa', fmt: v => fmtWon(v), lower: true },
    { label: 'ROAS', key: 'roas', fmt: v => v + '%', highlight: true },
    { label: '전환매출', key: 'revenue', fmt: v => fmtWon(v) },
  ];

  const header = `<tr>
    <th style="min-width:100px">지표</th>
    ${selectedCreatives.map((cr, i) => `<th>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${brandBadge(cr.brand)}
        <span style="font-size:11.5px">${cr.title.length > 12 ? cr.title.slice(0, 12) + '…' : cr.title}</span>
      </div>
    </th>`).join('')}
  </tr>`;

  const rows = metrics.map(m => {
    const vals = aggs.map(a => a[m.key] || 0);
    const best = m.lower ? Math.min(...vals.filter(v => v > 0)) : Math.max(...vals);

    const cells = aggs.map((a, i) => {
      const v = a[m.key] || 0;
      const isBest = v === best && v > 0;
      const color = m.highlight ? (isBest ? 'var(--green)' : 'var(--text)') : (isBest ? '#60a5fa' : 'var(--text)');
      const fontW = isBest ? '800' : '500';
      return `<td style="color:${color};font-weight:${fontW}">
        ${v ? m.fmt(v) : '—'}
        ${isBest && v > 0 ? '<i class="fa-solid fa-crown" style="font-size:10px;color:#fbbf24;margin-left:4px"></i>' : ''}
      </td>`;
    }).join('');

    return `<tr><td style="color:var(--text-muted);font-weight:600">${m.label}</td>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `
    <p class="modal-section-title" style="margin-bottom:14px">
      <i class="fa-solid fa-table-columns"></i> 상세 지표 비교
    </p>
    <div class="table-scroll">
      <table class="perf-table">
        <thead>${header}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
