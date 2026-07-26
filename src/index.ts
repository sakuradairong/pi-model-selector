/**
 * pi-model-selector - Interactive model selection with provider-focused TUI.
 *
 * Features:
 * - Provider switching with Tab / Shift+Tab
 * - Model navigation with ↑ / ↓
 * - Enter to confirm selection
 * - Escape to cancel
 * - Shows only models available in the current pi environment
 * - Highlights the active model and selected model separately
 * - Displays cost, context window, and reasoning capability
 *
 * Usage:
 *   /ms, /wow-model, /select-model, /model-selector - open the selector
 *   Ctrl+Shift+M                                    - open the selector
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

interface Provider {
  name: string;
  displayName: string;
  models: ModelInfo[];
}

interface ModelInfo {
  model: Model<Api>;
  name: string;
  cost: string;
  reasoning: boolean;
}

interface SelectorState {
  providers: Provider[];
  currentProviderIndex: number;
  /** Selected model index for each provider, parallel to `providers`. */
  modelIndices: number[];
  currentModelKey: string | undefined;
  lastError?: string;
}

const COMMAND_DESCRIPTION = "Open custom interactive model selector";
const MIN_DIALOG_WIDTH = 44;
const MODEL_ROWS = 8;
/** Visible width of the `›●R` marker cluster in front of each model name. */
const MARKER_WIDTH = 3;

