import { type Component, For, Match, Show, Switch } from 'solid-js';
import { Cmd, Phase } from '../arena';
import { ui } from './bridge';

export function fmtInterval(ms: number) {
  const m = ms / 60_000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${(d / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(d / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

const GRADES = [
  { g: 1, label: 'Again', hint: "Didn't know it", cls: 'again' },
  { g: 2, label: 'Hard', hint: 'Got there, struggled', cls: 'hard' },
  { g: 3, label: 'Good', hint: 'Knew it', cls: 'good' },
  { g: 4, label: 'Easy', hint: 'Instant', cls: 'easy' },
];

const sideName = (s: 'L' | 'R' | 'M') => (s === 'L' ? 'left side' : s === 'R' ? 'right side' : 'midline');

const Tier: Component<{ tier: number }> = (p) => (
  <span class="tier" title={`Difficulty tier ${p.tier} of 5`}>
    <For each={[1, 2, 3, 4, 5]}>{(t) => <i classList={{ on: t <= p.tier }} />}</For>
  </span>
);

export const CardPanel: Component<{
  ref: (el: HTMLDivElement) => void;
  cmd: (c: Cmd, arg?: number) => void;
  onDashboard: () => void;
}> = (props) => {
  const card = () => ui.card;
  return (
    <div class="panel" ref={props.ref} classList={{ revealed: ui.phase === Phase.Revealed }}>
      <Switch>
        <Match when={ui.phase === Phase.Empty}>
          <div class="empty">
            <h2>All caught up</h2>
            <p>
              <Show when={ui.nextDueAt} fallback="Nothing scheduled.">
                Next review in {fmtInterval(ui.nextDueAt - Date.now())}.
              </Show>{' '}
              FSRS spaces reviews so each one lands just before you'd forget.
            </p>
            <div class="row">
              <button class="primary" onClick={() => props.cmd(Cmd.StudyAhead)}>Study ahead</button>
              <button onClick={props.onDashboard}>Progress</button>
            </div>
          </div>
        </Match>

        <Match when={card()}>
          {(c) => (
            <>
              <div class="meta">
                <span class={`kind ${c().kind}`}>{c().kind === 'muscle' ? 'Muscle' : 'Bone'}</span>
                <span class="side">{sideName(ui.side)}</span>
                <Tier tier={c().tier} />
              </div>

              <Show
                when={ui.phase === Phase.Revealed}
                fallback={
                  <div class="ask">
                    <p class="prompt">Name the highlighted {c().kind}.</p>
                    <p class="sub">Say it out loud — then reveal. Drag to orbit, pinch to zoom.</p>
                    <div class="row">
                      <button class="primary big" onClick={() => props.cmd(Cmd.Reveal)}>Reveal <kbd>Space</kbd></button>
                      <button class="ghost" onClick={() => props.cmd(Cmd.Skip)} title="Skip without grading">Skip</button>
                    </div>
                  </div>
                }
              >
                <div class="answer">
                  <h2>{c().name}</h2>
                  <Show when={c().aka?.length}>
                    <p class="aka">aka {c().aka!.join(' · ')}</p>
                  </Show>
                  <p class="region">{c().region}</p>

                  <section class="ety">
                    <h3>Etymology</h3>
                    <p>{c().etymology}</p>
                  </section>

                  <Show when={c().kind === 'muscle'}>
                    <dl class="oia">
                      <dt>Origin</dt><dd>{c().origin}</dd>
                      <dt>Insertion</dt><dd>{c().insertion}</dd>
                      <dt>Action</dt>
                      <dd><ul><For each={c().actions}>{(x) => <li>{x}</li>}</For></ul></dd>
                      <dt>Nerve</dt><dd>{c().innervation}</dd>
                    </dl>
                  </Show>
                  <Show when={c().kind === 'bone'}>
                    <dl class="oia">
                      <Show when={c().articulations?.length}>
                        <dt>Joints</dt>
                        <dd><ul><For each={c().articulations}>{(x) => <li>{x}</li>}</For></ul></dd>
                      </Show>
                      <Show when={c().landmarks?.length}>
                        <dt>Landmarks</dt>
                        <dd><ul><For each={c().landmarks}>{(x) => <li>{x}</li>}</For></ul></dd>
                      </Show>
                    </dl>
                  </Show>
                  <Show when={c().tip}>
                    <p class="tip">{c().tip}</p>
                  </Show>
                </div>
                <div class="grades" role="group" aria-label="How well did you know it?">
                  <For each={GRADES}>
                    {(g, i) => (
                      <button class={`grade ${g.cls}`} title={`${g.hint} (${g.g})`} onClick={() => props.cmd(Cmd.Grade, g.g)}>
                        <span class="ivl">{fmtInterval(ui.intervals[i()])}</span>
                        <span class="lbl">{g.label}</span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </>
          )}
        </Match>
      </Switch>
    </div>
  );
};
