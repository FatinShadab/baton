"""
Generate the Baton Pitch Deck PPTX.
Widescreen 16:9, modern developer-focused dark-mode presentation.
"""

import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# Initialize Presentation
prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)
blank_layout = prs.slide_layouts[6]  # Blank slide

# Color Palette Constants
BG_COLOR = RGBColor(15, 23, 42)        # #0F172A Dark Slate
CARD_BG = RGBColor(30, 41, 59)         # #1E293B Slate 800
CARD_BORDER = RGBColor(51, 65, 85)     # #334155 Slate 700
CARD_BG_ALT = RGBColor(24, 33, 47)     # #18212F
CYAN = RGBColor(56, 189, 248)          # #38BDF8 Sky 400
INDIGO = RGBColor(129, 140, 248)       # #818CF8 Indigo 400
EMERALD = RGBColor(52, 211, 153)       # #34D399 Emerald 400
AMBER = RGBColor(251, 191, 36)         # #FBBF24 Amber 400
ROSE = RGBColor(248, 113, 113)         # #F87171 Rose 400
PURPLE = RGBColor(192, 132, 252)       # #C084FC Purple 400
WHITE = RGBColor(255, 255, 255)        # Pure White
TEXT_LIGHT = RGBColor(241, 245, 249)   # Slate 100
TEXT_MUTED = RGBColor(148, 163, 184)   # Slate 400
TEXT_BODY = RGBColor(203, 213, 225)    # Slate 300

FONT_HEADING = "Segoe UI"
FONT_BODY = "Segoe UI"
FONT_MONO = "Consolas"

def apply_background(slide):
    """Fill slide with dark slate background."""
    bg_shape = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height
    )
    bg_shape.fill.solid()
    bg_shape.fill.fore_color.rgb = BG_COLOR
    bg_shape.line.fill.background()
    return bg_shape

def add_header(slide, kicker: str, title: str, subtitle: str = ""):
    """Add standard slide header with kicker pill, title, and subtitle."""
    # Kicker / Badge
    kicker_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.45), Inches(11.7), Inches(0.4))
    tf_k = kicker_box.text_frame
    tf_k.word_wrap = True
    tf_k.margin_left = tf_k.margin_top = tf_k.margin_right = tf_k.margin_bottom = 0
    p_k = tf_k.paragraphs[0]
    p_k.text = kicker.upper()
    p_k.font.name = FONT_HEADING
    p_k.font.size = Pt(11)
    p_k.font.bold = True
    p_k.font.color.rgb = CYAN

    # Title & Subtitle in one box to prevent overlap
    title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.8), Inches(11.7), Inches(1.1))
    tf_t = title_box.text_frame
    tf_t.word_wrap = True
    tf_t.margin_left = tf_t.margin_top = tf_t.margin_right = tf_t.margin_bottom = 0
    p_t = tf_t.paragraphs[0]
    p_t.text = title
    p_t.font.name = FONT_HEADING
    p_t.font.size = Pt(26)
    p_t.font.bold = True
    p_t.font.color.rgb = WHITE

    if subtitle:
        p_s = tf_t.add_paragraph()
        p_s.text = subtitle
        p_s.font.name = FONT_BODY
        p_s.font.size = Pt(13)
        p_s.font.color.rgb = TEXT_MUTED
        p_s.space_before = Pt(4)

def add_card(slide, left, top, width, height, bg_color=CARD_BG, border_color=CARD_BORDER):
    """Add a rounded styled card background."""
    card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
    card.fill.solid()
    card.fill.fore_color.rgb = bg_color
    if border_color:
        card.line.color.rgb = border_color
        card.line.width = Pt(1.2)
    else:
        card.line.fill.background()
    return card

def add_footer(slide, current_slide: int, total_slides: int = 10):
    """Add discreet footer to slide."""
    footer_box = slide.shapes.add_textbox(Inches(0.8), Inches(7.0), Inches(11.7), Inches(0.3))
    tf = footer_box.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0
    p = tf.paragraphs[0]
    p.text = f"BATON  •  The AI Relay for VS Code              {current_slide} / {total_slides}"
    p.font.name = FONT_BODY
    p.font.size = Pt(9)
    p.font.color.rgb = TEXT_MUTED


