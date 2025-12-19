# index.html

## Purpose
Main HTML entry point for the Electron renderer process. Sets up the document structure, fonts, and Content Security Policy.

## Key Elements
- `<html lang="en" class="dark">` - Default to dark mode
- CSP meta tag for security
- Google Fonts preconnect and stylesheet links
- Root div for React mounting
- Module script entry point

## Content Security Policy
```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com;
font-src https://fonts.gstatic.com;
img-src 'self' data: https:;
connect-src 'self' ws: wss:;
frame-src *;
```

## Fonts
- Source Sans 3 (weights: 300, 400, 500, 600, 700, italic 400)
- Loaded from Google Fonts CDN

## Change History
- 2025-12-19: Added Google Fonts integration for Source Sans 3
  - Added CSP rules for fonts.googleapis.com and fonts.gstatic.com
  - Added preconnect hints for performance
