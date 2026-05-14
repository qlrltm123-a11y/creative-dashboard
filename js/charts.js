/* ============================
   charts.js - Chart.js 시각화
   ============================ */

let chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

const baseFont  = { family: "'Pretendard','Apple SD Gothic Neo',sans-serif" };
const gridColor = 'rgba(42,49,71,0.8)';
const tickColor = '#8892a4';

// ctx.parsed 안전 접근 헬퍼
function safeY(ctx) {
  return (ctx.parsed && ctx.parsed.y !== undefined) ? (ctx.parsed.y || 0) : 0;
}
function safeX(ctx) {
  return (ctx.parsed && ctx.parsed.x !== undefined) ? (ctx.parsed.x || 0) : 0;
}

function baseTooltipStyle() {
  return {
    backgroundColor: '#1e2535', borderColor: '#2a3147', borderWidth: 1,
    titleColor: '#e2e8f0', bodyColor: '#8892a4',
    titleFont: { ...baseFont, size: 12, weight: '700' },
    bodyFont:  { ...baseFont, size: 12 },
    padding: 12, cornerRadius: 10
  };
}
function baseLegend(pos) {
  return {
    position: pos || 'top',
    labels: { color: tickColor, font: { ...baseFont, size: 11.5 }, boxWidth: 12, boxHeight: 12, padding: 14 }
  };
}

// 공통 datalabel 옵션 (y축 기반)
function yDatalabel(fmtFn) {
  return {
    display: ctx => safeY(ctx) > 0,
    color: '#e2e8f0',
    font: { size: 10, weight: '700', family: baseFont.family },
    anchor: 'end', align: 'end',
    formatter: (v) => (v || 0) > 0 ? fmtFn(v) : ''
  };
}