# ==============================================================================
# SLIDE 1: TITLE & HOOK
# ==============================================================================
def make_slide_1():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)

    # Decorative top glow accent
    glow = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.2), Inches(1.8), Inches(0.06))
    glow.fill.solid()
    glow.fill.fore_color.rgb = CYAN
    glow.line.fill.background()

    # Title & Tagline Box
    tb = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(11.7), Inches(3.2))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

    p_badge = tf.paragraphs[0]
    p_badge.text = "VS CODE EXTENSION  •  MULTI-AGENT ORCHESTRATION"
    p_badge.font.name = FONT_HEADING
    p_badge.font.size = Pt(12)
    p_badge.font.bold = True
    p_badge.font.color.rgb = CYAN
    p_badge.space_after = Pt(12)

    p_title = tf.add_paragraph()
    p_title.text = "BATON"
    p_title.font.name = FONT_HEADING
    p_title.font.size = Pt(64)
    p_title.font.bold = True
    p_title.font.color.rgb = WHITE
    p_title.space_after = Pt(8)

    p_sub = tf.add_paragraph()
    p_sub.text = "Pass the prompt. Spare the quota. Ship the code."
    p_sub.font.name = FONT_HEADING
    p_sub.font.size = Pt(22)
    p_sub.font.bold = True
    p_sub.font.color.rgb = INDIGO
    p_sub.space_after = Pt(14)

    p_lead = tf.add_paragraph()
    p_lead.text = "You don't need an expensive $200/mo subscription to build with frontier speed.\nYou need an intelligent traffic controller for the AI tools you already own."
    p_lead.font.name = FONT_BODY
    p_lead.font.size = Pt(15)
    p_lead.font.color.rgb = TEXT_LIGHT

    # Bottom 3 Feature Pills
    pills = [
        ("60-30-10 Routing", "Cascading Gemma 4, Ollama Cloud & local rules", CYAN),
        ("Sanitized Context", "Automatic stripping of .env, keys, and secrets", EMERALD),
        ("Universal Memory & MCP", "Persistent MiniSearch + native read-only MCP server", PURPLE)
    ]
    card_w = Inches(3.64)
    card_h = Inches(1.4)
    for i, (title, desc, accent) in enumerate(pills):
        x = Inches(0.8) + i * Inches(4.0)
        y = Inches(5.1)
        add_card(slide, x, y, card_w, card_h, CARD_BG, CARD_BORDER)

        # Accent bar inside card
        acc = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, Inches(0.08), card_h)
        acc.fill.solid()
        acc.fill.fore_color.rgb = accent
        acc.line.fill.background()

        tb_c = slide.shapes.add_textbox(x + Inches(0.25), y + Inches(0.2), card_w - Inches(0.4), card_h - Inches(0.3))
        tf_c = tb_c.text_frame
        tf_c.word_wrap = True
        tf_c.margin_left = tf_c.margin_top = tf_c.margin_right = tf_c.margin_bottom = 0
        p1 = tf_c.paragraphs[0]
        p1.text = title
        p1.font.name = FONT_HEADING
        p1.font.size = Pt(13)
        p1.font.bold = True
        p1.font.color.rgb = WHITE
        p1.space_after = Pt(4)

        p2 = tf_c.add_paragraph()
        p2.text = desc
        p2.font.name = FONT_BODY
        p2.font.size = Pt(10.5)
        p2.font.color.rgb = TEXT_MUTED

    add_footer(slide, 1)


# ==============================================================================
# SLIDE 2: THE PROBLEM (THE DUAL DILEMMA)
# ==============================================================================
def make_slide_2():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "The Developer Dilemma", "The $200 Subscription Trap vs. The 5-Hour Wall",
               "Developers are caught between exorbitant fees and productivity-killing rate limits.")

    card_w = Inches(5.65)
    card_h = Inches(4.0)

    # Left Card: Bootstrapper / Budget Trap
    x_left = Inches(0.8)
    y_card = Inches(2.1)
    add_card(slide, x_left, y_card, card_w, card_h, CARD_BG, ROSE)

    tb_l = slide.shapes.add_textbox(x_left + Inches(0.4), y_card + Inches(0.35), card_w - Inches(0.8), card_h - Inches(0.6))
    tf_l = tb_l.text_frame
    tf_l.word_wrap = True
    tf_l.margin_left = tf_l.margin_top = tf_l.margin_right = tf_l.margin_bottom = 0

    p_badge = tf_l.paragraphs[0]
    p_badge.text = "THE BOOTSTRAPPER & INDIE DILEMMA"
    p_badge.font.name = FONT_HEADING
    p_badge.font.size = Pt(11)
    p_badge.font.bold = True
    p_badge.font.color.rgb = ROSE
    p_badge.space_after = Pt(8)

    p_title = tf_l.add_paragraph()
    p_title.text = "Can't Justify $200/mo Subscriptions"
    p_title.font.name = FONT_HEADING
    p_title.font.size = Pt(18)
    p_title.font.bold = True
    p_title.font.color.rgb = WHITE
    p_title.space_after = Pt(14)

    points_l = [
        "Paying $20–$200/mo across multiple AI tools quickly becomes unaffordable for solo builders, students, and indie developers.",
        "Frontier subscriptions bundle heavy reasoning models that are massive overkill for ordinary syntax checks and formatting.",
        "Fear of wasting tokens leads to hesitation and manual, sluggish coding workflows."
    ]
    for pt in points_l:
        p = tf_l.add_paragraph()
        p.text = f"•  {pt}"
        p.font.name = FONT_BODY
        p.font.size = Pt(12)
        p.font.color.rgb = TEXT_BODY
        p.space_after = Pt(10)

    # Right Card: Pro User Rate Limit Wall
    x_right = Inches(6.85)
    add_card(slide, x_right, y_card, card_w, card_h, CARD_BG, AMBER)

    tb_r = slide.shapes.add_textbox(x_right + Inches(0.4), y_card + Inches(0.35), card_w - Inches(0.8), card_h - Inches(0.6))
    tf_r = tb_r.text_frame
    tf_r.word_wrap = True
    tf_r.margin_left = tf_r.margin_top = tf_r.margin_right = tf_r.margin_bottom = 0

    p_badge_r = tf_r.paragraphs[0]
    p_badge_r.text = "THE POWER USER CEILING"
    p_badge_r.font.name = FONT_HEADING
    p_badge_r.font.size = Pt(11)
    p_badge_r.font.bold = True
    p_badge_r.font.color.rgb = AMBER
    p_badge_r.space_after = Pt(8)

    p_title_r = tf_r.add_paragraph()
    p_title_r.text = "Frustrated by the 5-Hour Rate Limit Wall"
    p_title_r.font.name = FONT_HEADING
    p_title_r.font.size = Pt(18)
    p_title_r.font.bold = True
    p_title_r.font.color.rgb = WHITE
    p_title_r.space_after = Pt(14)

    points_r = [
        "Even paying subscribers frequently hit 'Usage limit reached. Try again in 5 hours' right in the middle of a flow state.",
        "Valuable frontier quotas are squandered on simple regex, date formatting, and boilerplate tasks.",
        "Once locked out, productivity drops to zero while deadlines tick away."
    ]
    for pt in points_r:
        p = tf_r.add_paragraph()
        p.text = f"•  {pt}"
        p.font.name = FONT_BODY
        p.font.size = Pt(12)
        p.font.color.rgb = TEXT_BODY
        p.space_after = Pt(10)

    # Bottom Summary Callout
    bot_box = slide.shapes.add_textbox(Inches(0.8), Inches(6.3), Inches(11.7), Inches(0.5))
    tf_b = bot_box.text_frame
    tf_b.word_wrap = True
    tf_b.margin_left = tf_b.margin_top = tf_b.margin_right = tf_b.margin_bottom = 0
    p_bot = tf_b.paragraphs[0]
    p_bot.text = "The Paradox: Developers are either priced out of frontier AI, or locked out of it when they need it most."
    p_bot.font.name = FONT_HEADING
    p_bot.font.size = Pt(13)
    p_bot.font.bold = True
    p_bot.font.color.rgb = CYAN
    p_bot.alignment = PP_ALIGN.CENTER

    add_footer(slide, 2)


