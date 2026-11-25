"""Real Binary PDF (ReportLab) & DOCX (python-docx) Document Export Service."""

from __future__ import annotations

import io
from typing import Any

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer


TEMPLATE_STYLES = {
    "classic_professional": {
        "primary_hex": "#0F172A",
        "accent_hex": "#0F172A",
        "pdf_font": "Times-Roman",
        "pdf_bold": "Times-Bold",
        "docx_font": "Georgia",
        "rgb": (15, 23, 42),
    },
    "modern_minimalist": {
        "primary_hex": "#0F172A",
        "accent_hex": "#2563EB",
        "pdf_font": "Helvetica",
        "pdf_bold": "Helvetica-Bold",
        "docx_font": "Calibri",
        "rgb": (37, 99, 235),
    },
    "technical_engineering": {
        "primary_hex": "#0F172A",
        "accent_hex": "#1D4ED8",
        "pdf_font": "Helvetica",
        "pdf_bold": "Helvetica-Bold",
        "docx_font": "Consolas",
        "rgb": (29, 78, 216),
    },
    "graduate_entry_level": {
        "primary_hex": "#1E293B",
        "accent_hex": "#334155",
        "pdf_font": "Helvetica",
        "pdf_bold": "Helvetica-Bold",
        "docx_font": "Arial",
        "rgb": (30, 41, 59),
    },
}

_WINANSI_MAP = str.maketrans(
    {
        "\u2014": " - ",
        "\u2013": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
        "\u00a0": " ",
        "\u2022": "*",
    }
)


def _normalize_pdf_text(text: Any) -> str:
    """Keep text crisp and safe for ReportLab Type1 built-in fonts without broken glyphs."""
    cleaned = str(text or "").translate(_WINANSI_MAP)
    return cleaned.encode("latin-1", "replace").decode("latin-1")


def _escape_rl(text: Any) -> str:
    return (
        _normalize_pdf_text(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _add_docx_bottom_border(paragraph, color_hex: str) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color_hex.lstrip("#"))
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def render_document_pdf(document: dict[str, Any]) -> bytes:
    """Render structured document content as a genuine binary PDF using ReportLab."""
    template = document.get("template") or "classic_professional"
    style_cfg = TEMPLATE_STYLES.get(template, TEMPLATE_STYLES["classic_professional"])
    content = document.get("structured_content") or {}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=LETTER,
        leftMargin=0.72 * inch,
        rightMargin=0.72 * inch,
        topMargin=0.68 * inch,
        bottomMargin=0.68 * inch,
        title=_normalize_pdf_text(document.get("document_title") or "CareerCraft Document"),
    )

    base = getSampleStyleSheet()
    accent_color = colors.HexColor(style_cfg["accent_hex"])
    navy_color = colors.HexColor("#0F172A")
    muted_color = colors.HexColor("#475569")

    title_style = ParagraphStyle(
        "CCTitle",
        parent=base["Heading1"],
        fontName=style_cfg["pdf_bold"],
        fontSize=17,
        leading=21,
        textColor=accent_color,
        spaceAfter=4,
    )
    subtitle_style = ParagraphStyle(
        "CCSub",
        parent=base["Normal"],
        fontName=style_cfg["pdf_font"],
        fontSize=9.5,
        leading=13,
        textColor=muted_color,
        spaceAfter=8,
    )
    section_heading = ParagraphStyle(
        "CCSection",
        parent=base["Heading2"],
        fontName=style_cfg["pdf_bold"],
        fontSize=11,
        leading=14,
        textColor=navy_color,
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True,
    )
    item_heading = ParagraphStyle(
        "CCItem",
        parent=base["Normal"],
        fontName=style_cfg["pdf_bold"],
        fontSize=10,
        leading=13.5,
        textColor=navy_color,
        spaceBefore=4,
        spaceAfter=2,
        keepWithNext=True,
    )
    body_style = ParagraphStyle(
        "CCBody",
        parent=base["Normal"],
        fontName=style_cfg["pdf_font"],
        fontSize=10,
        leading=14,
        textColor=colors.HexColor("#111827"),
        spaceAfter=4,
    )
    bullet_style = ParagraphStyle(
        "CCBullet",
        parent=body_style,
        leftIndent=14,
        firstLineIndent=-8,
        spaceAfter=2,
    )

    story: list[Any] = []

    header = content.get("header") or {}
    heading_text = str(header.get("full_name") or document.get("document_title") or "Document").strip()
    story.append(Paragraph(_escape_rl(heading_text), title_style))

    contact_parts = [
        str(part).strip()
        for part in (
            header.get("headline") or header.get("professional_title"),
            header.get("email"),
            header.get("phone"),
            header.get("location"),
            header.get("portfolio_url"),
        )
        if str(part or "").strip()
    ]
    if contact_parts:
        story.append(Paragraph(_escape_rl("  |  ".join(contact_parts)), subtitle_style))

    story.append(HRFlowable(width="100%", thickness=1.2, color=accent_color, spaceAfter=8))

    if content.get("summary"):
        story.append(Paragraph("PROFESSIONAL SUMMARY", section_heading))
        story.append(Paragraph(_escape_rl(content["summary"]).replace("\n", "<br/>"), body_style))

    sections = content.get("sections") or []
    for sec in sections:
        sec_title = str(sec.get("heading") or "").strip()
        if sec_title:
            story.append(Paragraph(_escape_rl(sec_title.upper()), section_heading))

        if sec.get("body"):
            for para in str(sec["body"]).split("\n\n"):
                cleaned = para.strip()
                if cleaned:
                    story.append(Paragraph(_escape_rl(cleaned).replace("\n", "<br/>"), body_style))

        for entry in sec.get("entries") or []:
            entry_flow: list[Any] = []
            line_title = str(entry.get("title") or "").strip()
            line_meta = str(entry.get("meta") or "").strip()
            combined = f"{line_title} - {line_meta}" if line_title and line_meta else (line_title or line_meta)
            if combined:
                entry_flow.append(Paragraph(_escape_rl(combined), item_heading))
            if entry.get("description"):
                entry_flow.append(Paragraph(_escape_rl(entry["description"]).replace("\n", "<br/>"), body_style))
            bullets = [str(b or "").strip() for b in (entry.get("bullets") or []) if str(b or "").strip()]
            if bullets:
                entry_flow.append(Paragraph(f"* {_escape_rl(bullets[0])}", bullet_style))
            if entry_flow:
                story.append(KeepTogether(entry_flow))
            for b_txt in bullets[1:]:
                story.append(Paragraph(f"* {_escape_rl(b_txt)}", bullet_style))

        for bullet in sec.get("bullets") or []:
            b_txt = str(bullet or "").strip()
            if b_txt:
                story.append(Paragraph(f"* {_escape_rl(b_txt)}", bullet_style))

    for para in content.get("paragraphs") or []:
        p_txt = str(para or "").strip()
        if p_txt:
            story.append(Paragraph(_escape_rl(p_txt).replace("\n", "<br/>"), body_style))
            story.append(Spacer(1, 3))

    if content.get("closing"):
        story.append(Spacer(1, 6))
        story.append(Paragraph(_escape_rl(str(content["closing"])).replace("\n", "<br/>"), body_style))

    doc.build(story)
    return buf.getvalue()


