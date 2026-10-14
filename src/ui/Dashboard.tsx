// Progress dashboard. Reads the arena (read-only) to compute stats when opened;
// all changes go through commands. Charts are hand-rolled SVG.
import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { type Arena, CS, Cmd, LOG_CAP, MAX_TIER } from '../arena';
import { UNLOCK_FRACTION, dayStart, unlockedTier } from '../srs/scheduler';
import { ui } from './bridge';

const DAY = 86_400_000;
const MATURE_DAYS = 21;
const STATE_KEYS = ['New', 'Learning', 'Young', 'Mature'] as const;
const STATE_CLS = ['s-new', 's-learn', 's-young', 's-mature'];

function computeStats(a: Arena) {
  const now = Date.now();
  const today = dayStart(now);
  const S = a.srs;
  // per-tier state counts
  const tiers = Array.from({ length: MAX_TIER }, () => [0, 0, 0, 0]);
  let studied = 0, mature = 0;
  for (let c = 0; c < a.nCards; c++) {
    if (!a.settings.kindEnabled[a.cards.kind[c]]) continue;
    const st = S.state[c];
    const k = st === CS.New ? 0 : st === CS.Review ? (S.S[c] >= MATURE_DAYS ? 3 : 2) : 1;
    tiers[a.cards.tier[c] - 1][k]++;
    if (st !== CS.New) studied++;
    if (k === 3) mature++;
  }
  // reviews per day (last 30) split by correct / again; retention of review-state cards
  const days = 30;
  const perDay = Array.from({ length: days }, () => [0, 0]);
  let revN = 0, revOk = 0;
  const activeDays = new Set<number>();
  const L = a.log;
  for (let k = 0; k < L.count; k++) {
    const i = (L.head - 1 - k + LOG_CAP) % LOG_CAP;
    const d = Math.floor((today + DAY - 1 - L.t[i]) / DAY); // 0 = today
    activeDays.add(dayStart(L.t[i]));
    if (d < days) perDay[days - 1 - d][L.grade[i] === 1 ? 1 : 0]++;
    if (d < days && L.prevState[i] === CS.Review) { revN++; if (L.grade[i] > 1) revOk++; }
  }
  // streak: consecutive study days ending today (or yesterday if not studied yet today)
  let streak = 0;
  let cur = activeDays.has(today) ? today : dayStart(today - 1);
  while (activeDays.has(cur)) { streak++; cur = dayStart(cur - 1); }
  // forecast next 14 days
  const fdays = 14;
  const forecast = new Array(fdays).fill(0);
  for (let c = 0; c < a.nCards; c++) {
    if (S.state[c] === CS.New || !a.settings.kindEnabled[a.cards.kind[c]] || !a.settings.tierEnabled[a.cards.tier[c]]) continue;
    const d = Math.max(0, Math.floor((S.due[c] - today) / DAY));
    if (d < fdays) forecast[d]++;
  }
  // hardest cards
  const hard = [...Array(a.nCards).keys()]
    .filter((c) => S.reps[c] > 0 && (S.lapses[c] > 0 || S.D[c] >= 7))
    .sort((x, y) => S.lapses[y] - S.lapses[x] || S.D[y] - S.D[x])
    .slice(0, 8)
    .map((c) => ({ name: a.db.cards[c].name, lapses: S.lapses[c], D: S.D[c], S: S.S[c], kind: a.db.cards[c].kind }));
  const total = tiers.reduce((s, t) => s + t[0] + t[1] + t[2] + t[3], 0);
  return {
    tiers, studied, mature, total, perDay, forecast, hard, streak,
    retention: revN ? revOk / revN : NaN, revN,
    dueNow: ui.dueLearn + ui.dueReview,
    unlocked: unlockedTier(a),
  };
}

const [tip, setTip] = createSignal<{ x: number; y: number; text: string } | null>(null);
const showTip = (e: PointerEvent, text: string) => setTip({ x: e.clientX, y: e.clientY, text });
const hideTip = () => setTip(null);