# ==============================================================================
# SLIDE 3: THE UNTAPPED ARSENAL
# ==============================================================================
def make_slide_3():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "The Agent Landscape", "You Already Have an Army of Agents. You're Just Fighting Them.",
               "Developers already have access to vast AI capabilities across web, IDEs, and local tools.")

    col_w = Inches(3.64)
    col_h = Inches(4.3)
    cols = [
        ("FREE WEB POWERHOUSES", CYAN, [
            ("ChatGPT (GPT-4o Free)", "Capable general reasoning & quick planning without credit card barriers."),
            ("Claude.ai Free Tier", "High-clarity code explanation and architectural guidance."),
            ("Gemini 2.5 Flash / Pro", "Massive context window with instant web-tier responses.")
        ]),
        ("INSTALLED IDE ASSISTANTS", INDIGO, [
            ("Google Antigravity", "Native agentic workflows, IDE context awareness, and sidecar tools."),
            ("GitHub Copilot", "Fast inline completions and editor-integrated chat."),
            ("Codex CLI & Muse", "Terminal-native script execution and autonomous coding agents.")
        ]),
        ("FAST & LOCAL EDGE MODELS", EMERALD, [
            ("Google AI Studio (Gemma 4)", "Ultra-fast, zero-cost micro-decisions via high-speed API."),
            ("Ollama Cloud / Local", "Sub-second open weights running on local hardware or edge."),
            ("Deterministic Rules", "Instant regex and pattern matching with 0 latency and 0 tokens.")
        ])
    ]

    for i, (col_title, accent, items) in enumerate(cols):
        x = Inches(0.8) + i * Inches(4.0)
        y = Inches(2.1)
        add_card(slide, x, y, col_w, col_h, CARD_BG, CARD_BORDER)

        # Top accent bar
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, col_w, Inches(0.06))
        bar.fill.solid()
        bar.fill.fore_color.rgb = accent
        bar.line.fill.background()

        tb = slide.shapes.add_textbox(x + Inches(0.3), y + Inches(0.25), col_w - Inches(0.6), col_h - Inches(0.5))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        p_t = tf.paragraphs[0]
        p_t.text = col_title
        p_t.font.name = FONT_HEADING
        p_t.font.size = Pt(11)
        p_t.font.bold = True
        p_t.font.color.rgb = accent
        p_t.space_after = Pt(14)

        for name, desc in items:
            p_n = tf.add_paragraph()
            p_n.text = f"▸ {name}"
            p_n.font.name = FONT_HEADING
            p_n.font.size = Pt(12)
            p_n.font.bold = True
            p_n.font.color.rgb = WHITE
            p_n.space_after = Pt(2)

            p_d = tf.add_paragraph()
            p_d.text = desc
            p_d.font.name = FONT_BODY
            p_d.font.size = Pt(10.5)
            p_d.font.color.rgb = TEXT_BODY
            p_d.space_after = Pt(12)

    # Footer callout
    bot = slide.shapes.add_textbox(Inches(0.8), Inches(6.55), Inches(11.7), Inches(0.4))
    tf_b = bot.text_frame
    tf_b.word_wrap = True
    tf_b.margin_left = tf_b.margin_top = tf_b.margin_right = tf_b.margin_bottom = 0
    p = tf_b.paragraphs[0]
    p.text = "The Irony: Developers possess abundant compute, but switching between tools feels like carrying water in a leaky bucket."
    p.font.name = FONT_BODY
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = TEXT_LIGHT
    p.alignment = PP_ALIGN.CENTER

    add_footer(slide, 3)