/* ────────────────────────────────────────
   1) 브랜드별 ROAS 비교 (Grouped Bar)
──────────────────────────────────────── */
function renderBrandRoasChart(perfData) {
  destroyChart('chartBrandRoas');
  const el = document.getElementById('chartBrandRoas');
  if (!el) return;

  const channels = [...new Set(perfData.map(p => p.channel))].sort();
  const brands   = ['BOH', 'WM', 'CG'];

  const datasets = brands.map(brand => ({
    label: brand,
    data: channels.map(ch => {
      const rows = perfData.filter(p => p.brand === brand && p.channel === ch);
      if (!rows.length) return 0;
      return aggregatePerf(rows).roas || 0;
    }),
    backgroundColor: BRAND_COLORS[brand] + 'bb',
    borderColor: BRAND_COLORS[brand],
    borderWidth: 1.5, borderRadius: 6, borderSkipped: false
  }));

  chartInstances['chartBrandRoas'] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels: channels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: baseLegend('top'),
        tooltip: {
          ...baseTooltipStyle(),
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ROAS ${safeY(ctx)}%` }
        },
        datalabels: yDatalabel(v => v + '%')
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 }, callback: v => v + '%' } }
      }
    },
    plugins: [ChartDataLabels]
  });

  const legendEl = document.getElementById('brandRoasLegend');
  if (legendEl) {
    legendEl.innerHTML = brands.map(b =>
      `<span class="legend-item"><span class="legend-dot" style="background:${BRAND_COLORS[b]}"></span>${b}</span>`
    ).join('');
  }
}

/* ────────────────────────────────────────
   2) 매체별 집행 비중 (Doughnut)
──────────────────────────────────────── */
function renderChannelSpendChart(perfData) {
  destroyChart('chartChannelSpend');
  const el = document.getElementById('chartChannelSpend');
  if (!el) return;

  const channels = [...new Set(perfData.map(p => p.channel))];
  const spends   = channels.map(ch =>
    perfData.filter(p => p.channel === ch).reduce((s, r) => s + (r.spend || 0), 0)
  );

  chartInstances['chartChannelSpend'] = new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: channels,
      datasets: [{
        data: spends,
        backgroundColor: channels.map(ch => CHANNEL_COLORS[ch] || '#888'),
        borderColor: '#161b27', borderWidth: 3, hoverOffset: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: tickColor, font: { ...baseFont, size: 11.5 },
            boxWidth: 12, boxHeight: 12, padding: 10,
            generateLabels: chart => {
              const ds  = chart.data.datasets[0];
              const tot = ds.data.reduce((a, b) => a + b, 0) || 1;
              return chart.data.labels.map((label, i) => ({
                text: `${label}  ${((ds.data[i] / tot) * 100).toFixed(1)}%`,
                fillStyle:   ds.backgroundColor[i],
                strokeStyle: ds.backgroundColor[i],
                lineWidth: 0, hidden: false, index: i
              }));
            }
          }
        },
        tooltip: {
          ...baseTooltipStyle(),
          callbacks: {
            label: ctx => {
              const val = (ctx.parsed !== undefined && ctx.parsed !== null)
                ? (typeof ctx.parsed === 'object' ? (ctx.parsed.y || 0) : ctx.parsed)
                : 0;
              return ` ${fmtWon(val)}`;
            }
          }
        },
        datalabels: { display: false }
      }
    },
    plugins: [ChartDataLabels]
  });
}

/* ────────────────────────────────────────
   3) 매체별 CTR (Horizontal Bar)
──────────────────────────────────────── */
function renderChannelCtrChart(perfData) {
  destroyChart('chartChannelCtr');
  const el = document.getElementById('chartChannelCtr');
  if (!el) return;

  const channels = ['Meta', 'Google', 'Naver', 'Kakao', 'TikTok', 'YouTube'];
  const ctrs = channels.map(ch => {
    const rows = perfData.filter(p => p.channel === ch);
    if (!rows.length) return 0;
    const imp = rows.reduce((s, r) => s + r.impressions, 0);
    const cl  = rows.reduce((s, r) => s + r.clicks, 0);
    return imp > 0 ? parseFloat(((cl / imp) * 100).toFixed(2)) : 0;
  });

  chartInstances['chartChannelCtr'] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: channels,
      datasets: [{
        data: ctrs,
        backgroundColor: channels.map(ch => (CHANNEL_COLORS[ch] || '#888') + 'bb'),
        borderColor:     channels.map(ch => CHANNEL_COLORS[ch] || '#888'),
        borderWidth: 1.5, borderRadius: 6, borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...baseTooltipStyle(),
          callbacks: { label: ctx => ` CTR: ${safeX(ctx)}%` }
        },
        datalabels: {
          display: ctx => safeX(ctx) > 0,
          color: '#e2e8f0',
          font: { size: 11, weight: '700', family: baseFont.family },
          anchor: 'end', align: 'right',
          formatter: v => (v || 0) + '%'
        }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 }, callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { color: tickColor, font: { ...baseFont, size: 12, weight: '600' } } }
      }
    },
    plugins: [ChartDataLabels]
  });
}

/* ────────────────────────────────────────
   4) 브랜드별 집행금액 vs 전환매출
──────────────────────────────────────── */
function renderSpendRevenueChart(perfData) {
  destroyChart('chartSpendRevenue');
  const el = document.getElementById('chartSpendRevenue');
  if (!el) return;

  const brands   = ['BOH', 'WM', 'CG'];
  const spends   = brands.map(b => perfData.filter(p => p.brand === b).reduce((s, r) => s + r.spend, 0));
  const revenues = brands.map(b => perfData.filter(p => p.brand === b).reduce((s, r) => s + r.revenue, 0));

  chartInstances['chartSpendRevenue'] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: brands,
      datasets: [
        { label: '집행금액', data: spends,   backgroundColor: '#4A90E244', borderColor: '#4A90E2', borderWidth: 1.5, borderRadius: 6, borderSkipped: false },
        { label: '전환매출', data: revenues, backgroundColor: '#10b98144', borderColor: '#10b981', borderWidth: 1.5, borderRadius: 6, borderSkipped: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: baseLegend('top'),
        tooltip: {
          ...baseTooltipStyle(),
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtWon(safeY(ctx))}` }
        },
        datalabels: { display: false }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 }, callback: v => fmtWon(v) } }
      }
    },
    plugins: [ChartDataLabels]
  });
}

