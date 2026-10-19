# passport

A small, local-first travel atlas. Color the places you have visited, called home,
or want to visit. No account, backend, API key, analytics, or external map service.

## Run

Use Node.js 22.12 or newer (Node.js 24 recommended).

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite. To build static files, run `npm run build`;
`npm run preview` serves the resulting `dist` directory locally.

## Your map

The map and sidebar start at the top of the page, without a logo header or map
introduction. On desktop they sit side by side at full viewport height; on narrow
screens the map appears above the sidebar.

The sidebar's **Theme** picker changes the entire application:
**Classic** retains the original pastel map, **Dark** uses a navy ocean and dark
surfaces, and **Medieval** is a parchment atlas with sepia borders, serif headings,
sailing ships, birds, and ink-style clouds. Status colors adapt with each skin;
their meanings and legend remain consistent.

Classic is the default, regardless of your system color scheme. An explicit
choice is remembered in `passport:theme:v1`, separately from travel data, and
restored before loading/recovery screens appear. No preference is written merely
by opening the app. An unavailable saved skin falls back to Classic with an
explanation, without overwriting the old choice. Storage failures show a separate
theme warning; a theme that cannot be saved still works for the current session.
The preference is browser-local and is not included in travel JSON exports.

Switching skins preserves pan/zoom, selected territory, search/continent state,
travel data, and scenery pause/visibility/phase. It dismisses open status popovers
and map tooltips, without moving keyboard focus away from the picker.

Click a polygon, small-territory dot, or place in the sidebar to select
**Visited**, **Lived / Living**, **Want to Visit**, or **Reset (Unvisited)**.
Scroll/double-click to zoom, drag to pan, or use the zoom and reset-view buttons.
The searchable territory list provides the equivalent keyboard-accessible controls.
Escape closes the status popover and returns focus to its trigger.

All 249 official ISO 3166-1 territories and 17 additional non-ISO areas have
genuine bundled boundary polygons: **266 independently tracked places** in total.
Tiny territories also have constant-size markers. The six continent groups use
one assignment per territory; Antarctica has its own separate sidebar entry.
Mercator cannot show the poles: polar land is clipped by the viewport, with an
Antarctica marker kept within the initial map extent. Pan/zoom to explore.
Flags depend on platform emoji support; ISO country codes are always present.
Additional areas use a generic symbol and an explicit non-ISO label instead of
an invented national flag or ISO code.

### A little life on the map

Tiny ships, airplanes (birds in Medieval), and clouds follow illustrative geographic routes.
The original SVG artwork stays small as you zoom, moves with the map, and never
blocks selecting a place. Desktop has three ships, two airplanes, and four clouds;
narrow screens show two ships, one airplane, and three clouds.
Their screen-space illustration viewports are 37.5px for ships, 34.5px for
airplanes, and 69px for clouds.

Use the **pause/play** toolbar button to freeze or resume the visible scene.
The separate **eye** button hides or shows the entire scenery layer. Hiding stops
animation work; showing restores the same phase and your previous pause choice,
including after navigating the map while hidden.

Reduced-motion preferences keep the decorations static and disable the animation
control, but you can still hide them. Background tabs suspend animation without
catching up when you return. Pause and visibility choices last for the current
page only; they do not change saved travel data or exports.

Everything is drawn locally, with no new requests or external assets. Routes and
clouds are decorative, **not live ship traffic, flights, or weather**.

### Editing or adding a skin

The design is a local package under `src/themes`, not an npm dependency. All
styles and original SVG art are bundled with the application: no remote fonts,
CDNs, runtime skin downloads, or additional animation loops.

```text
src/themes/
  index.ts              Typed registry: IDs, labels, artwork, descriptions
  styles.css            Stylesheet imports, Classic first
  classic/theme.css     Complete semantic token defaults
  classic/scenery.svg   Default ship/plane/cloud symbols
  dark/theme.css        Scoped dark overrides; reuses default artwork
  medieval/theme.css    Scoped parchment overrides and decorative rules
  medieval/scenery.svg  Sailing ship/bird/ink-cloud symbols
```

Edit a skin's `theme.css` to change its palette. Classic supplies inherited
defaults, so other skins only need to override the properties they change.
Component layout/behavior stays in `src/styles`; preferences live in `src/theme.ts`.

| Token group | Examples |
| --- | --- |
| Typography and surfaces | `--font-body`, `--font-heading`, `--page`, `--surface`, `--ink`, `--muted`, `--subtle` |
| Controls and states | `--accent`, `--button`, `--on-accent`, `--hover`, `--input`, `--border`, `--selected` |
| Map and travel colors | `--ocean`, `--unvisited`, `--visited`, `--lived`, `--want-to-visit`, status tints, `--country-border`, marker colors |
| Overlays and decoration | Map-panel/tooltip/toast/warning colors, `--backdrop`, shadows, `--radius-*`, `--paper` |
| Scenery paints | `--ship-*`, `--plane-*`, `--cloud`, `--cloud-detail` |