# ==============================================================================
# SLIDE 4: THE 60-30-10 RULE
# ==============================================================================
def make_slide_4():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "AI Architecture Framework", "The 60-30-10 Rule of Model Compute Allocation",
               "Leading AI engineering principles dictate matching model capability directly to task complexity.")

    tiers = [
        ("60%", "ROUTINE & BOILERPLATE TASKS", CYAN, [
            "Task Types: Formatting, regex, basic extraction, summaries, simple classification, docstrings, test scaffolding.",
            "Target Engine: Fast, ultra-low cost / small models (Gemma 4, Ollama, local weights, or rule-based engines).",
            "Business Impact: 0 quota burn, sub-second latency, near-zero compute expense."
        ]),
        ("30%", "MODERATELY COMPLEX LOGIC", INDIGO, [
            "Task Types: Component refactoring, drafting implementation plans, API consolidation, bug diagnosis.",
            "Target Engine: Mid-tier models and web-tier chat interfaces (Gemini 2.5 Flash, ChatGPT-4o web).",
            "Business Impact: Solves 90% of architectural legwork without consuming paid enterprise token budgets."
        ]),
        ("10%", "HIGH-IMPACT FRONTIER DECISIONS", PURPLE, [
            "Task Types: Deep algorithmic reasoning, critical distributed edge cases, security audits, schema migrations.",
            "Target Engine: The most capable frontier models (Claude 3.7 Sonnet, OpenAI o3, Codex CLI).",
            "Business Impact: Quota is 100% preserved so frontier power is always ready when disaster strikes."
        ])
    ]

    card_w = Inches(3.64)
    card_h = Inches(4.3)

    for i, (pct, title, accent, points) in enumerate(tiers):
        x = Inches(0.8) + i * Inches(4.0)
        y = Inches(2.1)
        add_card(slide, x, y, card_w, card_h, CARD_BG, CARD_BORDER)

        # Huge percentage badge
        tb_pct = slide.shapes.add_textbox(x + Inches(0.3), y + Inches(0.2), card_w - Inches(0.6), Inches(0.8))
        tf_p = tb_pct.text_frame
        tf_p.word_wrap = True
        tf_p.margin_left = tf_p.margin_top = tf_p.margin_right = tf_p.margin_bottom = 0
        p_pct = tf_p.paragraphs[0]
        p_pct.text = pct
        p_pct.font.name = FONT_HEADING
        p_pct.font.size = Pt(38)
        p_pct.font.bold = True
        p_pct.font.color.rgb = accent

        tb_c = slide.shapes.add_textbox(x + Inches(0.3), y + Inches(1.05), card_w - Inches(0.6), card_h - Inches(1.2))
        tf_c = tb_c.text_frame
        tf_c.word_wrap = True
        tf_c.margin_left = tf_c.margin_top = tf_c.margin_right = tf_c.margin_bottom = 0

        p_t = tf_c.paragraphs[0]
        p_t.text = title
        p_t.font.name = FONT_HEADING
        p_t.font.size = Pt(11)
        p_t.font.bold = True
        p_t.font.color.rgb = WHITE
        p_t.space_after = Pt(12)

        for pt in points:
            p = tf_c.add_paragraph()
            p.text = f"• {pt}"
            p.font.name = FONT_BODY
            p.font.size = Pt(10.5)
            p.font.color.rgb = TEXT_BODY
            p.space_after = Pt(8)

    bot = slide.shapes.add_textbox(Inches(0.8), Inches(6.55), Inches(11.7), Inches(0.4))
    tf_b = bot.text_frame
    tf_b.word_wrap = True
    tf_b.margin_left = tf_b.margin_top = tf_b.margin_right = tf_b.margin_bottom = 0
    p = tf_b.paragraphs[0]
    p.text = "The Common Failure Mode: Developers waste 90% of their frontier quota on tasks that belong in the 60% tier."
    p.font.name = FONT_BODY
    p.font.size = Pt(12)
    p.font.bold = True
    p.font.color.rgb = ROSE
    p.alignment = PP_ALIGN.CENTER

    add_footer(slide, 4)


