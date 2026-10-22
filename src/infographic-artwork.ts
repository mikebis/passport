export const SCRAPBOOK_DEFS = `<defs>
  <linearGradient id="paper" x2=".8" y2="1"><stop stop-color="#fffdf4"/><stop offset="1" stop-color="#f0e7d6"/></linearGradient>
  <linearGradient id="sea" x2=".4" y2="1"><stop stop-color="#8bc8e0"/><stop offset=".5" stop-color="#b4dce6"/><stop offset="1" stop-color="#8fc7dc"/></linearGradient>
  <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#5393b1"/><stop offset="1" stop-color="#d5e6d8"/></linearGradient>
  <pattern id="grain" width="43" height="37" patternUnits="userSpaceOnUse"><path d="m4 7 3 1m20 12 5-1M10 30l4-1" stroke="#967748" stroke-opacity=".1"/><circle cx="36" cy="8" r=".8" fill="#967748" opacity=".16"/></pattern>
  <pattern id="water" width="467" height="313" patternUnits="userSpaceOnUse"><path d="M-20 38Q58-24 166 28T442 8l38 106q-156 41-259-8T-20 153Z" fill="#fff" opacity=".09"/><path d="M23 211q82-65 176-21t235-5l-29 82q-91 38-196 0T23 280Z" fill="#4c9dbe" opacity=".06"/><path d="M-12 153q72-23 155-2t169-10 170 6M72 297q68-13 145-1t148-6" fill="none" stroke="#fff" stroke-width="5" opacity=".08"/><path d="m35 76 29-3m277 51 38 2M145 246l25-3" stroke="#539bb8" stroke-width="2" opacity=".12"/></pattern>
</defs>`;

function postcard(x: number, y: number, width: number, height: number, angle: number, coast: boolean): string {
  const art = coast
    ? '<path d="M0 65Q120 155 220 100T500 130V300H0Z" fill="#438fa6"/><path d="M0 160q120-90 230-20t270-5v165H0Z" fill="#d7c39c"/><path d="M0 210q150-120 270-50t230-20v160H0Z" fill="#577956"/><path d="M0 235q170-90 290-35t210-30" fill="none" stroke="#dce6d1" stroke-width="8"/>'
    : '<path d="m-10 230 140-170 82 111 91-142 210 209Z" fill="#647e83"/><path d="m83 116 47-56 45 61-37-14-14 19-13-26ZM242 115l61-86 76 94-54-23-24 16-20-26Z" fill="#ecede0"/><path d="M0 230q160-90 290-40t210-20v130H0Z" fill="#628069"/><path d="M0 265q120-60 250-25t250-25v85H0Z" fill="#344f4c"/>';
  return `<g data-decoration="postcard" transform="translate(${x},${y}) rotate(${angle})"><rect x="-8" y="-8" width="${width + 16}" height="${height + 16}" fill="#e7dfce" stroke="#9c927d" stroke-width="2"/><svg width="${width}" height="${height}" viewBox="0 0 500 300" preserveAspectRatio="xMidYMid slice"><rect width="500" height="300" fill="url(#sky)"/><path d="M0 50q70-22 150 0t155-7 195-2" stroke="#fff" stroke-width="16" opacity=".5" fill="none"/>${art}</svg></g>`;
}

export function scrapbook(width: number, height: number): string {
  const horizontal = width > height;
  const edge = horizontal ? 60 : 24;
  const right = width - edge;
  const bottom = height - (horizontal ? 56 : 18);
  const step = horizontal ? 410 : 280;
  const photos: string[] = [];
  for (let x = -70; x < width; x += step) {
    photos.push(postcard(x, -60, step + 50, 220, x % 3 - 2, x % 4 === 0),
      postcard(x + 80, height - 160, step + 45, 220, x % 2 === 0 ? -7 : 6, x % 4 !== 0));
  }
  return `<g data-decoration="scrapbook"><rect width="${width}" height="${height}" fill="#47676b"/>${photos.join('')}
    <path d="M${edge + 8} 62 ${right - 5} 56 ${right + 4} ${bottom - 8} ${right - 15} ${bottom + 5} ${edge - 5} ${bottom}Z" fill="#1e3438" opacity=".2"/>
    <path d="M${edge} 49 ${edge + 10} 41 ${width * .29} 45 ${width * .52} 38 ${right - 4} 43 ${right + 2} ${height * .32} ${right - 3} ${height * .73} ${right} ${bottom} ${width * .72} ${bottom - 3} ${width * .4} ${bottom + 3} ${edge + 4} ${bottom} ${edge - 2} ${height * .57}Z" fill="url(#paper)" stroke="#c7bba4" stroke-width="2"/>
    <path d="M${edge + 8} 53H${right - 8}V${bottom - 8}H${edge + 8}Z" fill="url(#grain)" opacity=".85"/>
    <path d="M${edge + 15} 57H${right - 15}M${edge + 15} ${bottom - 12}H${right - 15}" fill="none" stroke="#b9a990" stroke-width="1" opacity=".4"/>
    </g>`;
}

