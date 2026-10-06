# Set for Life Financial Snapshot — Wireframe Specification v1

**Status:** Content architecture and low-fidelity wireframe specification for web Snapshot.

**Sequence:** Content blueprint → wireframe → approved visual design → production HTML/Next.js implementation.

## Global rules

- Participant-facing experience is qualitative, not a report card. No overall score.
- Human photography is limited to Section 1 Hero. Remaining sections use abstract/editorial/data visuals.
- Dynamic hero selection uses only the participant’s explicit gender response; never infer.
- Web copy is concise; expanded connective narrative belongs in the PDF.
- Perception Gap remains deferred for pilot and is not shown as a placeholder or missing section.
- The CTA is a replaceable campaign block. Current campaign: Financial Makeover Masterclass.

## 1. Snapshot Hero / Opening

**Purpose:** Tell the participant what they are looking at, create immediate personal relevance, and move them naturally into the results without introducing diagnostic interpretation.

**Required content**
- Eyebrow: YOUR SET FOR LIFE FINANCIAL SNAPSHOT
- Personalization: Prepared for {FIRST_NAME} when a verified first name exists
- Primary statement: Here is what your responses reveal.
- Conceptual line: One answer is a detail. Together, they make a picture.
- Transition cue: SEE MY PICTURE

**Visual asset / treatment:** One prominent editorial hero portrait. This is the only section that uses recognizable people as the dominant image.

**Suggested size:** Desktop hero image ~42–48% of section width; 4:5 portrait crop; source master 1600×1800 px or larger. Hero section target visual height ~650–760 px.

**Suggested word count:** Eyebrow 4–8 words; personalization 5–8; declaration 6–12; support 10–18; transition cue 2–5.

**Dynamic rules:** Gender response only: Female → approved Black woman hero; Male → approved Black man hero; Prefer not to say / missing / unsupported → approved neutral image with both Black woman and Black man or equivalent neutral editorial scene. Never infer gender from name, email, photo, age, or other data.

**Mobile behavior:** Words first, then portrait, then transition cue. Image becomes full-width stacked.

**Implementation notes:** No scores, recommendations, findings, or diagnostic jargon. Keep copy intentionally sparse.

## 2. Your Big Picture

**Purpose:** Provide the 30-second executive summary of the participant’s current financial picture before deeper interpretation.

**Required content**
- Overall Picture: 1 concise synthesis statement
- What’s Working: 1–2 bullets
- Where There’s Friction: 1–2 bullets when meaningful friction exists
- Worth Noticing: 1 primary connection insight

**Visual asset / treatment:** No human photography. Use restrained abstract editorial art showing separate pieces becoming coherent—overlap, focus, alignment, or connection.

**Suggested size:** Full-width section. Abstract transition graphic ~1200×250–350 px if used. Graphic should command ~15–25% of visual attention, not half the section.

**Suggested word count:** Orientation 15–25 words; Overall Picture 30–55; each strength/friction bullet 12–24; Worth Noticing headline 4–10; body 30–60. Ideal total 125–220 words.

**Dynamic rules:** The engine may use Strength + Friction + Context + Connection + Activation, but the UI does not need five equal boxes. Context and activation modify the synthesis when meaningful. If no meaningful friction exists, do not invent one; omit or replace with an approved neutral continuation state.

**Mobile behavior:** Stack Overall Picture → What’s Working → Friction if present → abstract transition → Worth Noticing.

**Implementation notes:** This is a summary, not a duplicate of later sections. The PDF may expand the prose.

## 3. Your Set for Life Money Picture™

**Purpose:** Show the six parts of the participant’s financial picture and how each currently presents, without converting them into an overall score.

**Required content**
- WHAT CAN YOU SEE?
- HOW MUCH ROOM DO YOU HAVE?
- HOW ARE YOU MAKING DECISIONS?
- HOW PREPARED ARE YOU FOR DISRUPTION?
- WHERE ARE YOU HEADED?
- WHAT HAPPENS AFTER YOU KNOW?
- For each: qualitative state label + concise interpretation

**Visual asset / treatment:** Signature Money Picture Map: YOU in the center with six equal nodes around it. Follow with six readable interpretation panels.

**Suggested size:** Desktop map ~1100–1200×650–760 px; center element ~180–220 px diameter; nodes ~240–290×110–150 px. Interpretation grid 2 columns desktop, stacked mobile.

**Suggested word count:** Intro 25–45 words; state label ideally 2–6 words; interpretation 20–40 words each; hard web max ~55 words each.

**Dynamic rules:** Questions are fixed; state labels and interpretations are dynamic. All six nodes remain structurally equal regardless of state. No node changes size or placement based on outcome.

**Mobile behavior:** Use simplified connected overview, then six stacked dimension cards. Do not miniaturize the full desktop map.

**Implementation notes:** No raw 1–5 values, percentages, overall score, ranking, traffic-light colors, radar chart, or internal SEE/ROOM/DIRECT/PREPARE/AIM/MOVE codes.