# ==============================================================================
# SLIDE 5: THE BREAKDOWN (THE TWO BOTTLENECKS)
# ==============================================================================
def make_slide_5():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "The Workflow Chokepoints", "Two Critical Breakdowns in Multi-Agent Development",
               "When you attempt to use multiple tools manually, coordination cost kills productivity.")

    card_w = Inches(5.65)
    card_h = Inches(4.2)

    # Bottleneck 1: Routing Paralysis
    x1 = Inches(0.8)
    y = Inches(2.1)
    add_card(slide, x1, y, card_w, card_h, CARD_BG, CARD_BORDER)

    tb1 = slide.shapes.add_textbox(x1 + Inches(0.4), y + Inches(0.35), card_w - Inches(0.8), card_h - Inches(0.6))
    tf1 = tb1.text_frame
    tf1.word_wrap = True
    tf1.margin_left = tf1.margin_top = tf1.margin_right = tf1.margin_bottom = 0

    p_badge1 = tf1.paragraphs[0]
    p_badge1.text = "BOTTLENECK #1"
    p_badge1.font.name = FONT_HEADING
    p_badge1.font.size = Pt(11)
    p_badge1.font.bold = True
    p_badge1.font.color.rgb = ROSE
    p_badge1.space_after = Pt(6)

    p_title1 = tf1.add_paragraph()
    p_title1.text = "Routing Paralysis & Token Inefficiency"
    p_title1.font.name = FONT_HEADING
    p_title1.font.size = Pt(18)
    p_title1.font.bold = True
    p_title1.font.color.rgb = WHITE
    p_title1.space_after = Pt(14)

    items1 = [
        ("Cognitive Tax on Every Prompt", "Developers waste mental energy deciding whether to open ChatGPT, Antigravity, Copilot, or terminal."),
        ("Token & Quota Wastage", "Sending small refactors to high-tier models drains limited rate-limit windows in minutes."),
        ("No Objective Risk Assessment", "High-risk changes (database updates, production config) are executed without verification.")
    ]
    for title, desc in items1:
        p = tf1.add_paragraph()
        p.text = f"▸  {title}"
        p.font.name = FONT_HEADING
        p.font.size = Pt(12)
        p.font.bold = True
        p.font.color.rgb = CYAN
        p.space_after = Pt(2)
        pd = tf1.add_paragraph()
        pd.text = desc
        pd.font.name = FONT_BODY
        pd.font.size = Pt(11)
        pd.font.color.rgb = TEXT_BODY
        pd.space_after = Pt(10)

    # Bottleneck 2: Context Amnesia
    x2 = Inches(6.85)
    add_card(slide, x2, y, card_w, card_h, CARD_BG, CARD_BORDER)

    tb2 = slide.shapes.add_textbox(x2 + Inches(0.4), y + Inches(0.35), card_w - Inches(0.8), card_h - Inches(0.6))
    tf2 = tb2.text_frame
    tf2.word_wrap = True
    tf2.margin_left = tf2.margin_top = tf2.margin_right = tf2.margin_bottom = 0

    p_badge2 = tf2.paragraphs[0]
    p_badge2.text = "BOTTLENECK #2"
    p_badge2.font.name = FONT_HEADING
    p_badge2.font.size = Pt(11)
    p_badge2.font.bold = True
    p_badge2.font.color.rgb = AMBER
    p_badge2.space_after = Pt(6)

    p_title2 = tf2.add_paragraph()
    p_title2.text = "Context Fragmentation & Secret Leaks"
    p_title2.font.name = FONT_HEADING
    p_title2.font.size = Pt(18)
    p_title2.font.bold = True
    p_title2.font.color.rgb = WHITE
    p_title2.space_after = Pt(14)

    items2 = [
        ("The Clunky Copy-Paste Shuffle", "Manually switching between browser tabs, clipping files, and pasting prompts destroys flow."),
        ("Catastrophic Credential Leaks", "Copying entire repos inadvertently ships .env, API secrets, and SSH keys into cloud prompts."),
        ("Complete Agent Amnesia", "An execution agent in terminal has zero knowledge of the implementation plan drafted in web chat.")
    ]
    for title, desc in items2:
        p = tf2.add_paragraph()
        p.text = f"▸  {title}"
        p.font.name = FONT_HEADING
        p.font.size = Pt(12)
        p.font.bold = True
        p.font.color.rgb = AMBER
        p.space_after = Pt(2)
        pd = tf2.add_paragraph()
        pd.text = desc
        pd.font.name = FONT_BODY
        pd.font.size = Pt(11)
        pd.font.color.rgb = TEXT_BODY
        pd.space_after = Pt(10)

    add_footer(slide, 5)


