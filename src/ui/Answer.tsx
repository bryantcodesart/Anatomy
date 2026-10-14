import { type Component, For, Show } from 'solid-js';
import type { Card } from '../types';

/** The revealed side of a card: name, etymology, O/I/A/N or joints/landmarks, tip. */
export const Answer: Component<{ card: Card }> = (p) => (
  <div class="answer">
    <h2>{p.card.name}</h2>
    <Show when={p.card.aka?.length}>
      <p class="aka">aka {p.card.aka!.join(' · ')}</p>
    </Show>
    <p class="region">{p.card.region}</p>

    <section class="ety">
      <h3>Etymology</h3>
      <p>{p.card.etymology}</p>
    </section>

    <Show when={p.card.kind === 'muscle'}>
      <dl class="oia">
        <dt>Origin</dt><dd>{p.card.origin}</dd>
        <dt>Insertion</dt><dd>{p.card.insertion}</dd>
        <dt>Action</dt>
        <dd><ul><For each={p.card.actions}>{(x) => <li>{x}</li>}</For></ul></dd>
        <dt>Nerve</dt><dd>{p.card.innervation}</dd>
      </dl>
    </Show>
    <Show when={p.card.kind === 'bone'}>
      <dl class="oia">
        <Show when={p.card.articulations?.length}>
          <dt>Joints</dt>
          <dd><ul><For each={p.card.articulations}>{(x) => <li>{x}</li>}</For></ul></dd>
        </Show>
        <Show when={p.card.landmarks?.length}>
          <dt>Landmarks</dt>
          <dd><ul><For each={p.card.landmarks}>{(x) => <li>{x}</li>}</For></ul></dd>
        </Show>
      </dl>
    </Show>
    <Show when={p.card.tip}>
      <p class="tip">{p.card.tip}</p>
    </Show>
  </div>
);
