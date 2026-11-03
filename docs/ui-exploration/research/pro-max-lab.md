## Design System: TTT Precision Lab

### Pattern
- **Name:** Newsletter / Content First
- **Conversion Focus:** Keep the form to the fields actually required and link to a sample issue. Show a subscriber count only when it is current, verified, and dated; otherwise use qualitative social proof.
- **CTA Placement:** Hero inline form + Sticky header form
- **Color Strategy:** Minimalist. Paper-like background. Text focus. Accent color for Subscribe.
- **Sections:** Hero (Value Prop + Form) > Recent Issues/Archives > Social Proof (Subscriber count) > About Author

### Style
- **Name:** Swiss Modernism 2.0
- **Mode Support:** Light supported | Dark supported
- **Keywords:** Grid system, Helvetica, modular, asymmetric, international style, rational, clean, mathematical spacing
- **Best For:** Corporate sites, architecture, editorial, SaaS, museums, professional services, documentation
- **Performance:** cost:low|drivers:none | **Accessibility:** risk:low|requires:contrast-text-4.5,keyboard,visible-focus,reduced-motion

### Colors
| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E3A5F` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#334155` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--color-on-secondary` |
| Accent/CTA | `#B45309` | `--color-accent` |
| On Accent/CTA | `#FFFFFF` | `--color-on-accent` |
| Background | `#F8FAFC` | `--color-background` |
| Foreground | `#0F172A` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#0F172A` | `--color-card-foreground` |
| Muted | `#E9EEF5` | `--color-muted` |
| Muted Foreground | `#475569` | `--color-muted-foreground` |
| Border | `#CBD5E1` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#1E3A5F` | `--color-ring` |

*Notes: Scholarly navy + citation gold + serif accent*

### Typography
- **Heading:** Crimson Pro
- **Body:** Atkinson Hyperlegible
- **Mood:** academic, research, scholarly, accessible, readable, educational
- **Best For:** Universities, research papers, academic journals, educational
- **Google Fonts:** https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Crimson+Pro:wght@400;500;600;700&display=swap
- **CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Crimson+Pro:wght@400;500;600;700&display=swap');
```

### Key Effects
display: grid, grid-template-columns: repeat(12 1fr), gap: 1rem, mathematical ratios, clear hierarchy

### Avoid (Anti-patterns)
- Low contrast
- Visual clutter
- motion-heavy chrome

### Pre-Delivery Checklist
- [ ] No emojis as icons (use SVG: Heroicons/Lucide)
- [ ] cursor-pointer on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard nav
- [ ] prefers-reduced-motion respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
