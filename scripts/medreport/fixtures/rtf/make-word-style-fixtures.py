#!/usr/bin/env python3
"""
Fictional Word-style RTF fixtures for scripts/medreport/rtf-forms.test.ts (organisations end "(fictional)").

Writes the markup noise Word itself writes (\rtlch/\ltrch, rsids, panose, style sheet, list table,
theme data, \shppict/\nonshppict pictures, form-field data) so the converter is tested on realistic input:
  initial-assessment-report.rtf  (a) header fields + clinical sections in two-column tables, merged rows
  mail-merge-report.rtf          (c) MERGEFIELD fields and typed «…» placeholders, a page header, form fields
  tick-box-discharge.rtf         (d) Wingdings / Wingdings 2 boxes, FORMCHECKBOX, Unicode boxes, a SYMBOL field
progress-report-textedit.rtf (b) is macOS TextEdit output: textutil -convert rtf progress-report.html.

Run: python3 scripts/medreport/fixtures/rtf/make-word-style-fixtures.py scripts/medreport/fixtures/rtf
"""
import sys
import binascii

RSID = "\\insrsid4542631"
PNG_1x1 = "89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360f80f0000010100005c1b2a0d0000000049454e44ae426082"

def esc(text):
    out = []
    for ch in text:
        o = ord(ch)
        if ch in "\\{}":
            out.append("\\" + ch)
        elif o < 0x80:
            out.append(ch)
        else:
            try:
                b = ch.encode("cp1252")
                out.append("\\'%02x" % b[0])
            except UnicodeEncodeError:
                n = o if o < 0x8000 else o - 0x10000
                out.append("\\u%d\\'3f" % n)
    return "".join(out)

