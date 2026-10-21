# System Requirements & Software Design Document (SRSD)

## 1. Executive Summary

**Project Name:** `passport`
**Type:** Client-Side Single Page Application (SPA)
**Tech Stack:** HTML5, TypeScript, Modern CSS (Flexbox/Grid, CSS Variables), D3.js (v7), TopoJSON, Vite.
**Architecture:** Pure Frontend / Zero Backend / Static File Persistence.
The goal is to build a minimal, modern, and aesthetic interactive world map SPA where users can track their relationship with countries using four distinct status states (**Visited**, **Lived/Living**, **Want to Visit**, or **Unvisited**).

Google sign-in and Drive synchronization are optional. Without an account or a
configured public OAuth client ID, the entire local travel-map experience remains
available. Only explicit Google opt-in loads external Google Identity Services.

---

## 2. Updated Functional Specifications

### 2.1 Interactive Map Canvas

* **Application Shell:** No global logo/tagline header or introductory map title/subtitle. The map and sidebar start at the top and occupy the full desktop viewport height, with existing minimum usable heights for short windows. On mobile, retain the map-above-sidebar layout. Geography and scenery fill the whole map section without a reserved footer strip. Keep interactive map/scenery controls floating on the left and the informational status legend floating at bottom center; clicks, drags, wheel and touch gestures pass through the legend. Remove the navigation hint. Place Natural Earth boundary attribution and the Data sources link beside the metadata/license credits in the sidebar footer.
* **Projection:** Mercator Projection (`d3.geoMercator`).
* **Global Coverage:** Complete ISO 3166-1 alpha-3 coverage, including all UN member states, dependencies, microstates (e.g., Vatican City, Monaco, San Marino, Liechtenstein, Andorra, Nauru, Tuvalu), and island territories.
* **Additional Non-ISO Areas:** Independently track all 17 non-ISO map units already present in the bundled Natural Earth source, for 266 total places. The explicit catalog in `data/additional-territories.json` includes Kosovo, Northern Cyprus, Somaliland, Akrotiri, Dhekelia, the Cyprus UN Buffer Zone, both Korean DMZ areas, Guantanamo Bay Naval Base, Siachen Glacier, the Southern Patagonian Ice Field, Bir Tawil, the Paracel and Spratly Islands, Bajo Nuevo Bank, Serranilla Bank, and Scarborough Reef. Use stable `custom:` identifiers derived from source map-unit IDs, not invented official ISO codes.
* **Boundary and Status Independence:** Preserve existing ISO polygons and use the additional areas' real source geometry. Render custom overlays above ISO polygons where necessary. Each entry has an independent status; changing an additional area does not change a related country's status. Inclusion is a travel-tracking convention, not a political recognition claim or a comprehensive worldwide dispute list.
* **Crimea Boundary Correction:** Assign the entire Crimean peninsula, including Sevastopol, to Ukraine (`UKR`), overriding the source's Russia grouping. Normalize the existing shared topology before simplification, joining Crimea to mainland Ukraine and removing the internal dividing line without redrawing coastlines or changing other boundary assignments. Crimea follows Ukraine's status, tooltip, click target and sidebar preview. Preserve existing saved Ukraine/Russia statuses, IDs, subdivisions and country/continent totals; do not add a separate Crimea entry or migrate country statuses.
* **Balanced Boundary Detail:** Generate one simplified, quantized TopoJSON asset from the pinned 1:10m source. Simplify shared arcs together, retaining recognizable shapes and every territory, polygon component, and hole. Protect collapsed/inverted rings and excessive area changes; derive marker metadata from original geometry. Require at least 70% fewer stored vertices and reference SVG characters than the detailed source topology, with a geographic asset under 1.5 MB. High zoom intentionally shows less coastal detail; no runtime detail switching is required.
* **Microstate Visualization (Dual-Layer):**
* Microstates are rendered as both standard **boundary polygons** AND **status-colored dots/pins** overlaying their geographic centroids when zoomed out.
* Dot markers maintain a consistent radius or scale dynamically as the user zooms in, ensuring ultra-small states remain easy to click without zooming to extreme levels.

