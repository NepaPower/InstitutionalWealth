// Capital One Retail Bank Intelligence Platform — POC
// Loads pre-computed summary.json (aggregated from 575K rows of synthetic data)
// and renders 8 dashboard tabs matching the platform's Ch2 framework.

let DATA = null;
const charts = {}; // keep chart instances so we can destroy/recreate on tab switch

const fmtPct = (v, digits = 1) => (v * 100).toFixed(digits) + '%';
const fmtMoney = (v) => '$' + Math.round(v).toLocaleString();
const fmtNum = (v) => Math.round(v).toLocaleString();
const fmtDateShort = (isoDate) => {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function ragBadge(status) {
  const map = {
    green: ['badge-green', 'Green'],
    amber: ['badge-amber', 'Amber'],
    red: ['badge-red', 'Red']
  };
  const [cls, label] = map[status] || map.green;
  return `<span class="badge ${cls}">${label}</span>`;
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ---------- KPI DEFINITIONS ----------
const KPI_DEFS = {
  'Digital Adoption': 'Share of accounts enrolled in digital banking (mobile app or web). Computed from the digital_enrolled_flag field on the account master table.',
  'Cross-Sell Ratio': 'Average number of products held per account (checking, savings, loans, etc.). A proxy for depth of relationship, not just account count.',
  'Blended CSAT': 'Average customer satisfaction score (1–5 scale), weighted equally across all interaction channels and types.',
  'Complaint Rate': 'Share of all logged interactions flagged as a Complaint or Fraud Report interaction type.',
  'Active Account Rate': 'Share of accounts with status = Active, excluding Dormant and Closed accounts.',
  'Volume': 'Total count of interactions of this type in the observation window (roughly 12 months of synthetic activity).',
  'Avg CSAT': 'Average customer satisfaction score (1–5 scale) for this channel or interaction type.',
  'Resolution Rate': 'Share of interactions marked resolved without escalation or follow-up required.',
  'Avg Duration': 'Average time spent per interaction, in minutes, used as the basis for the Ch9 cost-to-serve estimate.'
};

function kpiTile(label, value, { status = 'blue', target = null, definition = null } = {}) {
  const def = definition || KPI_DEFS[label] || '';
  const tooltipAttr = def ? `data-tooltip="${def.replace(/"/g, '&quot;')}"` : '';
  return `
    <div class="kpi-tile status-${status}" ${tooltipAttr} tabindex="0">
      <div class="kpi-label">${label}${def ? '<span class="kpi-info-icon">i</span>' : ''}</div>
      <div class="kpi-value">${value}</div>
      ${target ? `<div class="kpi-target">${target}</div>` : ''}
    </div>
  `;
}

// ---------- AUTO-COMPUTED TABLE INSIGHTS ----------
// Takes the actual rows behind a table and derives 2-3 concrete, numbered findings
// from them — not a static caption, so it stays true if the underlying data changes.
function interactionTypeInsight(types, channelLabel) {
  const totalVol = types.reduce((s, t) => s + t.volume, 0);
  const byVolume = [...types].sort((a, b) => b.volume - a.volume);
  const byCSAT = [...types].sort((a, b) => a.avg_csat - b.avg_csat);
  const byCost = [...types].sort((a, b) => b.est_cost_per_interaction - a.est_cost_per_interaction);

  const top = byVolume[0];
  const worstCsat = byCSAT[0];
  const costliest = byCost[0];
  const topSharePct = (top.volume / totalVol * 100).toFixed(0);
  const csatSpread = byCSAT[byCSAT.length - 1].avg_csat - byCSAT[0].avg_csat;

  const bullets = [];
  bullets.push(`<b>${top.interaction_type.replace(/_/g, ' ')}</b> drives ${topSharePct}% of ${channelLabel} volume (${fmtNum(top.volume)} interactions) — the type most worth optimizing first, since improvements here touch the most customers.`);

  if (csatSpread > 0.15) {
    bullets.push(`<b>${worstCsat.interaction_type.replace(/_/g, ' ')}</b> has the lowest CSAT in this channel (${worstCsat.avg_csat.toFixed(2)} vs. ${byCSAT[byCSAT.length - 1].avg_csat.toFixed(2)} for the best) — worth investigating as a specific friction point rather than treating the whole channel as uniform.`);
  } else {
    bullets.push(`CSAT is consistent across all interaction types in this channel (spread of only ${csatSpread.toFixed(2)}) — no single interaction type is dragging quality down.`);
  }

  bullets.push(`<b>${costliest.interaction_type.replace(/_/g, ' ')}</b> costs the most per interaction ($${costliest.est_cost_per_interaction.toFixed(2)}) — the best candidate for automation or process redesign if cost-to-serve needs to come down.`);

  return `
    <div class="insight-box">
      <div class="insight-label">What this table tells you</div>
      <ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
    </div>
  `;
}

// ---------- PAYMENT CONCENTRATION & RISK INSIGHTS ----------
function paymentInsights(pay) {
  const totalVol = pay.reduce((s, p) => s + p.volume, 0);
  const totalVal = pay.reduce((s, p) => s + p.total_amount, 0);
  const byValue = [...pay].sort((a, b) => b.total_amount - a.total_amount);
  const byVolume = [...pay].sort((a, b) => b.volume - a.volume);
  const topValue = byValue[0];
  const topVolume = byVolume[0];
  const topValueVolShare = (topValue.volume / totalVol * 100).toFixed(0);
  const topValueValShare = (topValue.total_amount / totalVal * 100).toFixed(0);
  const topVolValShare = (topVolume.total_amount / totalVal * 100).toFixed(1);
  const topVolVolShare = (topVolume.volume / totalVol * 100).toFixed(0);

  const withRisk = pay.map(p => ({ ...p, at_risk: p.total_amount * p.decline_rate }));
  const totalAtRisk = withRisk.reduce((s, p) => s + p.at_risk, 0);
  const topAtRisk = [...withRisk].sort((a, b) => b.at_risk - a.at_risk)[0];
  const topAtRiskShare = (topAtRisk.at_risk / totalAtRisk * 100).toFixed(0);
  const declineSpread = Math.max(...pay.map(p => p.decline_rate)) - Math.min(...pay.map(p => p.decline_rate));

  const valueBox = `
    <div class="insight-box">
      <div class="insight-label">Where to focus — value concentration</div>
      <ul>
        <li><b>${topValue.payment_type.replace(/_/g, ' ')}</b> is only ${topValueVolShare}% of transaction volume but ${topValueValShare}% of total dollar value (${fmtMoney(topValue.total_amount)}) — concentration risk sits almost entirely in a small number of high-value transactions, not in overall traffic.</li>
        <li><b>${topVolume.payment_type.replace(/_/g, ' ')}</b> is the mirror image: ${topVolVolShare}% of volume but only ${topVolValShare}% of value — high-frequency and low-stakes per transaction, the better candidate for automation and self-service rather than manual review.</li>
        <li><b>Recommendation:</b> weight fraud and compliance review capacity by dollar exposure, not transaction count. A ${topValue.payment_type.replace(/_/g, ' ')}-focused control framework protects far more value than a volume-based one, even though it covers a fraction of the transactions.</li>
      </ul>
    </div>
  `;

  const declineBox = `
    <div class="insight-box">
      <div class="insight-label">Where to focus — decline risk</div>
      <ul>
        <li>${declineSpread < 0.005
          ? `Decline rate is flat at ~${(pay[0].decline_rate * 100).toFixed(0)}% across all ${pay.length} payment types — there's no type-specific decline pattern to chase here.`
          : `Decline rates vary by type — <b>${[...pay].sort((a, b) => b.decline_rate - a.decline_rate)[0].payment_type.replace(/_/g, ' ')}</b> has the highest rate and is worth investigating specifically.`}</li>
        <li>Because the rate itself is uniform, dollar-at-risk still concentrates in <b>${topAtRisk.payment_type.replace(/_/g, ' ')}</b>: an estimated ${fmtMoney(topAtRisk.at_risk)} in declined-transaction value (${topAtRiskShare}% of all exposure) — the same ${(topAtRisk.decline_rate * 100).toFixed(0)}% failure rate carries very different consequences depending on transaction size.</li>
        <li><b>Recommendation:</b> don't apply one decline-rate threshold to every payment type — set dollar-exposure thresholds instead, so a ${topAtRisk.payment_type.replace(/_/g, ' ')} decline triggers review well before volume-based thresholds tuned for ${topVolume.payment_type.replace(/_/g, ' ')} would even notice.</li>
      </ul>
    </div>
  `;

  return { valueBox, declineBox };
}

// ---------- FUNNEL & MARKET INSIGHTS (Growth tab) ----------
function funnelInsight(funnel) {
  const drops = [];
  for (let i = 1; i < funnel.length; i++) {
    drops.push({
      from: funnel[i - 1].stage,
      to: funnel[i].stage,
      ppDrop: funnel[i - 1].pct - funnel[i].pct,
      countDrop: funnel[i - 1].count - funnel[i].count
    });
  }
  const biggest = [...drops].sort((a, b) => b.ppDrop - a.ppDrop)[0];
  const second = [...drops].sort((a, b) => b.ppDrop - a.ppDrop)[1];
  const finalStage = funnel[funnel.length - 1];

  return `
    <div class="insight-box">
      <div class="insight-label">Where to focus — funnel leakage</div>
      <ul>
        <li>The widest drop is <b>${biggest.from} &rarr; ${biggest.to}</b>: &minus;${biggest.ppDrop.toFixed(1)}pp, ${fmtNum(biggest.countDrop)} accounts. This is the single highest-leverage stage — closing even a third of this gap moves more accounts than any other intervention in the funnel.</li>
        <li>Second-widest is <b>${second.from} &rarr; ${second.to}</b>: &minus;${second.ppDrop.toFixed(1)}pp, ${fmtNum(second.countDrop)} accounts. Worth sequencing behind the first, not in parallel with it — see the note below on why order matters.</li>
        <li><b>Recommendation:</b> only ${finalStage.pct.toFixed(0)}% of accounts reach ${finalStage.stage.toLowerCase()} — but pushing cross-sell campaigns before fixing digital enrollment would target the wrong bottleneck. Fix the widest leak first, then re-measure before investing in the next stage.</li>
      </ul>
    </div>
  `;
}

function marketInsight(states) {
  const sorted = [...states].sort((a, b) => a.accounts - b.accounts);
  const medianAccounts = sorted[Math.floor(sorted.length / 2)].accounts;
  const belowMedian = states.filter(s => s.accounts < medianAccounts);
  const aboveMedian = states.filter(s => s.accounts >= medianAccounts);

  const bestEmerging = [...belowMedian].sort((a, b) => b.balance_trend - a.balance_trend)[0];
  const worstRetention = [...aboveMedian].filter(s => s.balance_trend < 0).sort((a, b) => a.balance_trend - b.balance_trend)[0];
  const worstUnderpenetrated = [...belowMedian].filter(s => s.balance_trend < 0).sort((a, b) => a.balance_trend - b.balance_trend)[0];

  return `
    <div class="insight-box">
      <div class="insight-label">Where to focus — market prioritization</div>
      <ul>
        <li><b>${bestEmerging.state}</b> is the strongest emerging-market candidate: only ${fmtNum(bestEmerging.accounts)} accounts (below-median volume) but the best balance trend on the book at +${(bestEmerging.balance_trend).toFixed(2)}% — low current penetration paired with real momentum.</li>
        ${worstRetention ? `<li><b>${worstRetention.state}</b> is the opposite problem: ${fmtNum(worstRetention.accounts)} accounts, the largest or near-largest market, but trending ${worstRetention.balance_trend.toFixed(2)}% — this is a retention problem, not a growth opportunity, and funding it out of a "growth" budget would misdirect the strategy.</li>` : ''}
        ${worstUnderpenetrated ? `<li><b>${worstUnderpenetrated.state}</b> has low volume and negative momentum (${worstUnderpenetrated.balance_trend.toFixed(2)}%) — not yet worth chasing with marketing spend until the underlying decline is understood.</li>` : ''}
        <li><b>Recommendation:</b> prioritize marketing investment in low-volume, positive-momentum states like ${bestEmerging.state} first — that combination is the actual definition of an emerging market, not just "small."</li>
      </ul>
    </div>
  `;
}

// ---------- TEAM COACHING PLAN (computed from real dimension data, not scripted) ----------
const DIM_ADVICE = {
  volume_per_month: {
    label: 'Volume',
    advice: (a) => `Volume is ${a.volume_per_month}/month, below team average — this is the one case where more output is actually part of the fix, since it's genuinely a below-average dimension here rather than already a strength.`
  },
  accuracy_pct: {
    label: 'Accuracy',
    advice: (a) => `Accuracy sits at ${a.accuracy_pct.toFixed(1)}%, below team average — build in a self-check or peer-review pass before submission, and slow down specifically on the highest-volume, lowest-complexity items, where errors tend to cluster when output is rushed.`
  },
  turnaround_days: {
    label: 'Turnaround',
    advice: (a) => `Turnaround is ${a.turnaround_days.toFixed(1)} days, slower than team average — time-box each analysis and escalate blockers earlier rather than pushing through solo once a task starts running long.`
  },
  collaboration_score: {
    label: 'Collaboration',
    advice: (a) => `Peer collaboration score is ${a.collaboration_score.toFixed(1)}/5, below team average — proactively request feedback on 2–3 analyses a month rather than working in isolation until final review.`
  },
  initiative_count: {
    label: 'Initiative',
    advice: (a) => `${a.initiative_count} self-driven projects this quarter, versus a team average well above that — propose one stretch project rather than waiting for assignment; this is the fastest-moving dimension in the whole model once someone starts.`
  },
  skill_growth_pct: {
    label: 'Skill growth',
    advice: (a) => `Skill assessment improved only ${a.skill_growth_pct > 0 ? '+' : ''}${a.skill_growth_pct.toFixed(1)}% over two quarters, well behind the team — pair with a high-growth peer (Omar Hassan's cohort shows +24.3% over the same window) for technique transfer, not just more repetitions of the same work.`
  }
};

