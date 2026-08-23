/**
 * Tests for pi-model-selector.
 *
 * Run with: node --test test/
 *
 * Node's type stripping runs src/index.ts directly, so no build step is
 * needed. The mock theme implements every Theme method the component calls;
 * all of them return their text argument unchanged.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelSelectorComponent,
  collectSearchHits,
  wrapIndex,
} from "../src/index.ts";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const TAB = "\t";
const ESC = "\x1b";
const BACKSPACE = "\x7f";
const CTRL_U = "\x15";
const KITTY_A = "\x1b[97u";
const KITTY_BACKSPACE = "\x1b[127u";
const KITTY_CTRL_U = "\x1b[117;5u";
const KITTY_ENTER = "\x1b[13u";

function makeModel(provider, id, extra = {}) {
  return {
    provider,
    id,
    name: id,
    reasoning: false,
    contextWindow: 1_000_000,
    ...extra,
  };
}

function makeProviders() {
  return [
    {
      name: "anthropic",
      displayName: "Anthropic",
      models: [
        {
          model: makeModel("anthropic", "claude-sonnet-4-5"),
          name: "claude-sonnet-4-5",
          cost: "free",
          reasoning: true,
        },
        {
          model: makeModel("anthropic", "claude-opus-4"),
          name: "claude-opus-4",
          cost: "free",
          reasoning: true,
        },
      ],
    },
    {
      name: "openai",
      displayName: "OpenAI",
      models: [
        {
          model: makeModel("openai", "gpt-4.1-mini"),
          name: "gpt-4.1-mini",
          cost: "free",
          reasoning: false,
        },
        {
          model: makeModel("openai", "gpt-5.2"),
          name: "gpt-5.2",
          cost: "free",
          reasoning: true,
        },
        {
          model: makeModel("openai", "gpt-5.2-codex"),
          name: "gpt-5.2-codex",
          cost: "free",
          reasoning: true,
        },
      ],
    },
  ];
}

function makeComponent({
  providers = makeProviders(),
  currentModelKey = undefined,
} = {}) {
  const state = {
    providers,
    currentProviderIndex: 0,
    modelIndices: providers.map(() => 0),
    currentModelKey,
  };

  const selected = [];
  const notifications = [];
  const theme = {
    fg: (_color, text) => text,
    bg: (_color, text) => text,
    bold: (text) => text,
    inverse: (text) => text,
  };

  let doneCalled = 0;
  const component = new ModelSelectorComponent(
    state,
    theme,
    {
      setModel: async (model) => {
        selected.push(model);
        return true;
      },
    },
    { ui: { notify: (message) => notifications.push(message) } },
    { requestRender: () => {} },
    () => {
      doneCalled += 1;
    },
  );

  return {
    component,
    state,
    selected,
    notifications,
    doneCalled: () => doneCalled,
  };
}

test("wrapIndex wraps in both directions", () => {
  assert.equal(wrapIndex(0, -1, 5), 4);
  assert.equal(wrapIndex(4, 1, 5), 0);
  assert.equal(wrapIndex(2, 1, 5), 3);
  assert.equal(wrapIndex(0, -1, 1), 0);
  assert.equal(wrapIndex(0, -1, 0), 0);
  assert.equal(wrapIndex(4, -6, 5), 3);
});

test("up at the top of the list jumps to the bottom", () => {
  const { component, state } = makeComponent();
  assert.equal(state.modelIndices[0], 0);

  component.handleInput(UP);
  assert.equal(
    state.modelIndices[0],
    1,
    "two-model provider wraps to the last model",
  );

  component.handleInput(UP);
  assert.equal(state.modelIndices[0], 0);
});

test("down at the bottom of the list jumps to the top", () => {
  const { component, state } = makeComponent();
  state.modelIndices[0] = 1;

  component.handleInput(DOWN);
  assert.equal(state.modelIndices[0], 0);
});

test("wrap navigation on a single-model provider stays put", () => {
  const providers = [
    {
      name: "solo",
      displayName: "Solo",
      models: [
        {
          model: makeModel("solo", "only-model"),
          name: "only-model",
          cost: "free",
          reasoning: false,
        },
      ],
    },
  ];
  const { component, state } = makeComponent({ providers });

  component.handleInput(UP);
  component.handleInput(DOWN);
  assert.equal(state.modelIndices[0], 0);
});

test("collectSearchHits matches names, ids, providers, and keys", () => {
  const providers = makeProviders();

  assert.deepEqual(
    collectSearchHits(providers, "sonnet").map((hit) => hit.model.name),
    ["claude-sonnet-4-5"],
  );
  assert.deepEqual(
    collectSearchHits(providers, "GPT-5").map((hit) => hit.model.name),
    ["gpt-5.2", "gpt-5.2-codex"],
  );
  assert.deepEqual(
    collectSearchHits(providers, "openai").map((hit) => hit.model.name),
    ["gpt-4.1-mini", "gpt-5.2", "gpt-5.2-codex"],
  );
  assert.deepEqual(
    // "openai/gpt-5.2" is also a prefix of "openai/gpt-5.2-codex", so plain
    // substring matching keeps both - same behaviour as fzf-style filters.
    collectSearchHits(providers, "openai/gpt-5.2").map((hit) => hit.model.name),
    ["gpt-5.2", "gpt-5.2-codex"],
  );
  assert.deepEqual(collectSearchHits(providers, ""), []);
  assert.deepEqual(collectSearchHits(providers, "   "), []);
  assert.deepEqual(collectSearchHits(providers, "does-not-exist"), []);
});

test("collectSearchHits reports provider and model indices", () => {
  const providers = makeProviders();
  const hit = collectSearchHits(providers, "codex")[0];

  assert.equal(hit.providerIndex, 1);
  assert.equal(hit.modelIndex, 2);
  assert.equal(hit.model.model.provider, "openai");
});

test("typing printable characters starts the filter", () => {
  const { component } = makeComponent();

  component.handleInput("g");
  component.handleInput("p");
  component.handleInput("t");

  assert.equal(component.filterText, "gpt");
  assert.equal(component.searchCursor, 0);
});

test("kitty CSI-u printable characters feed the filter", () => {
  const { component } = makeComponent();

  component.handleInput(KITTY_A);

  assert.equal(component.filterText, "a");
});

test("control characters never start the filter", () => {
  const { component } = makeComponent();

  component.handleInput("\x01"); // ctrl+a
  component.handleInput("\x1b[F"); // end key

  assert.equal(component.filterText, "");
});

test("kitty CSI-u letter sequences behave like pi's Input component", () => {
  // \x1b[65;1u is the Kitty encoding of a plain "A" key press, not an arrow
  // key (arrows arrive as CSI 1;m A and are matched earlier). pi's own Input
  // component accepts this sequence as text, so the filter does too.
  const { component } = makeComponent();

  component.handleInput("\x1b[65;1u");

  assert.equal(component.filterText, "A");
});

test("filter navigation moves through matches and wraps", () => {
  const { component } = makeComponent();

  component.handleInput("g");
  component.handleInput("p");
  component.handleInput("t");
  // Matches: gpt-4.1-mini, gpt-5.2, gpt-5.2-codex (cursor at 0).

  component.handleInput(DOWN);
  component.handleInput(DOWN);
  assert.equal(component.searchCursor, 2);

  component.handleInput(UP);
  assert.equal(component.searchCursor, 1);

  component.handleInput(UP);
  component.handleInput(UP);
  assert.equal(
    component.searchCursor,
    2,
    "up wraps from the first hit to the last",
  );

  component.handleInput(DOWN);
  assert.equal(
    component.searchCursor,
    0,
    "down wraps from the last hit to the first",
  );
});

test("enter selects the highlighted search hit and syncs the provider view", async () => {
  const { component, state, selected, doneCalled } = makeComponent();

  component.handleInput("g");
  component.handleInput("p");
  component.handleInput("t");
  component.handleInput(DOWN); // gpt-5.2
  component.handleInput(ENTER);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "gpt-5.2");
  assert.equal(state.currentProviderIndex, 1);
  assert.equal(state.modelIndices[1], 1);

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(doneCalled(), 1, "dialog closes after a successful selection");
});

test("kitty enter sequence selects the highlighted search hit", async () => {
  const { component, selected } = makeComponent();

  component.handleInput("codex");
  component.handleInput(KITTY_ENTER);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, "gpt-5.2-codex");
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("enter with no search hits selects nothing", () => {
  const { component, selected } = makeComponent();

  component.handleInput("zzz");
  component.handleInput(ENTER);

  assert.equal(selected.length, 0);
});

test("backspace edits the filter and deactivates it when empty", () => {
  const { component } = makeComponent();

  component.handleInput("g");
  component.handleInput("p");
  component.handleInput(BACKSPACE);

  assert.equal(component.filterText, "g");

  component.handleInput(KITTY_BACKSPACE);
  assert.equal(
    component.filterText,
    "",
    "kitty backspace also edits the filter",
  );
  assert.equal(component.filterText.length, 0);
});

test("ctrl+u clears the whole filter", () => {
  const { component } = makeComponent();

  component.handleInput("g");
  component.handleInput("p");
  component.handleInput(CTRL_U);

  assert.equal(component.filterText, "");

  component.handleInput("g");
  component.handleInput(KITTY_CTRL_U);
  assert.equal(component.filterText, "", "kitty ctrl+u also clears the filter");
});

test("esc clears the filter first and closes on the second press", () => {
  const { component, doneCalled } = makeComponent();

  component.handleInput("g");
  component.handleInput(ESC);

  assert.equal(component.filterText, "");
  assert.equal(doneCalled(), 0, "first Esc only clears the filter");

  component.handleInput(ESC);
  assert.equal(doneCalled(), 1, "second Esc closes the dialog");
});

test("tab is ignored while filtering", () => {
  const { component, state } = makeComponent();

  component.handleInput("g");
  component.handleInput(TAB);
  component.handleInput("\x1b[Z"); // shift+tab

  assert.equal(component.filterText, "g");
  assert.equal(state.currentProviderIndex, 0);
});

test("typed filter still filters after provider switches", () => {
  const { component, state } = makeComponent();

  state.currentProviderIndex = 1;
  state.modelIndices[1] = 2;

  component.handleInput("claude");
  // One Anthropic hit; Enter should select it even though OpenAI was active.
  component.handleInput(ENTER);

  assert.equal(component.filterText, "claude");
});

test("render shows the filter line, match count, and provider tags", () => {
  const { component } = makeComponent({
    currentModelKey: "openai/gpt-5.2",
  });

  component.handleInput("g");
  component.handleInput("p");
  component.handleInput("t");
  component.handleInput(DOWN); // cursor on gpt-5.2, the active model

  const lines = component.render(80);
  const text = lines.join("\n");

  assert.ok(lines.length > 10);
  for (const line of lines) {
    assert.equal(
      line.length,
      80,
      "every rendered line is exactly the dialog width",
    );
  }
  assert.match(text, /Filter gpt/);
  assert.match(text, /3 matches/);
  assert.match(text, /SEARCH RESULTS/);
  assert.match(text, /OpenAI gpt-5\.2/);
  assert.match(text, /active now/);
  assert.match(text, /Esc clear filter/);
});

test("render shows a no-match message for an empty result set", () => {
  const { component } = makeComponent();

  component.handleInput("zzz");

  const text = component.render(80).join("\n");
  assert.match(text, /0 matches/);
  assert.match(text, /No models match "zzz"/);
  assert.match(text, /No model selected/);
});

test("render keeps the provider view when no filter is active", () => {
  const { component } = makeComponent();

  const lines = component.render(80);
  const text = lines.join("\n");

  assert.match(text, /Anthropic\s+2\. OpenAI/);
  assert.match(text, /type to filter/);
  assert.doesNotMatch(text, /SEARCH RESULTS/);
});

test("render falls back to the narrow-terminal message", () => {
  const { component } = makeComponent();

  component.handleInput("g");
  const lines = component.render(30);

  assert.equal(lines.length, 5);
  assert.match(lines.join("\n"), /Window too narrow \(30 cols\)/);
});