* **Map Interactivity & Context Popover:**
* **Hover:** Displays a sleek floating tooltip with the territory's full name, country flag/code, and current status. Non-ISO entries show a generic symbol, their full custom ID, and an explicit "Additional territory / non-ISO" label instead of an invented national flag.
* **Interaction Work:** Reuse tooltip content and dimensions while the hovered territory is unchanged, retaining viewport clamping and refreshing after status/viewport changes. Pan/zoom transforms existing country paths rather than regenerating their geometry.
* **Click (Map / Dot / Polygon):** Opens a small, modern 4-button context popover adjacent to the clicked location or cursor with choices:
1. 🟩 **Visited**
2. 🟨 **Lived / Living**
3. 🟪 **Want to Visit**
4. ⬜ **Reset (Unvisited)**

* **Pan & Zoom:** Smooth D3 zoom behavior (`d3.zoom`) supporting scroll-to-zoom, double-click zoom, and drag-panning.

#### Decorative scenery

* **Artwork and density:** Original small theme-colored SVG ships, airplanes, and clouds, not emoji or external images. Use 37.5px ship, 34.5px airplane, and 69px cloud illustration viewports, constant in screen space. Use three ships, two airplanes, and four clouds on desktop; two ships, one airplane, and three clouds at the existing 720px mobile breakpoint.
* **Geographic positioning:** Follow deterministic illustrative geographic routes, with ships restricted to open water. Preserve small screen-space illustration sizes during pan, zoom, and resize. Use gentle ship bobbing, slow cloud drift, vehicle headings, and endpoint fades rather than abrupt visible resets.
* **Layering:** Draw above land but below microstate markers and all map UI. Clouds may cover the other scenery. Decorations are clipped to the map viewport, hidden from assistive technology, unfocusable, and pointer-transparent, including their descendants.
* **Separate controls:** A keyboard-accessible pause/resume button freezes all visible motion. A separate hide/show button removes the entire scenery layer and stops its animation work, while remaining reachable to show it again. Showing preserves the animation phase and prior pause choice and uses the current map position. Disable the pause control while hidden and explain why.
* **Motion preferences:** Honor initial and live `prefers-reduced-motion` changes with static artwork and a disabled, explained animation control. Suspend animation in hidden documents without accumulating hidden time or overriding the user's pause choice. Static scenery still follows map navigation.
* **Bounded lifecycle:** Use one animation frame loop, update only scenery transforms/opacity on frames, reuse the fixed object set, and clean up introduced listeners and scheduled frames when destroyed. Do not redraw country geometry on animation frames.
* **Local-only and decorative:** No live traffic/weather feeds, network requests, sounds, or connection to travel status. Pause and visibility choices are in-memory for the current page only; no persistence or export schema changes.

### 2.2 Country Sidebar