# ==============================================================================
# SLIDE 6: THE SOLUTION (INTRODUCING BATON)
# ==============================================================================
def make_slide_6():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "The Solution", "Meet Baton: The AI Relay Layer for VS Code",
               "A fast, privacy-first orchestration sidebar that turns coding requests into reviewed, context-aware handoffs.")

    # 4 Architecture Blocks across horizontal flow
    steps = [
        ("1. TASK INPUT", CYAN, "Type or Speak", "Type in the sidebar or speak hands-free via ElevenLabs voice STT."),
        ("2. CONTEXT SHIELD", EMERALD, "Automatic Sanitization", "Pulls Git diff, active file & memories. Strips .env, keys, and 100KB+ files."),
        ("3. CASCADING ROUTER", INDIGO, "Gemma 4 → Ollama → Rules", "Evaluates risk tier & best destination. Deterministic gate enforces policy safety."),
        ("4. ORCHESTRATED HANDOFF", PURPLE, "Plan or Execute", "1-click clipboard prompt to ChatGPT/Gemini/Antigravity OR terminal Codex run.")
    ]

    block_w = Inches(2.7)
    block_h = Inches(3.4)

    for i, (step_num, accent, headline, desc) in enumerate(steps):
        x = Inches(0.8) + i * Inches(2.98)
        y = Inches(2.1)
        add_card(slide, x, y, block_w, block_h, CARD_BG, CARD_BORDER)

        # Top accent
        top_bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, block_w, Inches(0.06))
        top_bar.fill.solid()
        top_bar.fill.fore_color.rgb = accent
        top_bar.line.fill.background()

        tb = slide.shapes.add_textbox(x + Inches(0.2), y + Inches(0.25), block_w - Inches(0.4), block_h - Inches(0.4))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        p1 = tf.paragraphs[0]
        p1.text = step_num
        p1.font.name = FONT_HEADING
        p1.font.size = Pt(10)
        p1.font.bold = True
        p1.font.color.rgb = accent
        p1.space_after = Pt(8)

        p2 = tf.add_paragraph()
        p2.text = headline
        p2.font.name = FONT_HEADING
        p2.font.size = Pt(14)
        p2.font.bold = True
        p2.font.color.rgb = WHITE
        p2.space_after = Pt(10)

        p3 = tf.add_paragraph()
        p3.text = desc
        p3.font.name = FONT_BODY
        p3.font.size = Pt(11)
        p3.font.color.rgb = TEXT_BODY

    # Flow Banner at Bottom
    banner = add_card(slide, Inches(0.8), Inches(5.75), Inches(11.7), Inches(0.95), CARD_BG_ALT, CYAN)
    tb_b = slide.shapes.add_textbox(Inches(1.1), Inches(5.85), Inches(11.1), Inches(0.75))
    tf_b = tb_b.text_frame
    tf_b.word_wrap = True
    tf_b.margin_left = tf_b.margin_top = tf_b.margin_right = tf_b.margin_bottom = 0

    p_b1 = tf_b.paragraphs[0]
    p_b1.text = "CORE GUARANTEE: DETERMINISTIC POLICY GATE"
    p_b1.font.name = FONT_HEADING
    p_b1.font.size = Pt(10.5)
    p_b1.font.bold = True
    p_b1.font.color.rgb = CYAN
    p_b1.space_after = Pt(2)

    p_b2 = tf_b.add_paragraph()
    p_b2.text = "AI models can hallucinate, but Baton's policy engine can ONLY raise risk tiers, never lower them. Critical actions always require manual terminal confirmation."
    p_b2.font.name = FONT_BODY
    p_b2.font.size = Pt(11)
    p_b2.font.color.rgb = TEXT_LIGHT

    add_footer(slide, 6)


# ==============================================================================
# SLIDE 7: KEY CAPABILITIES & MCP
# ==============================================================================
def make_slide_7():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "Engineered for Developers", "Under the Hood: Key Capabilities & Architecture",
               "Built with zero bloat: vanilla TypeScript webview, local JSON storage, and Model Context Protocol.")

    features = [
        ("Curated Context Engine", CYAN,
         "Preview README summary, Git status, active file excerpts, and saved memories. Easily toggle individual sources before routing. Capped at 6,000 chars."),
        ("One-Click Web Handoffs", INDIGO,
         "Baton copies structured prompts (files to touch, tests, risks) and opens ChatGPT or Gemini directly. Paste the plan back to save it permanently."),
        ("Persistent Local Memory", EMERALD,
         "Tasks, plans, and outcomes persist locally in VS Code global storage via MiniSearch. Past solutions automatically surface when working on related tasks."),
        ("Native Read-Only MCP Server", PURPLE,
         "Exposes `get_project_overview`, `search_project_context`, `get_active_plan`, and `get_project_history` to Claude Code, Antigravity, or any MCP client.")
    ]

    card_w = Inches(5.65)
    card_h = Inches(1.95)

    positions = [
        (Inches(0.8), Inches(2.1)),
        (Inches(6.85), Inches(2.1)),
        (Inches(0.8), Inches(4.3)),
        (Inches(6.85), Inches(4.3))
    ]

    for (x, y), (title, accent, desc) in zip(positions, features):
        add_card(slide, x, y, card_w, card_h, CARD_BG, CARD_BORDER)

        # Left accent stripe
        stripe = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, Inches(0.08), card_h)
        stripe.fill.solid()
        stripe.fill.fore_color.rgb = accent
        stripe.line.fill.background()

        tb = slide.shapes.add_textbox(x + Inches(0.3), y + Inches(0.2), card_w - Inches(0.5), card_h - Inches(0.35))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        p1 = tf.paragraphs[0]
        p1.text = title
        p1.font.name = FONT_HEADING
        p1.font.size = Pt(14)
        p1.font.bold = True
        p1.font.color.rgb = WHITE
        p1.space_after = Pt(6)

        p2 = tf.add_paragraph()
        p2.text = desc
        p2.font.name = FONT_BODY
        p2.font.size = Pt(11)
        p2.font.color.rgb = TEXT_BODY

    # Tech stack tag list at bottom
    tb_tech = slide.shapes.add_textbox(Inches(0.8), Inches(6.5), Inches(11.7), Inches(0.4))
    tf_t = tb_tech.text_frame
    tf_t.word_wrap = True
    tf_t.margin_left = tf_t.margin_top = tf_t.margin_right = tf_t.margin_bottom = 0
    pt = tf_t.paragraphs[0]
    pt.text = "STACK: TypeScript  •  esbuild bundle  •  SecretStorage API  •  MiniSearch  •  ElevenLabs Scribe  •  Stdio MCP Server"
    pt.font.name = FONT_MONO
    pt.font.size = Pt(10)
    pt.font.color.rgb = CYAN
    pt.alignment = PP_ALIGN.CENTER

    add_footer(slide, 7)