To add a skin:

1. Copy a theme folder and scope every override/decorative rule with
   `:root[data-theme="your-id"]`. Register its stylesheet in `src/themes/styles.css`.
2. Add one entry to `THEMES` in `src/themes/index.ts`: unique `id`, `label`,
   `artwork`, and accurate `sceneryDescription`. Allowed IDs and picker options
   come from this registry. Use `DEFAULT_ARTWORK` when no custom SVG is needed.
3. For custom artwork, import a local SVG with `?raw`. Include the three
   `symbol` IDs `ship`, `plane`, and `cloud`, each with a `viewBox`. The airborne
   symbol keeps the ID `plane` even when drawn as a bird. Point vehicles toward
   positive X and keep the existing centered viewBoxes for consistent sizing.
   Use inherited semantic paint variables. Do not add internal IDs/references,
   scripts, external resources, filters, or animations; the controller prefixes
   symbol IDs and swaps definitions without recreating objects or the clock.
   Malformed SVG or missing symbols fail explicitly, rather than silently falling
   back to unrelated art.
4. Check text/focus contrast, all four status colors across map/markers/legend/UI,
   desktop/mobile layouts, body-level dialogs/tooltips, and reduced-motion
   scenery. Run `npm run check` and `npm run test:e2e`. Keep paper effects static
   and lightweight; never alter geographic geometry to implement a skin.

### Additional territories

The explicit catalog in `data/additional-territories.json` includes Kosovo,
Northern Cyprus, Somaliland, Akrotiri, Dhekelia, the Cyprus UN Buffer Zone,
the northern and southern Korean DMZ areas, Guantanamo Bay Naval Base,
Siachen Glacier, the Southern Patagonian Ice Field, Bir Tawil, the Paracel Islands,
the Spratly Islands, Bajo Nuevo Bank, Serranilla Bank, and Scarborough Reef.
This includes several different kinds of areas, not just disputed states;
inclusion is for personal travel tracking and does not imply political recognition.
It is not an exhaustive list of every disputed area worldwide.

Entries use stable custom IDs, for example `custom:KOS`, `custom:CYN`, and
`custom:SOL`. Names and IDs are searchable in the normal continent groups.
The Cypriot additional areas appear in Europe, matching the existing Cyprus
entry; the other areas follow their source continent.

**Counts are exclusive:** a place marked Lived is counted under called home,
not also under visited. "Your world in color" counts all three non-default states,
including wishlist places; it is not a claim that you have visited that many.
Totals include both ISO and additional entries. Each entry counts once with its
own independent status: changing Kosovo does not change Serbia, changing
Northern Cyprus does not change Cyprus, and changing Somaliland does not change
Somalia. Source polygons can overlap, such as the DMZ overlays; this does not
automatically propagate statuses or merge the two entries in your totals.

### Persistence, recovery, and moving data

On first load, the app reads `data/user-data.json`. On later loads, valid
`localStorage` state (`passport:locations:v1`) takes precedence; changes in the
committed file do not silently replace browser edits. Browser storage is scoped
to the origin and is not synchronization across devices, browsers, or tabs.
Old 249-country browser saves load normally: existing statuses, timestamps, and
subdivisions are preserved, and new entries start Unvisited. Existing passport
saves are not rewritten merely by opening the app; the expanded state is saved
on your next change and is included in exports.

When upgrading from the former project name, a valid `visited:locations:v1` save
is copied unchanged to `passport:locations:v1` only if the passport key is absent.
The old key is removed **only after the new save succeeds**. If both exist, the
passport save wins; an invalid passport save still requires explicit recovery,
not a silent fallback to older data. Invalid legacy data also requires recovery,
and cancellation leaves both keys untouched.

If migration cannot write the new key, your loaded places remain usable, the old
save remains intact, and a warning asks you to export. If the write succeeds but
old-key removal fails, the app reports the cleanup failure while correctly
showing the data as saved. The next successful edit, import, or recovery save
retries cleanup. Storage is still origin-specific: changing hosts does not move
your data automatically.

- **Export data** downloads the full JSON array as `passport-data.json`.
- **Copy JSON** copies the same data; clipboard access needs a secure context
  such as HTTPS or localhost. If copying fails, use the download instead.
- **Import** validates a JSON file, then asks for confirmation before replacing
  current state. Missing known places become Unvisited. Unknown territory IDs,
  invalid statuses, duplicate IDs, and malformed subdivision data are rejected.
  Cancellation and validation failures do not change existing state.