/* ────────────────────────────────────────
   5) 소재 유형별 성과 (Radar)
──────────────────────────────────────── */
function renderCreativeTypeChart(perfData) {
  destroyChart('chartCreativeType');
  const el = document.getElementById('chartCreativeType');
  if (!el) return;

  const imageIds = CREATIVES.filter(c => c.type === 'image').map(c => c.id);
  const videoIds = CREATIVES.filter(c => c.type === 'video').map(c => c.id);
  const imgRows  = perfData.filter(p => imageIds.includes(p.creative_id));
  const vidRows  = perfData.filter(p => videoIds.includes(p.creative_id));
  const imgAgg   = imgRows.length ? aggregatePerf(imgRows) : { roas:0, ctr:0, cpa:0, conversions:0, clicks:0 };
  const vidAgg   = vidRows.length ? aggregatePerf(vidRows) : { roas:0, ctr:0, cpa:0, conversions:0, clicks:0 };

  const normalize = (val, max) => max > 0 ? Math.min(10, (val / max) * 10) : 0;
  const maxRoas = Math.max(imgAgg.roas, vidAgg.roas) || 1;
  const maxCtr  = Math.max(imgAgg.ctr,  vidAgg.ctr)  || 1;
  const maxCv   = Math.max(imgRows.reduce((s,r) => s+r.conversions,0), vidRows.reduce((s,r) => s+r.conversions,0)) || 1;
  const maxCl   = Math.max(imgRows.reduce((s,r) => s+r.clicks,0),      vidRows.reduce((s,r) => s+r.clicks,0))      || 1;
  const effImg  = imgAgg.cpa > 0 ? 50000 / imgAgg.cpa : 0;
  const effVid  = vidAgg.cpa > 0 ? 50000 / vidAgg.cpa : 0;
  const maxEff  = Math.max(effImg, effVid) || 1;

  chartInstances['chartCreativeType'] = new Chart(el.getContext('2d'), {
    type: 'radar',
    data: {
      labels: ['ROAS', 'CTR', '전환수', '클릭 규모', 'CPA 효율'],
      datasets: [
        {
          label: '이미지',
          data: [
            normalize(imgAgg.roas, maxRoas),
            normalize(imgAgg.ctr, maxCtr),
            normalize(imgRows.reduce((s,r)=>s+r.conversions,0), maxCv),
            normalize(imgRows.reduce((s,r)=>s+r.clicks,0), maxCl),
            normalize(effImg, maxEff)
          ],
          backgroundColor: '#60a5fa22', borderColor: '#60a5fa', borderWidth: 2,
          pointBackgroundColor: '#60a5fa', pointRadius: 4
        },
        {
          label: '영상',
          data: [
            normalize(vidAgg.roas, maxRoas),
            normalize(vidAgg.ctr, maxCtr),
            normalize(vidRows.reduce((s,r)=>s+r.conversions,0), maxCv),
            normalize(vidRows.reduce((s,r)=>s+r.clicks,0), maxCl),
            normalize(effVid, maxEff)
          ],
          backgroundColor: '#fb923c22', borderColor: '#fb923c', borderWidth: 2,
          pointBackgroundColor: '#fb923c', pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: baseLegend('top'),
        tooltip: { ...baseTooltipStyle() },
        datalabels: { display: false }
      },
      scales: {
        r: {
          min: 0, max: 10,
          grid: { color: gridColor },
          angleLines: { color: gridColor },
          pointLabels: { color: tickColor, font: { ...baseFont, size: 10.5 } },
          ticks: { display: false }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

/* ────────────────────────────────────────
   6) 소재별 ROAS 분포 (Performance Tab)
──────────────────────────────────────── */
function renderCreativeRoasChart(perfData, brand) {
  destroyChart('chartCreativeRoas');
  const el = document.getElementById('chartCreativeRoas');
  if (!el) return;

  const creatives = (!brand || brand === 'ALL') ? CREATIVES : CREATIVES.filter(c => c.brand === brand);
  const labels = [], roasData = [], colors = [], borderColors = [];

  creatives.forEach(cr => {
    const rows = perfData.filter(p => p.creative_id === cr.id);
    if (!rows.length) return;
    const agg = aggregatePerf(rows);
    labels.push(cr.title.length > 14 ? cr.title.slice(0, 14) + '…' : cr.title);
    roasData.push(agg.roas || 0);
    colors.push(BRAND_COLORS[cr.brand] + '88');
    borderColors.push(BRAND_COLORS[cr.brand]);
  });

  chartInstances['chartCreativeRoas'] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'ROAS (%)', data: roasData,
        backgroundColor: colors, borderColor: borderColors,
        borderWidth: 1.5, borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...baseTooltipStyle(), callbacks: { label: ctx => ` ROAS: ${safeY(ctx)}%` } },
        datalabels: yDatalabel(v => v + '%')
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor, font: { ...baseFont, size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 }, callback: v => v + '%' } }
      }
    },
    plugins: [ChartDataLabels]
  });
}