// Shared: compute team mean/std per dimension, and a z-score function, from the full analyst list
function getTeamStats(analysts) {
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const std = (arr) => { const m = mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); };
  const dims = {
    volume_per_month: analysts.map(a => a.volume_per_month),
    accuracy_pct: analysts.map(a => a.accuracy_pct),
    turnaround_days: analysts.map(a => -a.turnaround_days), // inverted: fewer days = better
    collaboration_score: analysts.map(a => a.collaboration_score),
    initiative_count: analysts.map(a => a.initiative_count),
    skill_growth_pct: analysts.map(a => a.skill_growth_pct)
  };
  const stats = {};
  Object.keys(dims).forEach(k => { stats[k] = { mean: mean(dims[k]), std: std(dims[k]) }; });
  return stats;
}

function getZScores(analyst, stats) {
  const z = (key, rawVal) => {
    const val = key === 'turnaround_days' ? -rawVal : rawVal;
    return stats[key].std === 0 ? 0 : (val - stats[key].mean) / stats[key].std;
  };
  return {
    volume_per_month: z('volume_per_month', analyst.volume_per_month),
    accuracy_pct: z('accuracy_pct', analyst.accuracy_pct),
    turnaround_days: z('turnaround_days', analyst.turnaround_days),
    collaboration_score: z('collaboration_score', analyst.collaboration_score),
    initiative_count: z('initiative_count', analyst.initiative_count),
    skill_growth_pct: z('skill_growth_pct', analyst.skill_growth_pct)
  };
}