To retain your state in Git, export and replace `data/user-data.json` with the
downloaded JSON, then commit it yourself. This application cannot write to your
repository. Import that file to deliberately replace an existing browser state.
Export before clearing browser storage or switching devices.
Older ISO-only exports can be imported into this version. As with every
replacement import, additional entries missing from that file reset to Unvisited
after confirmation. Exports containing `custom:` IDs cannot be loaded by the
older ISO-only application.

Corrupt saved JSON is never silently overwritten. The recovery dialog lets you
download the original value as `passport-recovery.json` and explicitly choose the
committed starting data.
Cancelling leaves it untouched. If browser storage is denied or full, changes
remain usable in the current tab, but a visible warning tells you to export.
Failed geographic/committed-data loads show a visible error with a retry action.

### JSON format

The top-level format remains `LocationEntry[]`, using official alpha-3 country
IDs or cataloged `custom:` territory IDs. Custom IDs are validated against the
registry; an arbitrary `custom:` prefix is not enough.

```json
[
  {
    "id": "USA",
    "name": "United States",
    "continent": "North America",
    "status": "visited",
    "subdivisions": [
      {
        "id": "US-CA",
        "name": "California",
        "continent": "North America",
        "status": "lived"
      }
    ],
    "updatedAt": "2026-01-01T12:00:00.000Z"
  }
]
```

Statuses are `unvisited`, `visited`, `lived`, and `want_to_visit`. Country names
and continent labels are normalized to the canonical registry. Recursive
subdivisions and optional ISO timestamps survive editing/import/export, but
subdivisions do not yet have a map, editing UI, or their own totals.
Subdivision IDs must have their parent country's ISO alpha-2 prefix. Imports
are limited to 5 MB, 10,000 entries, and 12 nested subdivision levels.
Additional territories do not have ISO alpha-2 codes or a custom subdivision
schema: nonempty subdivision arrays on custom entries are rejected explicitly.
Empty arrays are preserved, and ISO-country subdivision handling is unchanged.

## Geography and licensing

`data/world-10m.json` uses Natural Earth's **1:10m admin-0 map units**, not a
110m dataset: the latter would omit required microstates. Source polygons are
grouped by ISO code, simplified once per shared boundary arc, and quantized.
Natural Earth's nine US Minor Outlying Islands map units are assigned to UMI
instead of USA. The 17 cataloged non-ISO map units are matched by their source `GU_A3` IDs
and promoted into independently interactive features, with `custom:` IDs.
Custom polygons render after ISO polygons so source overlays remain selectable.
No parent geometry is subtracted or merged, and no new polygons are fabricated.
Boundaries reflect the source's cartographic conventions, not a political claim
or a legal/boundary-survey reference.

### Balanced map detail

The generated map retains all **266 places, 4,292 polygon components, and 4,312
rings**, including tiny islands and holes. Shared-arc spherical Visvalingam
simplification reduces stored vertices from 482,164 to 124,809 (about **74% fewer**)
and reference SVG path characters by about **76%**. The geographic asset shrinks
from 4.52 MB to 1.31 MB, or roughly 1.50 MB to 0.48 MB gzip.

Small or sensitive shapes are protected by restoring their original shared arcs
if simplification collapses a ring, changes its winding, or changes its area by
more than 10%. Whole-feature area changes are limited to 1%. Markers and
microstate eligibility still use the original source geometry.
The 10% base retention setting applies before these safeguards; the final
protected map retains about 26% of its original vertices.

This is one balanced-detail asset at every zoom level, not a detail toggle or
runtime simplification. Coastlines are intentionally less precise at high zoom,
but territory IDs, travel data, marker sizes, and map controls are unchanged.
Pan/zoom transforms the existing land paths; it does not regenerate them.
Tooltips reuse their content and measured size while hovering within one place.

Generation is deterministic. Coverage checks verify the original shared-arc
connections and polygon/ring structure, require at least 70% fewer stored points
and reference SVG characters, and enforce a 1.5 MB geometry budget.

### Licensing and provenance

