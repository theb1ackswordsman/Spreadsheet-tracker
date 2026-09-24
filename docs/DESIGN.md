# DESIGN (read only the cited section)

## Direction
Calm, dense, utilitarian workspace tool. Flat surfaces, hairline borders, one accent, real information density. Precision and clarity, not effects.
Banned: gradients, glows, blur/glass, colored shadows, emojis (UI, copy, toasts), decorative animation, illustrations, purple-blue palettes, big rounded corners, pill-everything.

## Tokens
Copy to `src/client/styles/tokens.css` as CSS variables:
```
--bg:#FFFFFF; --surface:#F6F7F8; --header:#F1F3F4; --border:#DADDE1; --grid-line:#E6E8EB;
--text:#1F2328; --muted:#656D76; --accent:#1A5FD0; --accent-weak:rgba(26,95,208,.08);
--danger:#B42318; --danger-weak:#FDF1F0; --ok:#1A7F37; --radius:4px;
--space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-6:24px;
--font-ui:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;   /* 13px */
--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;      /* formula bar + editor */
--shadow-pop:0 2px 8px rgba(0,0,0,.12);                           /* ONLY popovers + toasts */
--presence-1:#0F766E; --presence-2:#B45309; --presence-3:#9333EA; --presence-4:#BE123C; --presence-5:#4D7C0F; --presence-6:#0E7490;
```
Numbers: `font-variant-numeric: tabular-nums`. Motion: 120 ms opacity/transform only; honor prefers-reduced-motion. System fonts only. Light theme only.

## Layout (top to bottom)
1. Top bar 44px: editable sheet title | connection text (`Connected` / `Reconnecting...`) | presence avatars (solid circle, initials, name on hover) | `Share` (copy link).
2. Toolbar 36px, text buttons only, 1px border on hover: `Sample data`, `Stress test`, `Performance`, `Shortcuts`.
3. Formula bar 32px: name box (`B4`) | `fx` | mono input bound to `raw`. Error explanation line below it in `--danger`.
4. Grid: sticky column/row headers (`--header`); active row/col header gets `--accent-weak` + bold; 1px `--grid-line`; cell text ellipsis, 8px padding.
5. Performance strip (collapsible, above status bar): scope / populated / ms / mode / cells re-rendered / RTT, `Incremental | Naive` segmented control.
6. Status bar 28px: users online | sheet version | last recalc | Performance toggle.

## Components
- Selection: 2px `--accent` border. Edit mode: same border, white bg.
- Remote presence: 2px border in user color + name tag above cell (11px, solid color, white text, 2px radius, no shadow); stack tags if several users on one cell.
- Errors: `--danger` text on `--danger-weak`; explanation on select: "Circular reference: this cell depends on itself" / "Division by zero" / "Unknown function FOO" / "Reference outside the sheet" / "Value error: check the formula".
- Toast: bottom-left, dark neutral surface, plain sentence, 4 s, e.g. "Sam changed B4 after your edit".
- Reconnecting banner: thin, under top bar, plain text + queued edit count; grid stays editable.
- First load: sample budget sheet if empty + dismissible hint "Type = to start a formula. Open this page in another window to collaborate."

## UX rules
Every state visible in plain language. No modals. Esc always cancels. Keys: arrows, Tab/Shift+Tab, Enter/Shift+Enter, F2, Delete, Ctrl+C/V, `?` opens shortcuts popover. Layout never shifts when toasts/presence appear. Contrast WCAG AA. 2px focus ring on all buttons. `role="grid"`, `aria-rowindex`/`aria-colindex`.
