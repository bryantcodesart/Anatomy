import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { type Arena, Cmd, Mode, Phase, pushCmd } from '../arena';
import { boot } from '../boot';
import { ui } from './bridge';
import { CardPanel } from './CardPanel';
import { Dashboard } from './Dashboard';
import { LookupPanel } from './LookupPanel';

export const App: Component = () => {
  let canvas!: HTMLCanvasElement;
  let panel: HTMLDivElement | undefined;
  const [arena, setArena] = createSignal<Arena>();
  const [progress, setProgress] = createSignal(0);
  const [error, setError] = createSignal('');
  const [dash, setDash] = createSignal(false);

  onMount(async () => {
    try {
      setArena(await boot(canvas, setProgress));
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  const cmd = (c: Cmd, arg = 0) => { const a = arena(); if (a) pushCmd(a, c, arg); };

  // Report how much of the canvas the card panel covers so the camera frames the visible area.
  const ro = new ResizeObserver(() => {
    const a = arena();
    if (!a || !panel) return;
    const wide = window.innerWidth >= 900;
    const r = panel.getBoundingClientRect();
    a.gfx.insetBottom = wide ? 0 : Math.round(Math.min(r.height, window.innerHeight * 0.6));
    a.gfx.insetRight = wide ? Math.round(window.innerWidth - r.left) : 0;
  });
  const bindPanel = (el: HTMLDivElement) => { panel = el; ro.observe(el); };
  window.addEventListener('resize', () => panel && ro.observe(panel));
  onCleanup(() => ro.disconnect());

  const onKey = (e: KeyboardEvent) => {
    if (dash() || e.target instanceof HTMLInputElement) return;
    if (ui.mode === Mode.Lookup) {
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('.lookup input')?.focus(); }
      else if (e.key === 'Escape') cmd(Cmd.LookupClear);
      else if (e.key === 'r') cmd(Cmd.Recenter);
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      if (ui.phase === Phase.Asking) { e.preventDefault(); cmd(Cmd.Reveal); }
      else if (ui.phase === Phase.Revealed && e.key === ' ') { e.preventDefault(); cmd(Cmd.Grade, 3); }
    } else if (ui.phase === Phase.Revealed && e.key >= '1' && e.key <= '4') {
      cmd(Cmd.Grade, Number(e.key));
    } else if (e.key === 'r') cmd(Cmd.Recenter);
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));

  const openDash = (open: boolean) => { setDash(open); cmd(Cmd.Pause, open ? 1 : 0); };

  return (
    <div class="app">
      <canvas ref={canvas} class="stage" />

      <header class="topbar">
        <div class="brand">Anatomy<span>flash</span></div>
        <Show when={ui.ready}>
          <div class="seg modes" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={ui.mode === Mode.Study} classList={{ on: ui.mode === Mode.Study }} onClick={() => cmd(Cmd.SetMode, Mode.Study)}>Study</button>
            <button role="tab" aria-selected={ui.mode === Mode.Lookup} classList={{ on: ui.mode === Mode.Lookup }} onClick={() => cmd(Cmd.SetMode, Mode.Lookup)}>Lookup</button>
          </div>
        </Show>
        <Show when={ui.ready && ui.mode === Mode.Study}>
          <div class="counts" title="New · Learning · Reviews due">
            <span class="c-new" title="New cards left today">{ui.newLeft}</span>
            <span class="c-learn" title="Learning (short-term re-tests) due">{ui.dueLearn}</span>
            <span class="c-rev" title="Reviews due">{ui.dueReview}</span>
          </div>
        </Show>
        <div class="tools">
          <button class="icon" title="Re-center camera (R)" aria-label="Re-center camera" onClick={() => cmd(Cmd.Recenter)}>
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></svg>
          </button>
          <button class="icon" title="Progress & settings" aria-label="Progress and settings" onClick={() => openDash(true)}>
            <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
          </button>
        </div>
      </header>

      <Show when={!ui.ready}>
        <div class="loading">
          <Show when={!error()} fallback={<p class="err">Couldn't load: {error()}</p>}>
            <p>Loading 3D anatomy…</p>
            <div class="bar"><div style={{ width: `${Math.round(progress() * 100)}%` }} /></div>
          </Show>
        </div>
      </Show>

      <Show when={ui.ready && ui.mode === Mode.Study}>
        <CardPanel ref={bindPanel} cmd={cmd} onDashboard={() => openDash(true)} />
      </Show>
      <Show when={ui.ready && ui.mode === Mode.Lookup && arena()}>
        <LookupPanel ref={bindPanel} cards={arena()!.db.cards} cmd={cmd} />
      </Show>

      <Show when={dash() && arena()}>
        <Dashboard arena={arena()!} cmd={cmd} onClose={() => openDash(false)} />
      </Show>
    </div>
  );
};