Boundary data is **public domain**, from
[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/).
Country metadata is derived from
[mledoze/countries](https://github.com/mledoze/countries), licensed under
**ODbL 1.0**. The derived registry and generated starting database are also
available under ODbL 1.0; the full license is in `data/COUNTRIES-LICENSE.txt`.
The generator and all derived data needed to reproduce them are included.
These data-license terms are separate from application code.

Pinned source URLs, revisions, normalization rules, marker placement, and
continent exceptions are recorded in `data/provenance.json`.
`data/coverage-report.json` records actual polygon coverage and separate ISO,
additional, and combined totals. Each territory appears in exactly one group: Americas split into South
America versus North America (including Central America and the Caribbean);
transcontinental assignments follow the registry; Bouvet is grouped with
Africa, South Georgia with South America, and other Antarctic dependencies with
Oceania. Antarctica itself remains separate.

Regenerate bundled assets reproducibly (requires internet on the first run):

```powershell
npm run data:generate
npm run data:check
```

Source responses are cached in `.data-cache`. Regeneration **does not overwrite
an existing `data/user-data.json`**. Coverage is independently compared with the
ISO code list from `i18n-iso-countries`, excluding the user-assigned XK code.
The 17 additions are checked separately against the explicit catalog, including
ID/metadata uniqueness, genuine geometry, and the absence of invented flag codes.
Checks reject missing, inverted, degenerate, nonfinite, or unrenderable polygons.
Source licensing and geometry must be reviewed when updating pinned revisions.
The app does not fetch upstream data or load fonts/CDNs at runtime.

## Verification

```powershell
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs geographic checks, unit tests, strict TypeScript checking, and the
production build. Browser tests cover map/sidebar/marker synchronization, all
statuses, reloads, import/export, corrupt state, storage failures, keyboard
controls, zoom/drag, and mobile layout; screenshots are saved in `test-results`.
Scenery tests cover route interpolation, ship tracks against bundled land,
motion/visibility controls, reduced motion, background suspension, cleanup,
click-through selection, and constant-size positioning during map navigation.
Use `npx playwright install --with-deps chromium` on Linux.

To exercise the production build rather than the development server:

```powershell
$env:TEST_PRODUCTION = '1'
npm run build
npm run test:e2e
Remove-Item Env:TEST_PRODUCTION
```

## Static hosting and Azure Static Web Apps

Publish **the contents of `dist`**, not the source directory. Root hosting needs
no extra configuration. For project-subpath hosting, build with a trailing-slash
base URL:

```powershell
$env:BASE_PATH = '/passport/'
npm run build
npm run preview
```

Open the printed host at `/passport/`. JSON assets, JavaScript, CSS, favicon,
and attribution URLs use this prefix. Vite serves the repository's `data`
directory during development and emits it into `dist` during production builds;
there is no duplicate source of truth in `public`.

To run the browser suite against that production subpath:

```powershell
$env:TEST_PRODUCTION = '1'
$env:TEST_BASE_PATH = '/passport/'
npm run test:e2e
Remove-Item Env:BASE_PATH, Env:TEST_PRODUCTION, Env:TEST_BASE_PATH
```

### Azure deployment

`.github/workflows/azure-static-web-apps.yml` checks the application and exercises
production builds at root and project subpaths. After all checks pass, pushes to
`main` deploy to your existing **Azure Static Web Apps** resource. You can also
run the workflow manually from the Actions tab with `main` selected. Pull
requests and manual runs on other branches validate without deploying; no
pull-request preview environments are created.

The workflow reuses the deployment-token secret created by Azure when the
resource was connected to this repository. If you need to add or replace it:

1. In the Azure portal, open your Static Web App and select **Manage deployment
   token** to copy its deployment token. The resource must allow deployment-token
   authentication.
2. In the GitHub repository, open **Settings > Secrets and variables > Actions**
   and set the repository secret
   `AZURE_STATIC_WEB_APPS_API_TOKEN_GREEN_MEADOW_0F3FFA603` to that token.
   Do not commit the token or paste it into an issue.
3. Push to `main`, or manually run the workflow on `main`. A deployment fails
   with an explicit setup error if the secret is missing.

The token identifies the existing Azure resource; the workflow does not create
resources or change Azure settings. It explicitly rebuilds with `BASE_PATH=/`
after the subpath checks, then uploads only the prebuilt `dist` directory using
`Azure/static-web-apps-deploy`. Azure does not rebuild the app, and no API backend
is deployed. GitHub Pages actions and permissions are not needed.
This is the only deployment workflow; remove Azure-generated duplicate workflows
if reconnecting the resource creates another one.

**Moving your map:** browser storage belongs to its origin. Export your data
from the old localhost/hosted address and import it at the Azure address to keep
your places; deploying the application does not transfer browser-local data.
Verify the workflow's deployment result and the Azure site's URL after publishing;
local builds alone do not confirm a live deployment.

## Structure

`src/main.ts` wires the shell, recovery, import/export, and counters;
`store.ts` owns validation and persistence; `geography.ts` loads bundled data;
`map.ts` owns D3 rendering/navigation; `sidebar.ts` handles search/grouping;
`popover.ts` provides shared accessible status actions. CSS lives in
`src/styles`, reproducible geography scripts in `scripts`, and tests in `tests`.
