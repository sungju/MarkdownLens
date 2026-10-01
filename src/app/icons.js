/** Inline 16px icons. Stroke colour is inherited from the toolbar. */

const svg = (paths, extra = '') => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${extra}>${paths}</svg>`;

export const ICONS = {
  outline: svg('<path d="M2 4h3M2 8h3M2 12h3M7.5 4H14M7.5 8H14M7.5 12H14"/>'),
  palette: svg('<path d="M8 1.75a6.25 6.25 0 1 0 0 12.5c.69 0 1.25-.56 1.25-1.25 0-.32-.12-.61-.32-.83a1.25 1.25 0 0 1 .94-2.09h1.48A2.9 2.9 0 0 0 14.25 7 6.25 6.25 0 0 0 8 1.75Z"/><circle cx="5" cy="6.5" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="4.75" r=".9" fill="currentColor" stroke="none"/><circle cx="11" cy="6.5" r=".9" fill="currentColor" stroke="none"/>'),
  code: svg('<path d="M5.5 11 2.5 8l3-3M10.5 5l3 3-3 3M9.3 3.2 6.7 12.8"/>'),
  raw: svg('<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3M6 8.5h4M6 11h3"/>'),
  print: svg('<path d="M4.5 6V2h7v4"/><path d="M3 6h10a1 1 0 0 1 1 1v4h-2.5"/><path d="M4.5 11H2V7a1 1 0 0 1 1-1"/><path d="M4.5 9.5h7V14h-7z"/>'),
  settings: svg('<circle cx="8" cy="8" r="2.1"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5 3.4 3.4"/>'),
  sun: svg('<circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13M12.95 12.95l-1.13-1.13M4.18 4.18 3.05 3.05"/>'),
  moon: svg('<path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z"/>'),
  top: svg('<path d="M8 13V3.5M3.75 7.75 8 3.5l4.25 4.25"/>'),
  check: svg('<path d="M3 8.5 6.25 12 13 4.5"/>'),
  close: svg('<path d="m4 4 8 8M12 4l-8 8"/>'),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.3 3.3"/>'),
  reload: svg('<path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97"/><path d="M13.6 2.5v3.2h-3.2"/>'),
};