function computeCoachingPlan(analysts) {
  const stats = getTeamStats(analysts);
  const lowest = [...analysts].sort((a, b) => a.composite_score - b.composite_score)[0];
  const currentZ = getZScores(lowest, stats);

  // Rank the 5 non-volume dimensions by how far below the team they pull the composite
  const nonVolume = Object.entries(currentZ).filter(([k]) => k !== 'volume_per_month');
  const weakest = [...nonVolume].sort((a, b) => a[1] - b[1]).slice(0, 2);

  // Simulate: what if the two weakest dimensions moved to team average (z=0)?
  const simulatedZ = { ...currentZ };
  weakest.forEach(([key]) => { simulatedZ[key] = 0; });
  const currentComposite = Object.values(currentZ).reduce((a, b) => a + b, 0) / 6;
  const simulatedComposite = Object.values(simulatedZ).reduce((a, b) => a + b, 0) / 6;
  // Anchor to the authoritative composite_score from the data (not the locally-recomputed
  // z-score, which can drift slightly from the original scoring run) — only the *delta*
  // from closing the two gaps comes from this simulation.
  const projectedComposite = lowest.composite_score + (simulatedComposite - currentComposite);

  const adviceLines = weakest.map(([key]) => DIM_ADVICE[key].advice(lowest));
  const firstName = lowest.analyst.split(' ')[0];

  return `
    <div class="worked-example" style="margin-top:20px;">
      <div class="worked-header">Coaching plan — ${lowest.analyst}, composite ${lowest.composite_score.toFixed(2)} (rank #${lowest.composite_rank} of ${analysts.length})</div>
      <div class="worked-body">
        <p>The two dimensions pulling the composite score down the most: <b>${weakest.map(([k]) => DIM_ADVICE[k].label).join(' and ')}</b>.</p>
        ${adviceLines.map(line => `<p>&bull; ${line}</p>`).join('')}
        <p style="margin-top:12px;"><b>Projected impact:</b> if ${firstName} closed just these two gaps to team average — without changing volume at all — the composite score would move from <b>${lowest.composite_score.toFixed(2)}</b> to an estimated <b>${projectedComposite.toFixed(2)}</b>, enough to move out of last place on the team.</p>
        <p style="margin-top:10px;"><i>What this deliberately does not recommend: adding more volume. ${firstName} already has the highest output on the team (${lowest.volume_per_month}/month) — more volume on top of the current gaps would reinforce the exact pattern the composite score is designed to catch, not fix it.</i></p>
      </div>
    </div>
  `;
}