* **Tabs:** Manage countries, Stats and Badges, using accessible native tab buttons, roving focus and Left/Right/Home/End controls. Share only the existing heading and footer. Move theme selection/warnings, all-place totals/progress, search, filters and continent groups inside Manage countries. Default to Manage on reload; do not persist tab choice. Preserve all panel content, scroll and Manage state across switches, themes, hide/show and breakpoints. Inactive panels must leave layout/keyboard navigation; clear stale previews/popovers and restore focus only to visible controls without resetting the active tab.
* **Stats:** Implement four status counts, combined visited-or-lived count/percentage, continents visited or lived in, and per-continent completed/total percentages. Count full-registry ISO entries only, include Antarctica as the seventh continent, exclude additional areas/subdivisions, and count each completed top-level place once. Stay independent of Manage filters. Preserve Manage's existing all-place counters.
* **Badges:** Read a public `data/badges.json` array with exactly `name`, `description`, `condition`, `value` per object. Value is non-negative integer points. Visited and Lived / Living satisfy exact registry IDs (DEU, not GER; explicit custom IDs allowed). Recompute earned/lost badges and points from current data without persistent award state. Show ranked cards, descriptions, points, earned/in-progress text and accessible progress bars, plus earned/available badge/point totals. Load lazily and cache compiled definitions for the page; show loading, empty and isolated error/retry states, never blocking the map or other tabs.
* **Badge Grammar:** Support identifiers, parentheses, OR `|`, AND `+` (higher precedence), and explicit-list thresholds `(SVK, CZE, AUT){2}`. Reject duplicate threshold members, unknown IDs, unsupported operators, malformed syntax and out-of-range thresholds. Each ID contributes 0/1 or 1/1; AND sums units; OR contributes the best child fraction out of one; thresholds clamp completed counts at n. Display integer progress such as 4/10 with a 40% bar, or percentage-only text for fractional compounds. A country can satisfy overlapping logical groups. Determine earned state exactly, not from display rounding. No eval, continent queries, timestamps or status-specific conditions. Bound catalogs to 500 definitions, names to 120 characters, descriptions to 1000, conditions to 4096 and nesting to 32; require unique trimmed case-insensitive names and safe-integer values/total points. Reject invalid catalogs visibly rather than awarding a valid subset.
* **Badge ordering:** Show completed badges first, descending by points. Sort incomplete badges by exact completion percentage descending, then points descending. Preserve JSON file order for exact ties. Reorder existing cards live when current statuses change, without recreating cards or resetting panel scroll.
* **Badge countries:** List every distinct registry entry referenced by each condition, in first-reference order across logical groups and threshold lists, including nonqualifying alternatives and explicit custom IDs. Color country names by their current four-state travel status using readable theme-specific text colors; use muted text for Unvisited. Include exact-status hover text and screen-reader text rather than conveying status through color alone. Update existing country nodes on all store changes and theme switches without modifying formula/progress semantics.
* **Live panels:** Stats and badges follow every store notification, including imports, accepted Drive replacements and in-memory changes when saving fails. Retain active tab, panel nodes/focus/scroll and map/scenery instances. No travel schema, geographic, authentication or synchronization-protocol change.
* **Layout:** Docked sidebar with a floating bottom-right map button to Show sidebar / Hide sidebar on desktop above 720px, bottom-aligned with the status legend. Keep the legend centered when there is room; shift it left and wrap on narrow desktop maps to avoid the button. With no saved choice, show the sidebar. Remember explicit desktop visibility changes under the independent browser-local `passport:sidebar:v1` key, without including the preference in travel exports or Drive synchronization. Hiding removes the sidebar from layout, keyboard navigation and the accessibility tree, giving its full width to the actual map; preserve sidebar content, map/scenery instances and Google synchronization. Provide accurate expanded/control labels and keep focus on visible controls. On mobile always show the sidebar below the map and hide the toggle, retaining the desktop preference without writing it on resize. Invalid/unreadable preferences default to shown with an independent visible explanation; failed writes keep a session-only choice and report that it could not be remembered.
* **Grouping & Alphabetical Sorting:** Countries grouped into **7 continent accordions** (Africa, Asia, Europe, North America, Oceania, South America, Antarctica) and sorted alphabetically within each group. Start all seven collapsed, including Europe and Antarctica, on every page load. Groups open independently and their expanded states remain session-only.
* **Additional Entries and Totals:** Include the 17 additional areas in the same sorted/searchable continent groups and combined travel totals. Group Cypriot additional areas with the existing Cyprus entry in Europe; keep Antarctica independently selectable inside its final accordion. Each entry counts once regardless of source geometry overlap, and all displayed denominators derive from the registry.
* **Continent Progress:** Beside each continent summary show `(visited or lived / total)` for official ISO countries and territories only. Count each qualifying top-level place once; exclude wishlist, unvisited, additional non-ISO areas, and subdivisions from the numerator. Derive the denominator from all ISO entries assigned to that continent, including unvisited/wishlist entries, independently of search. Show Antarctica's `(0/1)` or `(1/1)` in its summary, not duplicated inside its country row. Update immediately after status edits and confirmed imports. This ISO-only policy does not change combined global status counters or world-in-color progress (which also includes wishlist).
* **Search / Filter:** A real-time quick filter input followed by four independent native toggle buttons: Visited, Lived / Living, Want to Visit, Unvisited. Selected statuses combine with OR; text search intersects them with AND. No selected statuses means all; turning off the last toggle or choosing Show all statuses clears only status criteria. Include additional non-ISO places and Antarctica. Use compact neutral buttons containing only colored status circles matching the active theme's map legend, with no visible status text. Fit all four and the reset-arrow button on one line, including narrow sidebars. Retain accessible names, status tooltips, visible focus, aria-pressed and a thicker selected border. Keep filters session-only: survive theme/sidebar/breakpoint changes but reset on reload, without storage, export or Drive fields. Filter sidebar rows only, never map visibility, travel data, global totals or full-continent ISO ratios. Recompute membership and matching counts after edits/imports/accepted cloud replacements, including failed local saves; hide excluded rows and empty groups from layout and keyboard navigation. Temporarily expand matches while either criterion is active, restoring prior session group states only when both clear. Preserve unaffected row identity/focus and manual filtered-group closure on unrelated updates. Clear excluded previews; if an update hides a focused row or a status popover's trigger, restore focus to search without stealing focus from other visible controls.
* **Controls per Country Item:** Displays status badges and triggers the same selection state options as the map popover.
* **Sidebar Map Preview:** Hovering or keyboard-focusing any sidebar place temporarily adds a contrasting map outline, preserving its status fill; tiny-place markers also receive a stronger ring. Include additional non-ISO territories and Antarctica. Hover takes priority over a different focused row, falling back to that row when hover ends or clearing if neither applies. Clear stale previews when filtering/removing rows or collapsing their group. Previewing does not pan/zoom/scroll the map, open tooltips/popovers, change status/storage, or overwrite clicked selection.

