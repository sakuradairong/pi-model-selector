/**
 * pi-model-selector - Interactive model selection with tabbed provider UI.
 *
 * Features:
 * - Tab bar for switching between providers (Tab / Shift+Tab)
 * - Arrow keys to navigate models (↑↓)
 * - Enter to confirm selection
 * - Escape to cancel
 * - Shows cost, context window, and reasoning badges per model
 * - Marks unavailable models with LOCK
 * - Highlights the currently active model with ●
 *
 * Usage:
 *   /model-selector    - open the selector
 *   Ctrl+Shift+M       - open the selector
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

interface Provider {
  name: string; // internal provider id (e.g., "anthropic")
  displayName: string; // human-readable name
  models: ModelInfo[];
}

interface ModelInfo {
  model: Model<Api>;
  name: string; // display name
  cost: string; // e.g., "$3/$3 · 200K ctx" or "free" / "local"
  reasoning: boolean;
  available: boolean; // has API key configured
}

export default function (pi: ExtensionAPI) {
  const handler = async (_args: string, ctx: ExtensionContext): Promise<void> => {
    await openModelSelector(ctx, pi);
  };

  // Register commands. Do NOT register /model: pi treats built-in /model as
  // a special interactive command, so extension shadowing is unreliable.
  pi.registerCommand("wow-model", {
    description: "Open custom interactive model selector",
    handler,
  });
  pi.registerCommand("ms", {
    description: "Open custom interactive model selector",
    handler,
  });
  pi.registerCommand("select-model", {
    description: "Open custom interactive model selector",
    handler,
  });
  pi.registerCommand("model-selector", {
    description: "Open custom interactive model selector with provider tabs",
    handler,
  });

  // Register shortcut: Ctrl+Shift+M opens selector.
  // Avoid Ctrl+M: many terminals encode it as Enter, which can break prompt submission.
  pi.registerShortcut(Key.ctrlShift("m"), {
    description: "Open model selector",
    handler: async (ctx) => {
      await openModelSelector(ctx, pi);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode === "tui") {
      ctx.ui.setStatus("pi-model-selector", ctx.ui.theme.fg("accent", "ms:/ms"));
    }
  });
}

async function openModelSelector(
  ctx: ExtensionContext,
  pi: ExtensionAPI,
): Promise<void> {
  if (ctx.mode !== "tui") {
    if (ctx.hasUI) {
      ctx.ui.notify("Model selector UI is only available in interactive TUI mode", "warning");
    }
    return;
  }

  const providers = buildProviderList(ctx);
  if (providers.length === 0) {
    ctx.ui.notify("No registered/available models found", "warning");
    return;
  }

  const currentModelKey = ctx.model ? modelKey(ctx.model) : undefined;
  const state: SelectorState = {
    providers,
    currentProviderIndex: 0,
    modelIndex: 0,
    currentModelKey,
    // Error to show after a failed selection attempt
    lastError: undefined,
  };

  // Ensure modelIndex points to the current model on first render
  ensureCurrentModelSelected(state);

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const component = new ModelSelectorComponent(state, theme, pi, ctx, done);
    return {
      render(width: number): string[] {
        return component.render(width);
      },
      invalidate(): void {
        component.invalidate();
      },
      handleInput(data: string): void {
        component.handleInput(data);
        tui.requestRender();
      },
    };
  });
}

// ─── Provider List Builder ────────────────────────────────────────────────────

function buildProviderList(ctx: ExtensionContext): Provider[] {
  // Show only models with configured auth/OAuth/API key. `getAll()` includes
  // every built-in provider, which makes the selector noisy on installs with
  // many packaged model definitions.
  const availableModels = ctx.modelRegistry.getAvailable();

  const byProvider = new Map<string, { displayName: string; models: ModelInfo[] }>();

  for (const model of availableModels) {
    const key = model.provider;
    if (!byProvider.has(key)) {
      byProvider.set(key, {
        displayName: ctx.modelRegistry.getProviderDisplayName(key),
        models: [],
      });
    }

    const info: ModelInfo = {
      model,
      name: model.name ?? model.id,
      cost: buildCostLabel(model),
      reasoning: model.reasoning ?? false,
      available: true,
    };

    byProvider.get(key)!.models.push(info);
  }

  // Sort providers alphabetically by display name
  const sorted = Array.from(byProvider.entries()).sort(([, aVal], [, bVal]) =>
    aVal.displayName.localeCompare(bVal.displayName),
  );

  return sorted.map(([name, { displayName, models }]) => ({
    name,
    displayName,
    // Sort models within each provider alphabetically
    models: models.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

function buildCostLabel(model: Model<Api>): string {
  const c = model.cost;
  const ctxLabel = model.contextWindow ? formatContextWindow(model.contextWindow) : "";
  if (!c) return ctxLabel ? `free · ${ctxLabel}` : "free";

  const inputCost = formatPrice(c.input);
  const outputCost = formatPrice(c.output);
  const priceLabel = inputCost === "free" && outputCost === "free"
    ? "free"
    : `${inputCost}/${outputCost}`;

  return ctxLabel ? `${priceLabel} · ${ctxLabel}` : priceLabel;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "free";
  return `$${Number.isInteger(value) ? value : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M ctx`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K ctx`;
  }
  return `${tokens} ctx`;
}

// ─── Selector State ───────────────────────────────────────────────────────────

interface SelectorState {
  providers: Provider[];
  currentProviderIndex: number;
  modelIndex: number;
  currentModelKey: string | undefined;
  lastError?: string;
}

function ensureCurrentModelSelected(state: SelectorState): void {
  if (!state.currentModelKey) return;

  for (let providerIndex = 0; providerIndex < state.providers.length; providerIndex++) {
    const provider = state.providers[providerIndex];
    const modelIndex = provider.models.findIndex(
      (model) => modelKey(model.model) === state.currentModelKey,
    );
    if (modelIndex >= 0) {
      state.currentProviderIndex = providerIndex;
      state.modelIndex = modelIndex;
      return;
    }
  }
}

// ─── Model Selector Component ────────────────────────────────────────────────

class ModelSelectorComponent {
  private readonly state: SelectorState;
  private readonly theme: Theme;
  private readonly pi: ExtensionAPI;
  private readonly ctx: ExtensionContext;
  private readonly onDone: (value: void) => void;
  private cachedLines?: string[];
  private cachedWidth?: number;

  constructor(
    state: SelectorState,
    theme: Theme,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    onDone: (value: void) => void,
  ) {
    this.state = state;
    this.theme = theme;
    this.pi = pi;
    this.ctx = ctx;
    this.onDone = onDone;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    const s = this.state;

    // Tab / Shift+Tab: switch provider
    if (matchesKey(data, Key.tab)) {
      s.currentProviderIndex = (s.currentProviderIndex + 1) % s.providers.length;
      s.modelIndex = 0;
      s.lastError = undefined;
      this.invalidate();
      return;
    }

    if (matchesKey(data, Key.shift("tab"))) {
      s.currentProviderIndex =
        (s.currentProviderIndex - 1 + s.providers.length) % s.providers.length;
      s.modelIndex = 0;
      s.lastError = undefined;
      this.invalidate();
      return;
    }

    // Arrow keys: navigate model list
    const provider = s.providers[s.currentProviderIndex];
    if (!provider) return;

    if (matchesKey(data, Key.up)) {
      s.modelIndex = Math.max(0, s.modelIndex - 1);
      s.lastError = undefined;
      this.invalidate();
      return;
    }

    if (matchesKey(data, Key.down)) {
      s.modelIndex = Math.min(provider.models.length - 1, s.modelIndex + 1);
      s.lastError = undefined;
      this.invalidate();
      return;
    }

    // Enter: select model
    if (matchesKey(data, Key.enter)) {
      const model = provider.models[s.modelIndex];
      if (model) {
        void this.selectModel(model);
      }
      return;
    }

    // Escape: cancel
    if (matchesKey(data, Key.escape)) {
      this.onDone();
      return;
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines = this.buildLines(width);
    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }

  private buildLines(width: number): string[] {
    const s = this.state;
    const safeWidth = Math.max(56, width);
    const innerWidth = Math.max(1, safeWidth - 2);
    const lines: string[] = [];
    const provider = s.providers[s.currentProviderIndex];
    const visibleRange = provider ? this.visibleModelRange(provider.models.length) : { start: 0, end: -1 };

    lines.push(this.frameTop(safeWidth));
    lines.push(
      this.frameLine(
        twoColumn(
          this.styled("accent", this.bold("Model Selector")),
          this.dim(`${s.providers.length} provider${s.providers.length === 1 ? "" : "s"}`),
          innerWidth,
        ),
        innerWidth,
      ),
    );
    lines.push(this.frameLine(this.buildProviderBar(innerWidth), innerWidth));

    if (provider) {
      const modelRange = provider.models.length > 0
        ? `${visibleRange.start + 1}-${visibleRange.end + 1}/${provider.models.length}`
        : "0/0";
      lines.push(
        this.frameLine(
          twoColumn(
            this.dim(`Models ${modelRange}`),
            this.dim(`selected ${Math.min(s.modelIndex + 1, provider.models.length)}/${provider.models.length}`),
            innerWidth,
          ),
          innerWidth,
        ),
      );
    }

    lines.push(this.frameDivider(safeWidth));

    if (s.lastError) {
      lines.push(this.frameLine(this.warning(`LOCK ${s.lastError} — select a different model`), innerWidth));
      lines.push(this.frameDivider(safeWidth));
    }

    lines.push(this.frameLine(this.buildListHeader(innerWidth), innerWidth));

    if (provider && provider.models.length > 0) {
      if (visibleRange.start > 0) {
        lines.push(this.frameLine(this.dim(`  ... ${visibleRange.start} more above`), innerWidth));
      }

      for (let index = visibleRange.start; index <= visibleRange.end; index++) {
        const model = provider.models[index];
        const isActive = modelKey(model.model) === s.currentModelKey;
        const isSelected = index === s.modelIndex;
        lines.push(this.frameLine(this.buildModelLine(model, isActive, isSelected, innerWidth), innerWidth));
      }

      const below = provider.models.length - visibleRange.end - 1;
      if (below > 0) {
        lines.push(this.frameLine(this.dim(`  ... ${below} more below`), innerWidth));
      }
    } else {
      lines.push(this.frameLine(this.muted("  (no models)"), innerWidth));
    }

    lines.push(this.frameDivider(safeWidth));
    const helpText = "Tab/Shift+Tab provider • Up/Down navigate • Enter select • Esc cancel";
    lines.push(this.frameLine(centerText(this.dim(helpText), innerWidth), innerWidth));
    lines.push(this.frameBottom(safeWidth));

    return lines.map((line) => this.theme.bg("customMessageBg", line));
  }

  private buildProviderBar(width: number): string {
    const s = this.state;
    const total = s.providers.length;
    const current = s.providers[s.currentProviderIndex];
    if (!current) return "";

    const previous = total > 1
      ? s.providers[(s.currentProviderIndex - 1 + total) % total]
      : undefined;
    const next = total > 1
      ? s.providers[(s.currentProviderIndex + 1) % total]
      : undefined;

    const parts: string[] = [];
    if (previous && previous.name !== current.name) {
      parts.push(this.dim(`< ${truncatePlain(previous.displayName, 18)}`));
    }

    parts.push(
      this.theme.inverse(
        this.styled(
          "accent",
          this.bold(` ${s.currentProviderIndex + 1}/${total} ${truncatePlain(current.displayName, 30)} `),
        ),
      ),
    );

    if (next && next.name !== current.name) {
      parts.push(this.dim(`${truncatePlain(next.displayName, 18)} >`));
    }

    return centerText(truncateToWidth(parts.join("  "), width), width);
  }

  private buildListHeader(width: number): string {
    return twoColumn(this.dim("  MODEL"), this.dim("PRICE / CONTEXT"), width);
  }

  private visibleModelRange(total: number): { start: number; end: number } {
    const maxVisible = 10;
    if (total <= 0) return { start: 0, end: -1 };
    if (total <= maxVisible) return { start: 0, end: total - 1 };

    const half = Math.floor(maxVisible / 2);
    const start = Math.max(0, Math.min(this.state.modelIndex - half, total - maxVisible));
    return { start, end: start + maxVisible - 1 };
  }

  private buildModelLine(
    model: ModelInfo,
    isActive: boolean,
    isSelected: boolean,
    width: number,
  ): string {
    const cursor = isSelected ? ">" : " ";
    const activeMark = isActive ? "*" : " ";
    const unavailableMark = model.available ? "" : "LOCK ";
    const reasoningMark = model.reasoning ? "R " : "";

    const leftPlain = `${cursor}${activeMark} ${unavailableMark}${reasoningMark}${model.name}`;
    const rightPlain = model.cost || "";

    const rightWidth = Math.min(26, Math.max(16, Math.floor(width * 0.34)));
    const leftWidth = Math.max(8, width - rightWidth - 1);

    const leftColor: ThemeColor = isActive ? "success" : isSelected ? "accent" : "text";
    const left = this.styled(leftColor, truncateToWidth(leftPlain, leftWidth));
    const right = this.dim(truncateToWidth(rightPlain, rightWidth));
    const line = `${padVisible(left, leftWidth)} ${right.padStart(Math.max(0, rightWidth))}`;

    return isSelected ? this.theme.bg("selectedBg", padVisible(line, width)) : line;
  }

  private frameTop(width: number): string {
    return this.borderMuted(`+${"-".repeat(Math.max(0, width - 2))}+`);
  }

  private frameDivider(width: number): string {
    return this.borderMuted(`+${"-".repeat(Math.max(0, width - 2))}+`);
  }

  private frameBottom(width: number): string {
    return this.borderMuted(`+${"-".repeat(Math.max(0, width - 2))}+`);
  }

  private frameLine(content: string, innerWidth: number): string {
    const clipped = truncateToWidth(content, innerWidth);
    const padded = padVisible(clipped, innerWidth);
    return `${this.borderMuted("|")}${padded}${this.borderMuted("|")}`;
  }

  private async selectModel(model: ModelInfo): Promise<void> {
    const s = this.state;

    const success = await this.pi.setModel(model.model);

    if (success) {
      this.ctx.ui.notify(`Model selected: ${model.model.provider}/${model.model.id}`, "info");
      this.onDone();
    } else {
      // No API key or other failure — stay in selector, show error
      s.lastError = `No API key for ${model.model.provider}/${model.name}`;
      this.ctx.ui.notify(s.lastError, "warning");
      this.invalidate();
    }
  }

  // ─── Theme helpers (avoids verbose theme.fg(...) calls) ───────────────────

  private styled(color: ThemeColor, text: string): string {
    return this.theme.fg(color, text);
  }

  private bold(text: string): string {
    return this.theme.bold(text);
  }

  private muted(text: string): string {
    return this.theme.fg("muted", text);
  }

  private dim(text: string): string {
    return this.theme.fg("dim", text);
  }

  private warning(text: string): string {
    return this.theme.fg("warning", text);
  }

  private borderMuted(text: string): string {
    return this.theme.fg("borderMuted", text);
  }
}

function hsep(width: number): string {
  return "-".repeat(Math.max(0, width));
}

function padVisible(text: string, width: number): string {
  const remaining = width - visibleWidth(text);
  return remaining > 0 ? `${text}${" ".repeat(remaining)}` : text;
}

function truncatePlain(text: string, width: number): string {
  return truncateToWidth(text, width);
}

function centerText(text: string, width: number): string {
  const textWidth = visibleWidth(text);
  if (textWidth >= width) return truncateToWidth(text, width);
  const left = Math.floor((width - textWidth) / 2);
  return `${" ".repeat(left)}${text}`;
}

function twoColumn(left: string, right: string, width: number): string {
  const rightWidth = visibleWidth(right);
  const leftWidth = Math.max(0, width - rightWidth - 1);
  const clippedLeft = truncateToWidth(left, leftWidth);
  const gap = Math.max(1, width - visibleWidth(clippedLeft) - rightWidth);
  return `${clippedLeft}${" ".repeat(gap)}${right}`;
}