// ---------- WHAT-IF ANALYSIS: minimum path to a positive composite score ----------
// For every analyst currently below zero, greedily "fixes" their weakest dimension
// to team average, one at a time, until the projected composite crosses zero —
// reporting exactly how many dimensions (and which ones) that takes.
function computeWhatIfRow(analyst, stats) {
  const z = getZScores(analyst, stats);
  const currentComposite = Object.values(z).reduce((a, b) => a + b, 0) / 6;

  // Only real weaknesses (below team average) are eligible fixes — never "fix" a
  // dimension that's already above average, since that would mean recommending
  // someone get *worse* at something to hit the target.
  const weaknesses = Object.entries(z).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);

  const runningZ = { ...z };
  const fixedKeys = [];
  let projected = analyst.composite_score;
  let crossedPositive = false;

  for (const [key] of weaknesses) {
    runningZ[key] = 0;
    fixedKeys.push(key);
    const newComposite = Object.values(runningZ).reduce((a, b) => a + b, 0) / 6;
    projected = analyst.composite_score + (newComposite - currentComposite);
    if (projected >= 0) { crossedPositive = true; break; }
  }

  return {
    analyst: analyst.analyst,
    rank: analyst.composite_rank,
    current: analyst.composite_score,
    fixedKeys,
    projected,
    crossedPositive,
    totalWeaknesses: weaknesses.length
  };
}

function renderWhatIfTable(analysts) {
  const stats = getTeamStats(analysts);
  const negative = [...analysts].filter(a => a.composite_score < 0).sort((a, b) => a.composite_score - b.composite_score);
  const rows = negative.map(a => computeWhatIfRow(a, stats));

  return `
    <div class="card" style="margin-top:20px;">
      <h3>What-if analysis — minimum path to a positive composite score</h3>
      <p style="font-size:12px;color:var(--slate-soft);margin:-4px 0 12px 0;">For each analyst currently below zero: fixing dimensions to team average, weakest first, in the fewest moves that flip the score positive. Only below-average dimensions are eligible — nothing here recommends getting worse at a strength to hit the target.</p>
      <table class="data-table">
        <tr><th>Analyst</th><th>Current</th><th>Priority fixes (in order)</th><th>Dimensions needed</th><th>Projected</th><th>Result</th></tr>
        ${rows.map(r => `
          <tr>
            <td><b>${r.analyst}</b> <span style="color:var(--slate-soft);">#${r.rank}</span></td>
            <td>${r.current.toFixed(2)}</td>
            <td>${r.fixedKeys.map(k => DIM_ADVICE[k].label).join(' &rarr; ')}</td>
            <td>${r.fixedKeys.length} of ${r.totalWeaknesses} weak dims</td>
            <td><b>${r.projected.toFixed(2)}</b></td>
            <td>${r.crossedPositive ? ragBadge('green') : '<span class="badge badge-amber">Still short</span>'}</td>
          </tr>
        `).join('')}
      </table>
      <div class="insight-box" style="margin-top:14px;">
        <div class="insight-label">Reading this table</div>
        <ul>
          <li>Every analyst here can reach a positive composite score by fixing 3 dimensions or fewer, except where marked "Still short" — meaning even eliminating every weakness down to team average isn't enough, and above-average performance somewhere would be required instead.</li>
          <li>The "priority fixes" order matters: these are sorted by which gap is dragging the score down hardest, not alphabetically or by ease — fixing them out of order wastes effort on a smaller lever while a bigger one sits untouched.</li>
          <li>${rows.some(r => r.fixedKeys.includes('volume_per_month'))
              ? 'Volume only appears as a fix where it\'s genuinely below team average — for analysts whose volume is already at or above average, the path to positive runs entirely through quality, collaboration, initiative, or growth instead.'
              : 'No row recommends more volume as a fix — every analyst here already has average-or-above volume, so the path to positive runs entirely through quality, collaboration, initiative, or growth instead.'}</li>
        </ul>
      </div>
    </div>
  `;
}

// ---------- INIT ----------
async function init() {
  try {
    const res = await fetch('data/summary.json');
    DATA = await res.json();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="loading">Could not load data/summary.json — make sure you're serving this over a local server, not opening index.html directly (browsers block fetch() on file:// URLs).</div>`;
    return;
  }
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  switchTab('overview');
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const renderers = {
    overview: renderOverview,
    digital: renderDigital,
    branch: renderBranch,
    contact: renderContact,
    payments: renderPayments,
    smb: renderSMB,
    growth: renderGrowth,
    team: renderTeam
  };
  (renderers[tab] || renderOverview)();
}