### 2.3 Data Persistence & Extensible Schema

#### Optional Google authentication and synchronization

* Use the GIS browser token model and authenticated Google UserInfo with
  `openid email https://www.googleapis.com/auth/drive.appdata`. Associate account
  state with stable `sub`, not email. Store access tokens only in memory.
  Require user-driven reconnection after reload/expiry; no backend, client secret
  or refresh token. Missing configuration must not block local use.
* Store private hidden app-data JSON snapshots, not ordinary shared Drive files.
  Use versioned envelopes preserving complete normalized entries, timestamps and
  subdivisions. Keep imports/exports and committed data as `LocationEntry[]`.
* Debounce automatic saves, serialize work, persist account-owned pending
  operations separately from travel data and verify every acknowledged upload.
  Retrying uses a fixed pre-generated appDataFolder file ID. Never overwrite or
  automatically delete a snapshot. Discover branches through validated lineage
  metadata, with complete pagination, then download only current candidate heads.
* First connection, different-account adoption, missing cloud history and
  differing remote versions require explicit choices. Ask Use this device,
  Use Google Drive (or another preserved version), or Cancel; allow downloading
  versions first. No newest-wins rule or automatic status merge. Concurrent
  saves preserve both branches; resolution creates a new snapshot referencing
  the accepted heads. Invalidate choices after intervening edits.
* Check before saving, on connection, returning to a visible app, coming online
  and manual Sync now. Suspend unsafe/background work and surface bounded retry,
  permission, popup, scope, expiry, offline, malformed-data and quota failures.
  Invalid/denied/incomplete data must not be interpreted as an empty Drive.
* Show account, independent cloud state, last successful sync, Sync now/retry,
  reconnect and sign-out controls in the existing sidebar. Use theme tokens,
  native keyboard controls, accessible modal choices and restrained live status.
  Local-save and cloud failures must not clear or mask each other.
* Sign-out drops app credentials but retains this device's map and pending
  account-owned backups. It neither logs out Google globally nor revokes grants
  or deletes Drive data. Another account cannot silently adopt that map or replay
  a previous account's pending operations. Cross-tab changes pause unsafe work;
  sign-out stops synchronization in other open tabs.
* Document opt-in networking, retained browser data, non-end-to-end-encrypted
  private app-data, snapshot storage growth/no pruning, current 5 MB snapshot and
  10,000-history-file limits, Google setup/origins/test users, public build-time
  client ID and production configuration. Real provider consent/storage requires
  a configured client and manual validation; CI mocks must not use personal data.

