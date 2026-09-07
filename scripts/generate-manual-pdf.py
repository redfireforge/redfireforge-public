#!/usr/bin/env python3
"""Generate RedfireForge User Manual PDF with screenshots."""

import sys
from pathlib import Path
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak,
    Table, TableStyle, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT

BRAND_DARK = HexColor('#0F172A')
BRAND_BLUE = HexColor('#3B5BDB')
BRAND_LIGHT = HexColor('#E8EBF5')
BRAND_ORANGE = HexColor('#FF6B35')
BRAND_GRAY = HexColor('#6B7280')
WHITE = HexColor('#FFFFFF')

PAGE_W, PAGE_H = LETTER
IMG_W = PAGE_W - 2 * inch


def get_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        'ManualTitle', parent=styles['Title'],
        fontSize=28, leading=34, textColor=BRAND_DARK,
        spaceAfter=6, alignment=TA_CENTER, fontName='Helvetica-Bold'))

    styles.add(ParagraphStyle(
        'ManualSubtitle', parent=styles['Normal'],
        fontSize=14, leading=18, textColor=BRAND_GRAY,
        spaceAfter=20, alignment=TA_CENTER))

    styles.add(ParagraphStyle(
        'SectionHead', parent=styles['Heading1'],
        fontSize=22, leading=26, textColor=BRAND_BLUE,
        spaceBefore=20, spaceAfter=12, fontName='Helvetica-Bold'))

    styles.add(ParagraphStyle(
        'SubHead', parent=styles['Heading2'],
        fontSize=16, leading=20, textColor=BRAND_DARK,
        spaceBefore=16, spaceAfter=8, fontName='Helvetica-Bold'))

    styles.add(ParagraphStyle(
        'Body', parent=styles['Normal'],
        fontSize=11, leading=15, textColor=BRAND_DARK,
        spaceAfter=8))

    styles.add(ParagraphStyle(
        'StepNum', parent=styles['Normal'],
        fontSize=12, leading=16, textColor=BRAND_BLUE,
        fontName='Helvetica-Bold', spaceAfter=4))

    styles.add(ParagraphStyle(
        'ManualBullet', parent=styles['Normal'],
        fontSize=11, leading=15, textColor=BRAND_DARK,
        leftIndent=20, bulletIndent=8, spaceAfter=4))

    styles.add(ParagraphStyle(
        'Caption', parent=styles['Normal'],
        fontSize=9, leading=12, textColor=BRAND_GRAY,
        alignment=TA_CENTER, spaceAfter=16, spaceBefore=4,
        fontName='Helvetica-Oblique'))

    styles.add(ParagraphStyle(
        'Tip', parent=styles['Normal'],
        fontSize=10, leading=14, textColor=HexColor('#1A5D1A'),
        leftIndent=12, borderPadding=8, spaceAfter=10,
        fontName='Helvetica-Oblique'))

    styles.add(ParagraphStyle(
        'TableHeader', parent=styles['Normal'],
        fontSize=10, leading=13, textColor=WHITE,
        fontName='Helvetica-Bold', alignment=TA_CENTER))

    styles.add(ParagraphStyle(
        'TableCell', parent=styles['Normal'],
        fontSize=10, leading=13, textColor=BRAND_DARK))

    return styles


def add_image(elements, img_path, caption, styles):
    if img_path.exists():
        img = Image(str(img_path), width=IMG_W, height=IMG_W * 0.643)
        img.hAlign = 'CENTER'
        elements.append(img)
        elements.append(Paragraph(caption, styles['Caption']))
    else:
        elements.append(Paragraph(f"[Screenshot: {caption}]", styles['Caption']))


def add_step(elements, num, title, description, styles, img_path=None, caption=None):
    step_items = []
    step_items.append(Paragraph(f"Step {num}: {title}", styles['StepNum']))
    step_items.append(Paragraph(description, styles['Body']))
    if img_path and img_path.exists():
        img = Image(str(img_path), width=IMG_W, height=IMG_W * 0.643)
        img.hAlign = 'CENTER'
        step_items.append(img)
        if caption:
            step_items.append(Paragraph(caption, styles['Caption']))
    step_items.append(Spacer(1, 8))
    elements.append(KeepTogether(step_items))


