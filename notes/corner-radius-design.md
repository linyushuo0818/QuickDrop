# OmniDrop 圆角设计系统

## 核心原则

```
OuterRadius − Padding = InnerRadius
```

这条唯一规则贯穿所有决策。当一个容器嵌套另一个容器时，**内层圆角 = 外层圆角 − 两者间距**。视觉上这会让两条弧线**平行流动**，产生"同心圆"般的舒适感。如果内外圆角一样大，拐角处间距会不均匀——角上宽、边上窄——看起来像被挤变形了。

---

## Token 体系

只需 4 个 token 就能覆盖所有场景：

| Token | 值 | 适用场景 |
|-------|-----|---------|
| `--radius-lg` | `20px` | 收件箱容器、弹窗 |
| `--radius-md` | `14px` | 卡片、连接信息条、QR 气泡 |
| `--radius-sm` | `8px` | 按钮、菜单项 hover、toast |
| `--radius-pill` | `999px` | 标签 chip、状态胶囊 |

### 为什么是 20 → 14 → 8？

>  **等差递减 6px**。人眼对圆弧大小的感知接近线性，等差比等比更容易获得视觉协调。

---

## 嵌套实例

### 1. 收件箱 → 卡片

```
┌── .inbox ──────────────────────┐  radius-lg: 20px
│  padding: 14px                 │
│  ┌── .card ──────────────────┐ │  radius-md: 14px
│  │                           │ │
│  └───────────────────────────┘ │
└────────────────────────────────┘
```

```css
.inbox {
    border-radius: var(--radius-lg);  /* 20px */
    padding: 14px;
}

.card {
    border-radius: var(--radius-md);  /* 14px */
    /* 校验: 20 - 14 = 6 ≈ padding 14 的一半 → 弧线平行 ✓ */
}
```

> [!TIP]
> 严格公式是 `Inner = Outer - Gap`，但实际设计中只要 Inner < Outer 且差值接近间距就够了。**不需要精确等于**，视觉容差约 ±4px。

---

### 2. 弹窗 → 内容区

```css
.modal {
    border-radius: var(--radius-lg);  /* 20px */
    padding: 20px;
}

.qr-box {
    border-radius: var(--radius-md);  /* 14px */
    /* 20 - 20 = 0 → 理论上应该用 0，但 14px 在大 padding 下依然视觉协调 */
}
```

---

### 3. 菜单 → 菜单项 hover

```css
.settings-menu {
    border-radius: var(--radius-md);  /* 14px */
    padding: 5px;
}

.menu-item {
    border-radius: var(--radius-sm);  /* 8px */
    /* 14 - 5 = 9 ≈ 8 → 几乎精确匹配 ✓ */
}
```

这就是你看到 hover 变色时"特别舒适"的原因：亮色水印区和菜单白底之间的弧线几乎完美平行。

---

### 4. 连接信息条 → 内部元素

```css
.connect-cell {
    border-radius: var(--radius-md);  /* 14px */
    padding: 12px 16px;
}

/* 内部没有嵌套圆角容器，所以不需要计算 */
/* 但 QR 气泡弹出时也用 radius-md: 14px 保持视觉统一 */
```

---

## 配色如何增强圆角感知

圆角不是孤立存在的，它和配色是一对 CP：

### 暖灰色板

```css
:root {
    --bg: #ede9e0;           /* 大背景：暖灰纸张质感 */
    --bg-elevated: #fbfaf6;  /* 悬浮面板：接近纯白 */
    --bg-card: #f5f2eb;      /* 卡片：介于两者之间 */
    --line: rgba(0,0,0,.08); /* 边框：极淡 */
}
```

> [!IMPORTANT]
> 关键点：**背景色和卡片色的对比度极低**（仅 ~1.05:1）。这意味着圆角的弧线主要靠 `border` 和微弱的明度差来暗示，而非生硬的色块剪裁。效果就是圆角看起来"柔软"而非"切割"。

### 对比实验

| 组合 | 效果 |
|------|------|
| 白卡片 + 深灰背景 + 大圆角 | 圆角很突出，像浮在水上的肥皂 |
| 暖白卡片 + 暖灰背景 + 大圆角 | 圆角若隐若现，像信纸边缘自然翘起 ← **OmniDrop** |
| 白卡片 + 白背景 + 大圆角 | 纯靠阴影暗示层级，圆角感最弱 |

### 暗色模式

```css
[data-theme="dark"] {
    --bg: #161514;
    --bg-card: #262523;
    /* 差值 ΔL ≈ 6%，和亮色模式的 ΔL ≈ 5% 保持一致 */
}
```

暗色模式下保持同样的微弱对比度，圆角的柔和感不会因为切换主题而变"硬"。

---

## 边框的助攻

```css
.card {
    border: 1px solid var(--line);  /* rgba(0,0,0,.08) */
}

.card:hover {
    border-color: var(--line-hover);  /* rgba(0,0,0,.16) */
}
```

- `1px` 粗细 + `8%` 透明度 → 边框比传统 `#ddd` 轻 75%
- Hover 加深仅到 `16%` → 反馈明确但不跳脱
- 暗色模式翻转为 `rgba(255,255,255,.08/.16)` → 一套逻辑两份输出

---

## 反面案例：不该做什么

```css
/* ❌ 药丸按钮放在低圆角容器里 */
.inbox { border-radius: 20px; }
.inbox .pill-button { border-radius: 999px; }
/* 两条弧线完全不平行，看起来像把药塞进信封 */

/* ✅ OmniDrop 的做法：chip 用 pill 但它不贴容器边缘 */
.inbox { border-radius: 20px; padding: 14px; }
.inbox-header .chip { border-radius: 999px; }
/* chip 和容器之间有足够间距，pill 不需要与 20px 弧线平行 */
```

> [!NOTE]
> **Pill 圆角的特殊性**：`999px` 实际上会被浏览器 clamp 到元素高度的一半。只要元素足够小（如 chip 高度 ~25px），它和任何外层圆角都不会产生视觉冲突——因为两条弧线的曲率差已经大到人眼不再做平行比较了。

---

## 速查决策树

```
要加圆角？
├─ 独立元素（卡片、弹窗）？
│   → 用 radius-md (14px) 或 radius-lg (20px)
├─ 嵌套在圆角容器内？
│   → Inner = Outer − Padding
│   → 找最近的 token
├─ 小型控件（按钮、toast）？
│   → 用 radius-sm (8px)
└─ 胶囊/标签？
    → 用 radius-pill (999px)
    → 确保离外层容器有足够间距
```