## 4. What’s Already Working for You

**Purpose:** Identify genuine, evidence-supported financial strengths so the participant sees what can be built upon.

**Required content**
- 1–3 evidence-supported strengths only
- For each: strength label + concise why-it-matters interpretation

**Visual asset / treatment:** No photography. Editorial panels with abstract foundation/momentum motifs. Avoid gamified “success” iconography.

**Suggested size:** 1 strength: featured panel ~900–1050×260–340 px. 2 strengths: two panels ~520–560×280–340 px. 3 strengths: three panels ~340–370×290–360 px.

**Suggested word count:** Section intro 20–30 words; label 2–7; explanation 25–45; hard max ~55 words per strength.

**Dynamic rules:** 0 strengths → omit section. 1 → featured layout. 2 → 2-column. 3 → 3-column. Never fabricate strengths for symmetry.

**Mobile behavior:** Stack all present strengths. No carousel or accordion.

**Implementation notes:** Acknowledgment, not praise. No “financially healthy,” rankings, or comparisons to others.

## 5. Where There’s Friction

**Purpose:** Identify the places where the participant’s financial life appears tighter, harder, inconsistent, or less aligned—without shame or alarm.

**Required content**
- 1–3 meaningful friction findings
- For each: friction label + plain-English explanation
- Optional context sentence where necessary to prevent misinterpretation (e.g., capacity constraints)

**Visual asset / treatment:** No photography. Restrained abstract tension motifs: offset layers, narrowing bands, interrupted lines, subtle asymmetry.

**Suggested size:** 1 friction: featured full-width panel. 2: balanced 2-column. 3: stacked editorial rows preferred when copy needs nuance.

**Suggested word count:** Intro 20–30 words; label 2–8; body 30–50; optional context 15–30; hard max ~70 words per finding.

**Dynamic rules:** 0 meaningful friction → omit section. Never manufacture a problem to preserve layout symmetry.

**Mobile behavior:** Stack all findings with generous spacing. No carousel.

**Implementation notes:** Do not equate low margin with low agency. Avoid danger-red treatment and punitive language.

## 6. The Connection / Here’s the Part Worth Noticing

**Purpose:** Create the “I had not connected those two things” moment by showing how findings may be interacting.

**Required content**
- Primary connection headline
- Primary connection explanation
- Optional secondary connection headline + explanation
- If reliable participant-facing “Side A / Side B” labels exist, they may be used in the relationship diagram

**Visual asset / treatment:** Relational diagram: two equal-weight points/forms connected to a central interpretation. If Side A/B cannot be supported cleanly by resolved data, use abstract nodes rather than inventing labels.

**Suggested size:** Main relationship visualization ~900–1100×350–500 px; finding blocks ~260–340×100–150 px.

**Suggested word count:** Headline 4–12 words; Side labels 3–10; primary body 40–70; secondary body 25–45.

**Dynamic rules:** 0 connections → omit section. 1 → full featured treatment. 2 → one featured + one subordinate. Never show more than two.

**Mobile behavior:** Simplify relationship graphic vertically; keep actual headline/body as real text.

**Implementation notes:** Use relational language (“may be connected,” “worth noticing alongside”), not unsupported causation (“this caused that”).

## 7. What “Set for Life” Means to You

**Purpose:** Reflect the participant’s own stated aspirations back to them and reconnect the assessment to what they want money to make possible.

**Required content**
- Participant Q16 destination themes, displayed unranked
- Optional short framing line
- Neutral treatment for Destination Still Forming

**Visual asset / treatment:** No photography. Spacious aspirational treatment using horizon, constellation, pathway, or light abstract forms—without luxury-flex imagery.

**Suggested size:** Theme blocks flex to count: 1 large feature; 2 equal blocks; 3–4 two-column grid; 5+ clean responsive grid without shrinking type excessively.

**Suggested word count:** Framing 15–25 words; theme label 1–6; optional supporting phrase 8–18; closing reflection 10–20.

**Dynamic rules:** All selected themes display with equal dignity. No primary/secondary ranking unless the source question itself creates one. “Destination Still Forming” remains neutral.

**Mobile behavior:** Stack all themes; no hidden “view more” if avoidable.

**Implementation notes:** Do not score, rank, or reinterpret a participant’s aspirations into advisor language.

## 8. Your Readiness Right Now

**Purpose:** Show four distinct forms of activation without averaging them into a single readiness or motivation score.

**Required content**
- Urgency
- Readiness
- Commitment
- Support Readiness
- For each: qualitative state + concise interpretation

**Visual asset / treatment:** Four equal editorial indicators/columns, not gauges. Optional independent dot/line indicators may be used if they do not imply one shared numeric axis.

**Suggested size:** Four equal columns desktop; stacked blocks mobile. Keep substantial negative space and minimal chrome.

**Suggested word count:** Intro 18–30 words; state label 1–4; interpretation 20–40; hard max ~50 words each.

**Dynamic rules:** All four dimensions always display separately. No averaging, no total readiness score, no CTA preselection based on support readiness.

