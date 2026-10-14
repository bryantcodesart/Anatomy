// Lookup mode: browse or search every bone and muscle; selecting one flies the
// camera to it and shows its answer. Tapping the body selects too (pick system).
import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import { Cmd, Phase } from '../arena';
import type { Card } from '../types';
import { Answer } from './Answer';
import { ui } from './bridge';
import { Tier } from './CardPanel';

const REGION_ORDER = [
  'Head', 'Skull', 'Face', 'Eye', 'Ear', 'Tongue', 'Pharynx', 'Larynx', 'Neck',
  'Shoulder', 'Thorax', 'Back', 'Spine', 'Abdomen', 'Pelvic floor', 'Pelvis',
  'Arm', 'Forearm', 'Hand', 'Hip', 'Thigh', 'Knee', 'Leg', 'Foot',
];
const regionRank = (r: string) => { const i = REGION_ORDER.indexOf(r); return i < 0 ? 99 : i; };

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

type Tab = 'muscle' | 'bone';
const TAB_KEY = 'anatomy-flashcards.lookupTab';
const loadTab = (): Tab => { try { return localStorage.getItem(TAB_KEY) === 'bone' ? 'bone' : 'muscle'; } catch { return 'muscle'; } };

export const LookupPanel: Component<{
  ref: (el: HTMLDivElement) => void;
  cards: Card[];
  cmd: (c: Cmd, arg?: number) => void;
}> = (props) => {
  const [tab, setTabRaw] = createSignal<Tab>(loadTab());
  const setTab = (t: Tab) => { setTabRaw(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ } };
  const [query, setQuery] = createSignal('');

  // search haystacks, built once
  const index = props.cards.map((c, i) => ({
    i, c,
    name: fold([c.name, ...(c.aka ?? [])].join(' | ')),
    region: fold(c.region),
    ety: fold(c.etymology),
  }));
  const counts = { muscle: props.cards.filter((c) => c.kind === 'muscle').length, bone: props.cards.filter((c) => c.kind === 'bone').length };

  const groups = createMemo(() => {
    const byRegion = new Map<string, { i: number; c: Card }[]>();
    for (const e of index) {
      if (e.c.kind !== tab()) continue;
      if (!byRegion.has(e.c.region)) byRegion.set(e.c.region, []);
      byRegion.get(e.c.region)!.push(e);
    }
    return [...byRegion.entries()]
      .sort((a, b) => regionRank(a[0]) - regionRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([region, items]) => ({ region, items: items.sort((a, b) => a.c.name.localeCompare(b.c.name)) }));
  });

  // ranked search across bones and muscles: name/aka > region > etymology
  const results = createMemo(() => {
    const terms = fold(query()).split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const scored: { i: number; c: Card; score: number }[] = [];
    for (const e of index) {
      let score = 0;
      for (const t of terms) {
        if (e.name.startsWith(t)) score += 6;
        else if (e.name.includes(' ' + t) || e.name.includes('(' + t)) score += 4;
        else if (e.name.includes(t)) score += 3;
        else if (e.region.includes(t)) score += 2;
        else if (e.ety.includes(t)) score += 1;
        else { score = 0; break; }
      }
      if (score) scored.push({ i: e.i, c: e.c, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.c.tier - b.c.tier || a.c.name.localeCompare(b.c.name)).slice(0, 80);
  });

  const show = (i: number, inst = 0) => props.cmd(Cmd.LookupShow, i * 4 + inst);
  const selected = () => (ui.phase === Phase.Lookup ? ui.card : null);

  // related cards: the whole muscle this is part of, and the parts it is made of
  const related = createMemo(() => {
    const c = selected();
    if (!c) return { parents: [], children: [] };
    const mine = new Set(c.inst[0]?.parts ?? []);
    const parents: { i: number; c: Card }[] = [], children: { i: number; c: Card }[] = [];
    props.cards.forEach((o, i) => {
      if (o === c || o.kind !== c.kind || o.id === c.id) return;
      const theirs = new Set(o.inst[0]?.parts ?? []);
      if (theirs.size > mine.size && [...mine].every((p) => theirs.has(p))) parents.push({ i, c: o });
      else if (theirs.size < mine.size && theirs.size > 0 && [...theirs].every((p) => mine.has(p))) children.push({ i, c: o });
    });
    return { parents, children };
  });

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { if (query()) setQuery(''); else props.cmd(Cmd.LookupClear); }
  };

  return (
    <div class="panel lookup" ref={props.ref} onKeyDown={onKey}>
      <Show when={selected()}>
        {(c) => (
          <div class="detail">
            <div class="detail-bar">
              <button class="ghost back" onClick={() => props.cmd(Cmd.LookupClear)} aria-label="Back to list">← List</button>
              <span class={`kind ${c().kind}`}>{c().kind === 'muscle' ? 'Muscle' : 'Bone'}</span>
              <Tier tier={c().tier} />
            </div>
            <Show when={c().inst.length > 1}>
              <div class="seg sides" role="group" aria-label="Side">
                <For each={c().inst}>
                  {(it, k) => (
                    <button classList={{ on: ui.inst === k() }} onClick={() => show(ui.cardIndex, k())}>
                      {it.side === 'L' ? 'Left' : it.side === 'R' ? 'Right' : 'Midline'}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Answer card={c()} />
            <Show when={related().parents.length || related().children.length}>
              <div class="related">
                <Show when={related().parents.length}>
                  <span>Part of</span>
                  <For each={related().parents}>{(r) => <button class="chip" onClick={() => show(r.i, ui.inst)}>{r.c.name}</button>}</For>
                </Show>
                <Show when={related().children.length}>
                  <span>Made of</span>
                  <For each={related().children}>{(r) => <button class="chip" onClick={() => show(r.i, ui.inst)}>{r.c.name}</button>}</For>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>

      <div class="browse" style={{ display: selected() ? 'none' : undefined }}>
        <div class="search">
          <input
            type="search"
            placeholder="Search muscles & bones…"
            aria-label="Search muscles and bones"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results().length) show(results()[0].i); }}
          />
        </div>
        <Show
          when={query().trim()}
          fallback={
            <>
              <div class="seg tabs" role="tablist">
                <button role="tab" aria-selected={tab() === 'muscle'} classList={{ on: tab() === 'muscle' }} onClick={() => setTab('muscle')}>
                  Muscles <small>{counts.muscle}</small>
                </button>
                <button role="tab" aria-selected={tab() === 'bone'} classList={{ on: tab() === 'bone' }} onClick={() => setTab('bone')}>
                  Bones <small>{counts.bone}</small>
                </button>
              </div>
              <p class="hint">Tap any structure on the body to identify it.</p>
              <For each={groups()}>
                {(g) => (
                  <section class="group">
                    <h4>{g.region} <small>{g.items.length}</small></h4>
                    <ul>
                      <For each={g.items}>{(e) => <li><button onClick={() => show(e.i)}>{e.c.name}</button></li>}</For>
                    </ul>
                  </section>
                )}
              </For>
            </>
          }
        >
          <Show when={results().length} fallback={<p class="hint">No matches for “{query()}”.</p>}>
            <ul class="results">
              <For each={results()}>
                {(r) => (
                  <li>
                    <button onClick={() => show(r.i)}>
                      <span>{r.c.name}</span>
                      <small class={`kind ${r.c.kind}`}>{r.c.kind === 'muscle' ? 'Muscle' : 'Bone'}</small>
                      <small class="rg">{r.c.region}</small>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </div>
  );
};