def render_document_docx(document: dict[str, Any]) -> bytes:
    """Render structured document content as a genuine binary DOCX using python-docx."""
    template = document.get("template") or "classic_professional"
    style_cfg = TEMPLATE_STYLES.get(template, TEMPLATE_STYLES["classic_professional"])
    content = document.get("structured_content") or {}
    font_name = style_cfg["docx_font"]

    word_doc = docx.Document()
    for sec in word_doc.sections:
        sec.top_margin = Inches(0.7)
        sec.bottom_margin = Inches(0.7)
        sec.left_margin = Inches(0.75)
        sec.right_margin = Inches(0.75)

    normal_style = word_doc.styles["Normal"]
    normal_style.font.name = font_name
    normal_style.font.size = Pt(10.5)

    accent_rgb = RGBColor(*style_cfg["rgb"])
    navy_rgb = RGBColor(15, 23, 42)
    muted_rgb = RGBColor(71, 85, 105)

    header = content.get("header") or {}
    heading_text = str(header.get("full_name") or document.get("document_title") or "Document").strip()
    title_p = word_doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    title_run = title_p.add_run(heading_text)
    title_run.font.name = font_name
    title_run.bold = True
    title_run.font.size = Pt(17)
    title_run.font.color.rgb = accent_rgb

    contact_parts = [
        str(part).strip()
        for part in (
            header.get("headline") or header.get("professional_title"),
            header.get("email"),
            header.get("phone"),
            header.get("location"),
            header.get("portfolio_url"),
        )
        if str(part or "").strip()
    ]
    if contact_parts:
        sub_p = word_doc.add_paragraph()
        sub_run = sub_p.add_run(" | ".join(contact_parts))
        sub_run.font.name = font_name
        sub_run.font.size = Pt(9.5)
        sub_run.font.color.rgb = muted_rgb
        _add_docx_bottom_border(sub_p, style_cfg["accent_hex"])
    else:
        _add_docx_bottom_border(title_p, style_cfg["accent_hex"])

    def add_section_heading(text: str) -> None:
        h = word_doc.add_paragraph()
        h.paragraph_format.keep_with_next = True
        hr = h.add_run(text.upper())
        hr.font.name = font_name
        hr.bold = True
        hr.font.size = Pt(11)
        hr.font.color.rgb = navy_rgb

    def add_body_para(text: str) -> None:
        p = word_doc.add_paragraph()
        r = p.add_run(text)
        r.font.name = font_name
        r.font.size = Pt(10.5)

    if content.get("summary"):
        add_section_heading("PROFESSIONAL SUMMARY")
        add_body_para(str(content["summary"]))

    for sec in content.get("sections") or []:
        sec_title = str(sec.get("heading") or "").strip()
        if sec_title:
            add_section_heading(sec_title)

        if sec.get("body"):
            for para in str(sec["body"]).split("\n\n"):
                if para.strip():
                    add_body_para(para.strip())

        for entry in sec.get("entries") or []:
            line_title = str(entry.get("title") or "").strip()
            line_meta = str(entry.get("meta") or "").strip()
            combined = f"{line_title} — {line_meta}" if line_title and line_meta else (line_title or line_meta)
            if combined:
                ep = word_doc.add_paragraph()
                ep.paragraph_format.keep_with_next = True
                er = ep.add_run(combined)
                er.font.name = font_name
                er.bold = True
                er.font.color.rgb = navy_rgb
            if entry.get("description"):
                add_body_para(str(entry["description"]))
            for bullet in entry.get("bullets") or []:
                b_txt = str(bullet or "").strip()
                if b_txt:
                    bp = word_doc.add_paragraph(style="List Bullet")
                    br = bp.add_run(b_txt)
                    br.font.name = font_name

        for bullet in sec.get("bullets") or []:
            b_txt = str(bullet or "").strip()
            if b_txt:
                bp = word_doc.add_paragraph(style="List Bullet")
                br = bp.add_run(b_txt)
                br.font.name = font_name

    for para in content.get("paragraphs") or []:
        if str(para or "").strip():
            add_body_para(str(para).strip())

    if content.get("closing"):
        add_body_para(str(content["closing"]))

    out = io.BytesIO()
    word_doc.save(out)
    return out.getvalue()
