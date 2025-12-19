# tailwind.config.js

## Purpose
Tailwind CSS configuration file. Extends the default theme with custom colors, fonts, and border radius values.

## Configuration

### Dark Mode
- `darkMode: 'class'` - Uses class-based dark mode toggle

### Content
- Scans `./src/renderer/**/*.{js,ts,jsx,tsx,html}`

### Colors (via CSS variables)
- `background` / `foreground`
- `card` / `card-foreground`
- `primary` / `primary-foreground`
- `secondary` / `secondary-foreground`
- `muted` / `muted-foreground`
- `accent` / `accent-foreground`
- `destructive` / `destructive-foreground`
- `border`, `input`, `ring`

### Border Radius
- `lg`: `var(--radius)`
- `md`: `calc(var(--radius) - 2px)`
- `sm`: `calc(var(--radius) - 4px)`

### Font Family
- `sans`: Source Sans 3, ui-sans-serif, system-ui, sans-serif
- `mono`: JetBrains Mono, Menlo, Monaco, monospace

## Change History
- 2025-12-19: Updated sans font family to Source Sans 3 (Claude brand font)