HEADER = r"""{\rtf1\adeflang1025\ansi\ansicpg1252\uc1\adeff31507\deff0\stshfdbch31505\stshfloch31506\stshfhich31506\stshfbi31507\deflang2057\deflangfe2057\themelang2057\themelangfe0\themelangcs0{\fonttbl{\f0\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}{\f1\fbidi \fswiss\fcharset0\fprq2{\*\panose 020b0604020202020204}Arial;}
{\f2\fbidi \fnil\fcharset2\fprq2{\*\panose 05000000000000000000}Wingdings;}{\f3\fbidi \froman\fcharset2\fprq2{\*\panose 05050102010706020507}Symbol;}{\f4\fbidi \froman\fcharset2\fprq2{\*\panose 05020102010507070707}Wingdings 2;}
{\flomajor\f31500\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}{\fdbmajor\f31501\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}
{\fhimajor\f31502\fbidi \fswiss\fcharset0\fprq2{\*\panose 020f0302020204030204}Calibri Light;}{\fbimajor\f31503\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}
{\flominor\f31504\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}{\fdbminor\f31505\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}
{\fhiminor\f31506\fbidi \fswiss\fcharset0\fprq2{\*\panose 020f0502020204030204}Calibri;}{\fbiminor\f31507\fbidi \froman\fcharset0\fprq2{\*\panose 02020603050405020304}Times New Roman;}{\f41\fbidi \froman\fcharset238\fprq2 Times New Roman CE;}}
{\colortbl;\red0\green0\blue0;\red0\green0\blue255;\red0\green255\blue255;\red0\green255\blue0;\red255\green0\blue255;\red255\green0\blue0;\red255\green255\blue0;\red255\green255\blue255;\red0\green0\blue128;\red0\green128\blue128;\red0\green128\blue0;
\red128\green0\blue128;\red128\green0\blue0;\red128\green128\blue0;\red128\green128\blue128;\red192\green192\blue192;\red31\green56\blue100;\red217\green226\blue243;\ctextone\ctint255\cshade255\red0\green0\blue0;}
{\*\defchp \f1\fs22\lang2057\langfe1033\langfenp1033 }{\*\defpap \ql \li0\ri0\sa160\sl259\slmult1\widctlpar\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0\itap0 }\noqfpromote {\stylesheet{\ql \li0\ri0\sa160\sl259\slmult1\widctlpar\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0\itap0 \rtlch\fcs1 \af31507\afs22\alang1025 \ltrch\fcs0 
\f1\fs22\lang2057\langfe1033\cgrid\langnp2057\langfenp1033 \snext0 \sqformat \spriority0 Normal;}{\s1\ql \li0\ri0\sb240\sa120\keepn\widctlpar\wrapdefault\aspalpha\aspnum\faauto\outlinelevel0\adjustright\rin0\lin0\itap0 \rtlch\fcs1 \ab\af31507\afs32\alang1025 \ltrch\fcs0 
\b\f1\fs32\cf17\lang2057\langfe1033\kerning32\cgrid\langnp2057\langfenp1033 \sbasedon0 \snext0 \slink15 \sqformat \spriority9 \styrsid4542631 heading 1;}{\s2\ql \li0\ri0\sb200\sa80\keepn\widctlpar\wrapdefault\aspalpha\aspnum\faauto\outlinelevel1\adjustright\rin0\lin0\itap0 \rtlch\fcs1 \ab\af31507\afs26\alang1025 \ltrch\fcs0 
\b\f1\fs26\cf17\lang2057\langfe1033\cgrid\langnp2057\langfenp1033 \sbasedon0 \snext0 \slink16 \sqformat \spriority9 heading 2;}{\*\cs10 \additive \ssemihidden \sunhideused \spriority1 Default Paragraph Font;}{\*
\ts11\tsrowd\trftsWidthB3\trpaddl108\trpaddr108\trpaddfl3\trpaddft3\trpaddfb3\trpaddfr3\trcbpat1\trcfpat1\tblind0\tblindtype3\tsvertalt\tsbrdrt\tsbrdrl\tsbrdrb\tsbrdrr\tsbrdrdgl\tsbrdrdgr\tsbrdrh\tsbrdrv \ql \li0\ri0\sa160\sl259\slmult1
\widctlpar\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0\itap0 \rtlch\fcs1 \af31507\afs22\alang1025 \ltrch\fcs0 \f1\fs22\lang2057\langfe1033\cgrid\langnp2057\langfenp1033 \snext11 \ssemihidden \sunhideused Normal Table;}{\*\cs15 \additive 
\rtlch\fcs1 \ab\af0\afs32 \ltrch\fcs0 \b\f1\fs32\cf17\kerning32 \sbasedon10 \slink1 \slocked \spriority9 Heading 1 Char;}{\s17\ql \li0\ri0\widctlpar\tqc\tx4513\tqr\tx9026\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0\itap0 \rtlch\fcs1 \af31507\afs22\alang1025 
\ltrch\fcs0 \f1\fs22\lang2057\langfe1033\cgrid\langnp2057\langfenp1033 \sbasedon0 \snext17 \slink18 \sunhideused header;}}{\*\listtable{\list\listtemplateid-1468722766\listhybrid{\listlevel\levelnfc23\levelnfcn23\leveljc0\leveljcn0\levelfollow0\levelstartat1
\levelspace0\levelindent0{\leveltext\leveltemplateid134807553\'01\u-3913 ?;}{\levelnumbers;}\f3\fbias0\hres0\chhres0 \fi-360\li720\lin720 }{\listname ;}\listid1250460170}}{\*\listoverridetable{\listoverride\listid1250460170\listoverridecount0\ls1}}
{\*\rsidtbl \rsid4542631\rsid9779621}{\mmathPr\mmathFont34\mbrkBin0\mbrkBinSub0\msmallFrac0\mdispDef1\mlMargin0\mrMargin0\mdefJc1\mwrapIndent1440\mintLim0\mnaryLim1}{\info{\title %(title)s}{\author Template Author}{\operator Template Author}
{\creatim\yr2026\mo10\dy1\hr9\min0}{\revtim\yr2026\mo10\dy1\hr9\min30}{\version2}{\edmins12}{\nofpages2}{\nofwords320}{\nofchars1830}{\nofcharsws2140}{\vern121}}{\*\xmlnstbl {\xmlns1 http://schemas.microsoft.com/office/word/2003/wordml}}
\paperw11906\paperh16838\margl1134\margr1134\margt1134\margb1134\gutter0\ltrsect 
\widowctrl\ftnbj\aenddoc\trackmoves0\trackformatting1\donotembedsysfont1\relyonvml0\donotembedlingdata0\grfdocevents0\validatexml1\showplaceholdtext0\ignoremixedcontent0\saveinvalidxml0\showxmlerrors1\noxlattoyen
\expshrtn\noultrlspc\dntblnsbdb\nospaceforul\formshade\horzdoc\dgmargin\dghspace180\dgvspace180\dghorigin1134\dgvorigin1134\dghshow1\dgvshow1
\jexpand\viewkind1\viewscale100\pgbrdrhead\pgbrdrfoot\splytwnine\ftnlytwnine\htmautsp\nolnhtadjtbl\useltbaln\alntblind\lytcalctblwd\lyttblrtgr\lnbrkrule\nobrkwrptbl\snaptogridincell\allowfieldendsel\wrppunct
\asianbrkrule\rsidroot4542631\newtblstyruls\nogrowautofit\usenormstyforlist\noindnmbrts\felnbrelev\nocxsptable\indrlsweleven\noafcnsttbl\afelev\utinl\hwelev\spltpgpar\notcvasp\notbrkcnstfrctbl\notvatxbx\krnprsnet\cachedcolbal \nouicompat \fet0
{\*\wgrffmtfilter 2450}\nofeaturethrottle1\ilfomacatclnup0{\*\ftnsep \ltrpar \pard\plain \ltrpar\ql \li0\ri0\widctlpar\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0\itap0 \rtlch\fcs1 \af31507\afs22\alang1025 \ltrch\fcs0 
\f1\fs22\lang2057\langfe1033\cgrid\langnp2057\langfenp1033 {\rtlch\fcs1 \af31507 \ltrch\fcs0 \insrsid4542631 \chftnsep 
\par }}\ltrpar \sectd \ltrsect\linex0\headery709\footery709\colsx708\endnhere\sectlinegrid360\sectdefaultcl\sftnbj %(sectextra)s{\*\pnseclvl1\pnucrm\pnstart1\pnindent720\pnhang {\pntxta .}}"""