const BarChart: Component<{
  data: number[][]; // per bar: stacked segment values
  labels: string[]; // tooltip label per bar
  series: string[]; // names per segment
  cls: string[]; // css class per segment
  xTicks: { i: number; text: string }[];
}> = (p) => {
  // draw at the container's real pixel width so text is never stretched
  const [W, setW] = createSignal(600);
  const H = 150, PAD_L = 28, PAD_B = 20, PAD_T = 8;
  let el!: SVGSVGElement;
  onMount(() => {
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });
  const max = () => Math.max(4, ...p.data.map((d) => d.reduce((s, x) => s + x, 0)));
  const niceMax = () => { const m = max(); const step = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / step) * step; };
  const bw = () => (W() - PAD_L) / p.data.length;
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / niceMax());
  return (
    <svg ref={el} class="chart" viewBox={`0 0 ${W()} ${H}`} role="img">
      <For each={[0, 0.5, 1]}>
        {(f) => (
          <>
            <line class="grid" x1={PAD_L} x2={W()} y1={y(niceMax() * f)} y2={y(niceMax() * f)} />
            <text class="axis" x={PAD_L - 6} y={y(niceMax() * f) + 4} text-anchor="end">{Math.round(niceMax() * f)}</text>
          </>
        )}
      </For>
      <For each={p.data}>
        {(segs, i) => {
          const offs = segs.map((_, k) => segs.slice(0, k).reduce((s, x) => s + x, 0));
          const topK = segs.reduce((m, v, k) => (v > 0 ? k : m), -1);
          const text = `${p.labels[i()]}: ` + segs.map((v, k) => `${v} ${p.series[k]}`).join(', ');
          return (
            <g onPointerEnter={(e) => showTip(e, text)} onPointerMove={(e) => showTip(e, text)} onPointerLeave={hideTip}>
              <rect class="hit" x={PAD_L + i() * bw()} y={PAD_T} width={bw()} height={H - PAD_T - PAD_B} />
              <For each={segs}>
                {(v, k) => {
                  const y0 = y(offs[k()]), y1 = y(offs[k()] + v);
                  // 2px surface gap between stacked segments; rounded data-end on top only
                  return v > 0 ? (
                    <rect class={p.cls[k()]} x={PAD_L + i() * bw() + bw() * 0.15} width={bw() * 0.7}
                      y={y1} height={Math.max(0, y0 - y1 - (k() > 0 ? 2 : 0))} rx={k() === topK ? 2 : 0} />
                  ) : null;
                }}
              </For>
            </g>
          );
        }}
      </For>
      <line class="base" x1={PAD_L} x2={W()} y1={H - PAD_B} y2={H - PAD_B} />
      <For each={p.xTicks}>
        {(t) => {
          const anchor = t.i === 0 ? 'start' : t.i === p.data.length - 1 ? 'end' : 'middle';
          const x = anchor === 'start' ? PAD_L : anchor === 'end' ? W() : PAD_L + (t.i + 0.5) * bw();
          return <text class="axis" x={x} y={H - 5} text-anchor={anchor}>{t.text}</text>;
        }}
      </For>
    </svg>
  );
};