**Mobile behavior:** Stack all four dimensions. No carousel or accordion.

**Implementation notes:** Avoid LOW/MID/HIGH as dominant UI if a more human participant-facing state phrase is available.

## 9. One Area Worth Examining Next

**Purpose:** Reduce overwhelm by naming one educationally relevant area that deserves attention next, without prescribing a financial product or strategy.

**Required content**
- Primary attention-area label
- Primary explanation of why it rises to the surface
- Optional secondary attention area, clearly subordinate

**Visual asset / treatment:** Spotlight/focus motif—one clear point emerging from a broader field. Avoid warnings, targets, or “Priority #1” badges.

**Suggested size:** Primary feature panel centered, visually dominant. Secondary area appears as a smaller text block below if present.

**Suggested word count:** Framing 18–30 words; primary label 2–7; body 40–70; hard max ~85; secondary body 20–40.

**Dynamic rules:** Primary is required when available. Secondary is optional; if absent, no placeholder appears.

**Mobile behavior:** Single-column, large label + explanation, then optional secondary block.

**Implementation notes:** Educational focus, not advice. Avoid “you need to,” product recommendations, allocations, replacement/surrender language.

## 10. Configurable Next-Step CTA — Current Campaign: Financial Makeover Masterclass

**Purpose:** Invite the participant to continue the experience after substantive Snapshot value has already been delivered. The section is permanent; the campaign content is replaceable.

**Required content**
- Eyebrow: READY TO GO DEEPER?
- Headline: Your Snapshot helped you see the picture. Now let’s help you understand what to do with what you see.
- Supporting copy 35–60 words
- Three bullets
- Primary button: SAVE MY SEAT FOR THE MASTERCLASS
- Current URL: https://masterclass.setforlifelive.com/register

**Visual asset / treatment:** LOCKED OPTION A: full-width Evergreen background, Ivory typography, Champagne/Gold accents. No person photography. Use subtle abstract “opening / horizon / path” motif.

**Suggested size:** Full-width closing invitation, target visual height ~500–650 px desktop.

**Suggested word count:** Eyebrow 3–6 words; headline 8–18; body 35–60; exactly 3 bullets, 8–16 words each; button 4–8 words.

**Dynamic rules:** Campaign fields must be config-driven: eyebrow, headline, body, bullets, button label, URL, campaign ID, active state, optional tracking. Future campaigns may point to appointment scheduling or another experience without changing Snapshot structure.

**Mobile behavior:** Single column, full-width button. Keep bullets visible and concise.

**Implementation notes:** LOCKED bullets: “See your financial picture more clearly”; “Understand which areas deserve your attention”; “Learn how to think about your next moves with greater intention.” CTA is an invitation, never a diagnosis-driven requirement.

## 11. Download My Financial Snapshot

**Purpose:** Give the participant a simple utility action to keep and revisit the personalized PDF, distinct from the promotional continuation CTA.

**Required content**
- Heading: KEEP YOUR SNAPSHOT
- Short explanatory line
- Button: DOWNLOAD MY FINANCIAL SNAPSHOT
- Optional miniature PDF-cover preview

**Visual asset / treatment:** Quiet Ivory utility block with Evergreen/Gold accents. No photography. Small report preview recommended.

**Suggested size:** Compact section. PDF preview ~140–180 px wide desktop; ~110–140 px mobile.

**Suggested word count:** Heading 2–5 words; supporting copy 18–30; fixed button label; optional file note 3–8.

**Dynamic rules:** Signed/private PDF URL. States: Ready / Preparing / Failed with human error copy. Download must never require Masterclass registration or additional form completion.

**Mobile behavior:** Preview above copy, full-width download button.

**Implementation notes:** Masterclass = continue the journey. Download = keep the results. Do not make the actions compete visually.

## 12. Disclosure / Set for Life Footer

**Purpose:** Close the Snapshot with the approved educational disclosure and brand in a quiet, readable endpoint.

**Required content**
- Set for Life brand mark
- Approved educational disclosure verbatim
- Optional copyright line

**Visual asset / treatment:** Minimal Ivory or very soft Champagne-tinted field, thin Gold/Champagne divider, no photography or abstract art.

**Suggested size:** Disclosure max reading width ~750–850 px. Web type minimum 14–15 px with ~21–24 px line height.

**Suggested word count:** Disclosure is fixed, approved copy and is not shortened in the web Snapshot.

**Dynamic rules:** None beyond canonical brand token. Web does not use PDF page-number footer formatting.

**Mobile behavior:** Single column; disclosure remains readable, never tiny.

**Implementation notes:** Approved disclosure: “This Financial Snapshot is based on your responses to the Set for Life Financial Assessment and is provided for educational and informational purposes. It is not a recommendation to buy, sell, replace, surrender, allocate, or change any financial product, investment, insurance coverage, account, or strategy. Individualized recommendations, when appropriate, belong in an appropriately licensed and supervised conversation.”