PLAIN = r"\rtlch\fcs1 \af31507\afs22\alang1025 \ltrch\fcs0 \f1\fs22\lang2057\langfe1033\cgrid\langnp2057\langfenp1033 "
PARD = r"\pard\plain \ltrpar\ql \li0\ri0\sa160\sl259\slmult1\widctlpar\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0\itap0 " + PLAIN
PARD_TBL = r"\pard\plain \ltrpar\ql \li0\ri0\widctlpar\intbl\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0 " + PLAIN

def run(text, fmt=""):
    return r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 %s%s %s}" % (fmt, RSID, esc(text))

def para(content, pard=PARD):
    return pard + content + r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 " + RSID + r" \par }" + "\n"

def heading(text, level=1):
    size = 32 if level == 1 else 26
    pard = (r"\pard\plain \ltrpar\s%d\ql \li0\ri0\sb240\sa120\keepn\widctlpar\wrapdefault\aspalpha\aspnum\faauto\outlinelevel%d\adjustright\rin0\lin0\itap0 "
            r"\rtlch\fcs1 \ab\af31507\afs%d\alang1025 \ltrch\fcs0 \b\f1\fs%d\cf17\lang2057\langfe1033\kerning32\cgrid\langnp2057\langfenp1033 ") % (level, level - 1, size, size)
    return pard + run(text) + r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 " + RSID + r" \par }" + "\n"

def border(side):
    return r"\clbrdr%s\brdrs\brdrw10 " % side

def rowdef(irow, cells, last=False, header=False):
    """cells: list of (right, extra) where extra holds cell props such as \\clmgf or \\clcbpat18."""
    s = r"\trowd \irow%d\irowband%d\ltrrow\ts11\trgaph108\trleft-108\trbrdrt\brdrs\brdrw10 \trbrdrl\brdrs\brdrw10 \trbrdrb\brdrs\brdrw10 \trbrdrr\brdrs\brdrw10 \trbrdrh\brdrs\brdrw10 \trbrdrv\brdrs\brdrw10 " % (irow, irow)
    if header:
        s += r"\trhdr"
    s += r"\trftsWidth1\trftsWidthB3\trftsWidthA3\trautofit1\trpaddl108\trpaddr108\trpaddfl3\trpaddft3\trpaddfb3\trpaddfr3\tblrsid4542631\tbllkhdrrows\tbllklastrow\tbllkhdrcols\tbllklastcol\tblind0\tblindtype3 "
    if last:
        s += r"\lastrow "
    prev = -108
    for right, extra in cells:
        s += r"\clvertalt" + border("t") + border("l") + border("b") + border("r") + extra + r"\cltxlrtb\clftsWidth3\clwWidth%d\clshdrawnil \cellx%d" % (right - prev, right)
        prev = right
    return s + "\n"