def make_table(elements, headers, rows, styles):
    header_cells = [Paragraph(h, styles['TableHeader']) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), styles['TableCell']) for c in row])

    col_widths = [IMG_W / len(headers)] * len(headers)
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BRAND_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, -1), HexColor('#F8F9FC')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [HexColor('#F8F9FC'), WHITE]),
        ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#D1D5DB')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
    ]))
    elements.append(t)
    elements.append(Spacer(1, 12))


def generate(version, img_dir, output_path):
    styles = get_styles()
    doc = SimpleDocTemplate(
        str(output_path), pagesize=LETTER,
        leftMargin=inch, rightMargin=inch,
        topMargin=0.8*inch, bottomMargin=0.8*inch,
        title=f"RedfireForge User Manual v{version}",
        author="RedfireForge Team")

    elements = []
    img = lambda name: img_dir / name

    # ════════════════════════════════════════════
    # COVER PAGE
    # ════════════════════════════════════════════
    elements.append(Spacer(1, 2 * inch))
    elements.append(Paragraph("🔥 RedfireForge", styles['ManualTitle']))
    elements.append(Paragraph("API Performance Studio", styles['ManualSubtitle']))
    elements.append(Spacer(1, 0.3 * inch))
    elements.append(Paragraph("User Manual", ParagraphStyle(
        'CoverSub', parent=styles['ManualSubtitle'],
        fontSize=20, textColor=BRAND_BLUE)))
    elements.append(Spacer(1, 0.5 * inch))
    elements.append(Paragraph(f"Version {version}", styles['ManualSubtitle']))
    elements.append(Paragraph("Fire. Measure. Validate.", ParagraphStyle(
        'Tagline', parent=styles['ManualSubtitle'],
        textColor=BRAND_ORANGE, fontName='Helvetica-Oblique')))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # TABLE OF CONTENTS
    # ════════════════════════════════════════════
    elements.append(Paragraph("Table of Contents", styles['SectionHead']))
    elements.append(Spacer(1, 8))
    toc_items = [
        "1. Introduction",
        "2. Installation",
        "3. App Overview",
        "4. Settings — Add Environments & Microservices",
        "5. Sidebar — Select Environment & Microservice",
        "6. Create a Feature Group",
        "7. Add a Scenario",
        "8. Add a Test",
        "9. Viewing Existing Tests",
        "10. Authentication Setup",
        "11. Running Performance Tests",
        "12. Analyzing Results",
        "13. Export & Import",
        "14. Desktop vs Web Comparison",
        "15. Tips & Best Practices",
        "16. Quick Reference",
    ]
    for item in toc_items:
        elements.append(Paragraph(item, styles['Body']))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 1. INTRODUCTION
    # ════════════════════════════════════════════
    elements.append(Paragraph("1. Introduction", styles['SectionHead']))
    elements.append(Paragraph(
        "RedfireForge is a desktop and web application for API performance testing. "
        "It lets you define HTTP tests visually, execute them with configurable concurrency, "
        "validate responses against expected schemas, and analyze the results — all without "
        "writing a single line of test script.", styles['Body']))
    elements.append(Paragraph(
        "RedfireForge is available as a native desktop application (macOS, Windows, Linux) "
        "and as a web application running in your browser.", styles['Body']))
    elements.append(Spacer(1, 8))

    elements.append(Paragraph("Key Capabilities", styles['SubHead']))
    for cap in [
        "Visual HTTP test builder — no scripting required",
        "Hierarchical organization: Feature Groups → Scenarios → Tests",
        "OAuth2, Bearer Token, Basic Auth, and API Key authentication",
        "Global auth profiles with 4-tier inheritance",
        "Sequential, Parallel, and Ramp-up execution modes",
        "Real-time execution progress and result metrics",
        "Export/Import with intelligent conflict resolution",
        "Drag-and-drop test organization",
        "Cross-platform: macOS, Windows, Linux, and Web",
    ]:
        elements.append(Paragraph(f"• {cap}", styles['ManualBullet']))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 2. INSTALLATION
    # ════════════════════════════════════════════
    elements.append(Paragraph("2. Installation", styles['SectionHead']))

    elements.append(Paragraph("Desktop Application (Recommended)", styles['SubHead']))
    make_table(elements,
        ["Platform", "Installer", "How to Install"],
        [
            ["macOS", ".dmg file", "Open DMG → drag RedfireForge to Applications"],
            ["Windows", ".msi installer", "Double-click → follow the setup wizard"],
            ["Linux", ".AppImage / .deb", "Make AppImage executable and run, or install .deb"],
        ], styles)

    elements.append(Paragraph(
        '<b>macOS first launch:</b> Right-click the app → Open → click "Open" in the dialog '
        'to bypass Gatekeeper security.', styles['Tip']))

    elements.append(Paragraph("Web Application", styles['SubHead']))
    elements.append(Paragraph(
        "If using the web version, you need Node.js installed. Run the following commands:",
        styles['Body']))
    elements.append(Paragraph(
        "<font face='Courier' size='10'>npm install</font> — install dependencies<br/>"
        "<font face='Courier' size='10'>npm run dev</font> — start the dev server<br/>"
        "Open <font face='Courier' size='10'>http://localhost:5173</font> in your browser.",
        styles['Body']))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 3. APP OVERVIEW
    # ════════════════════════════════════════════
    elements.append(Paragraph("3. App Overview", styles['SectionHead']))
    elements.append(Paragraph(
        "When you launch RedfireForge, you'll see the main interface with three primary areas: "
        "the header with navigation tabs, the sidebar for filtering, and the main content area.",
        styles['Body']))
    add_image(elements, img('01-app-launch.png'),
              "Figure 1: RedfireForge main interface on first launch", styles)

    elements.append(Paragraph("The interface has three main navigation tabs:", styles['Body']))
    make_table(elements,
        ["Tab", "Purpose"],
        [
            ["Feature Groups", "Create, organize, and edit your API tests"],
            ["Test Runner", "Configure and execute performance test runs"],
            ["Results", "View historical results, metrics, and charts"],
        ], styles)
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 4. SETTINGS — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("4. Settings — Add Environments & Microservices", styles['SectionHead']))
    elements.append(Paragraph(
        "Before creating tests, you need to set up at least one Environment and one Microservice. "
        "Open Settings by clicking ⚙ Settings in the sidebar.",
        styles['Body']))

    add_step(elements, 1,
        "Open Settings",
        "Click the ⚙ Settings button at the bottom of the sidebar.",
        styles, img('02-settings-open.png'),
        "Figure 2: Settings modal — Environments and Microservices")

    add_step(elements, 2,
        "Add an Environment",
        "Type an environment name (e.g., 'demo-env', 'test', 'staging') in the input field "
        "and click Add.",
        styles, img('03-settings-env-type.png'),
        "Figure 3: Typing a new environment name")

    add_step(elements, 3,
        "Environment Added",
        "The environment appears as a chip below the input. You can add multiple environments.",
        styles, img('04-settings-env-added.png'),
        "Figure 4: Environment successfully added")

    add_step(elements, 4,
        "Add a Microservice",
        "Type a microservice name (e.g., 'demo-api-service') and click Add.",
        styles, img('05-settings-svc-type.png'),
        "Figure 5: Typing a new microservice name")

    add_step(elements, 5,
        "Microservice Added",
        "The microservice appears in the list. You can configure base URLs per environment.",
        styles, img('06-settings-svc-added.png'),
        "Figure 6: Microservice added with configuration options")

    elements.append(Paragraph("Global Auth Profiles", styles['SubHead']))
    elements.append(Paragraph(
        "Scroll down in Settings to see Global Authentication Profiles. "
        "These let you define reusable auth configurations (OAuth2, Bearer, etc.) "
        "that your tests can inherit.",
        styles['Body']))
    add_image(elements, img('07-settings-global-auth.png'),
              "Figure 7: Global Auth Profiles section", styles)

    elements.append(Paragraph("Storage & Export/Import", styles['SubHead']))
    add_image(elements, img('08-settings-storage-export.png'),
              "Figure 8: Storage usage and Export/Import buttons", styles)
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 5. SIDEBAR — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("5. Sidebar — Select Environment & Microservice", styles['SectionHead']))
    elements.append(Paragraph(
        "The left sidebar lets you filter Feature Groups by Environment and Microservice. "
        "You must select both before you can create or view Feature Groups.",
        styles['Body']))

    add_step(elements, 1,
        "Click an Environment",
        "Click on an environment name (e.g., 'demo-env') to select it. "
        "The tree expands to show microservices deployed to that environment.",
        styles, img('09-sidebar-env-click.png'),
        "Figure 9: Clicking an environment in the sidebar")

    add_step(elements, 2,
        "Select a Microservice",
        "Click on a microservice in the expanded tree to filter Feature Groups.",
        styles, img('10-sidebar-svc-selected.png'),
        "Figure 10: Microservice selected — Feature Groups now filtered")

    add_step(elements, 3,
        "Microservices Tab",
        "You can also switch to the Microservices tab to browse by service first.",
        styles, img('11-sidebar-microservices-tab.png'),
        "Figure 11: Sidebar Microservices tab view")
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 6. CREATE FEATURE GROUP — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("6. Create a Feature Group", styles['SectionHead']))
    elements.append(Paragraph(
        "Feature Groups are the top-level containers for organizing your tests. "
        "You can also select the environment and microservice from the dropdowns in the header.",
        styles['Body']))

    add_image(elements, img('12-feature-groups-env-svc-selected.png'),
              "Figure 12: Environment and Microservice selected via header dropdowns", styles)

    add_step(elements, 1,
        "Click '+ Add Feature Group'",
        "An inline form appears where you can type the name.",
        styles, img('13-feature-group-naming.png'),
        "Figure 13: Feature Group naming form appears")

    add_step(elements, 2,
        "Type a Name and Click Create",
        "Enter a descriptive name (e.g., 'Demo API Tests') and click Create.",
        styles, img('14-feature-group-name-typed.png'),
        "Figure 14: Typing the Feature Group name")

    add_step(elements, 3,
        "Feature Group Created",
        "The new Feature Group appears in the list, expanded and ready for scenarios.",
        styles, img('15-feature-group-created.png'),
        "Figure 15: Feature Group created successfully")
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 7. ADD SCENARIO — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("7. Add a Scenario", styles['SectionHead']))
    elements.append(Paragraph(
        "Scenarios group related tests within a Feature Group (e.g., 'Health Check Flow').",
        styles['Body']))

    add_step(elements, 1,
        "Click '+ Scenario'",
        "Inside the Feature Group, click the '+ Scenario' button.",
        styles, img('16-scenario-naming.png'),
        "Figure 16: Scenario naming form")

    add_step(elements, 2,
        "Type a Name and Click Create",
        "Enter a scenario name (e.g., 'Health Check Flow') and click Create.",
        styles, img('17-scenario-name-typed.png'),
        "Figure 17: Typing the Scenario name")

    add_step(elements, 3,
        "Scenario Created",
        "The scenario appears inside the Feature Group, ready for tests.",
        styles, img('18-scenario-created.png'),
        "Figure 18: Scenario created with action buttons")
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 8. ADD TEST — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("8. Add a Test", styles['SectionHead']))
    elements.append(Paragraph(
        "Tests are individual HTTP requests with optional assertions.",
        styles['Body']))

    add_step(elements, 1,
        "Click '+ Test'",
        "Inside a Scenario, click '+ Test' to open the test editor.",
        styles, img('19-test-editor-open.png'),
        "Figure 19: Test editor opens in a split panel")

    add_step(elements, 2,
        "Fill in Name and URL",
        "Enter a test name (e.g., 'GET Health Check') and the request URL "
        "(e.g., 'https://httpbin.org/get'). Select the HTTP method.",
        styles, img('20-test-name-url-filled.png'),
        "Figure 20: Test name and URL configured")

    add_step(elements, 3,
        "Configure More Fields",
        "Scroll down to add headers, request body, expected status code, "
        "and response validation rules.",
        styles, img('21-test-editor-more-fields.png'),
        "Figure 21: Additional test configuration options")

    add_step(elements, 4,
        "Save the Test",
        "Click Save to add the test to the scenario.",
        styles, img('22-test-saved.png'),
        "Figure 22: Test saved and visible in the scenario")

    elements.append(Paragraph("Test Configuration Fields", styles['SubHead']))
    make_table(elements,
        ["Field", "Description"],
        [
            ["Name", "A descriptive name for the test"],
            ["Method", "HTTP method: GET, POST, PUT, DELETE, PATCH"],
            ["URL", "The full request URL"],
            ["Headers", "Key-value pairs for request headers"],
            ["Body", "Request body (for POST/PUT/PATCH)"],
            ["Expected Status", "The expected HTTP status code (e.g., 200, 201)"],
            ["Validation", "JSON response validation rules"],
            ["Auth", "Override authentication for this specific test"],
        ], styles)
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 9. EXISTING DATA VIEW
    # ════════════════════════════════════════════
    elements.append(Paragraph("9. Viewing Existing Tests", styles['SectionHead']))
    elements.append(Paragraph(
        "Once you have Feature Groups with scenarios and tests, you can browse "
        "and expand them to see all your test configurations.",
        styles['Body']))

    add_image(elements, img('23-existing-feature-groups.png'),
              "Figure 23: Feature Groups with existing test data", styles)
    add_image(elements, img('24-feature-groups-all-expanded.png'),
              "Figure 24: All Feature Groups expanded showing scenarios and tests", styles)
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 10. AUTHENTICATION
    # ════════════════════════════════════════════
    elements.append(Paragraph("10. Authentication Setup", styles['SectionHead']))
    elements.append(Paragraph(
        "RedfireForge supports a 4-tier authentication inheritance model. "
        "Configure auth once at the top level and let it cascade down:",
        styles['Body']))

    make_table(elements,
        ["Level", "Inherits From", "Override?"],
        [
            ["Global Auth Profile", "—", "Base configuration"],
            ["Feature Group", "Global Profile", "Can override"],
            ["Scenario", "Feature Group", "Can override"],
            ["Test", "Scenario", "Can override"],
        ], styles)

    elements.append(Paragraph("Supported Auth Types", styles['SubHead']))
    for auth in [
        "<b>OAuth2 (Client Credentials)</b> — Token URL, Client ID, Client Secret, Scope",
        "<b>Bearer Token</b> — Static token value",
        "<b>Basic Auth</b> — Username and password",
        "<b>API Key</b> — Key name, value, sent in header or query",
    ]:
        elements.append(Paragraph(f"• {auth}", styles['ManualBullet']))

    elements.append(Spacer(1, 8))
    elements.append(Paragraph(
        'Use the "Verify" button to test your credentials before running tests.',
        styles['Tip']))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 11. TEST RUNNER — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("11. Running Performance Tests", styles['SectionHead']))
    elements.append(Paragraph(
        "Switch to the Test Runner tab to configure and execute performance tests.",
        styles['Body']))

    add_step(elements, 1,
        "Open Test Runner Tab",
        "Click the 'Test Runner' tab in the header navigation.",
        styles, img('25-test-runner-tab.png'),
        "Figure 25: Test Runner tab — select tests to run")

    add_step(elements, 2,
        "Configure the Test Run",
        "Select a Feature Group or Scenario to test. Set the number of iterations "
        "and choose the execution mode.",
        styles, img('26-test-runner-configured.png'),
        "Figure 26: Test Runner configured and ready")

    elements.append(Paragraph("Execution Modes", styles['SubHead']))
    make_table(elements,
        ["Mode", "Behavior", "Best For"],
        [
            ["Sequential", "One request at a time", "Baseline measurements"],
            ["Parallel", "All requests at once", "Load testing"],
            ["Ramp-up", "Gradually increase concurrency", "Stress testing"],
        ], styles)

    add_step(elements, 3,
        "Click Run Test",
        "Press the ▶ Run Test button. Watch real-time progress as tests execute. "
        "Results are automatically saved when complete.",
        styles, img('27-test-runner-run-button.png'),
        "Figure 27: Run Test button — click to start execution")
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 12. RESULTS — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("12. Analyzing Results", styles['SectionHead']))
    elements.append(Paragraph(
        "After tests complete, switch to the Results tab to view detailed metrics.",
        styles['Body']))

    add_step(elements, 1,
        "Open Results Tab",
        "Click the 'Results' tab to see all historical test runs.",
        styles, img('28-results-dashboard.png'),
        "Figure 28: Results Dashboard — historical test runs")

    add_step(elements, 2,
        "View Detailed Metrics",
        "Click on a test run to see response time distributions, error rates, "
        "and per-request details. Scroll down for more data.",
        styles, img('29-results-metrics-scroll.png'),
        "Figure 29: Detailed metrics and charts")

    elements.append(Paragraph("Available Metrics", styles['SubHead']))
    for metric in [
        "<b>Average Response Time</b> — mean of all request durations",
        "<b>Min / Max</b> — fastest and slowest responses",
        "<b>P95 / P99</b> — 95th and 99th percentile response times",
        "<b>Error Rate</b> — percentage of failed requests",
        "<b>Status Code Distribution</b> — breakdown by HTTP status",
    ]:
        elements.append(Paragraph(f"• {metric}", styles['ManualBullet']))
    elements.append(Spacer(1, 8))
    elements.append(Paragraph(
        "You can export results as JSON or CSV for further analysis in spreadsheets.",
        styles['Body']))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 13. EXPORT & IMPORT — Step-by-step
    # ════════════════════════════════════════════
    elements.append(Paragraph("13. Export & Import", styles['SectionHead']))

    elements.append(Paragraph("Export Center", styles['SubHead']))
    elements.append(Paragraph(
        "Access via Settings → Export Data. Export your entire configuration or "
        "select specific items. Files are saved to <b>Documents/RedfireForge/</b> by default.",
        styles['Body']))
    add_image(elements, img('30-export-center.png'),
              "Figure 30: Export Center — select items to export", styles)
    elements.append(Paragraph(
        "Exported files use a standardized naming convention:<br/>"
        "<font face='Courier' size='10'>{environment}-{microservice}-{level}-{name}-{timestamp}.json</font>",
        styles['Body']))

    elements.append(Paragraph("Import Center", styles['SubHead']))
    elements.append(Paragraph(
        "Access via Settings → Import Data. Select a previously exported .json file. "
        "RedfireForge will detect conflicts and let you resolve them per item.",
        styles['Body']))
    add_image(elements, img('31-import-center.png'),
              "Figure 31: Import Center — choose a file and resolve conflicts", styles)
    make_table(elements,
        ["Action", "Behavior"],
        [
            ["Skip", "Keep existing, ignore imported item"],
            ["Overwrite", "Replace existing with imported item"],
            ["Keep Both", "Import as a new item with a new ID"],
        ], styles)
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 12. DESKTOP VS WEB
    # ════════════════════════════════════════════
    elements.append(Paragraph("14. Desktop vs Web Comparison", styles['SectionHead']))
    make_table(elements,
        ["Feature", "Desktop (Tauri)", "Web (Browser)"],
        [
            ["Storage", "OS AppData directory (files)", "Browser localStorage"],
            ["HTTP Requests", "Native HTTP (no CORS issues)", "Vite proxy required"],
            ["File Dialogs", "Native OS file dialogs", "Browser file picker"],
            ["Default Export Dir", "Documents/RedfireForge/", "Browser default"],
            ["Installation", ".dmg / .msi / .AppImage", "npm run dev"],
            ["Offline Use", "Yes — fully standalone", "No — needs dev server"],
            ["Data Persistence", "Survives browser cache clears", "Lost if cache cleared"],
        ], styles)
    elements.append(Paragraph(
        "The desktop application is recommended for daily use. "
        "The web version is useful for quick UI development and testing.",
        styles['Tip']))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 13. TIPS & BEST PRACTICES
    # ════════════════════════════════════════════
    elements.append(Paragraph("15. Tips & Best Practices", styles['SectionHead']))
    tips = [
        ("Organize by Environment",
         "Create one Feature Group per environment/microservice combination for clarity."),
        ("Use Global Auth Profiles",
         "Define credentials once in Settings → Global Auth Profiles. Let tests inherit "
         "rather than duplicating auth config in every test."),
        ("Export Regularly",
         "Export your configuration as a backup. Use Documents/RedfireForge/ to keep "
         "all exports organized."),
        ("Start Sequential, Then Parallel",
         "Validate your tests in Sequential mode first. Once they pass, "
         "switch to Parallel or Ramp-up for load testing."),
        ("Monitor P95/P99",
         "Average response time can hide outliers. Always check P95 and P99 "
         "for a realistic picture of user experience."),
        ("Use Drag-and-Drop",
         "As your test suite grows, use drag-and-drop to restructure "
         "scenarios and tests across Feature Groups."),
        ("Prefer Desktop App",
         "The desktop app has no CORS issues, uses native file dialogs, "
         "and stores data independently of browser cache."),
    ]
    for title, desc in tips:
        elements.append(Paragraph(f"<b>{title}</b>", styles['Body']))
        elements.append(Paragraph(desc, styles['ManualBullet']))
        elements.append(Spacer(1, 4))
    elements.append(PageBreak())

    # ════════════════════════════════════════════
    # 14. QUICK REFERENCE
    # ════════════════════════════════════════════
    elements.append(Paragraph("16. Quick Reference", styles['SectionHead']))
    make_table(elements,
        ["Action", "Where", "How"],
        [
            ["Switch views", "Header bar", "Click Feature Groups / Test Runner / Results"],
            ["Filter by env", "Sidebar", "Click an Environment"],
            ["Filter by service", "Sidebar", "Click Microservices tab"],
            ["Create Feature Group", "Feature Groups tab", "Click '+ Add Feature Group'"],
            ["Add Scenario", "Inside Feature Group", "Click '+ Add Scenario'"],
            ["Add Test", "Inside Scenario", "Click '+ Add Test'"],
            ["Reorder items", "Feature Groups", "Drag and drop"],
            ["Settings", "Sidebar", "Click ⚙ Settings"],
            ["Export config", "Settings modal", "Click Export Center"],
            ["Import config", "Settings modal", "Click Import Center"],
            ["Run tests", "Test Runner tab", "Configure → Click Run"],
            ["View results", "Results tab", "Browse historical runs"],
        ], styles)

    # ════════════════════════════════════════════
    # BACK COVER
    # ════════════════════════════════════════════
    elements.append(PageBreak())
    elements.append(Spacer(1, 2.5 * inch))
    elements.append(Paragraph("🔥 RedfireForge", styles['ManualTitle']))
    elements.append(Paragraph("Fire. Measure. Validate.", ParagraphStyle(
        'BackTagline', parent=styles['ManualSubtitle'],
        textColor=BRAND_ORANGE, fontName='Helvetica-Oblique',
        fontSize=16)))
    elements.append(Spacer(1, 0.5 * inch))
    elements.append(Paragraph(f"Version {version}", styles['ManualSubtitle']))

    doc.build(elements)
    print(f"✅ Created: {output_path}")


if __name__ == "__main__":
    version = sys.argv[1] if len(sys.argv) > 1 else "0.2.0"
    script_dir = Path(__file__).parent.parent
    img_dir = script_dir / "training-ppt" / "manual" / "images"
    output = script_dir / "training-ppt" / f"RedfireForge-Manual-{version}.pdf"
    (script_dir / "training-ppt").mkdir(exist_ok=True)
    generate(version, img_dir, str(output))