# ==============================================================================
# SLIDE 8: THE USER JOURNEY
# ==============================================================================
def make_slide_8():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "Product Walkthrough", "From Task to Shipped Code in 5 Frictionless Steps",
               "How a developer uses Baton to resolve tasks without wasting tokens or leaking secrets.")

    steps = [
        ("01", "DESCRIBE", "Type in the sidebar or speak with the microphone button. ElevenLabs transcribes your voice in real time."),
        ("02", "INSPECT CONTEXT", "Review gathered context. Deselect any sensitive files with one click. Baton limits context to 6,000 chars."),
        ("03", "INSTANT ROUTE", "Cascading router runs in <500ms. Displays task type, risk tier (Low/Mod/High), and recommended target."),
        ("04", "PLAN OR EXECUTE", "Click 'Plan in ChatGPT/Gemini' to paste the structured prompt, or 'Run in Codex' for terminal execution."),
        ("05", "RECORD & SYNC", "Paste the generated plan back into Baton. It indexes locally into memory, immediately accessible via MCP.")
    ]

    card_w = Inches(2.18)
    card_h = Inches(4.3)

    for i, (num, title, desc) in enumerate(steps):
        x = Inches(0.8) + i * Inches(2.38)
        y = Inches(2.1)
        add_card(slide, x, y, card_w, card_h, CARD_BG, CARD_BORDER)

        tb = slide.shapes.add_textbox(x + Inches(0.2), y + Inches(0.25), card_w - Inches(0.4), card_h - Inches(0.4))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

        p_num = tf.paragraphs[0]
        p_num.text = num
        p_num.font.name = FONT_HEADING
        p_num.font.size = Pt(28)
        p_num.font.bold = True
        p_num.font.color.rgb = CYAN
        p_num.space_after = Pt(6)

        p_title = tf.add_paragraph()
        p_title.text = title
        p_title.font.name = FONT_HEADING
        p_title.font.size = Pt(12)
        p_title.font.bold = True
        p_title.font.color.rgb = WHITE
        p_title.space_after = Pt(10)

        p_desc = tf.add_paragraph()
        p_desc.text = desc
        p_desc.font.name = FONT_BODY
        p_desc.font.size = Pt(10.5)
        p_desc.font.color.rgb = TEXT_BODY

    add_footer(slide, 8)


# ==============================================================================
# SLIDE 9: COMPETITIVE COMPARISON
# ==============================================================================
def make_slide_9():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)
    add_header(slide, "Competitive Advantage", "Why Baton Wins: The Orchestration Layer",
               "Comparison against monolithic closed assistants and manual copy-pasting.")

    # Table coordinates
    x = Inches(0.8)
    y = Inches(2.05)
    width = Inches(11.7)
    height = Inches(4.5)

    rows, cols = 6, 4
    table_shape = slide.shapes.add_table(rows, cols, x, y, width, height)
    table = table_shape.table

    # Set column widths
    table.columns[0].width = Inches(2.5)
    table.columns[1].width = Inches(3.0)
    table.columns[2].width = Inches(2.8)
    table.columns[3].width = Inches(3.4)

    headers = ["FEATURE / METRIC", "MONOLITHIC ASSISTANTS", "MANUAL COPY-PASTE", "BATON ORCHESTRATION"]
    data = [
        ["Monthly Cost", "$20 – $200 / user / month", "Free (time consuming)", "$0 / Free & cheap tiers"],
        ["60-30-10 Efficiency", "No (burns high-tier quota)", "Manual guesswork", "Automatic cascading routing"],
        ["Secret Leak Prevention", "Uploads entire workspace", "Frequent accidental leaks", "Strict local stripping of .env/keys"],
        ["Cross-Agent Memory", "Locked in proprietary silo", "No shared memory", "Local MiniSearch + Stdio MCP"],
        ["Execution Safety", "Silent automated code edits", "Manual inspection", "Deterministic policy gate + diff"]
    ]

    # Populate Header
    for col_idx, text in enumerate(headers):
        cell = table.cell(0, col_idx)
        cell.fill.solid()
        cell.fill.fore_color.rgb = CARD_BG_ALT
        p = cell.text_frame.paragraphs[0]
        p.text = text
        p.font.name = FONT_HEADING
        p.font.size = Pt(10.5)
        p.font.bold = True
        p.font.color.rgb = CYAN if col_idx == 3 else WHITE
        p.alignment = PP_ALIGN.LEFT

    # Populate Rows
    for row_idx, row_data in enumerate(data, start=1):
        for col_idx, cell_text in enumerate(row_data):
            cell = table.cell(row_idx, col_idx)
            cell.fill.solid()
            # Highlight Baton column
            if col_idx == 3:
                cell.fill.fore_color.rgb = RGBColor(28, 45, 70)
            else:
                cell.fill.fore_color.rgb = CARD_BG if row_idx % 2 == 1 else CARD_BG_ALT

            p = cell.text_frame.paragraphs[0]
            p.text = cell_text
            p.font.name = FONT_BODY
            p.font.size = Pt(10)
            if col_idx == 0:
                p.font.bold = True
                p.font.color.rgb = WHITE
            elif col_idx == 3:
                p.font.bold = True
                p.font.color.rgb = EMERALD
            else:
                p.font.color.rgb = TEXT_BODY
            p.alignment = PP_ALIGN.LEFT

    add_footer(slide, 9)