def table_row(irow, cells, contents, last=False, header=False):
    """contents: list of RTF content strings (already escaped runs) for each cell."""
    d = rowdef(irow, cells, last, header)
    s = d
    for c in contents:
        s += PARD_TBL + c + r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 " + RSID + r" \cell }"
    s += PARD_TBL.replace(r"\intbl", r"\intbl") + r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 " + RSID + " " + d + r"\row }" + "\n"
    return s

def merge_field(name, result=True):
    res = r"{\fldrslt {\rtlch\fcs1 \af31507 \ltrch\fcs0 \lang1024\langfe1024\noproof%s %s}}" % (RSID, esc("«%s»" % name)) if result else r"{\fldrslt }"
    return r"{\field{\*\fldinst {\rtlch\fcs1 \af31507 \ltrch\fcs0 %s  MERGEFIELD %s \\* MERGEFORMAT }}%s}" % (RSID, name, res)

def form_text(name):
    return (r"{\field\flddirty{\*\fldinst {\rtlch\fcs1 \af31507 \ltrch\fcs0 %s  FORMTEXT }{\rtlch\fcs1 \af31507 \ltrch\fcs0 %s {\*\datafield 800100000000000005%s0000000000}"
            r"{\*\formfield{\fftype0\ffownhelp\ffownstat\fftypetxt0{\*\ffname %s}}}}}{\fldrslt {\rtlch\fcs1 \af31507 \ltrch\fcs0 \noproof%s \u8194\'20\u8194\'20\u8194\'20\u8194\'20\u8194\'20}}}") % (RSID, RSID, binascii.hexlify(name.encode()).decode(), name, RSID)

def form_check(name, checked=False):
    return (r"{\field{\*\fldinst {\rtlch\fcs1 \af31507 \ltrch\fcs0 %s  FORMCHECKBOX }{\rtlch\fcs1 \af31507 \ltrch\fcs0 %s {\*\datafield 650000001400000006%s0000000000}"
            r"{\*\formfield{\fftype1\ffres25\fftypetxt0\ffhps20%s{\*\ffname %s}}}}}{\fldrslt }}") % (RSID, RSID, binascii.hexlify(name.encode()).decode(), r"\ffdefres1" if checked else "", name)

def form_dropdown(name, items, sel=0):
    ffl = "".join(r"{\*\ffl %s}" % esc(i) for i in items)
    return (r"{\field{\*\fldinst {\rtlch\fcs1 \af31507 \ltrch\fcs0 %s  FORMDROPDOWN }{\rtlch\fcs1 \af31507 \ltrch\fcs0 %s "
            r"{\*\formfield{\fftype2\ffres25\fftypetxt0\ffhps20\ffdefres%d{\*\ffname %s}%s}}}}{\fldrslt }}") % (RSID, RSID, sel, name, ffl)

def wingdings_box(font=2, code=0xa8):
    return r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 \f%d%s \'%02x}" % (font, RSID, code)

def symbol_field(code, font):
    return r'{\field{\*\fldinst {\rtlch\fcs1 \af31507 \ltrch\fcs0 %s  SYMBOL %d \\f "%s" \\s 11}}{\fldrslt {\rtlch\fcs1 \af31507 \ltrch\fcs0 \f2\fs22%s}}}' % (RSID, code, font, RSID)

def picture_group():
    return r"{\*\shppict{\pict{\*\picprop\shplid1025{\sp{\sn shapeType}{\sv 75}}{\sp{\sn fFlipH}{\sv 0}}}\picscalex100\picscaley100\piccropl0\piccropr0\piccropt0\piccropb0\picw26\pich26\picwgoal15\pichgoal15\pngblip\bliptag-1\blipupi96{\*\blipuid 0}" + PNG_1x1 + r"}}{\nonshppict{\pict\picscalex100\picscaley100\picw26\pich26\picwgoal15\pichgoal15\wmetafile8\bliptag-1 010009000003" + "00" * 40 + "}}"

