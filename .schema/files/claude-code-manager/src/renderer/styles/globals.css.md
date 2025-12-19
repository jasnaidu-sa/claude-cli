# globals.css

## Purpose
Global CSS file with Tailwind directives and CSS custom properties for theming. Defines the Claude-inspired color palette for light and dark modes.

## Color System

### Light Mode (`:root`)
- `--background: 45 30% 96%` - Warm cream (#eeece2 style)
- `--foreground: 40 20% 20%` - Warm dark brown
- `--primary: 14 64% 60%` - Terra cotta (#da7756)
- `--secondary/muted/accent: 40 15% 92%` - Warm neutrals
- `--border: 40 15% 85%` - Warm border

### Dark Mode (`.dark`)
- `--background: 30 5% 10%` - Warm dark gray (NOT blue)
- `--foreground: 35 15% 90%` - Warm off-white
- `--primary: 14 64% 60%` - Terra cotta (same as light)
- `--secondary/muted/accent: 30 5% 18%` - Warm dark neutrals
- `--border: 30 5% 20%` - Dark warm border

## Key Sections
- `@layer base` - CSS variable definitions
- Custom scrollbar styling
- Title bar drag regions
- Terminal styles (xterm)
- File tree styles
- Panel resize handles
- Status indicators
- Animations (fade-in, slide-up)

## Change History
- 2025-12-19: Complete theme overhaul to Claude-inspired warm palette
  - Replaced blue-tinted dark mode with warm neutral grays
  - Added terra cotta (#da7756) as primary color
  - Updated both light and dark mode variables
