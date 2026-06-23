# pi-model-selector

Interactive model selector for [pi](https://pi.dev/) with a provider-focused terminal UI.

`pi-model-selector` replaces noisy full-provider model lists with a compact selector that only shows models available in your current pi environment. It is useful when you have many built-in providers installed but only want to switch among models with configured auth/API keys/OAuth credentials.

## Features

- Provider-focused navigation with `Tab` / `Shift+Tab`
- Model navigation with `↑` / `↓`
- Confirm selection with `Enter`
- Cancel with `Esc`
- Shows only available models from `ctx.modelRegistry.getAvailable()`
- Displays provider count, model range, selected index, model price, and context window
- Highlights the currently selected row
- Marks current active model with `*`
- Marks reasoning-capable models with `R`
- Avoids overriding pi's built-in `/model` command

## UI preview

```text
+--------------------------------------------------------------+
|Model Selector                                      3 providers|
|          < Anthropic       2/3 OpenAI       Google >          |
|Models 1-10/18                                  selected 3/18|
+--------------------------------------------------------------+
|  MODEL                                      PRICE / CONTEXT   |
|>  R gpt-5.2-codex                          $1.25/$10 · 400K |
| * R gpt-5.2                                $1.25/$10 · 400K |
|   gpt-4.1-mini                              $0.4/$1.6 · 1M   |
+--------------------------------------------------------------+
|      Tab/Shift+Tab provider • Up/Down navigate • Enter select|
+--------------------------------------------------------------+
```

## Install

### Install as a pi package from GitHub

```bash
pi install git:github.com/sakuradairong/pi-model-selector
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
| `↑` / `↓` | Move through models |
| `Enter` | Select model |
| `Esc` | Cancel |

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

## License

MIT