def header_group(kind, content):
    return r"{\%s \ltrpar \pard\plain \ltrpar\s17\ql \li0\ri0\widctlpar\tqc\tx4513\tqr\tx9026\wrapdefault\aspalpha\aspnum\faauto\adjustright\rin0\lin0\itap0 " % kind + PLAIN + content + r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 " + RSID + r" \par }}" + "\n"

def page_field(instr, result):
    return r"{\field{\*\fldinst {\rtlch\fcs1 \af31507 \ltrch\fcs0 %s  %s }}{\fldrslt {\rtlch\fcs1 \af31507 \ltrch\fcs0 \lang1024\langfe1024\noproof%s %s}}}" % (RSID, instr, RSID, result)

def document(title, headers, body, sectextra=""):
    return HEADER % {"title": esc(title), "sectextra": sectextra} + "".join(headers) + body + r"{\*\themedata 504b030414000600080000002100e9de0fbfff0000001c020000130000005b436f6e74656e745f54797065735d2e786d6cac91cb4ec3301045f748fc83e52d4a}" + "\n" + r"{\*\colorschememapping 3c3f786d6c2076657273696f6e3d22312e30}" + "\n}"


OUT = sys.argv[1]
B = r"\b"

# (a) Word-style Initial Assessment Report: header fields + clinical sections in a two-column table ----------
def fixture_a():
    headers = [
        header_group("header", picture_group() + run("Larchfield Medico-Legal Services (fictional)", r"\b") + run("\tInitial Physiotherapy Assessment Report", "")),
        header_group("footer", run("Larchfield Medico-Legal Services (fictional) – Page ") + page_field("PAGE", "1") + run(" of ") + page_field("NUMPAGES", "2")),
    ]
    body = ""
    body += heading("Initial Physiotherapy Assessment Report", 1)
    body += para(run("Please complete every section. Where information is not available, say so. The completed report is disclosed to all parties, so write in plain English and avoid abbreviations.", r"\i"))
    W1, W2 = 3402, 9638
    rows = [
        ("Claimant’s full name", ""),
        ("Date of birth", ""),
        ("Our reference", ""),
        ("Date of accident", ""),
        ("Instructing solicitor", ""),
    ]
    body += heading("Section 1 – Claimant details", 2)
    for i, (label, _) in enumerate(rows):
        body += table_row(i, [(W1, r"\clcbpat18 "), (W2, "")], [run(label, B), ""], last=(i == len(rows) - 1))
    body += para("")
    body += heading("Section 2 – Clinical findings", 2)
    clinical = [
        "Mechanism of injury",
        "Presenting complaint",
        "Pre-accident medical history",
        "Examination findings",
        "Treatment provided to date",
        "Number of sessions attended",
    ]
    irow = 0
    # A shaded heading row merged across both columns (old-style \clmgf / \clmrg).
    body += table_row(irow, [(W1, r"\clmgf\clcbpat17 "), (W2, r"\clmrg\clcbpat17 ")], [run("CLINICAL FINDINGS (to be completed by the treating physiotherapist)", r"\b\cf8"), ""], header=True)
    irow += 1
    for label in clinical:
        body += table_row(irow, [(W1, ""), (W2, "")], [run(label, B), ""])
        irow += 1
    # Outcome measures: a label cell merged vertically over two rows, with a third column.
    M = 6237
    body += table_row(irow, [(W1, r"\clvmgf "), (M, ""), (W2, "")], [run("Outcome measures", B), run("Score at assessment"), ""])
    irow += 1
    body += table_row(irow, [(W1, r"\clvmrg "), (M, ""), (W2, "")], ["", run("Score at discharge"), ""])
    irow += 1
    body += table_row(irow, [(W1, ""), (W2, "")], [run("Prognosis", B), ""], last=True)
    body += para("")
    # Page break, then the declaration.
    body += PARD + r"{\rtlch\fcs1 \af31507 \ltrch\fcs0 " + RSID + r" \page }" + "\n"
    body += heading("Section 3 – Declaration", 2)
    body += para(run("I confirm that this report is accurate to the best of my knowledge and that I have treated the claimant named above. Fees are payable at £" + "85 per report."))
    body += para(run("Signed: ____________________________   Date: ______________"))
    body += para(run("Physiotherapist’s name: ______________________   HCPC number: ____________"))
    return document("Initial Physiotherapy Assessment Report", headers, body)

