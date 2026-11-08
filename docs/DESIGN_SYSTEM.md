# NoFollow Web — Luxury Dark SaaS Design System Specification

## 1. Design Tokens & Palette

Inspired by modern luxury fintech and developer platforms (Stripe, Linear, Raycast), this design system establishes a high-contrast, deeply focused dark workspace with subtle depth and precision typography.

### 1.1 Color Tokens

| Token Name | Hex Value | Semantic Purpose |
|---|---|---|
| `--bg-app` | `#0B0D12` | Deep root application canvas |
| `--bg-sidebar` | `#10131A` | Fixed navigation bar canvas |
| `--bg-header` | `#0E1118` | Sticky header / topbar canvas |
| `--bg-card` | `#151922` | Standard card / container surface |
| `--bg-card-elevated`| `#191E29` | Elevated card / modal / dropdown surface |
| `--border-primary` | `#252B38` | Strong container borders, dividers |
| `--border-secondary`| `#202633` | Table row borders, subtle inner edges |
| `--text-primary` | `#F1F3F8` | High-contrast headings and primary content |
| `--text-secondary` | `#A0A8BA` | Descriptions, labels, secondary metadata |
| `--text-muted` | `#737D92` | Timestamp, inactive icons, placeholders |
| `--accent` | `#8175F5` | Primary action color, active indicators |
| `--accent-hover` | `#968BFF` | Hover state for accent buttons |
| `--accent-subtle` | `rgba(129, 117, 245, 0.12)` | Active chip backgrounds, selection tint |
| `--success` | `#35C994` | Verified, authenticated, unfollowed, complete |
| `--warning` | `#E8B45C` | Paused, needs review, skipped, cautionary note |
| `--danger` | `#E66F79` | Failed, action blocked, security challenge, stop |
| `--info` | `#65A9ED` | Already unfollowed, already cancelled, informational |

---

## 2. Typography Hierarchy

Primary Font Family: `Inter`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `Roboto`, `sans-serif`  
Monospace Font Family: `"JetBrains Mono"`, `"Cascadia Code"`, `"SF Mono"`, `Consolas`, `monospace`

| Role | Font Size | Font Weight | Line Height | Letter Spacing |
|---|---|---|---|---|
| **Page Title** | `26px` | `600 (SemiBold)` | `1.25` | `-0.025em` |
| **Section Title**| `18px` | `600 (SemiBold)` | `1.3` | `-0.015em` |
| **Card Title** | `14px` | `600 (SemiBold)` | `1.4` | `-0.01em` |
| **KPI Value** | `28px` | `700 (Bold)` | `1.1` | `-0.03em (tabular-nums)` |
| **Body Content** | `13.5px` | `400 (Regular)` | `1.5` | `normal` |
| **Table Cell** | `13px` | `450 (Normal)` | `1.4` | `normal` |
| **Label / Meta** | `11.5px` | `500 (Medium)` | `1.3` | `+0.02em` |
| **Badge / Tag** | `11px` | `600 (SemiBold)` | `1.2` | `+0.03em (uppercase/capital)` |

---

## 3. Spacing, Elevation & Shapes

- **Base Spacing Grid**: 4px base (`4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `48px`).
- **Corner Radii**:
  - Cards & Containers: `10px`
  - Buttons & Inputs: `7px`
  - Badges & Chips: `9999px` (full pill)
  - Modals: `12px`
- **Elevation Shadows**:
  - Card Shadow: `0 1px 3px rgba(0, 0, 0, 0.4), 0 4px 12px rgba(0, 0, 0, 0.25)`
  - Elevated Modal: `0 12px 36px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05)`
  - Active Button Glow: `0 2px 8px rgba(129, 117, 245, 0.35)`

---

## 4. Component Standards

### 4.1 Buttons
- **Primary**: Solid `#8175F5` with subtle top highlight and active transform `translateY(1px)`.
- **Secondary**: Elevated surface `#191E29` with `#252B38` border and light text.
- **Danger**: Subdued red tint `rgba(230, 111, 121, 0.12)` with `#E66F79` border and text.
- **Ghost**: Transparent with subtle hover highlight `rgba(255, 255, 255, 0.05)`.

### 4.2 KPI Metric Cards
- Container: `#151922` with `#252B38` hairline border and subtle gradient hover effect.
- Header: Small uppercase/medium label + icon.
- Value: Large 28px bold tabular numbers with optional colored trend indicator.

### 4.3 Tables
- Container: `#151922` wrapped in `#252B38` border.
- Header (`th`): Sticky, `#191E29` surface, 11.5px uppercase, letter-spacing `0.06em`, color `#737D92`.
- Rows (`tr`): Subtle bottom border `#202633`, hover highlight `rgba(255, 255, 255, 0.03)`.
- Checkboxes: Custom styled with `#8175F5` accent.

### 4.4 Status Badges
- Unfollowed / Done: Background `rgba(53, 201, 148, 0.12)`, text `#35C994`.
- Already Done / Info: Background `rgba(101, 169, 237, 0.12)`, text `#65A9ED`.
- In Progress / Pending: Background `rgba(129, 117, 245, 0.12)`, text `#8175F5`.
- Warning / Needs Review: Background `rgba(232, 180, 92, 0.12)`, text `#E8B45C`.
- Failed / Blocked: Background `rgba(230, 111, 121, 0.12)`, text `#E66F79`.