export default function modelSelectorExtension(pi: ExtensionAPI) {
  const handler = async (_args: string, ctx: ExtensionContext): Promise<void> => {
    await openModelSelector(ctx, pi);
  };

  pi.registerCommand("wow-model", {
    description: COMMAND_DESCRIPTION,
    handler,
  });
  pi.registerCommand("ms", {
    description: COMMAND_DESCRIPTION,
    handler,
  });
  pi.registerCommand("select-model", {
    description: COMMAND_DESCRIPTION,
    handler,
  });
  pi.registerCommand("model-selector", {
    description: "Open custom interactive model selector with provider tabs",
    handler,
  });

  pi.registerShortcut(Key.ctrlShift("m"), {
    description: "Open model selector",
    handler: async (ctx: ExtensionContext) => {
      await openModelSelector(ctx, pi);
    },
  });

  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
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
    ctx.ui.notify("No available models found", "warning");
    return;
  }

  const state: SelectorState = {
    providers,
    currentProviderIndex: 0,
    modelIndices: providers.map(() => 0),
    currentModelKey: ctx.model ? modelKey(ctx.model) : undefined,
    lastError: undefined,
  };

  ensureCurrentModelSelected(state);

  await ctx.ui.custom<void>((tui: TUI, theme: Theme, _kb: unknown, done: (value: void) => void) => {
    const component = new ModelSelectorComponent(state, theme, pi, ctx, tui, done);
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

function buildProviderList(ctx: ExtensionContext): Provider[] {
  const availableModels = ctx.modelRegistry.getAvailable();
  const byProvider = new Map<string, { displayName: string; models: ModelInfo[] }>();

  for (const model of availableModels) {
    const providerName = model.provider;
    let provider = byProvider.get(providerName);

    if (!provider) {
      provider = {
        displayName: ctx.modelRegistry.getProviderDisplayName(providerName),
        models: [],
      };
      byProvider.set(providerName, provider);
    }

    provider.models.push({
      model,
      name: model.name ?? model.id,
      cost: buildCostLabel(model),
      reasoning: model.reasoning ?? false,
    });
  }

  return Array.from(byProvider.entries())
    .sort(([, a], [, b]) => a.displayName.localeCompare(b.displayName))
    .map(([name, provider]) => ({
      name,
      displayName: provider.displayName,
      models: provider.models.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

function buildCostLabel(model: Model<Api>): string {
  const contextLabel = model.contextWindow ? formatContextWindow(model.contextWindow) : "";
  const cost = model.cost;

  if (!cost) {
    return contextLabel ? `free · ${contextLabel}` : "free";
  }

  const inputCost = formatPrice(cost.input);
  const outputCost = formatPrice(cost.output);
  const priceLabel = inputCost === "free" && outputCost === "free"
    ? "free"
    : `${inputCost}/${outputCost}`;

  return contextLabel ? `${priceLabel} · ${contextLabel}` : priceLabel;
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "free";
  }

  const formatted = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");

  return `$${formatted}`;
}

function modelKey(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M ctx`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K ctx`;
  }
  return `${tokens} ctx`;
}

function ensureCurrentModelSelected(state: SelectorState): void {
  if (!state.currentModelKey) {
    return;
  }

  for (let providerIndex = 0; providerIndex < state.providers.length; providerIndex++) {
    const provider = state.providers[providerIndex];
    const modelIndex = provider.models.findIndex(
      (entry) => modelKey(entry.model) === state.currentModelKey,
    );

    if (modelIndex >= 0) {
      state.currentProviderIndex = providerIndex;
      state.modelIndices[providerIndex] = modelIndex;
      return;
    }
  }
}

class ModelSelectorComponent {
  private readonly state: SelectorState;
  private readonly theme: Theme;
  private readonly pi: ExtensionAPI;
  private readonly ctx: ExtensionContext;
  private readonly tui: TUI;
  private readonly onDone: (value: void) => void;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private closed = false;
  private selecting = false;

  constructor(
    state: SelectorState,
    theme: Theme,
    pi: ExtensionAPI,
    ctx: ExtensionContext,
    tui: TUI,
    onDone: (value: void) => void,
  ) {
    this.state = state;
    this.theme = theme;
    this.pi = pi;
    this.ctx = ctx;
    this.tui = tui;
    this.onDone = onDone;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  handleInput(data: string): void {
    if (this.closed || this.selecting) {
      return;
    }

    if (matchesKey(data, Key.tab)) {
      this.moveProvider(1);
      return;
    }

    if (matchesKey(data, Key.shift("tab"))) {
      this.moveProvider(-1);
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.moveModel(-1);
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.moveModel(1);
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const provider = this.currentProvider();
      const model = provider?.models[this.modelIndex()];
      if (model) {
        this.selecting = true;
        void this.selectModel(model);
      }
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.close();
    }
  }

  private close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onDone();
  }

  private modelIndex(): number {
    return this.state.modelIndices[this.state.currentProviderIndex] ?? 0;
  }

  private setModelIndex(index: number): void {
    this.state.modelIndices[this.state.currentProviderIndex] = index;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines = this.buildLines(width);
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  private moveProvider(offset: number): void {
    const state = this.state;
    const count = state.providers.length;
    if (count === 0) {
      return;
    }

    state.currentProviderIndex = (state.currentProviderIndex + offset + count) % count;
    const provider = this.currentProvider();
    this.setModelIndex(clamp(this.modelIndex(), 0, Math.max(0, (provider?.models.length ?? 1) - 1)));
    state.lastError = undefined;
    this.invalidate();
  }

  private moveModel(offset: number): void {
    const provider = this.currentProvider();
    if (!provider || provider.models.length === 0) {
      return;
    }

    this.setModelIndex(clamp(this.modelIndex() + offset, 0, provider.models.length - 1));
    this.state.lastError = undefined;
    this.invalidate();
  }

  private currentProvider(): Provider | undefined {
    return this.state.providers[this.state.currentProviderIndex];
  }

  private buildLines(width: number): string[] {
    const clampedWidth = Math.max(1, width);

    if (clampedWidth < MIN_DIALOG_WIDTH) {
      return this.renderTooNarrow(clampedWidth);
    }

    const innerWidth = clampedWidth - 2;
    const provider = this.currentProvider();
    const visibleRange = provider
      ? this.visibleModelRange(provider.models.length)
      : { start: 0, end: -1 };

    const lines: string[] = [];
    lines.push(this.frameTop(clampedWidth));
    lines.push(this.frameLine(this.headerLine(innerWidth), innerWidth));
    lines.push(this.frameLine(this.providerStrip(innerWidth), innerWidth));
    lines.push(this.frameLine(this.providerMetaLine(innerWidth, provider), innerWidth));
    lines.push(this.frameLine(this.summaryLine(innerWidth, provider, visibleRange), innerWidth));
    lines.push(this.frameDivider(clampedWidth));

    if (provider) {
      lines.push(this.frameLine(this.sectionTitle("Models"), innerWidth));
      lines.push(this.frameLine(this.tableHeader(innerWidth), innerWidth));

      if (provider.models.length === 0) {
        lines.push(this.frameLine(this.muted("No models available for this provider"), innerWidth));
      } else {
        if (visibleRange.start > 0) {
          lines.push(this.frameLine(this.dim(`↑ ${visibleRange.start} more above`), innerWidth));
        }

        for (let index = visibleRange.start; index <= visibleRange.end; index++) {
          const model = provider.models[index];
          const isActive = modelKey(model.model) === this.state.currentModelKey;
          const isSelected = index === this.modelIndex();
          lines.push(this.frameLine(this.modelRow(model, isActive, isSelected, innerWidth), innerWidth));
        }

        const below = provider.models.length - visibleRange.end - 1;
        if (below > 0) {
          lines.push(this.frameLine(this.dim(`↓ ${below} more below`), innerWidth));
        }
      }

      lines.push(this.frameDivider(clampedWidth));
      lines.push(this.frameLine(this.sectionTitle("Selection"), innerWidth));
      for (const detailLine of this.detailLines(provider, innerWidth)) {
        lines.push(this.frameLine(detailLine, innerWidth));
      }
    }

    if (this.state.lastError) {
      lines.push(this.frameDivider(clampedWidth));
      lines.push(this.frameLine(this.warning(`Failed: ${this.state.lastError}`), innerWidth));
    }

    lines.push(this.frameDivider(clampedWidth));
    lines.push(this.frameLine(this.helpLine(innerWidth), innerWidth));
    lines.push(this.frameBottom(clampedWidth));

    return lines.map((line) => this.theme.bg("customMessageBg", truncateToWidth(line, clampedWidth, "")));
  }

  private renderTooNarrow(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const innerWidth = Math.max(0, safeWidth - 2);
    const lines = [
      this.frameTop(safeWidth),
      this.frameLine(this.styled("accent", this.bold("Model Selector")), innerWidth),
      this.frameLine(this.warning(`Window too narrow (${safeWidth} cols)`), innerWidth),
      this.frameLine(this.dim(`Resize to at least ${MIN_DIALOG_WIDTH} columns`), innerWidth),
      this.frameBottom(safeWidth),
    ];
    return lines.map((line) => this.theme.bg("customMessageBg", truncateToWidth(line, safeWidth, "")));
  }

  private headerLine(width: number): string {
    return twoColumn(
      this.styled("accent", this.bold("Model Selector")),
      this.dim(`${this.state.providers.length} provider${this.state.providers.length === 1 ? "" : "s"}`),
      width,
    );
  }

  private providerStrip(width: number): string {
    const providers = this.state.providers;
    const currentIndex = this.state.currentProviderIndex;
    const current = providers[currentIndex];
    if (!current) {
      return "";
    }

    const fullSegments = providers.map((provider, index) => this.providerLabel(provider, index, index === currentIndex));
    const fullLine = fullSegments.join(" ");
    if (visibleWidth(fullLine) <= width) {
      return fullLine;
    }

    const segments: string[] = [];
    const hiddenLeft = currentIndex;
    const hiddenRight = providers.length - currentIndex - 1;

    if (hiddenLeft > 1) {
      segments.push(this.dim(`← ${hiddenLeft} more`));
    } else if (hiddenLeft === 1) {
      segments.push(this.providerLabel(providers[currentIndex - 1], currentIndex - 1, false));
    }

    segments.push(this.providerLabel(current, currentIndex, true));

    if (hiddenRight === 1) {
      segments.push(this.providerLabel(providers[currentIndex + 1], currentIndex + 1, false));
    } else if (hiddenRight > 1) {
      segments.push(this.dim(`${hiddenRight} more →`));
    }

    return fitSegments(segments, width);
  }

  private providerLabel(provider: Provider, index: number, isCurrent: boolean): string {
    const label = ` ${index + 1}. ${provider.displayName} `;
    if (isCurrent) {
      return this.theme.inverse(this.styled("accent", this.bold(label)));
    }
    return this.muted(label);
  }

  private providerMetaLine(width: number, provider: Provider | undefined): string {
    if (!provider) {
      return this.muted("No provider selected");
    }

    return twoColumn(
      this.dim(`Provider ${this.state.currentProviderIndex + 1}/${this.state.providers.length} • ${provider.displayName}`),
      this.dim(`${provider.models.length} model${provider.models.length === 1 ? "" : "s"}`),
      width,
    );
  }

  private summaryLine(
    width: number,
    provider: Provider | undefined,
    visibleRange: { start: number; end: number },
  ): string {
    if (!provider) {
      return this.muted("No providers available");
    }

    const total = provider.models.length;
    const modelPosition = total === 0 ? "0/0" : `${this.modelIndex() + 1}/${total}`;
    const visibleLabel = total === 0
      ? "0/0"
      : `${visibleRange.start + 1}-${visibleRange.end + 1}/${total}`;
    const activeLabel = this.state.currentModelKey?.startsWith(`${provider.name}/`)
      ? this.styled("success", "active in provider")
      : this.dim("active elsewhere");

    return twoColumn(
      this.dim(`${provider.displayName} • showing ${visibleLabel}`),
      `${this.dim(`selected ${modelPosition}`)} ${activeLabel}`,
      width,
    );
  }

  private sectionTitle(label: string): string {
    return this.styled("accent", this.bold(label.toUpperCase()));
  }

  private tableHeader(width: number): string {
    const nameWidth = this.nameColumnWidth(width);
    const priceWidth = this.priceColumnWidth(width);
    return `${padVisible(this.dim("MARK MODEL"), nameWidth)} ${alignRight(this.dim("PRICE / CONTEXT"), priceWidth)}`;
  }

  private modelRow(model: ModelInfo, isActive: boolean, isSelected: boolean, width: number): string {
    const nameWidth = this.nameColumnWidth(width);
    const priceWidth = this.priceColumnWidth(width);

    const selectedMark = isSelected ? this.styled("accent", "›") : this.dim(" ");
    const activeMark = isActive ? this.styled("success", "●") : this.dim("·");
    const reasoningMark = model.reasoning ? this.styled("warning", "R") : this.dim("·");
    const markers = `${selectedMark}${activeMark}${reasoningMark}`;

    let nameColor: ThemeColor = "text";
    if (isSelected) {
      nameColor = "accent";
    } else if (isActive) {
      nameColor = "success";
    }

    // Colour the name on its own: `markers` already closes its own colour spans,
    // so wrapping both together would reset the name back to the default colour.
    const nameText = truncateToWidth(model.name, Math.max(0, nameWidth - MARKER_WIDTH - 1));
    const leftText = `${markers} ${this.styled(nameColor, nameText)}`;
    const left = padVisible(leftText, nameWidth);
    const rightText = truncateToWidth(model.cost, priceWidth);
    const right = alignRight(this.dim(rightText), priceWidth);
    const line = `${left} ${right}`;

    return isSelected ? this.theme.bg("selectedBg", padVisible(line, width)) : line;
  }

  private detailLines(provider: Provider, width: number): string[] {
    const model = provider.models[this.modelIndex()];
    if (!model) {
      return [this.muted("No model selected")];
    }

    const isActive = modelKey(model.model) === this.state.currentModelKey;
    const status = isActive
      ? this.styled("success", "active now")
      : this.styled("accent", "press Enter to activate");
    let capability = this.dim("Standard reasoning profile");
    if (model.reasoning) {
      capability = this.styled("warning", "Reasoning capable");
    }

    const selectedPosition = `${this.modelIndex() + 1}/${provider.models.length}`;
    const markerSummary = [
      this.styled("accent", "› selected"),
      this.styled("success", "● active"),
      this.styled("warning", "R reasoning"),
    ].join(this.dim(" • "));

    return [
      twoColumn(this.bold(model.name), status, width),
      twoColumn(this.dim(`${provider.displayName} • model ${selectedPosition}`), capability, width),
      this.dim(`${provider.name}/${model.model.id}`),
      twoColumn(this.dim("Price / context"), this.bold(this.dim(model.cost)), width),
      markerSummary,
    ];
  }

  private helpLine(width: number): string {
    return centerText(
      this.dim("Tab/Shift+Tab provider • ↑↓ move • Enter select • Esc cancel"),
      width,
    );
  }

  private visibleModelRange(total: number): { start: number; end: number } {
    if (total <= 0) {
      return { start: 0, end: -1 };
    }

    if (total <= MODEL_ROWS) {
      return { start: 0, end: total - 1 };
    }

    const half = Math.floor(MODEL_ROWS / 2);
    const start = clamp(this.modelIndex() - half, 0, total - MODEL_ROWS);
    return { start, end: start + MODEL_ROWS - 1 };
  }

  private nameColumnWidth(width: number): number {
    const priceWidth = this.priceColumnWidth(width);
    return Math.max(12, width - priceWidth - 1);
  }

  private priceColumnWidth(width: number): number {
    return clamp(Math.floor(width * 0.35), 16, 28);
  }

  private frameTop(width: number): string {
    return this.borderMuted(`┌${hsep(width - 2, "─")}┐`);
  }

  private frameDivider(width: number): string {
    return this.borderMuted(`├${hsep(width - 2, "─")}┤`);
  }

  private frameBottom(width: number): string {
    return this.borderMuted(`└${hsep(width - 2, "─")}┘`);
  }

  private frameLine(content: string, innerWidth: number): string {
    return `${this.borderMuted("│")}${padVisible(truncateToWidth(content, innerWidth, ""), innerWidth)}${this.borderMuted("│")}`;
  }

  private async selectModel(model: ModelInfo): Promise<void> {
    const label = `${model.model.provider}/${model.model.id}`;

    try {
      const success = await this.pi.setModel(model.model);

      if (success) {
        this.state.currentModelKey = modelKey(model.model);
        this.state.lastError = undefined;
        this.invalidate();
        this.ctx.ui.notify(`Model selected: ${label}`, "info");
        this.close();
        return;
      }

      this.state.lastError = label;
      this.ctx.ui.notify(`Failed to select ${label}`, "warning");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.state.lastError = `${label} (${reason})`;
      this.ctx.ui.notify(`Failed to select ${label}: ${reason}`, "error");
    } finally {
      this.selecting = false;
      this.invalidate();
      // setModel resolves after the keypress that triggered it, so ask the TUI
      // to repaint instead of waiting for the next input event.
      this.tui.requestRender();
    }
  }

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

function hsep(width: number, char = "─"): string {
  return char.repeat(Math.max(0, width));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function padVisible(text: string, width: number): string {
  const remaining = width - visibleWidth(text);
  return remaining > 0 ? `${text}${" ".repeat(remaining)}` : truncateToWidth(text, width, "");
}

function alignRight(text: string, width: number): string {
  const remaining = width - visibleWidth(text);
  return remaining > 0 ? `${" ".repeat(remaining)}${text}` : truncateToWidth(text, width, "");
}

function centerText(text: string, width: number): string {
  const textWidth = visibleWidth(text);
  if (textWidth >= width) {
    return truncateToWidth(text, width, "");
  }

  const leftPad = Math.floor((width - textWidth) / 2);
  return `${" ".repeat(leftPad)}${text}`;
}

function twoColumn(left: string, right: string, width: number): string {
  const rightWidth = visibleWidth(right);
  const leftWidth = Math.max(0, width - rightWidth - 1);
  const clippedLeft = truncateToWidth(left, leftWidth, "");
  const gap = Math.max(1, width - visibleWidth(clippedLeft) - rightWidth);
  return `${clippedLeft}${" ".repeat(gap)}${right}`;
}

function fitSegments(segments: string[], width: number): string {
  if (segments.length === 0) {
    return "";
  }

  const separator = " ";
  let combined = segments.join(separator);
  if (visibleWidth(combined) <= width) {
    return combined;
  }

  const first = segments[0] ?? "";
  if (segments.length === 1) {
    return truncateToWidth(first, width, "");
  }

  const last = segments.at(-1) ?? "";
  const middleCount = Math.max(0, segments.length - 2);
  const summary = middleCount > 0 ? ` ${middleCount} more ` : " ";
  combined = `${truncateToWidth(first, Math.max(8, Math.floor(width * 0.35)), "")}${separator}${summary}${separator}${truncateToWidth(last, Math.max(8, Math.floor(width * 0.25)), "")}`;

  return truncateToWidth(combined, width, "");
}