# (c) Mail-merge template: MERGEFIELD fields and typed «…» placeholders at the top, a page header ------
def fixture_c():
    headers = [
        header_group("header", run("Wrenfield Reporting Partners (fictional)", r"\b") + run("\tRe: ") + merge_field("Patient_Name") + run("\tRef: «Clinic_Ref»")),
    ]
    body = ""
    body += heading("Treating Physiotherapist Report", 1)
    body += para(run("Patient: ", B) + merge_field("Patient_Name"))
    body += para(run("Address: ", B) + merge_field("Patient_Address"))
    body += para(run("Date of birth: ", B) + merge_field("DOB"))
    body += para(run("Treating physiotherapist: ", B) + merge_field("Physio_Name", result=False))
    body += para(run("Our reference: ", B) + run("«Clinic_Ref»"))
    body += para(run("Referral date: ", B) + run("<<Referral_Date>>"))
    body += para(run("Case number: [Case_ID]"))
    # The details table a practice system merges into: merge fields alone in the answer cells.
    W1, W2 = 3402, 9638
    rows = [
        ("Patient name", merge_field("Patient_Name")),
        ("Referral reference", run("«Referral Ref»")),
        ("Treating therapist", merge_field("Therapist")),
        ("HCPC number", run("«") + run("HCPC", r"\b") + run("»")),
    ]
    for i, (label, content) in enumerate(rows):
        body += table_row(i, [(W1, ""), (W2, "")], [run(label, B), content], last=(i == len(rows) - 1))
    body += para("")
    body += heading("1. Diagnosis", 2)
    body += para(run("Working diagnosis: ") + form_text("Diagnosis"))
    body += heading("2. Current symptoms", 2)
    body += para("")
    body += para("")
    body += heading("3. Treatment and progress", 2)
    body += para("")
    body += para("")
    body += heading("4. Fitness for work", 2)
    body += para(run("Current fitness for work: ") + form_dropdown("Fitness", ["Fit", "Fit with adjustments", "Unfit"], 0))
    body += heading("5. Prognosis", 2)
    body += para("")
    body += para(run("Signed: ______________________   Date: ____________"))
    return document("Treating Physiotherapist Report", headers, body)

# (d) Tick boxes: Wingdings / Wingdings 2 boxes, FORMCHECKBOX fields, Unicode boxes and a SYMBOL field ------------
def fixture_d():
    body = ""
    body += heading("Physiotherapy Discharge Summary", 1)
    body += para(run("Brookvale Rehabilitation (fictional)", B))
    body += para(run("Patient name: ______________________"))
    body += para(run("Discharged from treatment?   Yes ") + wingdings_box(2, 0xa8) + run("   No ") + wingdings_box(2, 0xa8))
    body += para(run("Treatment goals met:   Fully ") + form_check("Goals1") + run("   Partly ") + form_check("Goals2") + run("   Not met ") + form_check("Goals3"))
    body += para(run("Home exercise programme given   ") + form_check("HEP", checked=True))
    body += para(run("Onward referral:   GP ") + run("☐") + run("   Consultant ") + run("☐") + run("   None ") + run("☐"))
    body += para(run("Patient consent to share this summary:   Yes ") + wingdings_box(4, 0xa3) + run("   No ") + symbol_field(111, "Wingdings"))
    W1, W2 = 4820, 9638
    body += table_row(0, [(W1, ""), (W2, "")], [run("Able to return to normal activities", B), run("Yes ") + wingdings_box(2, 0xa8) + run("  No ") + wingdings_box(2, 0xa8)])
    body += table_row(1, [(W1, ""), (W2, "")], [run("Pain at discharge (0–10)", B), ""], last=True)
    body += para(run("Comments:"))
    body += para("")
    body += para(run("• Please return this form within 14 days.", ""))
    return document("Physiotherapy Discharge Summary", [], body)

for name, fn in [("initial-assessment-report.rtf", fixture_a), ("mail-merge-report.rtf", fixture_c), ("tick-box-discharge.rtf", fixture_d)]:
    data = fn()
    data.encode("ascii")  # RTF is 7-bit
    open(f"{OUT}/{name}", "w", newline="\r\n").write(data)
    print(name, len(data))