/* ────────────────────────────────────────
   7) 소재 포맷별 성과 (Bubble)
──────────────────────────────────────── */
function renderFormatPerfChart(perfData) {
  destroyChart('chartFormatPerf');
  const el = document.getElementById('chartFormatPerf');
  if (!el) return;

  const formatMap = {};
  CREATIVES.forEach(cr => {
    const rows = perfData.filter(p => p.creative_id === cr.id);
    if (!rows.length) return;
    const agg = aggregatePerf(rows);
    const fmt = cr.format.split(' ')[0];
    if (!formatMap[fmt]) formatMap[fmt] = { spend:0, revenue:0, conversions:0, brand: cr.brand };
    formatMap[fmt].spend       += agg.spend;
    formatMap[fmt].revenue     += agg.revenue;
    formatMap[fmt].conversions += agg.conversions;
  });

  const datasets = Object.entries(formatMap).map(([fmt, d]) => ({
    label: fmt,
    data: [{ x: d.spend/10000, y: d.revenue/10000, r: Math.min(28, Math.max(5, d.conversions/30)) }],
    backgroundColor: (BRAND_COLORS[d.brand] || '#888') + '55',
    borderColor: BRAND_COLORS[d.brand] || '#888',
    borderWidth: 1.5
  }));

  chartInstances['chartFormatPerf'] = new Chart(el.getContext('2d'), {
    type: 'bubble',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: tickColor, font: { ...baseFont, size: 10 }, boxWidth: 10, padding: 8 } },
        tooltip: {
          ...baseTooltipStyle(),
          callbacks: {
            label: ctx => [
              ` 포맷: ${ctx.dataset.label}`,
              ` 집행: ${fmtWon((ctx.raw.x || 0) * 10000)}`,
              ` 매출: ${fmtWon((ctx.raw.y || 0) * 10000)}`
            ]
          }
        },
        datalabels: { display: false }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          title: { display: true, text: '집행금액 (만원)', color: tickColor, font: { ...baseFont, size: 11 } },
          ticks: { color: tickColor, font: { ...baseFont, size: 10 } }
        },
        y: {
          grid: { color: gridColor },
          title: { display: true, text: '전환매출 (만원)', color: tickColor, font: { ...baseFont, size: 11 } },
          ticks: { color: tickColor, font: { ...baseFont, size: 10 } }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

/* ────────────────────────────────────────
   8) 매체 × 브랜드 ROAS 히트맵 (Table)
──────────────────────────────────────── */
function renderHeatmap(perfData) {
  const wrap = document.getElementById('heatmapWrap');
  if (!wrap) return;

  const brands   = ['BOH', 'WM', 'CG'];
  const channels = ['Meta', 'Google', 'Naver', 'Kakao', 'TikTok', 'YouTube'];

  let html = `<table class="heatmap-table">
    <thead><tr><th></th>${channels.map(ch => `<th>${ch}</th>`).join('')}</tr></thead>
    <tbody>`;

  brands.forEach(brand => {
    html += `<tr><td class="row-label">${brand}</td>`;
    channels.forEach(ch => {
      const rows = perfData.filter(p => p.brand === brand && p.channel === ch);
      if (!rows.length) { html += `<td style="color:#2a3147;font-weight:400">—</td>`; return; }
      const roas = aggregatePerf(rows).roas || 0;
      let bg, color;
      if      (roas >= 1500) { bg = 'rgba(16,185,129,0.35)'; color = '#6ee7b7'; }
      else if (roas >= 1000) { bg = 'rgba(16,185,129,0.18)'; color = '#34d399'; }
      else if (roas >=  700) { bg = 'rgba(245,158,11,0.20)'; color = '#fbbf24'; }
      else if (roas >=  500) { bg = 'rgba(239,68,68,0.18)';  color = '#f87171'; }
      else                   { bg = 'rgba(239,68,68,0.08)';  color = '#ef4444'; }
      html += `<td style="background:${bg};color:${color}">${roas}%</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

/* ────────────────────────────────────────
   9) CPA 비교 (Grouped Bar)
──────────────────────────────────────── */
function renderCpaChart(perfData) {
  destroyChart('chartCpa');
  const el = document.getElementById('chartCpa');
  if (!el) return;

  const brands   = ['BOH', 'WM', 'CG'];
  const channels = ['Meta', 'Google', 'Naver', 'Kakao', 'TikTok', 'YouTube'];

  const datasets = brands.map(brand => ({
    label: brand,
    data: channels.map(ch => {
      const rows = perfData.filter(p => p.brand === brand && p.channel === ch);
      if (!rows.length) return 0;
      return aggregatePerf(rows).cpa || 0;
    }),
    backgroundColor: BRAND_COLORS[brand] + '88',
    borderColor: BRAND_COLORS[brand],
    borderWidth: 1.5, borderRadius: 5, borderSkipped: false
  }));

  chartInstances['chartCpa'] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: { labels: channels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: baseLegend('top'),
        tooltip: {
          ...baseTooltipStyle(),
          callbacks: {
            label: ctx => safeY(ctx) > 0
              ? ` ${ctx.dataset.label}: CPA ${safeY(ctx).toLocaleString()}원`
              : ` ${ctx.dataset.label}: 데이터 없음`
          }
        },
        datalabels: { display: false }
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 }, callback: v => (v/1000).toFixed(0) + 'K' } }
      }
    },
    plugins: [ChartDataLabels]
  });
}

/* ────────────────────────────────────────
   10) 소재 비교 차트 3종
──────────────────────────────────────── */
function renderCompareCharts(selectedCreatives, perfData) {
  if (!selectedCreatives || selectedCreatives.length < 2) return;

  const labels = selectedCreatives.map(cr =>
    cr.title.length > 12 ? cr.title.slice(0, 12) + '…' : cr.title
  );
  const colors = selectedCreatives.map(cr => BRAND_COLORS[cr.brand] || '#888');

  const aggs = selectedCreatives.map(cr => {
    const rows = perfData.filter(p => p.creative_id === cr.id);
    return rows.length
      ? aggregatePerf(rows)
      : { roas:0, ctr:0, cpa:0, spend:0, conversions:0, revenue:0, impressions:0, clicks:0 };
  });

  _renderCompareBar('chartCompareRoas', labels, colors, 'ROAS (%)',
    aggs.map(a => a.roas || 0),
    ctx => ` ROAS: ${safeY(ctx)}%`,
    v => v + '%'
  );
  _renderCompareBar('chartCompareCtr', labels, colors, 'CTR (%)',
    aggs.map(a => parseFloat((a.ctr || 0).toFixed(2))),
    ctx => ` CTR: ${safeY(ctx)}%`,
    v => v + '%'
  );
  _renderCompareBar('chartCompareCpa', labels, colors, 'CPA (원)',
    aggs.map(a => a.cpa || 0),
    ctx => safeY(ctx) > 0 ? ` CPA: ${safeY(ctx).toLocaleString()}원` : ' 데이터 없음',
    v => v > 0 ? (v/1000).toFixed(1) + 'K' : '0'
  );
}

function _renderCompareBar(chartId, labels, colors, dataLabel, data, tooltipFn, fmtFn) {
  destroyChart(chartId);
  const el = document.getElementById(chartId);
  if (!el) return;

  chartInstances[chartId] = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: dataLabel, data,
        backgroundColor: colors.map(c => c + '88'),
        borderColor: colors,
        borderWidth: 2, borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...baseTooltipStyle(), callbacks: { label: tooltipFn } },
        datalabels: {
          display: ctx => safeY(ctx) > 0,
          color: '#e2e8f0',
          font: { size: 11, weight: '700', family: baseFont.family },
          anchor: 'end', align: 'end',
          formatter: (v) => fmtFn(v || 0)
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor, font: { ...baseFont, size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { ...baseFont, size: 11 } } }
      }
    },
    plugins: [ChartDataLabels]
  });
}