export function tape(x: number, y: number, angle: number, size = 1): string {
  return `<path data-decoration="tape" transform="translate(${x},${y}) rotate(${angle}) scale(${size})" d="m-36-12 8-3 9 2 9-2 9 2 9-2 10 2 9-1 10 2-3 23-10 2-9-2-10 2-9-2-9 2-10-2-9 2Z" fill="#d7bc80" fill-opacity=".55" stroke="#bca170" stroke-opacity=".35"/>`;
}

export function stamp(x: number, y: number, size: number): string {
  return `<g data-decoration="stamp" transform="translate(${x},${y}) rotate(-15)" fill="none" stroke="#b46c56" opacity=".55"><circle r="${size}"/><circle r="${size - 5}"/><path d="M${-size * .85}-7H${size * .85}M${-size * .85}7H${size * .85}" stroke-dasharray="3 3"/><path d="m-13 0 10-3 3-13 3 13 10 3-10 3-3 13-3-13Z"/></g>`;
}

export function sticker(x: number, y: number, size: number, index: number): string {
  const icons = [
    '<path d="m0-41 13 27 30 5-22 21 4 31L0 29-26 43l5-31-22-21 30-5Z" fill="#e9b85b" stroke="#fff0b8" stroke-width="3"/><path d="M0-34 0 25 33-7 10-11Z" fill="#f8d989"/><path d="M0-34-10-11-34-7-17 9-21 34 0 25" fill="#bb7b38"/>',
    '<path d="M-47 24-17-35 4-8 22-43 51 25Z" fill="#839d91" stroke="#eceddc" stroke-width="2"/><path d="m-27-16 10-19 15 24-15-5-7 8ZM9-19l13-24 14 34-14-9-8 6Z" fill="#fff6dc"/><path d="M-49 27q40-18 98 0v17h-98Z" fill="#326b71"/><path d="M-22 34H28" stroke="#b5dce1" stroke-width="3"/>',
    '<circle r="43" fill="#4c9ab6" stroke="#e9c278" stroke-width="3"/><path d="m-31-27 19-8 8 12-7 14-15-3-9 15-6-5ZM5-38l22 8 6 17-15 7-4 22-13 20-12-9 2-23-12-14 18-12Z" fill="#85aa59" stroke="#c4ce83" stroke-width="2"/><path d="M-42 0H42M0-42C-22-19-22 19 0 42M0-42C22-19 22 19 0 42" stroke="#e8d594" stroke-width="1.4" fill="none"/>',
  ];
  return `<g data-decoration="badge-sticker" transform="translate(${x},${y}) scale(${size / 130})"><path d="M0-62 47-44 61 0 45 48 0 65-47 46-62 0-46-45Z" fill="#fffaf0" stroke="#b7a480" stroke-width="2"/><path d="M0-55 40-38 53 0 39 41 0 57-40 39-54 0-40-39Z" fill="#214b64" stroke="#d7b56c" stroke-width="3"/>${icons[index % 3]}</g>`;
}

export function metricIcon(x: number, y: number, index: number, size = 28): string {
  const paths = [
    '<path d="m2 12 8-2 4-8 2 1-1 7 7 3-1 2-7-1-3 7-2 1 1-9-7 1Z"/>',
    '<path d="m2 11 10-9 10 9M5 9v13h14V9M10 22v-9h5v9" fill="none"/>',
    '<path d="M12 22s8-8 8-14a8 8 0 0 0-16 0c0 6 8 14 8 14Z" fill="none"/><circle cx="12" cy="8" r="3" fill="none"/>',
    '<path d="m12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1Z" fill="none"/>',
    '<circle cx="12" cy="12" r="9" fill="none"/><path d="m7 12 4 4 6-8" fill="none"/>',
    '<circle cx="12" cy="12" r="10" fill="none"/><ellipse cx="12" cy="12" rx="5" ry="10" fill="none"/><path d="M2 12h20M4 7h16M4 17h16" fill="none"/>',
  ];
  return `<g data-decoration="metric-icon" transform="translate(${x},${y}) scale(${size / 24})" fill="#284b58" stroke="#284b58" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${paths[index % 6]}</g>`;
}
