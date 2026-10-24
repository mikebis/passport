# passport

A small, local-first travel atlas. Color the places you have visited, called home,
or want to visit. No required account, backend, API key, or external map service.
Optional Google sign-in backs up your map to your private Drive app-data.
Optional, separately configured Google Analytics measures basic public-site
traffic without receiving your travel data.

**Contents:** [Run](#run) · [Your map](#your-map) ·
[Favourites](#favourite-places) · [Google sync](#optional-google-sign-in-and-drive-sync) ·
[Configure Google](#configure-google-optional) ·
[Analytics and privacy](#optional-google-analytics-and-privacy) ·
[Tabs and statistics](#sidebar-tabs-and-statistics) ·
[Share a picture](#share-a-travel-picture) · [Badges](#editing-badges) ·
[Scenery](#a-little-life-on-the-map) · [Skins](#editing-or-adding-a-skin) ·
[Additional territories](#additional-territories) ·
[Persistence](#persistence-recovery-and-moving-data) · [JSON format](#json-format) ·
[Geography and licensing](#geography-and-licensing) ·
[Verification](#verification) ·
[Hosting and Azure](#static-hosting-and-azure-static-web-apps) ·
[Structure](#structure)

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
screens the map appears above the sidebar. Geography and scenery fill the entire
map area, with a floating bottom-center status legend and left-hand controls.
The informational legend lets clicks, drags and zoom gestures reach the map
underneath. There is no navigation hint or reserved map footer; boundary
attribution and the Data sources link sit with the sidebar footer's license credits,
followed by a **View on GitHub** link to the
[source repository](https://github.com/mikebis/passport).
The shared footer uses larger, higher-contrast text and clearly underlined links
with visible keyboard focus. It scrolls independently on short desktop windows
so credits remain reachable without crowding out the country list. Save status,
JSON backup/import controls and Google Drive sync live in **Save/Export**.

On desktop, **Hide sidebar** at the map's bottom-right corner, level with the
legend, gives the full width to the map; **Show sidebar** restores the same
sidebar. It starts shown unless
you previously chose to hide it in this browser. This independent
`passport:sidebar:v1` preference is not part of travel exports or Google Drive
sync. If it cannot be read, the sidebar stays shown with an explanation; if it
cannot be saved, your choice still works for the current session.
Mobile always shows the sidebar below the map, without changing the saved
desktop choice.

### Favourite places

Use the star beside a place in **Countries**, or the **Favourite** toggle
in its map/sidebar popover. An outlined star becomes a filled golden star.
Favourites do not change map boundaries, tiny-place marker rings or map previews.
All ISO and additional places, including Antarctica, can be favourites.
The controls support mouse and keyboard without changing map navigation.
The star button beside the sidebar status filters shows favourites only.

Favourites are independent of travel status: even an Unvisited place can be a
favourite, and **Reset (Unvisited)** does not remove it. They do not change
alphabetical ordering, status filter membership, totals, Stats or badge progress.
They save locally, appear in JSON exports/imports and participate in optional
Google Drive sync, including favourite-only changes.

The optional `favourite` field is a boolean; missing means `false`. Existing saves
need no migration or startup rewrite. Confirmed imports replace favourites too:
importing an older file without flags clears them, while cancellation preserves
the current map. Import and Drive comparisons report status and favourite
differences separately. Use updated app versions on all devices: older clients
do not understand the field and can discard it when saving or synchronizing.

### Optional Google sign-in and Drive sync

Open **Save/Export** and choose **Connect Google Drive**, then **Continue with
Google**. Google resources are loaded only after
this opt-in for sign-in/Drive. Separately configured usage analytics can contact
Google on eligible public production visits without connecting Drive. The connection requires a
configured public OAuth client ID (setup below).

The first connection asks before backing up or replacing a map. If Drive and
this device differ, choose **Use this device** or a **Google Drive version**,
or cancel to pause synchronization. Each version can be downloaded in the normal
import-compatible JSON format. Timestamps and subdivisions are compared and
preserved, not just country colors. New remote changes require a choice even if
this device has no pending edits; there is no automatic newest-wins merge.

After linking, edits and imports save locally immediately and automatically sync
after a short debounce. Cloud status, **Sync now**, retry and the last successful
sync time are separate from browser-save warnings. Drive is checked before
saving, on returning to the app, coming online and manual sync. It is not a
real-time service. Offline edits remain local; return and reconnect to reconcile.

This is a static browser-only integration: access tokens live only in memory.
After reload or token expiry, click to reconnect. There is no refresh token,
backend session, unattended sign-in, or secret bundled with the app.
**Sign out** disconnects passport but **keeps the map on this device**. It does
not sign out your Google account globally, revoke permissions or delete Drive
data. Linking to a different Google account always requires confirmation.
This is not a shared-device privacy vault: retained local travel data and pending
backups remain readable in the browser.

Drive access is limited to the non-sensitive `drive.appdata` scope, plus
`openid email` to identify the selected account. The app cannot browse your other
Drive files. App-data is private and hidden from normal Drive listings, not
end-to-end encrypted. Revoke access in your Google Account's third-party
connections; manage/delete stored app data through Google Drive's app settings.
Deleting cloud history requires an explicit new backup decision in passport.

Saves are **immutable versioned JSON snapshots**, not overwrites of one file.
Concurrent device edits remain separate branches until you choose a version;
resolving creates a new snapshot without deleting earlier copies. Snapshots use
your Drive storage and are not automatically pruned. Rapid edits are grouped;
large histories cost additional metadata-listing time. The app currently limits
each snapshot to 5 MB and history to 10,000 files, and reports unsupported,
incomplete or corrupt history without replacing it. Export backups before
managing/removing app data. Normal exports remain `LocationEntry[]`; only hidden
cloud files add a versioned synchronization envelope.

Pending cloud operations and account-specific baselines use separate
`passport:drive:*` browser keys. They never contain access tokens. Pending
operations are associated with Google's stable account ID and cannot be replayed
to another account. Conflicting changes in another tab pause synchronization
until comparison; signing out stops synchronization in other open tabs too.
If browser storage prevents notifying other tabs, passport warns you to sign out
in those tabs manually.

### Configure Google (optional)

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/).
   Enable **Google Drive API** under APIs & Services.
2. Configure **Google Auth Platform** branding, audience and data access.
   Request only `openid`, `email` and
   `https://www.googleapis.com/auth/drive.appdata`. For an External app in Testing,
   add the Google accounts that will test it as test users. Google Workspace
   policies can restrict access even when consent is granted.
3. Create an OAuth client of type **Web application**. Add authorized JavaScript
   origins `http://localhost`, `http://localhost:5173` and
   `https://green-meadow-0f3ffa603.4.azurestaticapps.net` (plus any actual custom
   production origin). Origins contain scheme, hostname and port, not paths:
   `/passport-test/` is not part of an origin. Use localhost for OAuth testing;
   Google can reject raw-IP origins such as `127.0.0.1`.
4. Copy `.env.example` to ignored `.env.local` and set `VITE_GOOGLE_CLIENT_ID`
   to the public client ID. **Never supply a client secret** to this frontend.
   Start your own localhost server with
   `npm run dev -- --host localhost --port 5174`, authorizing
   `http://localhost:5174` too if your existing port 5173 server must stay running.
   Environment changes require restarting only your own relevant Vite process.
5. For Azure builds, set the public repository Actions variable
   **GOOGLE_CLIENT_ID** under Settings > Secrets and variables > Actions >
   Variables. It is not the Azure deployment-token secret. The workflow injects
   it into the final Vite production rebuild. Without it, deployment remains
   usable locally but explains that Google sync is unconfigured.
6. Before opening access to general users, review Google's publishing,
   branding/domain-verification and privacy-policy requirements for your app.
   Testing restrictions and organizational policies are distinct from the
   app-data scope's non-sensitive classification.

Test real consent and a backup using your configured client, reconnect, sign out,
and verify the map on a second device. Automated tests mock Google SDK and REST
responses and do not prove live OAuth/Drive setup. CI uses a synthetic client ID
only in mocked validation builds; it is never a production fallback.

See [Google's browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
and [Drive app-data guide](https://developers.google.com/workspace/drive/api/guides/appdata).

The sidebar's **Theme** picker changes the entire application:
**Classic** uses a bright blue ocean, silver-gray land, white borders, green
Visited, yellow Lived / Living, violet Want to Visit, and cool blue UI accents.
**Dark** uses a charcoal ocean,
warm-gray land, near-black borders, indigo surfaces, and blue/red/gold travel
colors, and **Medieval** is an aged fantasy atlas with grainy parchment, muted
sea-green water, olive land colors, sepia borders, serif headings, sailing
galleons, dragons, and ink-style clouds. Status colors adapt with each skin;
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

The neighboring **Projection** picker switches between **Equal Earth** (the
default equal-area world view) and **Mercator**. It applies to both the live map
and generated shared pictures. Switching resets the map's pan/zoom to its initial
world view while preserving the selected place, travel data, filters and scenery
state. Theme and Projection are independent.

An explicit projection choice is remembered in `passport:projection:v1`; opening
the app does not write a default. Invalid or unreadable preferences use Equal
Earth with a separate warning, without overwriting the saved value. A failed
save keeps the choice for the current page and explains that it could not be
remembered. Projection is browser-local, not part of travel JSON, Google Drive
snapshots or QR contents.

Click a polygon, small-territory dot, or place in the sidebar to select
**Visited**, **Lived / Living**, **Want to Visit**, or **Reset (Unvisited)**.
Scroll/double-click to zoom, drag to pan, or use the zoom and reset-view buttons.
The searchable territory list provides the equivalent keyboard-accessible controls.
Escape closes the status popover and returns focus to its trigger.
Hover a sidebar place or focus it with the keyboard to temporarily outline it
on the map, with a stronger marker ring for tiny places. This includes additional
territories and Antarctica. Hover takes priority over a different focused row;
leaving restores that row's preview, or clears the preview when no row is focused.
Previews preserve status colors and clicked selection without moving the map,
opening status choices, or changing your data.

All 249 official ISO 3166-1 territories and 17 additional non-ISO areas have
genuine bundled boundary polygons: **266 independently tracked places** in total.
Tiny territories also have constant-size markers. The seven continent accordions
use one assignment per territory, with Antarctica as the final group.
All groups, including Europe and Antarctica, start collapsed on each page load.
Open any groups independently; search and filters temporarily expand
matching groups and restore their previous open/closed states when all clear.

Use **Visited**, **Lived / Living**, **Want to Visit**, and **Unvisited** buttons
below search to filter the sidebar. Each is independent: selecting Visited and
Want to Visit includes either status; Lived / Living is not included in Visited.
Text search further narrows that selection. No selected buttons means all
statuses; **Show all statuses** clears just the status selection, keeping search
and the favourite filter. The star button beside the status filters toggles
**favourites only**, intersecting the selected statuses and text search.
Compact, neutral buttons fit on one row, with colored circles matching the
active theme's map legend and a thicker border indicating selection. Hover for
filter tooltips; the reset arrow shows all statuses. Results update immediately
after edits, imports or accepted Drive replacements, including additional places
and Antarctica.
Filters last only until reload, survive theme switches and sidebar hiding, and
are not saved, exported or synchronized. They affect sidebar rows only, not map
visibility, travel data, global totals or continent progress. If a status edit
filters out its sidebar trigger, focus returns to search instead of a hidden row.

Each continent shows **(visited or lived / total)** using only official ISO
countries and territories; Antarctica's summary shows **(0/1)** or **(1/1)**.
Only Visited and Lived / Living contribute to the numerator, once per place.
ISO wishlist and unvisited places remain in the denominator; additional non-ISO
areas are excluded entirely. Search/status filters change the list, not the progress values.
These ISO-only ratios differ from the global counters and world-in-color progress,
which still include additional areas (and wishlist in world-in-color).
Equal Earth shows the full world including the poles. Mercator cannot show the
poles: polar land is clipped by the viewport, with an Antarctica marker kept
within the initial map extent. Pan/zoom to explore.
Flags depend on platform emoji support; ISO country codes are always present.
Additional areas use a generic symbol and an explicit non-ISO label instead of
an invented national flag or ISO code.

### Optional Google Analytics and privacy

Analytics is **disabled by default**. When a public GA4 measurement ID is
configured, production visits automatically send basic traffic data without a
consent prompt. Development, recognized localhost/private-address previews,
Do Not Track and Global Privacy Control are excluded. Local hostname detection
does not perform DNS lookups or prove that a hostname resolves to a public IP.
An invalid ID or blocked/timed-out script produces a developer-console warning
without blocking map use. No GA account or analytics permission is needed to use
the app.

GA4 can report **Sessions** (visits), **Views**, **Total users** and **Active
users**, device categories (desktop/mobile/tablet) and approximate visitor
countries. Total users is an estimate based on browser identifiers, not exact
unique people across devices, cleared cookies or private browsing. Active users
is a different engagement-based metric. Privacy exclusions, blockers and
network failures reduce measured traffic; VPNs can change inferred countries.

The app sends a fixed `passport` title, its origin/base URL without query/hash
or incidental paths, and at most a referring site's origin. It sends one
deliberate page view per document; tabs, themes, projections, map edits,
exports and picture generation do not send custom events or extra page views.
GA's normal first-visit, session and engagement events still apply. No travel
statuses, favourites, picture names/images, exports or Google sign-in identity
are passed to analytics. Advertising signals are disabled.

Google receives network/browser information and can set first-party analytics
cookies with pseudonymous browser identifiers. This is **not anonymous or
cookie-free tracking**. The shared footer's **Privacy** link opens an untracked
same-origin page describing local storage, optional Drive and analytics.
Browser privacy signals must be enabled before loading the app; clearing
cookies removes existing identifiers, not Google's historical data or future
collection on eligible visits.

**Before enabling:** always-on analytics without prior consent may not comply
with your jurisdiction's requirements. The operator must resolve applicable
consent, disclosure and retention requirements first. The Privacy link and
DNT/GPC exclusions do not replace legally required prior consent.

#### Create and configure GA4

1. At [Google Analytics](https://analytics.google.com/), create an account if
   needed, then **Admin > Create > Property**. Choose the reporting time zone
   and the relevant business objectives.
2. Under **Admin > Data collection and modification > Data streams**, create a
   **Web** stream for your public HTTPS app, for example
   `https://green-meadow.4.azurestaticapps.net`.
3. **Turn Enhanced Measurement off**, including history-based page views,
   scrolling, outbound links, site search, downloads and form interactions.
   In the stream's **Google tag > Configure tag settings > Manage automatic
   event detection**, also disable automatic interaction detection. Do not
   enable user-provided-data collection, Google Signals, advertising
   personalization or Ads integrations. Keep these settings disabled:
   `send_page_view: false` alone does not disable remote interaction collection.
4. Copy the stream's **Measurement ID**, such as `G-ABC1234567`. This is a
   public identifier, not an OAuth client ID, `GTM-` container, API secret or
   client secret. Do not paste Google's extra HTML snippet into this app.
5. For the existing deployment, add the **repository Actions variable**
   `GOOGLE_ANALYTICS_ID` in **Settings > Secrets and variables > Actions >
   Variables**. The main-only deployment rebuild reads it as
   `VITE_GOOGLE_ANALYTICS_ID`. Leave it empty to disable analytics; changing
   the variable requires a fresh build/deployment.
6. For other static deployments set `VITE_GOOGLE_ANALYTICS_ID` at build time,
   or in ignored `.env.local`, then rebuild. Merely configuring it does not
   enable analytics on development or localhost/private previews.

On the deployed site, use a browser with DNT/GPC off and analytics unblocked,
then check **Realtime** in your property. Normal processed reports may take
24-48 hours. Use **Traffic acquisition** for sessions, **Pages and screens**
for views, **Tech details** with Device category, and **Demographic details**
with Country. Report collections/names vary with property objectives; use an
Exploration with **Total users** if the default report shows **Active users**.
There is no backfill before configuration. Confirm actual property reporting
yourself: automated checks mock Google and cannot verify real delivery or
future changes to Google's tag/property settings.

See Google's [GA4 setup](https://support.google.com/analytics/answer/9304153),
[Enhanced Measurement](https://support.google.com/analytics/answer/9216061)
and [configuration reference](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).

### Sidebar tabs and statistics

The sidebar has **Countries**, **Stats**, **Badges**, and **Save/Export** tabs. Only the
heading and footer are shared: the theme picker, existing all-place totals,
search, filters and country list live in Countries. Keyboard users can
switch tabs with Left/Right and Home/End. Countries opens on reload;
switching tabs retains its search, filters, accordion choices and scroll.
Sidebar hiding and mobile transitions retain the active tab.
Save/Export groups its controls under matching category headings: always-visible
**Google Drive sync** first, **Import / Export data** for the device save status,
Export data, Copy JSON, and Import data buttons, then **Sharing** for Share picture.
Actions use larger, full-width
buttons stacked one per line, including the Google connection controls. Sync
continues in the background when another tab is active. Attribution, GitHub and Privacy links
remain in the shared footer.

Stats reports the four status counts, combined visited-or-lived count and
percentage, continent coverage, and per-continent completed/total percentages.
It counts **all tracked countries and territories** (currently 266), including
additional non-ISO places and Antarctica as the seventh continent. Each catalog
entry counts once, even where geometries overlap; subdivisions do not count.
Its denominators come from the full registry, not Countries' filters.
Countries' continent-summary ratios remain ISO-only; its global totals cover
all tracked places.
Statistics and badges update on edits, imports and accepted Drive versions,
even when local saving fails; they do not change the map or travel JSON.

### Share a travel picture

Open **Save/Export** and choose the colored **Share picture** button with its
camera icon and visible text. Its tooltip and accessible name are also
**Share picture**. Pick a **Picture format**, optionally enter your name,
then use **Download PNG** to save the exact finished preview as
`passport-infographic.png`.

| Format | PNG size | Flags/symbols per group |
| --- | --- | --- |
| Horizontal (default) | 2400 x 1600 | Up to 18 |
| Instagram Feed (4:5) | 1080 x 1350 | Up to 6 |
| Story (9:16) | 1080 x 1920 | Up to 12 |

Both portraits reflow the full map, six statistics, four flag groups, top three
earned badges and fixed app QR into a vertical composition. Badge names/points
use compact rows; Story leaves extra top/bottom clearance for platform controls.
These are PNG images for sharing, not an automatic Instagram upload or a Reel
video. Platforms may crop/compress images or overlay controls.
All three formats use an original scrapbook design: off-white textured paper
over illustrated mountain/coast postcards, a blue handwritten heading, compact
icon statistics, a prominent textured-blue world, taped flag cards and
decorative stamps, without a corner passport illustration. The exported styling
is independent of the app theme.
The header shows a single blue **Caveat** handwritten title at a slight angle:
**Alex Morgan's Travel Passport**, or **James' Travel Passport** for names ending
in s (case-insensitive), using typographic apostrophes in the picture. Only the name is
editable; there is no subtitle, byline or placeholder slogan. Leave the name
blank to show **My Travel Passport**.
The font is bundled locally, loaded only when generating
a picture and embedded as a transparent raster for reliable PNG rendering.
The button uses the active theme's filled accent color and a local SVG camera.
The optional name is limited to 60 characters. Long text is wrapped or shortened to fit.

The picture includes a separately fitted map using the selected projection, all-place status and
favourite statistics, visited-or-lived world progress, continent coverage, and
the three highest-point **currently earned** badges. Equal-point badges retain
catalog order; the total earned count/points includes all earned badges.
Original star, mountain and globe stickers accompany the real badge names and
points. These and the scenic collage are illustrative decoration, not additional
achievements or a claim that you visited the illustrated destinations.
No achievements are invented for an empty or unearned catalog.

Equal Earth pictures include the full polar geography. Mercator pictures use a
bounded world view (approximately 85.0511 degrees north/south), clipping polar
land and keeping an Antarctica marker visible inside the map. Both choices
retain every catalog entry and its statistics; projection never changes counts.
The generator follows the current choice even after closing and reopening, and
discards stale results if the projection changes during generation.

Four strips show Visited, Lived / Living, Want to Visit and Favourites. Each
uses the full registry, alphabetical names, its format's display limit and an
exact **+N more** count. Favourites are independent and may repeat a place in
another strip. Additional non-ISO places use neutral code symbols instead of
invented flags. Subdivisions are excluded; sidebar filters do not affect the
picture. As in Stats, the summary counts every tracked country and territory,
including additional non-ISO places, once.

Below the QR, **Scan to create yours!** and the displayed URL are centered
with matching typography.
The **non-editable QR destination** is the current app origin and deployment
base path, without incidental query strings or fragments. It opens the app,
**not a published copy of your personal map**. Localhost/private addresses
show a warning; a deployed address is not checked for public reachability.
Use the full-size PNG and preserve the QR's white margin when sharing.
Unsupported/overlong addresses fail explicitly rather than producing a tiny QR.

Generation is entirely on this device, using locally bundled SVG flags,
title fonts and a QR encoder: no image upload, external font/image service,
external generator or QR-destination request.
Personalization and the selected format stay in page memory across closing and
reopening, never travel JSON, browser storage or Google Drive; reload resets the
format to Horizontal. Current in-memory edits are included even if local saving
fails. Data/input/format changes regenerate the preview and disable download
until ready, without clearing the entered name.
Close/Escape cancels stale results; flag/catalog/browser-encoding errors offer
**Retry picture** without blocking normal map editing or JSON export.

### Editing badges

Edit **`data/badges.json`**, a public JSON array bundled with the application.
Add to or edit the included badge definitions. Each object must have exactly
four fields:

```json
[
  {
    "name": "Two neighbours",
    "description": "Visit or live in at least two of Slovakia, Czechia and Austria.",
    "condition": "(SVK, CZE, AUT){2}",
    "value": 10
  }
]
```

`value` is non-negative integer **points**, not a target. Visited and Lived /
Living qualify; Want to Visit and Unvisited do not. Awards and points are
recomputed from current statuses and can be lost if the condition stops matching.
They have no saved unlock history, timestamps, export fields or Drive metadata.
Badges shows completed definitions first, ordered by points from highest to
lowest. Incomplete badges follow by completion percentage from highest to lowest,
then points from highest to lowest. Exact ties keep their JSON file order.
Ordering updates with your map, retaining existing cards and panel scroll.
Each badge shows its progress bar, alongside total earned/available badges and
points. Each card also lists all countries referenced by its condition, once
each in formula order, including alternatives and threshold members. Country
names use theme-aware, readable status text colors; Unvisited is muted.
Hover text and screen-reader labels give the exact status, and names/colors
update with the current map without changing badge conditions or progress.
The catalog loads when Badges is first
opened; an empty file explains that no badges are configured. Request/JSON/
definition errors appear only there, with retry, leaving the other tabs usable.

Formulas use exact registry identifiers: Germany is **DEU**, not GER.
Existing IDs such as `custom:KOS` and `ATA` can also be explicitly referenced.
Whitespace and nested parentheses are supported:

| Formula | Meaning |
| --- | --- |
| `SVK \| CZE` | Either place (or both) |
| `SVK + CZE + AUT` | All three |
| `(SVK \| CZE) + (AUT \| DEU)` | One qualifying place in each pair |
| `(SVK, CZE, AUT){2}` | At least two distinct listed places |
| `(SVK + CZE) \| AUT` | Both Slovakia and Czechia, or Austria |

`+` binds more tightly than `|`; use parentheses for clarity. Thresholds accept
only explicit comma-separated identifiers, with a positive integer target no
greater than the list size. Duplicate threshold IDs are rejected. There are no
continent queries, date/status comparisons or executable JavaScript.

Each country is one progress unit. AND sums its operands' progress units; OR is
one unit with the best alternative's completion fraction. A threshold clamps
at its target. Thus the paired-OR example progresses 0/2, 1/2, 2/2, and a
four-of-ten list shows **4/10** with a **40%** bar. Fractional compound progress
uses percentage-only text: the final example shows 50% when only SVK qualifies.
A country may satisfy overlapping logical groups, so these units need not be
unique countries. Earned state uses the exact condition, not rounded percentages.

Validation allows at most 500 badges, 120 characters per name, 1000 per
description, 4096 per condition, and 32 nested parentheses. Names must be
nonempty and unique ignoring surrounding whitespace/case; descriptions and
conditions must be nonempty. Points and their total must be safe integers.
Unknown IDs, extra/missing fields and malformed formulas reject the catalog
with an actionable error rather than awarding a partial list.

### A little life on the map

Tiny ships, airplanes (dragons in Medieval), and clouds follow illustrative geographic routes.
The original SVG artwork stays small as you zoom, moves with the map, and never
blocks selecting a place. Desktop has three ships, two airplanes, and four clouds;
narrow screens show two ships, one airplane, and three clouds.
Their screen-space illustration viewports are 37.5px for ships, 34.5px for
airplanes, and 69px for clouds.
Medieval gives its galleons and dragons a modest 1.35x visual scale for readable
sails, rigging, wings, and curled tails; routes and animation timing stay the same.

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
  medieval/theme.css    Aged parchment, sea-green/olive palette and decorative rules
  medieval/scenery.svg  Original galleon/dragon/ink-cloud symbols
  medieval/paper-grain.svg  Small original repeating paper-fiber texture
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
   symbol keeps the ID `plane` even when drawn as a dragon. Point vehicles toward
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

Medieval's original `paper-grain.svg` is a small, static repeating texture with
paper fibers and fine ink flecks. `--paper-grain` and `--paper` control its
surfaces; a pointer-transparent map overlay also gives land an aged finish.
The map frame, edge shading, and texture are scoped to Medieval and disappear
when switching skins. No SVG filters or additional animation loops are used.

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
  invalid statuses/favourite flags, duplicate IDs, and malformed subdivision data are rejected.
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
    "favourite": true,
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

Statuses are `unvisited`, `visited`, `lived`, and `want_to_visit`. The optional
boolean `favourite` defaults to false and is independent of status. Country names
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
Additional areas do not subtract from or merge their parent geometry, and no new
polygons are fabricated.

**Crimea, including Sevastopol, is part of Ukraine on this map.** Generation
reassigns the source's Crimean polygon from Russia to Ukraine and joins its
existing arcs with mainland Ukraine, removing the internal dividing line without
redrawing the coast. This targeted source override leaves every other boundary
assignment unchanged. Crimea follows Ukraine's saved status, tooltip, clicks,
and sidebar highlight; existing Ukraine/Russia statuses and country totals are
not migrated or changed.
Other boundaries retain the source's cartographic conventions; this map is not
a legal/boundary-survey reference.

### Balanced map detail

The normalized map retains all **266 places, 4,291 polygon components, and 4,311
rings**, including tiny islands and holes. Joining Crimea to mainland Ukraine
accounts for one fewer component/ring than the original source grouping, without
losing land. Shared-arc spherical Visvalingam
simplification reduces stored vertices from 482,164 to 124,809 (about **74% fewer**)
and reference SVG path characters by about **76%**. The geographic asset shrinks
from 4.52 MB to 1.31 MB, or roughly 1.50 MB to 0.48 MB gzip.

Small or sensitive shapes are protected by restoring their original shared arcs
if simplification collapses a ring, changes its winding, or changes its area by
more than 10%. Whole-feature area changes are limited to 1%. Markers and
microstate eligibility use unsimplified geometry, including the Crimea correction.
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

Infographic flags come from [flag-icons](https://github.com/lipis/flag-icons)
(MIT); QR generation uses [qrcode](https://github.com/soldair/node-qrcode)
(MIT) and its dijkstrajs dependency (MIT). The unchanged notices ship as
`data/FLAG-ICONS-LICENSE.txt`, `data/QRCODE-LICENSE.txt` and
`data/DIJKSTRAJS-LICENSE.txt`. The handwritten name uses
[Caveat](https://github.com/googlefonts/caveat), bundled through
[@fontsource/caveat](https://fontsource.org/fonts/caveat) under **SIL OFL 1.1**;
its unchanged notice ships as `data/CAVEAT-LICENSE.txt`. Latin/extended Latin and
Cyrillic subsets are local assets; other characters use the declared system
fallback. Font loading/decoding or title encoding failures use the picture's
explicit error and Retry flow, not a silent replacement design.
Scenic postcards, paper, stamp accents and badge stickers are original
vector artwork; no reference-picture artwork, photographs or remotely hosted
fonts are used.

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
The app does not fetch upstream geographic data or remote fonts at runtime.
Optional Google sign-in and configured usage analytics use Google's services.

## Verification

```powershell
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs geographic checks, ESLint (`npm run lint`), unit tests, strict
TypeScript checking, and the production build. Browser tests cover
map/sidebar/marker synchronization, all statuses, reloads, import/export,
corrupt state, storage failures, keyboard controls, zoom/drag, and mobile
layout. Playwright keeps traces of failed tests in `test-results`; in CI it also
writes an HTML report to `playwright-report`.
Scenery tests cover route interpolation, ship tracks against bundled land,
motion/visibility controls, reduced motion, background suspension, cleanup,
click-through selection, and constant-size positioning during map navigation.
Infographic tests inspect real downloaded PNG dimensions, marked-map/flag
pixels, decoded QR payloads, preview/download identity, ephemeral text,
current-state updates, errors/retry and responsive modal behavior.
`security-headers.spec.ts` applies the production CSP and fails on violations.
`analytics.spec.ts` intercepts every external request, serves an isolated public
HTTPS test origin from the owned preview, and checks safe tag configuration,
DNT/GPC and private-host exclusions, script failures and Privacy-page behavior.
No real property receives automated traffic.
Use `npx playwright install --with-deps chromium` on Linux.

To check production dependencies for known vulnerabilities (as CI does):

```powershell
npm audit --omit=dev --audit-level=high
```

To exercise the production build rather than the development server:

```powershell
$env:TEST_PRODUCTION = '1'
npm run build
npm run test:e2e
Remove-Item Env:TEST_PRODUCTION
```

Google sync browser tests run only when the build has a client ID; they mock
every Google request. Use a synthetic ID for such test builds and rebuild
without it before deploying or sharing `dist`:

```powershell
$env:VITE_GOOGLE_CLIENT_ID = 'synthetic-test.apps.googleusercontent.com'
$env:TEST_PRODUCTION = '1'
npm run build
npm run test:e2e
Remove-Item Env:VITE_GOOGLE_CLIENT_ID, Env:TEST_PRODUCTION
npm run build
```

To exercise the analytics-specific configured cases (never use a real ID):

```powershell
$env:VITE_GOOGLE_ANALYTICS_ID = 'G-0000000000'
$env:TEST_PRODUCTION = '1'
$env:TEST_ANALYTICS_MODE = 'configured'
npm run build
npx playwright test analytics.spec.ts security-headers.spec.ts
$env:VITE_GOOGLE_ANALYTICS_ID = ''
$env:TEST_ANALYTICS_MODE = 'unconfigured'
npm run build
npx playwright test analytics.spec.ts --grep "disabled analytics builds"
Remove-Item Env:TEST_PRODUCTION
$env:VITE_GOOGLE_ANALYTICS_ID = 'G-0000000000'
$env:TEST_ANALYTICS_MODE = 'development'
npx playwright test analytics.spec.ts --grep "disabled analytics builds"
Remove-Item Env:VITE_GOOGLE_ANALYTICS_ID, Env:TEST_ANALYTICS_MODE
npm run build
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

Third-party actions are pinned to full commit SHAs (with the tag in a comment);
update the SHA and comment together when upgrading an action.
`.github/dependabot.yml` opens weekly grouped update PRs for npm packages and
these actions. The workflow also fails on high-severity production dependency
advisories (`npm audit`), has a 45-minute timeout, uploads Playwright reports and
traces as artifacts when a browser suite fails, and cancels superseded runs only
on non-`main` refs, so a newer push never interrupts a production deployment.

**Security headers:** `public/staticwebapp.config.json` is copied into `dist` and
makes Azure send a Content-Security-Policy, `X-Content-Type-Options: nosniff`,
a strict referrer policy and `frame-ancestors 'none'`. The policy allows only
this origin plus the Google Identity Services and Drive/UserInfo endpoints the
optional sync uses, and `data:`/`blob:` images for picture generation.
For configured usage analytics, the policy also permits Google's direct `gtag.js` and
non-advertising analytics collection/regional endpoints. It does not allow
arbitrary scripts, inline/eval scripts or Ads/DoubleClick endpoints. If you add
another external script, font, image or API, update the policy or the browser will
block it; `tests/browser/security-headers.spec.ts` applies these headers and fails
on any CSP violation. Other static hosts and `npm run preview` ignore this file,
so configure equivalent headers there yourself.

**Moving your map:** browser storage belongs to its origin. Export your data
from the old localhost/hosted address and import it at the Azure address to keep
your places; deploying the application does not transfer browser-local data.
Verify the workflow's deployment result and the Azure site's URL after publishing;
local builds alone do not confirm a live deployment.

## Structure

`src/main.ts` wires the shell, recovery, import/export, and counters;
`analytics.ts` initializes optional basic GA4 with privacy exclusions and safe
metadata; `address.ts` shares local-address classification with picture QR warnings;
`store.ts` owns validation and persistence; `geography.ts` loads bundled data;
`google-auth.ts` handles optional Google authorization, `google-drive.ts` the
immutable private snapshot protocol, and `sync.ts` / `sync-ui.ts` cloud
coordination and sidebar controls;
`map.ts` owns D3 rendering/navigation; `sidebar.ts` handles search/grouping;
`popover.ts` provides shared accessible status actions; `badge-catalog.ts`
shares validated lazy badge loading. `infographic.ts` derives the snapshot
model; `infographic-assets.ts` provides flags/QR, `infographic-artwork.ts` the
original collage/stickers, and `infographic-title.ts` local typography.
`infographic-renderer.ts` and `infographic-ui.ts` provide SVG-to-PNG composition
and the lazy preview dialog. `dom.ts` holds shared DOM helpers (unique IDs,
downloads); `theme.ts`, `projection-preference.ts` and `sidebar-visibility.ts`
own browser-local preferences; `projection.ts` provides shared projection
definitions/fitting; `sidebar-tabs.ts` the accessible tab strip; `statistics.ts` /
`statistics-ui.ts` the all-place Stats panel; `badges.ts` / `badges-ui.ts` the
formula evaluator and Badges panel; `scenery.ts` the decorative animation; and
`types.ts` shared types. Theme packages live in `src/themes`, CSS in
`src/styles`, reproducible geography scripts in `scripts`, and tests in `tests`.
