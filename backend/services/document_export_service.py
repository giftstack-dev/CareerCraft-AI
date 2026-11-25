"""Real Binary PDF (ReportLab) & DOCX (python-docx) Document Export Service."""

from __future__ import annotations

import io
from typing import Any

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer


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


def _escape_rl(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


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
        title=str(document.get("document_title") or "CareerCraft Document"),
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
        story.append(Paragraph(_escape_rl(str(content["summary"])), body_style))

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
            line_title = str(entry.get("title") or "").strip()
            line_meta = str(entry.get("meta") or "").strip()
            combined = f"{line_title} — {line_meta}" if line_title and line_meta else (line_title or line_meta)
            if combined:
                story.append(Paragraph(_escape_rl(combined), item_heading))
            if entry.get("description"):
                story.append(Paragraph(_escape_rl(str(entry["description"])), body_style))
            for bullet in entry.get("bullets") or []:
                b_txt = str(bullet or "").strip()
                if b_txt:
                    story.append(Paragraph(f"• {_escape_rl(b_txt)}", bullet_style))

        for bullet in sec.get("bullets") or []:
            b_txt = str(bullet or "").strip()
            if b_txt:
                story.append(Paragraph(f"• {_escape_rl(b_txt)}", bullet_style))

    # Support letter/prose paragraphs if structured_content uses paragraphs[]
    for para in content.get("paragraphs") or []:
        p_txt = str(para or "").strip()
        if p_txt:
            story.append(Paragraph(_escape_rl(p_txt), body_style))
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

    word_doc = docx.Document()
    for sec in word_doc.sections:
        sec.top_margin = Inches(0.7)
        sec.bottom_margin = Inches(0.7)
        sec.left_margin = Inches(0.75)
        sec.right_margin = Inches(0.75)

    normal_style = word_doc.styles["Normal"]
    normal_style.font.name = style_cfg["docx_font"]
    normal_style.font.size = Pt(10.5)

    accent_rgb = RGBColor(*style_cfg["rgb"])
    navy_rgb = RGBColor(15, 23, 42)
    muted_rgb = RGBColor(71, 85, 105)

    header = content.get("header") or {}
    heading_text = str(header.get("full_name") or document.get("document_title") or "Document").strip()
    title_p = word_doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    title_run = title_p.add_run(heading_text)
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
        sub_run.font.size = Pt(9.5)
        sub_run.font.color.rgb = muted_rgb

    if content.get("summary"):
        h = word_doc.add_paragraph()
        hr = h.add_run("PROFESSIONAL SUMMARY")
        hr.bold = True
        hr.font.size = Pt(11)
        hr.font.color.rgb = navy_rgb
        word_doc.add_paragraph(str(content["summary"]))

    for sec in content.get("sections") or []:
        sec_title = str(sec.get("heading") or "").strip()
        if sec_title:
            h = word_doc.add_paragraph()
            hr = h.add_run(sec_title.upper())
            hr.bold = True
            hr.font.size = Pt(11)
            hr.font.color.rgb = navy_rgb

        if sec.get("body"):
            for para in str(sec["body"]).split("\n\n"):
                if para.strip():
                    word_doc.add_paragraph(para.strip())

        for entry in sec.get("entries") or []:
            line_title = str(entry.get("title") or "").strip()
            line_meta = str(entry.get("meta") or "").strip()
            combined = f"{line_title} — {line_meta}" if line_title and line_meta else (line_title or line_meta)
            if combined:
                ep = word_doc.add_paragraph()
                er = ep.add_run(combined)
                er.bold = True
                er.font.color.rgb = navy_rgb
            if entry.get("description"):
                word_doc.add_paragraph(str(entry["description"]))
            for bullet in entry.get("bullets") or []:
                if str(bullet or "").strip():
                    word_doc.add_paragraph(str(bullet).strip(), style="List Bullet")

        for bullet in sec.get("bullets") or []:
            if str(bullet or "").strip():
                word_doc.add_paragraph(str(bullet).strip(), style="List Bullet")

    for para in content.get("paragraphs") or []:
        if str(para or "").strip():
            word_doc.add_paragraph(str(para).strip())

    if content.get("closing"):
        word_doc.add_paragraph(str(content["closing"]))

    out = io.BytesIO()
    word_doc.save(out)
    return out.getvalue()