export const Dashboard: Component<{ arena: Arena; cmd: (c: Cmd, arg?: number) => void; onClose: () => void }> = (props) => {
  const a = props.arena;
  const stats = createMemo(() => { void ui.version; return computeStats(a); });
  const [confirmAll, setConfirmAll] = createSignal('');
  const [confirmTier, setConfirmTier] = createSignal(0);
  // settings are mirrored locally so the inputs update immediately
  const [ret, setRet] = createSignal(a.settings.retention);
  const [npd, setNpd] = createSignal(a.settings.newPerDay);
  const [tierOn, setTierOn] = createSignal([...a.settings.tierEnabled]);
  const [tierForced, setTierForced] = createSignal([...a.settings.tierForced]);
  const [kinds, setKinds] = createSignal([...a.settings.kindEnabled]);

  const dayLabel = (i: number, n: number, future: boolean) => {
    const d = new Date(Date.now() + (future ? i : i - (n - 1)) * DAY);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');

  return (
    <div class="dash" role="dialog" aria-label="Progress and settings">
      <div class="dash-inner">
        <header>
          <h1>Progress</h1>
          <button class="icon" aria-label="Close" onClick={props.onClose}>
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div class="kpis">
          <div class="kpi"><b>{stats().studied}</b><span>of {stats().total} cards seen</span></div>
          <div class="kpi"><b>{stats().mature}</b><span>mature (≥{MATURE_DAYS}d stability)</span></div>
          <div class="kpi"><b>{pct(stats().retention)}</b><span>review recall, 30d ({stats().revN})</span></div>
          <div class="kpi"><b>{stats().streak}</b><span>day streak</span></div>
        </div>

        <section>
          <h2>Reviews, last 30 days</h2>
          <div class="legend"><span class="sw s-ok" />Recalled <span class="sw s-again" />Forgot (Again)</div>
          <BarChart
            data={stats().perDay}
            labels={stats().perDay.map((_, i) => dayLabel(i, 30, false))}
            series={['recalled', 'forgot']}
            cls={['s-ok', 's-again']}
            xTicks={[{ i: 0, text: dayLabel(0, 30, false) }, { i: 14, text: dayLabel(14, 30, false) }, { i: 29, text: 'Today' }]}
          />
        </section>

        <section>
          <h2>Due, next 14 days</h2>
          <BarChart
            data={stats().forecast.map((v) => [v])}
            labels={stats().forecast.map((_, i) => (i === 0 ? 'Today (incl. overdue)' : dayLabel(i, 14, true)))}
            series={['cards due']}
            cls={['s-ok']}
            xTicks={[{ i: 0, text: 'Today' }, { i: 7, text: dayLabel(7, 14, true) }, { i: 13, text: dayLabel(13, 14, true) }]}
          />
        </section>

        <section>
          <h2>Levels</h2>
          <p class="note">
            New cards come from the easiest unlocked level first. A level unlocks when {Math.round(UNLOCK_FRACTION * 100)}% of the one below
            has graduated to review. Currently unlocked: <b>level {stats().unlocked}</b>.
          </p>
          <div class="legend">
            <For each={STATE_KEYS}>{(k, i) => <><span class={`sw ${STATE_CLS[i()]}`} />{k}</>}</For>
          </div>
          <div class="tiers">
            <For each={stats().tiers}>
              {(t, i) => {
                const tier = i() + 1;
                const total = t[0] + t[1] + t[2] + t[3];
                return (
                  <div class="tier-row" classList={{ off: !tierOn()[tier] }}>
                    <div class="tier-name">
                      <b>Level {tier}</b>
                      <span>{total} cards{tier > stats().unlocked && !tierForced()[tier] ? ' · locked' : ''}</span>
                    </div>
                    <div class="stack" aria-label={`Level ${tier}: ${t.map((v, k) => `${v} ${STATE_KEYS[k]}`).join(', ')}`}>
                      <For each={t}>
                        {(v, k) => (
                          <Show when={v > 0}>
                            <div class={STATE_CLS[k()]} style={{ 'flex-grow': v }}
                              onPointerEnter={(e) => showTip(e, `Level ${tier} · ${STATE_KEYS[k()]}: ${v}`)}
                              onPointerMove={(e) => showTip(e, `Level ${tier} · ${STATE_KEYS[k()]}: ${v}`)}
                              onPointerLeave={hideTip} />
                          </Show>
                        )}
                      </For>
                    </div>
                    <div class="tier-ctl">
                      <label title="Include this level in study sessions">
                        <input type="checkbox" checked={!!tierOn()[tier]} onChange={(e) => {
                          const v = e.currentTarget.checked ? 1 : 0;
                          setTierOn((o) => { const n = [...o]; n[tier] = v; return n; });
                          props.cmd(Cmd.SetTierEnabled, tier * 10 + v);
                        }} /> Study
                      </label>
                      <Show when={tier > 1}>
                        <label title="Unlock new cards from this level now, regardless of progress">
                          <input type="checkbox" checked={!!tierForced()[tier]} onChange={(e) => {
                            const v = e.currentTarget.checked ? 1 : 0;
                            setTierForced((o) => { const n = [...o]; n[tier] = v; return n; });
                            props.cmd(Cmd.SetTierForced, tier * 10 + v);
                          }} /> Unlock
                        </label>
                      </Show>
                      <Show when={confirmTier() === tier} fallback={
                        <button class="danger-link" onClick={() => setConfirmTier(tier)}>Reset</button>
                      }>
                        <button class="danger small" onClick={() => { props.cmd(Cmd.ResetTier, tier); setConfirmTier(0); }}>Confirm reset</button>
                        <button class="small" onClick={() => setConfirmTier(0)}>Cancel</button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </section>

        <section>
          <h2>Settings</h2>
          <div class="settings">
            <label class="check"><input type="checkbox" checked={!!kinds()[1]} onChange={(e) => {
              const v = e.currentTarget.checked ? 1 : 0; setKinds([kinds()[0], v]); props.cmd(Cmd.SetKindEnabled, 10 + v);
            }} /> Muscles</label>
            <label class="check"><input type="checkbox" checked={!!kinds()[0]} onChange={(e) => {
              const v = e.currentTarget.checked ? 1 : 0; setKinds([v, kinds()[1]]); props.cmd(Cmd.SetKindEnabled, v);
            }} /> Bones</label>
            <label class="range">
              <span>Target recall <b>{Math.round(ret() * 100)}%</b></span>
              <input type="range" min="0.75" max="0.97" step="0.01" value={ret()} onInput={(e) => {
                const v = Number(e.currentTarget.value); setRet(v); props.cmd(Cmd.SetRetention, v);
              }} />
              <small>Higher = more frequent reviews. 90% is the evidence-based sweet spot.</small>
            </label>
            <label class="range">
              <span>New cards per day <b>{npd()}</b></span>
              <input type="range" min="0" max="60" step="1" value={npd()} onInput={(e) => {
                const v = Number(e.currentTarget.value); setNpd(v); props.cmd(Cmd.SetNewPerDay, v);
              }} />
            </label>
          </div>
        </section>

        <Show when={stats().hard.length}>
          <section>
            <h2>Hardest for you</h2>
            <table class="hard">
              <thead><tr><th>Card</th><th>Lapses</th><th>Difficulty</th><th>Stability</th></tr></thead>
              <tbody>
                <For each={stats().hard}>
                  {(h) => (
                    <tr>
                      <td>{h.name}</td><td>{h.lapses}</td><td>{h.D.toFixed(1)}</td>
                      <td>{h.S < 1 ? `${Math.round(h.S * 24)}h` : `${h.S.toFixed(1)}d`}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </section>
        </Show>

        <section class="danger-zone">
          <h2>Danger zone</h2>
          <p>Erase all progress, review history and level unlocks on this device. This can't be undone.</p>
          <div class="row">
            <input placeholder='Type "RESET"' value={confirmAll()} onInput={(e) => setConfirmAll(e.currentTarget.value)} />
            <button class="danger" disabled={confirmAll() !== 'RESET'} onClick={() => {
              props.cmd(Cmd.ResetAll); setConfirmAll(''); setTierForced(new Array(MAX_TIER + 1).fill(0));
            }}>Reset everything</button>
          </div>
        </section>

        <footer class="credits">
          <p>
            3D models: <a href="https://www.z-anatomy.com" target="_blank" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0),
            derived from <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" target="_blank" rel="noopener">BodyParts3D</a> © The Database Center for Life Science.
            Simplified for the web. Scheduling: <a href="https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm" target="_blank" rel="noopener">FSRS-5</a>.
            Study aid only; verify against your course texts.
          </p>
        </footer>
      </div>
      <Show when={tip()}>
        {(t) => <div class="tooltip" style={{ left: `${t().x}px`, top: `${t().y}px` }}>{t().text}</div>}
      </Show>
    </div>
  );
};
