## UI Pro Max Search Results
**Domain:** style | **Query:** data-dense dashboard telemetry
**Source:** styles.csv | **Found:** 1 results

### Result 1
- **Style ID:** data-dense-dashboard
- **Style Category:** Data-Dense Dashboard
- **Aliases:** Data-Dense
- **Status:** active
- **Parent Style ID:**
- **Preferred Mode:** auto
- **Type:** BI/Analytics
- **Keywords:** Multiple charts/widgets, data tables, KPI cards, minimal padding, grid layout, space-efficient, maximum data visibility
- **Primary Colors:** Neutral primary (light grey/white #F5F5F5), data colors (blue/green/red), dark text #333333
- **Effects & Animation:** Hover tooltips, chart zoom on click, row highlighting on hover, smooth filter animations, data loading spinners
- **Best For:** Business intelligence dashboards, financial analytics, enterprise reporting, operational dashboards, data warehousing
- **Light Mode ✓:** supported
- **Dark Mode ✓:** supported
- **Performance:** cost:low|drivers:none
- **Accessibility:** risk:low|requires:contrast-text-4.5,keyboard,visible-focus,reduced-motion
- **Framework Compatibility:** recharts|chartjs|d3
- **Complexity:** Medium
- **AI Prompt Keywords:** Design a data-dense dashboard. Use: multiple chart widgets, KPI cards row, data tables with sorting, minimal padding (8-12px), efficient grid layout, filter sidebar, dense but readable typography, maximum information density.
- **CSS/Technical Keywords:** display: grid, grid-template-columns: repeat(12, 1fr), gap: 8px, padding: 12px, font-size: 12-14px, overflow: auto for tables, compact card design, sticky headers
- **Implementation Checklist:** ☐ Grid layout 12 columns, ☐ KPI cards responsive, ☐ Tables sortable, ☐ Filters functional, ☐ Loading states for data, ☐ Export functionality
- **Design System Variables:** --grid-gap: 8px, --card-padding: 12px, --font-size-small: 12px, --table-row-height: 36px, --sidebar-width: 240px, --header-height: 56px

## UI Pro Max Search Results
**Domain:** style | **Query:** minimalist analytical light
**Source:** styles.csv | **Found:** 0 results

No matches. This is not a match with an empty value -- the query did not hit the database. Retry with broader/different keywords before falling back to general defaults, and say explicitly that no database match was found if you do fall back.
**Closest known terms:** lights, minimalism, analytics, night
## UI Pro Max Search Results
**Domain:** style | **Query:** HUD instrument dashboard
**Source:** styles.csv | **Found:** 2 results

### Result 1
- **Style ID:** hud-sci-fi-fui
- **Style Category:** HUD / Sci-Fi FUI
- **Aliases:** HUD|FUI|Sci-Fi HUD|HUD/Sci-Fi FUI|Holographic / HUD|Holographic/HUD
- **Status:** active
- **Parent Style ID:**
- **Preferred Mode:** auto
- **Type:** General
- **Keywords:** Futuristic, technical, wireframe, neon, data, transparency, iron man, sci-fi, interface
- **Primary Colors:** Neon Cyan #00FFFF, Holographic Blue #0080FF, Alert Red #FF0000
- **Effects & Animation:** Glow effects, scanning animations, ticker text, blinking markers, fine line drawing
- **Best For:** Sci-fi games, space tech, cybersecurity, movie props, immersive dashboards
- **Light Mode ✓:** supported
- **Dark Mode ✓:** supported
- **Performance:** cost:moderate|drivers:animation,blur
- **Accessibility:** risk:high|requires:contrast-text-4.5,keyboard,visible-focus,reduced-motion
- **Framework Compatibility:** react|canvas
- **Complexity:** High
- **AI Prompt Keywords:** Design a futuristic HUD (Heads Up Display) or FUI. Use: thin lines (1px), neon cyan/blue on black, technical markers, decorative brackets, data visualization, monospaced tech fonts, glowing elements, transparency.
- **CSS/Technical Keywords:** border: 1px solid rgba(0,255,255,0.5), color: #00FFFF, background: transparent or rgba(0,0,0,0.8), font-family: monospace, text-shadow: 0 0 5px cyan
- **Implementation Checklist:** ☐ Fine lines 1px, ☐ Neon glow text/borders, ☐ Monospaced font, ☐ Dark/Transparent BG, ☐ Decorative tech markers, ☐ Holographic feel
- **Design System Variables:** --hud-color: #00FFFF, --bg-color: rgba(0,10,20,0.9), --line-width: 1px, --glow: 0 0 5px, --font: monospace

### Result 2
- **Style ID:** data-dense-dashboard
- **Style Category:** Data-Dense Dashboard
- **Aliases:** Data-Dense
- **Status:** active
- **Parent Style ID:**
- **Preferred Mode:** auto
- **Type:** BI/Analytics
- **Keywords:** Multiple charts/widgets, data tables, KPI cards, minimal padding, grid layout, space-efficient, maximum data visibility
- **Primary Colors:** Neutral primary (light grey/white #F5F5F5), data colors (blue/green/red), dark text #333333
- **Effects & Animation:** Hover tooltips, chart zoom on click, row highlighting on hover, smooth filter animations, data loading spinners
- **Best For:** Business intelligence dashboards, financial analytics, enterprise reporting, operational dashboards, data warehousing
- **Light Mode ✓:** supported
- **Dark Mode ✓:** supported
- **Performance:** cost:low|drivers:none
- **Accessibility:** risk:low|requires:contrast-text-4.5,keyboard,visible-focus,reduced-motion
- **Framework Compatibility:** recharts|chartjs|d3
- **Complexity:** Medium
- **AI Prompt Keywords:** Design a data-dense dashboard. Use: multiple chart widgets, KPI cards row, data tables with sorting, minimal padding (8-12px), efficient grid layout, filter sidebar, dense but readable typography, maximum information density.
- **CSS/Technical Keywords:** display: grid, grid-template-columns: repeat(12, 1fr), gap: 8px, padding: 12px, font-size: 12-14px, overflow: auto for tables, compact card design, sticky headers
- **Implementation Checklist:** ☐ Grid layout 12 columns, ☐ KPI cards responsive, ☐ Tables sortable, ☐ Filters functional, ☐ Loading states for data, ☐ Export functionality
- **Design System Variables:** --grid-gap: 8px, --card-padding: 12px, --font-size-small: 12px, --table-row-height: 36px, --sidebar-width: 240px, --header-height: 56px

## UI Pro Max Search Results
**Domain:** chart | **Query:** chart axis labels readable
**Source:** charts.csv | **Found:** 2 results

### Result 1
- **Data Type:** 3D Spatial Data
- **Keywords:** 3d, spatial, immersive, terrain, molecular, volumetric, point-cloud, accessible chart, keyboard accessible chart
- **Best Chart Type:** 3D Scatter / Surface Plot
- **Secondary Options:** Volumetric Rendering, Point Cloud
- **When to Use:** Scientific/engineering context where Z-axis carries essential info not expressible in 2D
- **When NOT to Use:** 2D projection conveys the same insight; mobile context; accessibility-required environments; standard business dashboards
- **Data Volume Threshold:** WebGL required. Deck.gl: up to 1M points. Three.js: LOD required beyond 50,000 pts
- **Color Guidance:** Depth cues: lighting and shading. Z-axis: color gradient (cool → warm). Transparent overlapping: opacity 0.4
- **Accessibility Grade:** deprecated: use Accessibility Risk
- **Accessibility Risk:** risk:high
- **Accessibility Notes:** Use labels, shapes, and depth-independent cues; color and 3D position cannot be the only carriers of meaning.
- **A11y Fallback:** Mandatory 2D projection, data table, and spatial summary. Keyboard: rotate/pan buttons and +/- zoom controls replace pointer/VR manipulation; Reset returns the camera.
- **Library Recommendation:** Three.js, Deck.gl, Plotly 3D
- **Interactive Level:** Rotate + Zoom + VR

### Result 2
- **Data Type:** Trend Over Time
- **Keywords:** trend, time-series, line, growth, timeline, progress, accessible chart, keyboard accessible chart
- **Best Chart Type:** Line Chart
- **Secondary Options:** Area Chart, Smooth Area
- **When to Use:** Data has a time axis; user needs to observe rise/fall trends or rate of change over a continuous period
- **When NOT to Use:** Fewer than 4 data points (use stat card); more than 6 series (visual noise); no time dimension exists
- **Data Volume Threshold:** <1000 pts: SVG; ≥1000 pts: Canvas + downsampling; >10000: aggregate to intervals
- **Color Guidance:** Primary: #0080FF. Multiple series: distinct colors + distinct line styles. Fill: 20% opacity
- **Accessibility Grade:** deprecated: use Accessibility Risk
- **Accessibility Risk:** risk:low
- **Accessibility Notes:** Use solid, dashed, and dotted line styles plus direct series labels; never distinguish series by hue alone.
- **A11y Fallback:** Visible data table plus concise trend summary. Keyboard: focus reveals hover values; +/- buttons zoom; Reset restores the full range.
- **Library Recommendation:** Chart.js, Recharts, ApexCharts
- **Interactive Level:** Hover + Zoom

## UI Pro Max Search Results
**Domain:** style | **Query:** minimalism analytics
**Source:** styles.csv | **Found:** 1 results

### Result 1
- **Style ID:** minimalism-and-swiss-style
- **Style Category:** Minimalism & Swiss Style
- **Aliases:** Minimal|Minimalism|Minimalism (Frame)
- **Status:** active
- **Parent Style ID:**
- **Preferred Mode:** auto
- **Type:** General
- **Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential
- **Primary Colors:** Monochromatic, Black #000000, White #FFFFFF
- **Effects & Animation:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading
- **Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools
- **Light Mode ✓:** supported
- **Dark Mode ✓:** supported
- **Performance:** cost:low|drivers:none
- **Accessibility:** risk:low|requires:contrast-text-4.5,keyboard,visible-focus,reduced-motion
- **Framework Compatibility:** tailwind|bootstrap|mui
- **Complexity:** Low
- **AI Prompt Keywords:** Design a minimalist landing page. Use: white space, geometric layouts, sans-serif fonts, high contrast, grid-based structure, essential elements only. Avoid shadows and gradients. Focus on clarity and functionality.
- **CSS/Technical Keywords:** display: grid, gap: 2rem, font-family: sans-serif, color: #000 or #FFF, max-width: 1200px, clean borders, no box-shadow unless necessary
- **Implementation Checklist:** ☐ Grid-based layout 12-16 columns, ☐ Typography hierarchy clear, ☐ No unnecessary decorations, ☐ text contrast measured against the chosen project target, ☐ Mobile responsive grid
- **Design System Variables:** --spacing: 2rem, --border-radius: 0px, --font-weight: 400-700, --shadow: none, --accent-color: single primary only
