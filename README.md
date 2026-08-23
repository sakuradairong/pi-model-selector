# pi-model-selector

Interactive model selector for [pi](https://pi.dev/) with a provider-focused terminal UI.

`pi-model-selector` replaces noisy full-provider model lists with a compact selector that only shows models available in your current pi environment. It is useful when you have many built-in providers installed but only want to switch among models with configured auth/API keys/OAuth credentials.

## Features

- Provider-focused navigation with `Tab` / `Shift+Tab`
- Model navigation with `↑` / `↓` (wraps around at both ends of the list)
- Incremental filtering: type any text to search model names across all providers
- `Backspace` edits the filter, `Ctrl+U` clears it, `Esc` clears it before closing
- Confirm selection with `Enter`
- Cancel with `Esc`
- Shows only available models from `ctx.modelRegistry.getAvailable()`
- Displays provider count, visible range, selected model details, model price, and context window
- Highlights the selected row and active model separately
- Marks current active model with `●`
- Marks reasoning-capable models with `R`
- Displays prices as `$input/$output · context`
- Handles narrow terminals with a compact fallback message instead of overflowing lines
- Avoids overriding pi's built-in `/model` command

## UI preview

```text
┌────────────────────────────────────────────────────────────────┐
│Model Selector                                       3 providers│
│ 1. Anthropic   2. Google   3. OpenAI                           │
│Provider 3/3 • OpenAI                                  15 models│
│OpenAI • showing 1-8/15         selected 3/15 active in provider│
├────────────────────────────────────────────────────────────────┤
│MODELS                                                          │
│MARK MODEL                                       PRICE / CONTEXT│
│ ·· gpt-4.1-mini                              $0.4/$1.6 · 1M ctx│
│ ●R gpt-5.2                                 $1.25/$10 · 400K ctx│
│›·R gpt-5.2-codex                           $1.25/$10 · 400K ctx│
│ ·· gpt-extra-0                             $1.25/$10 · 400K ctx│
│ ·· gpt-extra-1                             $1.25/$10 · 400K ctx│
│↓ 7 more below                                                  │
├────────────────────────────────────────────────────────────────┤
│SELECTION                                                       │
│gpt-5.2-codex                            press Enter to activate│
│OpenAI • model 3/15                            Reasoning capable│
│openai/gpt-5.2-codex                                            │
│Price / context                             $1.25/$10 · 400K ctx│
│› selected • ● active • R reasoning                             │
├────────────────────────────────────────────────────────────────┤
│  Tab/Shift+Tab provider • ↑↓ move • type to filter • Enter select│
└────────────────────────────────────────────────────────────────┘
```

### Filter mode

Typing any text switches the selector into a cross-provider search view:

```text
┌────────────────────────────────────────────────────────────────┐
│Model Selector                                       3 providers│
│Filter gp                                                    4 matches│
├────────────────────────────────────────────────────────────────┤
│SEARCH RESULTS                                                  │
│MARK MODEL                                       PRICE / CONTEXT│
│›·· OpenAI gpt-4.1-mini                      $0.4/$1.6 · 1M ctx│
│ ·R OpenAI gpt-5.2                          $1.25/$10 · 400K ctx│
│ ·R OpenAI gpt-5.2-codex                    $1.25/$10 · 400K ctx│
│ ·R Google gemini-3-pro                      $2/$12 · 1M ctx│
├────────────────────────────────────────────────────────────────┤
│SELECTION                                                       │
│gpt-4.1-mini                            press Enter to activate│
│OpenAI • result 1/4                     Standard reasoning profile│
│openai/gpt-4.1-mini                                            │
│Price / context                       $0.4/$1.6 · 1M ctx│
│› selected • ● active • R reasoning                             │
├────────────────────────────────────────────────────────────────┤
│ ↑↓ move • Backspace edit • Ctrl+U clear • Enter select • Esc clear filter│
└────────────────────────────────────────────────────────────────┘
```

The filter matches (case-insensitively) against the provider display name,
provider name, model name, model id, and `provider/id` key.

## Install

### Install as a pi package from GitHub

```bash
pi install git:github.com/sakuradairong/pi-model-selector
```

For a pinned install, use a release tag:

```bash
pi install git:github.com/sakuradairong/pi-model-selector@v0.1.0
```

Then restart pi, or run:

```text
/reload
```

### Try without installing

```bash
pi -e git:github.com/sakuradairong/pi-model-selector
```

### Manual install

Copy the extension file into your global pi extensions directory:

```bash
mkdir -p ~/.pi/agent/extensions
curl -fsSL https://raw.githubusercontent.com/sakuradairong/pi-model-selector/main/src/index.ts \
  -o ~/.pi/agent/extensions/pi-model-selector.ts
```

Then restart pi or run `/reload`.

## Usage

Open the selector with any of these commands:

```text
/ms
/wow-model
/select-model
/model-selector
```

Keyboard controls inside the selector:

| Key | Action |
| --- | --- |
| `Tab` | Next provider |
| `Shift+Tab` | Previous provider |
| `↑` / `↓` | Move through models (wraps around at both ends) |
| Any printable text | Filter models across all providers |
| `Backspace` | Edit the filter text |
| `Ctrl+U` | Clear the filter |
| `Enter` | Select model |
| `Esc` | Clear the filter first, then cancel |

A shortcut is also registered:

```text
Ctrl+Shift+M
```

## Important note about `/model`

This extension intentionally **does not override** pi's built-in `/model` command.

Pi treats `/model` as a built-in interactive command, so extension shadowing is unreliable. Use `/ms` or `/wow-model` for this selector.

## Requirements

- pi latest version
- Interactive TUI mode
- At least one model with configured auth/API key/OAuth credentials

The selector only opens in interactive TUI mode. In RPC, JSON, or print mode it will not attempt to render terminal UI.

## Development

This package follows pi's package manifest format:

```json
{
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Local test:

```bash
pi -e ./src/index.ts
```

Run the test suite (uses Node's built-in test runner, no build step needed):

```bash
node --test test/selector.test.mjs
```

## License

MIT