* **Sub-national Ready JSON Schema:** The data structure supports country-level entries out of the box while allowing sub-national subdivisions (e.g., `US-CA`, `CA-ON`) under a `subdivisions` array in the same JSON object without breaking schema compatibility.

```typescript
export type TravelStatus = 'unvisited' | 'visited' | 'lived' | 'want_to_visit';

export interface LocationEntry {
  id: string; // ISO alpha-3, cataloged custom ID (e.g., "custom:KOS"), or ISO 3166-2 for regions
  name: string;
  continent: string;
  status: TravelStatus;
  subdivisions?: LocationEntry[]; // Extensible for future US States, Canadian provinces, etc.
  updatedAt?: string;
}

```

* **Compatibility:** Keep the `LocationEntry[]` format. Older ISO-only saves/exports retain their statuses, timestamps, and subdivisions; missing additional entries default to Unvisited without a corruption prompt. Existing passport saves are not automatically rewritten on load. Reject unknown custom IDs. Nonempty subdivision arrays on custom entries are unsupported until a dedicated custom subdivision schema exists; existing ISO subdivision support is unchanged.
* **Project Rename Migration:** Use `passport:locations:v1` as the browser storage key. Only when absent, validate and copy the legacy `visited:locations:v1` JSON unchanged, then remove the old key after a successful new-key write. Existing passport data always takes precedence, including its corruption recovery flow. Migration write failure preserves legacy and in-memory data with an unsaved warning; cleanup failure reports that data is saved but legacy removal failed, with cleanup retried on the next successful save. Corrupt legacy data is untouched until explicit recovery; replacement is saved under the new key before legacy cleanup.

* **Persistence Strategy:**
1. Default load from committed repository file (`/data/user-data.json`).
2. Live changes stored in `localStorage` for persistent browser sessions.
3. One-click **"Export Data / Copy JSON"** button in the UI footer to easily copy state back into `data/user-data.json` for Git commits. Downloads use `passport-data.json`; raw recovery downloads use `passport-recovery.json`. Previously exported JSON remains importable regardless of filename.
4. Validated import replaces current state only after confirmation. Importing older files resets missing additional entries to Unvisited. New exports with custom IDs require the updated application; older ISO-only versions do not accept them.

---

## 3. Aesthetic & UI Design System

### Classic Color Palette (default)

* **Water / Ocean:** Bright Blue (`#1893D9`)
* **Unvisited / Base Boundary:** Silver Gray (`#C6CED6`)
* **Visited:** Leaf Green (`#41A12B`)
* **Lived / Living:** Sunflower Yellow (`#F2BF05`)
* **Want to Visit:** Violet (`#9254D4`)
* **Country Borders / Outlines:** White stroke (`#FFFFFF`, `1px`), increasing to `1.5px` on hover/selection while remaining white. Keep country strokes non-scaling during zoom.
* **Microstate Dots:** Fill corresponding to status with a crisp 1px `#FFFFFF` halo border.
* **Surrounding UI:** Cool white surfaces (`#F8F9FB`), navy text, blue controls,
  white/blue ships and airplanes, and white clouds.

### Editable full-application themes

* **Skins:** Classic (bright blue ocean, green/yellow/violet travel colors, white borders), Dark (charcoal ocean `#202020`,
  warm-gray land `#413C39`, near-black borders `#0C0C0C`, indigo surfaces
  `#20263E`, high-contrast text, blue Visited `#224CBB`, gold Lived / Living
  `#FBE769`, coral Want to Visit `#EC6568`), and Medieval (aged parchment,
  sea-green ocean `#9BA58B`, land `#DCC699`, olive Visited `#748044`,
  slate-blue Lived / Living `#708E99`, ochre Want to Visit `#A87A2C`,
  sepia ink, serif headings, sailing galleons, dragons instead of airplanes,
  and ink-style clouds).
* **Scope:** Skin the map, markers, sidebar, legend, native controls, tooltips,
  body-level status popovers/dialogs, warnings/toasts, and loading/fatal screens.
  Status colors adapt but meanings, labels, and cross-surface consistency do not.
* **Selection:** A labeled keyboard-accessible native select in the sidebar.
  Do not restore a global header. Classic remains default, independent of system
  light/dark settings. Apply the root skin before rendering loading UI and update
  native `color-scheme` and browser `theme-color`.