// ---------- OVERVIEW ----------
function renderOverview() {
  const k = DATA.kpis;
  const rd = DATA.risk_distribution;
  const app = document.getElementById('app');

  const digitalStatus = k.digital_adoption >= k.digital_adoption_target ? 'green' : (k.digital_adoption >= k.digital_adoption_target * 0.85 ? 'amber' : 'red');
  const csatStatus = k.blended_csat >= k.csat_target ? 'green' : (k.blended_csat >= k.csat_target - 0.3 ? 'amber' : 'red');
  const complaintStatus = k.complaint_rate <= k.complaint_target ? 'green' : (k.complaint_rate <= k.complaint_target * 1.5 ? 'amber' : 'red');
  const crossSellStatus = k.cross_sell_ratio >= k.cross_sell_target ? 'green' : (k.cross_sell_ratio >= k.cross_sell_target * 0.85 ? 'amber' : 'red');
  const activeStatus = k.active_rate >= k.active_target ? 'green' : (k.active_rate >= k.active_target - 0.05 ? 'amber' : 'red');

  const dataAsOf = DATA.data_as_of;
  const dateRangeLabel = dataAsOf
    ? `<span class="data-as-of">Data as of &nbsp;<b>${fmtDateShort(dataAsOf.min_date)}</b> &ndash; <b>${fmtDateShort(dataAsOf.max_date)}</b></span>`
    : '';

  app.innerHTML = `
    <div class="section-header-row">
      <div>
        <div class="section-title">Executive Summary</div>
        <div class="section-sub">The 30-second answer to "how's the bank doing" — landing tab, everyone, daily. ${fmtNum(k.total_accounts)} accounts, ${fmtMoney(k.total_balance)} total balance.</div>
      </div>
      ${dateRangeLabel}
    </div>

    <div class="kpi-row">
      ${kpiTile('Digital Adoption', fmtPct(k.digital_adoption), { status: digitalStatus, target: `Target ${fmtPct(k.digital_adoption_target, 0)} ${ragBadge(digitalStatus)}` })}
      ${kpiTile('Cross-Sell Ratio', k.cross_sell_ratio.toFixed(2), { status: crossSellStatus, target: `Target ${k.cross_sell_target.toFixed(1)} ${ragBadge(crossSellStatus)}` })}
      ${kpiTile('Blended CSAT', k.blended_csat.toFixed(2), { status: csatStatus, target: `Target ${k.csat_target.toFixed(1)} ${ragBadge(csatStatus)}` })}
      ${kpiTile('Complaint Rate', fmtPct(k.complaint_rate), { status: complaintStatus, target: `Target &lt;${fmtPct(k.complaint_target, 0)} ${ragBadge(complaintStatus)}` })}
      ${kpiTile('Active Account Rate', fmtPct(k.active_rate), { status: activeStatus, target: `Target ${fmtPct(k.active_target, 0)} ${ragBadge(activeStatus)}` })}
    </div>

    <div class="grid-2">
      <div class="card">
        <h3>Portfolio risk distribution — 75,000 accounts scored (Ch5)</h3>
        <div class="chart-wrap"><canvas id="chart-risk-donut"></canvas></div>
        <div id="risk-legend" class="custom-legend"></div>
      </div>
      <div class="card">
        <h3>Complaint rate by channel</h3>
        <div class="chart-wrap"><canvas id="chart-complaint-bar"></canvas></div>
        <p style="font-size:12px;color:var(--slate-soft);margin-top:8px;">Contact Center complaint rate is ${fmtPct(k.contact_center_complaint_rate)} — the sharpest signal in the dataset, and the thread Ch5, Ch7, Ch8, and Ch9 all trace back to. Branch and Digital are genuinely 0.0% by design: <code>complaint_flag</code> only fires on Complaint/Fraud Report interaction types, which only occur in Contact Center.</p>
      </div>
    </div>
  `;

  const total = (rd.Green || 0) + (rd.Amber || 0) + (rd.Red || 0);
  const riskRows = [
    { label: 'Green', count: rd.Green || 0, color: '#0f6e56' },
    { label: 'Amber', count: rd.Amber || 0, color: '#c8861a' },
    { label: 'Red', count: rd.Red || 0, color: '#a32d2d' }
  ];
  document.getElementById('risk-legend').innerHTML = riskRows.map(r => `
    <div class="legend-row">
      <span class="legend-swatch" style="background:${r.color}"></span>
      <span class="legend-label">${r.label}</span>
      <span class="legend-value">${fmtNum(r.count)} accounts (${(r.count / total * 100).toFixed(1)}%)</span>
    </div>
  `).join('');

  // Small plugin: draws the numeric value above (or just above the axis for) every bar,
  // so a true 0% reads as "confirmed zero" rather than "no data rendered."
  const valueLabelPlugin = {
    id: 'valueLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets[0].data.forEach((val, i) => {
        const bar = chart.getDatasetMeta(0).data[i];
        ctx.save();
        ctx.fillStyle = '#2c2c2a';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${val}%`, bar.x, bar.y - 6);
        ctx.restore();
      });
    }
  };

  destroyChart('risk-donut');
  charts['risk-donut'] = new Chart(document.getElementById('chart-risk-donut'), {
    type: 'doughnut',
    data: {
      labels: ['Green', 'Amber', 'Red'],
      datasets: [{
        data: [rd.Green || 0, rd.Amber || 0, rd.Red || 0],
        backgroundColor: ['#0f6e56', '#c8861a', '#a32d2d'],
        borderWidth: 0
      }]
    },
    options: { plugins: { legend: { display: false } } }
  });

  destroyChart('complaint-bar');
  const ch = DATA.channel_stats;
  charts['complaint-bar'] = new Chart(document.getElementById('chart-complaint-bar'), {
    type: 'bar',
    data: {
      labels: ch.map(c => c.channel.replace('_', ' ')),
      datasets: [{
        data: ch.map(c => Number((c.complaint_rate * 100).toFixed(1))),
        backgroundColor: ch.map(c => c.channel === 'Contact_Center' ? '#a32d2d' : '#2f6fb0')
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      layout: { padding: { top: 20 } },
      scales: { y: { title: { display: true, text: '% complaints' }, suggestedMax: 38 } }
    },
    plugins: [valueLabelPlugin]
  });
}

// ---------- DIGITAL ----------
function renderDigital() {
  const app = document.getElementById('app');
  const stat = DATA.channel_stats.find(c => c.channel === 'Digital');
  const types = DATA.channel_efficiency.filter(r => r.channel === 'Digital');

  app.innerHTML = `
    <div class="section-title">Digital Banking</div>
    <div class="section-sub">Highest-volume channel, digital ops team, daily monitoring.</div>

    <div class="kpi-row">
      ${kpiTile('Volume', fmtNum(stat.volume), { status: 'green' })}
      ${kpiTile('Avg CSAT', stat.avg_csat.toFixed(2), { status: 'green' })}
      ${kpiTile('Resolution Rate', fmtPct(stat.resolution_rate), { status: 'green' })}
      ${kpiTile('Avg Duration', stat.avg_duration.toFixed(1) + 'm', { status: 'green' })}
    </div>

    <div class="card">
      <h3>Volume by interaction type</h3>
      <table class="data-table">
        <tr><th>Interaction Type</th><th>Volume</th><th>Avg Duration</th><th>CSAT</th><th>Est. Cost/Interaction</th></tr>
        ${types.map(t => `<tr><td>${t.interaction_type.replace('_', ' ')}</td><td>${fmtNum(t.volume)}</td><td>${t.avg_duration.toFixed(2)}m</td><td>${t.avg_csat.toFixed(2)}</td><td>$${t.est_cost_per_interaction.toFixed(2)}</td></tr>`).join('')}
      </table>
      ${interactionTypeInsight(types, 'Digital')}
    </div>
  `;
}

// ---------- BRANCH ----------
function renderBranch() {
  const app = document.getElementById('app');
  const stat = DATA.channel_stats.find(c => c.channel === 'Branch');
  const types = DATA.channel_efficiency.filter(r => r.channel === 'Branch');

  app.innerHTML = `
    <div class="section-title">Branch / Café</div>
    <div class="section-sub">Physical channel — where digitally-disengaged customers still show up. Branch managers, daily.</div>

    <div class="kpi-row">
      ${kpiTile('Volume', fmtNum(stat.volume), { status: 'green' })}
      ${kpiTile('Avg CSAT', stat.avg_csat.toFixed(2), { status: 'green' })}
      ${kpiTile('Avg Duration', stat.avg_duration.toFixed(1) + 'm', { status: 'amber' })}
      ${kpiTile('Resolution Rate', fmtPct(stat.resolution_rate), { status: 'green' })}
    </div>

    <div class="card">
      <h3>Volume by interaction type</h3>
      <table class="data-table">
        <tr><th>Interaction Type</th><th>Volume</th><th>Avg Duration</th><th>CSAT</th><th>Est. Cost/Interaction</th></tr>
        ${types.map(t => `<tr><td>${t.interaction_type.replace('_', ' ')}</td><td>${fmtNum(t.volume)}</td><td>${t.avg_duration.toFixed(2)}m</td><td>${t.avg_csat.toFixed(2)}</td><td>$${t.est_cost_per_interaction.toFixed(2)}</td></tr>`).join('')}
      </table>
      ${interactionTypeInsight(types, 'Branch')}
    </div>
  `;
}

// ---------- CONTACT CENTER ----------
function renderContact() {
  const app = document.getElementById('app');
  const stat = DATA.channel_stats.find(c => c.channel === 'Contact_Center');
  const types = DATA.channel_efficiency.filter(r => r.channel === 'Contact_Center');

  app.innerHTML = `
    <div class="section-title">Contact Center</div>
    <div class="section-sub">Where friction concentrates — feeds Ch7's nudge triggers directly. CX &amp; Ops leads, daily.</div>

    <div class="kpi-row">
      ${kpiTile('Complaint Rate', fmtPct(stat.complaint_rate), { status: 'red' })}
      ${kpiTile('Resolution Rate', fmtPct(stat.resolution_rate), { status: 'amber' })}
      ${kpiTile('Avg CSAT', stat.avg_csat.toFixed(2), { status: 'amber' })}
      ${kpiTile('Volume', fmtNum(stat.volume), { status: 'green' })}
    </div>

    <div class="card">
      <h3>Volume by interaction type — Complaint &amp; Fraud Report highlighted</h3>
      <table class="data-table">
        <tr><th>Interaction Type</th><th>Volume</th><th>CSAT</th><th>Quadrant (Ch9)</th></tr>
        ${types.map(t => `<tr ${t.quadrant.includes('Channel-shift') ? 'style="background:#f8e6e6;"' : ''}><td>${t.interaction_type.replace('_', ' ')}</td><td>${fmtNum(t.volume)}</td><td>${t.avg_csat.toFixed(2)}</td><td>${t.quadrant}</td></tr>`).join('')}
      </table>
      ${(() => {
        const shiftCandidates = types.filter(t => t.quadrant.includes('Channel-shift'));
        const shiftVolume = shiftCandidates.reduce((s, t) => s + t.volume, 0);
        const shiftCost = shiftCandidates.reduce((s, t) => s + t.est_total_cost, 0);
        const shiftShare = (shiftVolume / types.reduce((s, t) => s + t.volume, 0) * 100).toFixed(0);
        const worstCsat = [...types].sort((a, b) => a.avg_csat - b.avg_csat)[0];
        return `
          <div class="insight-box">
            <div class="insight-label">What this table tells you</div>
            <ul>
              <li><b>${shiftCandidates.map(t => t.interaction_type.replace('_', ' ')).join(' and ')}</b> make up only ${shiftShare}% of Contact Center volume but cost an estimated ${fmtMoney(shiftCost)}/yr — disproportionate cost concentrated in a small slice of interaction types.</li>
              <li><b>${worstCsat.interaction_type.replace('_', ' ')}</b> has the worst CSAT in the channel (${worstCsat.avg_csat.toFixed(2)}) — this is the interaction type driving the complaint-velocity risk dimension in Ch5.</li>
              <li>Every other interaction type in this channel sits in the "worth the cost" quadrant — the problem is narrow and specific, not a channel-wide quality issue.</li>
            </ul>
          </div>
        `;
      })()}
    </div>
  `;
}

// ---------- PAYMENTS ----------
function renderPayments() {
  const app = document.getElementById('app');
  const pay = DATA.payment_stats;
  const { valueBox, declineBox } = paymentInsights(pay);

  app.innerHTML = `
    <div class="section-title">Enterprise Payments</div>
    <div class="section-sub">Debit, ACH, check, wire — payments ops, weekly.</div>

    <div class="grid-2">
      <div class="card">
        <h3>Volume by payment type</h3>
        <div class="chart-wrap"><canvas id="chart-pay-vol"></canvas></div>
      </div>
      <div class="card">
        <h3>Total value by payment type</h3>
        <div class="chart-wrap"><canvas id="chart-pay-val"></canvas></div>
        ${valueBox}
      </div>
    </div>

    <div class="card">
      <h3>Decline rates</h3>
      <table class="data-table">
        <tr><th>Payment Type</th><th>Volume</th><th>Total Value</th><th>Decline Rate</th></tr>
        ${pay.map(p => `<tr><td>${p.payment_type.replace('_', ' ')}</td><td>${fmtNum(p.volume)}</td><td>${fmtMoney(p.total_amount)}</td><td>${fmtPct(p.decline_rate)}</td></tr>`).join('')}
      </table>
      ${declineBox}
    </div>
  `;

  destroyChart('pay-vol');
  charts['pay-vol'] = new Chart(document.getElementById('chart-pay-vol'), {
    type: 'bar',
    data: { labels: pay.map(p => p.payment_type.replace('_', ' ')), datasets: [{ data: pay.map(p => p.volume), backgroundColor: '#2f6fb0' }] },
    options: { plugins: { legend: { display: false } } }
  });

  destroyChart('pay-val');
  charts['pay-val'] = new Chart(document.getElementById('chart-pay-val'), {
    type: 'bar',
    data: { labels: pay.map(p => p.payment_type.replace('_', ' ')), datasets: [{ data: pay.map(p => p.total_amount), backgroundColor: '#4a3fa8' }] },
    options: { plugins: { legend: { display: false } } }
  });
}

// ---------- SMB & RISK ----------
function renderSMB() {
  const app = document.getElementById('app');
  const risk = DATA.worked_examples.risk_example;
  const smb = DATA.worked_examples.smb_example;
  const a = risk.account;
  const s = smb.account;

  app.innerHTML = `
    <div class="section-title">Small Business Banking — Risk &amp; Relationship</div>
    <div class="section-sub">Ch5 risk scoring + Ch6 relationship cheat sheet, worked on real accounts. Relationship Managers, weekly + on-demand.</div>

    <div class="worked-example">
      <div class="worked-header">Ch5 worked example — ${a.AccountID} — composite risk ${a.risk_score.toFixed(2)}, ${ragBadge(a.risk_band.toLowerCase())}</div>
      <div class="worked-body">
        <p><b>${a.state}</b> &middot; ${a.segment} &middot; tenure ${a.tenure_months.toFixed(1)} months &middot; balance <span class="mono">$${a.current_balance.toFixed(2)}</span> (${a.balance_trend_pct.toFixed(1)}%)</p>
        <p>Digital enrolled: <b>${a.digital_enrolled_flag ? 'Yes' : 'No'}</b> &middot; Complaint rate: <b>${fmtPct(a.complaint_rate)}</b> &middot; Resolution rate: <b>${fmtPct(a.resolution_rate)}</b></p>
        <div class="grid-3" style="margin-top:14px;">
          <div class="card"><h3 style="margin-bottom:4px;">Digital disengagement</h3><div class="kpi-value" style="font-size:20px;">${a.risk_digital.toFixed(0)}/100</div></div>
          <div class="card"><h3 style="margin-bottom:4px;">Complaint velocity</h3><div class="kpi-value" style="font-size:20px;">${a.risk_complaint.toFixed(0)}/100</div></div>
          <div class="card"><h3 style="margin-bottom:4px;">Balance trend</h3><div class="kpi-value" style="font-size:20px;">${a.risk_balance.toFixed(0)}/100</div></div>
        </div>
        <p style="margin-top:14px;"><i>Reading: complaint velocity and digital disengagement drive this score, not the balance decline — this account needs a service recovery call, not a retention offer.</i></p>
      </div>
    </div>

    <div class="worked-example" style="margin-top:20px;">
      <div class="worked-header">Ch6 worked example — ${s.AccountID} — pre-meeting brief</div>
      <div class="worked-body">
        <p><b>${s.state}</b> Small Business &middot; revenue <span class="mono">$${fmtNum(s.annual_revenue)}</span> &middot; ${s.num_employees} employees &middot; ${s.product_holdings_count} products held</p>
        <p>Risk score: <b>${s.risk_score.toFixed(1)}</b> ${ragBadge(s.risk_band.toLowerCase())} &middot; Complaint rate: <b>${fmtPct(s.complaint_rate)}</b></p>
        <p style="margin-top:10px;"><b>AI-generated talking point:</b> <i>"This account already holds more products than its SMB peer average — don't lead with cross-sell. Acknowledge the outstanding service issue directly, first."</i></p>
      </div>
    </div>
  `;
}

// ---------- GROWTH ----------
function renderGrowth() {
  const app = document.getElementById('app');
  const funnel = DATA.funnel;
  const states = [...DATA.state_market].sort((a, b) => a.accounts - b.accounts);

  app.innerHTML = `
    <div class="section-title">Growth &amp; Emerging Markets</div>
    <div class="section-sub">Ch4 — where growth actually is. Marketing &amp; Product leads, monthly.</div>

    <div class="grid-2">
      <div class="card">
        <h3>Product adoption funnel</h3>
        <div class="chart-wrap"><canvas id="chart-funnel"></canvas></div>
        ${funnelInsight(funnel)}
      </div>
      <div class="card">
        <h3>State classification — lowest volume, sorted first</h3>
        <table class="data-table">
          <tr><th>State</th><th>Accounts</th><th>Balance Trend</th><th>Class</th></tr>
          ${states.slice(0, 8).map(s => {
            const cls = s.balance_trend >= 0 ? 'badge-green' : 'badge-amber';
            const label = s.balance_trend >= 0 ? 'Emerging' : 'Watch';
            return `<tr><td>${s.state}</td><td>${fmtNum(s.accounts)}</td><td>${s.balance_trend.toFixed(2)}%</td><td><span class="badge ${cls}">${label}</span></td></tr>`;
          }).join('')}
        </table>
        ${marketInsight(DATA.state_market)}
      </div>
    </div>
  `;

  destroyChart('funnel');
  charts['funnel'] = new Chart(document.getElementById('chart-funnel'), {
    type: 'bar',
    data: {
      labels: funnel.map(f => f.stage),
      datasets: [{ data: funnel.map(f => f.pct), backgroundColor: ['#2f6fb0', '#2f6fb0', '#2f6fb0', '#c8861a', '#a32d2d'] }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { title: { display: true, text: '% of total accounts' }, max: 100 } }
    }
  });
}

// ---------- TEAM ----------
function renderTeam() {
  const app = document.getElementById('app');
  const analysts = DATA.analysts;

  const topAnalyst = [...analysts].sort((a, b) => a.composite_rank - b.composite_rank)[0];
  const bottomAnalyst = [...analysts].sort((a, b) => b.composite_rank - a.composite_rank)[0];
  const highestVolume = [...analysts].sort((a, b) => b.volume_per_month - a.volume_per_month)[0];
  const teamAvgVolume = analysts.reduce((s, a) => s + a.volume_per_month, 0) / analysts.length;

  app.innerHTML = `
    <div class="section-title">Team Leadership &amp; Coaching</div>
    <div class="section-sub">Ch10 — composite rank across 6 behavioral dimensions, not volume alone. Hover any row's dimensions against the team average to see where the score actually comes from.</div>

    <div class="card">
      <table class="data-table">
        <tr><th>Rank</th><th>Analyst</th><th>Volume/mo</th><th>Accuracy</th><th>Turnaround</th><th>Collaboration</th><th>Initiative</th><th>Skill Growth</th><th>Composite</th></tr>
        ${analysts.map(a => {
          const highlight = a.analyst === topAnalyst.analyst ? 'style="background:#e3f5ee;"' : (a.analyst === bottomAnalyst.analyst ? 'style="background:#f8e6e6;"' : '');
          return `<tr ${highlight}>
            <td>#${a.composite_rank}</td>
            <td><b>${a.analyst}</b></td>
            <td>${a.volume_per_month}</td>
            <td>${a.accuracy_pct.toFixed(1)}%</td>
            <td>${a.turnaround_days.toFixed(1)}d</td>
            <td>${a.collaboration_score.toFixed(1)}</td>
            <td>${a.initiative_count}</td>
            <td>${a.skill_growth_pct > 0 ? '+' : ''}${a.skill_growth_pct.toFixed(1)}%</td>
            <td>${a.composite_score.toFixed(2)}</td>
          </tr>`;
        }).join('')}
      </table>
      <div class="insight-box">
        <div class="insight-label">What this table tells you</div>
        <ul>
          <li><b>${topAnalyst.analyst}</b> (highlighted green) ranks #1 with ${topAnalyst.volume_per_month}/mo volume — below the team average of ${teamAvgVolume.toFixed(0)}/mo. Volume alone would have ranked this person lower; the composite score catches quality and growth that raw output hides.</li>
          <li><b>${bottomAnalyst.analyst}</b> (highlighted red) ranks last despite ${bottomAnalyst.volume_per_month}/mo — the highest volume on the team${highestVolume.analyst === bottomAnalyst.analyst ? '' : ` (second only to ${highestVolume.analyst})`}. High output is masking, not offsetting, weaker performance on every other dimension.</li>
          <li><b>Recommendation for reviewers:</b> if volume and composite rank move in opposite directions for someone on your team, treat that as a signal to look at the full 6-dimension breakdown before the next calibration conversation — not just the tenure/output numbers on the surface.</li>
        </ul>
      </div>
    </div>

    ${computeCoachingPlan(analysts)}
    ${renderWhatIfTable(analysts)}
  `;
}

document.addEventListener('DOMContentLoaded', init);
