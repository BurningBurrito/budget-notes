# Budget Notes

Plan a budget in a note: set a total and drag a slider for each category. Everything is saved as plain text inside the note, so you can read it, fix it by hand, and see every change in your version history.

Each budget is its own note: a monthly household budget, a trip, a holiday, and so on.

## Features

- **Total and sliders:** one slider and one dollar box per category. Dragging updates the box, typing updates the slider.
- **Percent of total** for every category.
- **Lock** a category so its amount can't be changed by accident.
- **Left to allocate:** total minus all categories. Turns red and says "Over by $X" when you've planned more than the total. Other sliders are never shrunk automatically.
- **Needs, Wants and Savings** groups, each with a subtotal and its share of the total, next to the 50/30/20 guideline.
- **Edit categories:** add, rename, reorder and delete (with a confirmation before deleting).
- **New budget** command and ribbon button, with two presets:
  - **50/30/20 starter:** 18 common categories, with the total split 50% needs, 30% wants, 20% savings.
  - **Blank:** no categories.
- Works in reading view and live preview, and on narrow screens. Uses your theme's colors, so it fits light and dark themes.
- Money in US dollars and cents (`$1,234.56`). All math is done in whole cents, so totals never pick up rounding errors.

## How to use

1. Open **Settings → Budget Notes** and choose the **Budget folder** where new budget notes go (default: `Budget`). The folder is created if it doesn't exist.
2. Select the **piggy-bank** icon in the ribbon, or run **Budget Notes: New budget** from the command palette.
3. Enter a name, a starting total and the month, choose a preset, and select **Create**. The new note opens.
4. Drag the sliders or type amounts. Changes are saved into the note about half a second after you let go of a slider or leave a box.
5. To add, rename, reorder or delete categories, select **Edit categories** at the top of the budget, and **Done** when you're finished.

## Where your data lives

A budget is a fenced code block with the language `budget-notes`, written in YAML:

````markdown
```budget-notes
name: Household
month: 2026-11
total: 4000.00
currency: USD
categories:
  - name: Rent
    group: needs
    amount: 1450.00
    locked: true
  - name: Groceries
    group: needs
    amount: 512.50
    locked: false
  - name: Dining out
    group: wants
    amount: 150.00
    locked: false
  - name: Emergency fund
    group: savings
    amount: 300.00
    locked: false
```
````

| Key | Meaning |
|---|---|
| `name` | Name of the budget (optional) |
| `month` | Year and month, like `2026-11` (optional) |
| `total` | The total to plan, in dollars |
| `currency` | `USD` (the only currency for now) |
| `categories` | The list of categories, each with `name`, `group` (`needs`, `wants` or `savings`), `amount` in dollars, and `locked` (`true` or `false`) |

The plugin always writes the keys in the same order and amounts with two decimals, so changes stay small in Git or other version history.

**Safety rules:**

- If the text in a block can't be read (for example broken YAML or a negative amount), the plugin shows a message explaining what's wrong and doesn't change the note.
- If a block contains comments (`#`) or keys the plugin doesn't know, it's shown but editing is turned off, because saving would remove them.
- The plugin only replaces the budget block you changed, and only if it still matches what's on screen. Everything else in the note is left alone.

**Current limitations:** US dollars only. Budget blocks inside callouts or block quotes are shown, but changes to them can't be saved.

## Privacy

Budget Notes works completely offline. It makes no network requests and collects nothing. Your budgets are ordinary notes in your vault. If you sync or back up your vault (for example with Git), your budget numbers go wherever your notes go, including their version history.

## Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/BurningBurrito/budget-notes/releases/latest).
2. Copy them into `<your vault>/.obsidian/plugins/budget-notes/`.
3. In Obsidian, go to **Settings → Community plugins**, refresh the list and turn on **Budget Notes**.

Requires Obsidian 1.13.0 or newer.

## Development

```bash
npm install     # install the build tools
npm run dev     # build and rebuild on every change
npm run build   # type-check and build main.js
npm test        # run the automated tests
npm run lint    # check the code with Obsidian's lint rules
```

## License

[MIT](LICENSE)