* **Persistence:** Store only an explicit selection in `passport:theme:v1`.
  Recognized IDs restore without a startup write. Unknown IDs fall back to
  Classic with a visible explanation and leave the stored value untouched.
  Read/write failures have an independent non-blocking theme warning; failed
  writes retain the requested session appearance. Never mark travel data unsaved
  because a theme preference failed. Travel storage, migration, recovery,
  import/export schema, and subdivision preservation remain independent.
* **Package:** Editable local `src/themes` folders with semantic CSS tokens,
  scoped decorative rules, optional original SVG artwork, one typed registry,
  and a stylesheet entry point. Classic supplies defaults; other skins inherit
  unchanged tokens and may reuse Classic art. No remote fonts/CDNs, runtime
  theme requests, styling framework, or published npm package.
* **Artwork contract:** Trusted bundled SVG supplies `ship`, `plane`, `cloud`
  symbols with centered viewBoxes and theme-variable paints, no internal
  IDs/references or external/animated resources. `plane` is the route-kind slot
  for Medieval dragons. Validate symbols and prefix their IDs per scene.
  Swap only definitions in place; retain object nodes, routes, density,
  illustration sizes, clock/phase, and the single frame-loop lifecycle.
  Medieval artwork uses a scoped 1.35x visual scale for recognizable sails,
  rigging and dragon wings without changing route-object/viewports or culling.
* **State preservation:** Theme changes preserve geometry/path nodes,
  pan/zoom, active territory, travel data/totals, search/accordion state,
  keyboard focus, scenery pause/hide/reduced-motion choices, and background
  suspension. Dismiss cached tooltips and status popovers without stealing
  picker focus. Use accurate scenery descriptions for each skin.
* **Accessibility/performance:** Readable text and focus contrast, text labels
  alongside status colors, unchanged responsive layout and pointer-transparent
  decorations. Use static lightweight parchment treatment, no SVG filters,
  geography redrawing, extra loops, or geographic asset changes.
  Medieval uses an original bundled paper-fiber/ink-fleck SVG tile, static
  edge shading, and a double-line frame. The texture overlay covers land and sea
  but remains pointer-transparent. No filters, moving textures, or additional
  geographic paths are introduced; switching skins removes the treatment.

---

## 4. File & Directory Structure

```text
/
├── index.html            # Main HTML shell & UI layout
├── src/
│   ├── main.ts           # App initialization & event wiring
│   ├── types.ts          # TypeScript interfaces (LocationEntry, TravelStatus)
│   ├── map.ts            # D3.js Mercator map, TopoJSON loader, Microstate dots
│   ├── scenery.ts        # Theme artwork installation, geographic routes, motion lifecycle
│   ├── theme.ts          # Independent theme preference and root skin application
│   ├── themes/           # Editable local design packages
│   │   ├── index.ts      # Typed registry, artwork and descriptions
│   │   ├── styles.css    # Theme stylesheet entry point
│   │   ├── classic/      # Complete token defaults and original scenery.svg
│   │   ├── dark/         # Dark token overrides; default scenery
│   │   └── medieval/     # Fantasy-atlas tokens, galleon/dragon/cloud SVG, paper-grain.svg
│   ├── popover.ts        # 4-button contextual selection popover
│   ├── sidebar.ts        # Sidebar list, search filtering, continent accordion
│   ├── store.ts          # State management, localStorage, JSON sync/export
│   └── styles/
│       ├── main.css      # Theme imports, layout reset, token-based typography
│       ├── sidebar.css   # Sidebar layout and theme picker
│       ├── map.css       # SVG map layer styles, tooltips, microstate dots
│       └── popover.css   # Context popover floating panel styles
├── data/
│   ├── world-10m.json    # Simplified 1:10m-derived TopoJSON retaining every polygon and ring
│   ├── additional-territories.json # Explicit non-ISO catalog and source map-unit IDs
│   ├── registry.json    # ISO/custom metadata, grouping, and marker coordinates
│   └── user-data.json    # Committed user status file
├── tsconfig.json
└── package.json

```