# ==============================================================================
# SLIDE 10: THE VISION & CTA
# ==============================================================================
def make_slide_10():
    slide = prs.slides.add_slide(blank_layout)
    apply_background(slide)

    # Accent decorative top glow
    glow = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.8), Inches(1.2), Inches(1.8), Inches(0.06))
    glow.fill.solid()
    glow.fill.fore_color.rgb = CYAN
    glow.line.fill.background()

    tb = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(11.7), Inches(3.2))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_top = tf.margin_right = tf.margin_bottom = 0

    p_badge = tf.paragraphs[0]
    p_badge.text = "THE FUTURE OF AGENTIC CODING"
    p_badge.font.name = FONT_HEADING
    p_badge.font.size = Pt(12)
    p_badge.font.bold = True
    p_badge.font.color.rgb = CYAN
    p_badge.space_after = Pt(12)

    p_title = tf.add_paragraph()
    p_title.text = "The Future Isn't One Monolithic Model.\nIt's an Orchestrated Relay."
    p_title.font.name = FONT_HEADING
    p_title.font.size = Pt(36)
    p_title.font.bold = True
    p_title.font.color.rgb = WHITE
    p_title.space_after = Pt(14)

    p_quote = tf.add_paragraph()
    p_quote.text = "“The fastest runners don't run 400 meters alone. They pass the baton.”"
    p_quote.font.name = FONT_HEADING
    p_quote.font.size = Pt(18)
    p_quote.font.italic = True
    p_quote.font.color.rgb = INDIGO

    # Status / CTA Cards
    card_w = Inches(5.65)
    card_h = Inches(1.8)

    # Left CTA Card
    x_l = Inches(0.8)
    y_c = Inches(4.7)
    add_card(slide, x_l, y_c, card_w, card_h, CARD_BG, CARD_BORDER)

    tb_cl = slide.shapes.add_textbox(x_l + Inches(0.3), y_c + Inches(0.25), card_w - Inches(0.6), card_h - Inches(0.4))
    tf_cl = tb_cl.text_frame
    tf_cl.word_wrap = True
    tf_cl.margin_left = tf_cl.margin_top = tf_cl.margin_right = tf_cl.margin_bottom = 0

    p1 = tf_cl.paragraphs[0]
    p1.text = "READY TODAY: FUNCTIONAL VS CODE MVP"
    p1.font.name = FONT_HEADING
    p1.font.size = Pt(12)
    p1.font.bold = True
    p1.font.color.rgb = CYAN
    p1.space_after = Pt(6)

    p2 = tf_cl.add_paragraph()
    p2.text = "• Fully functional TypeScript extension with SecretStorage security\n• Cascading Gemma 4 router, Ollama Cloud & local fallback\n• Stdio MCP server ready for Antigravity & Claude Code"
    p2.font.name = FONT_BODY
    p2.font.size = Pt(10.5)
    p2.font.color.rgb = TEXT_BODY

    # Right CTA Card
    x_r = Inches(6.85)
    add_card(slide, x_r, y_c, card_w, card_h, CARD_BG, CYAN)

    tb_cr = slide.shapes.add_textbox(x_r + Inches(0.3), y_c + Inches(0.25), card_w - Inches(0.6), card_h - Inches(0.4))
    tf_cr = tb_cr.text_frame
    tf_cr.word_wrap = True
    tf_cr.margin_left = tf_cr.margin_top = tf_cr.margin_right = tf_cr.margin_bottom = 0

    p_r1 = tf_cr.paragraphs[0]
    p_r1.text = "TRY BATON NOW"
    p_r1.font.name = FONT_HEADING
    p_r1.font.size = Pt(12)
    p_r1.font.bold = True
    p_r1.font.color.rgb = WHITE
    p_r1.space_after = Pt(6)

    p_r2 = tf_cr.add_paragraph()
    p_r2.text = "1. Open repository in VS Code\n2. Press F5 (or select 'Run Baton' in Run & Debug)\n3. Click the Baton sidebar icon & route your first task!\nGitHub: d:/GITHUB/ME/baton"
    p_r2.font.name = FONT_MONO
    p_r2.font.size = Pt(10.5)
    p_r2.font.color.rgb = WHITE

    add_footer(slide, 10)


def main():
    output_path = "Baton_Pitch_Deck.pptx"
    print("Generating Baton Pitch Deck...")
    make_slide_1()
    make_slide_2()
    make_slide_3()
    make_slide_4()
    make_slide_5()
    make_slide_6()
    make_slide_7()
    make_slide_8()
    make_slide_9()
    make_slide_10()

    prs.save(output_path)
    print(f"Successfully generated presentation at: {output_path}")

if __name__ == "__main__":
    main()
