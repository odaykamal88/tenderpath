import type { InlineButton } from "./api";

export const MAIN_MENU: InlineButton[][] = [
  [
    { text: "📋 My Assessment", callback_data: "menu_assessment" },
    { text: "🔑 Login Issue", callback_data: "menu_login" },
  ],
  [
    { text: "🎯 My Top Matches", callback_data: "menu_matches" },
    { text: "💬 Talk to Team", callback_data: "menu_escalate" },
  ],
  [
    { text: "❓ FAQ", callback_data: "menu_faq" },
    { text: "📅 Book a 30-min Call", url: "https://calendly.com/oday-kamal-9ya/30min" },
  ],
];

export const LOGIN_MENU: InlineButton[][] = [
  [
    { text: "I use Google", callback_data: "login_google" },
    { text: "I use email / magic link", callback_data: "login_magic" },
  ],
  [
    { text: "💬 Talk to Team", callback_data: "menu_escalate" },
    { text: "← Back", callback_data: "back_menu" },
  ],
];

export const FAQ_MENU: InlineButton[][] = [
  [
    { text: "What is TenderPath?", callback_data: "faq_what_is" },
    { text: "How does assessment work?", callback_data: "faq_assessment" },
  ],
  [
    { text: "Agencies covered", callback_data: "faq_agencies" },
    { text: "What is UNGM?", callback_data: "faq_ungm" },
  ],
  [
    { text: "Documents needed", callback_data: "faq_docs" },
    { text: "Pricing & plans", callback_data: "faq_pricing" },
  ],
  [
    { text: "Cancel subscription", callback_data: "faq_cancel" },
    { text: "Arabic support", callback_data: "faq_arabic" },
  ],
  [
    { text: "💬 Talk to Team", callback_data: "menu_escalate" },
    { text: "← Back", callback_data: "back_menu" },
  ],
];

export const FAQ_BACK: InlineButton[][] = [
  [
    { text: "← FAQ list", callback_data: "menu_faq" },
    { text: "💬 Talk to Team", callback_data: "menu_escalate" },
    { text: "⌂ Menu", callback_data: "back_menu" },
  ],
];

export const ESCALATE_BACK: InlineButton[][] = [
  [
    { text: "💬 Talk to Team", callback_data: "menu_escalate" },
    { text: "⌂ Main menu", callback_data: "back_menu" },
  ],
];

export const WELCOME =
  `Hey! I'm the TenderPath assistant.\n\n` +
  `I can pull up your assessment results, check your tender matches, or help with account stuff.\n\n` +
  `What's up?`;

export const FAQ_ANSWERS: Record<string, string> = {
  faq_what_is:
    `<b>What is TenderPath?</b>\n\n` +
    `TenderPath is a procurement intelligence platform that helps businesses find, assess, and win UN contracts and grants.\n\n` +
    `We crawl 15+ UN agency portals in real time, match opportunities to your company profile, and provide readiness analysis and proposal support.`,

  faq_assessment:
    `<b>How does the free assessment work?</b>\n\n` +
    `Enter your company name, email, and website (or a short description). Our AI:\n` +
    `• Crawls your website and extracts capabilities\n` +
    `• Matches you against active tenders from 15+ UN agencies\n` +
    `• Scores your readiness across 5 dimensions\n\n` +
    `All in under 30 seconds. The report is free and sent to your email.`,

  faq_agencies:
    `<b>Agencies we cover</b>\n\n` +
    `UNDP, UNICEF, WHO, WFP, UNHCR, UNFPA, UN Women, UNOPS, FAO, ILO, UNESCO, UNGM, World Bank, IFC, and several regional development banks.\n\n` +
    `We add new sources regularly.`,

  faq_ungm:
    `<b>What is UNGM?</b>\n\n` +
    `UNGM (United Nations Global Marketplace) is the central vendor registration portal for most UN agencies. Registration is free but requires specific documentation.\n\n` +
    `Many tenders are only visible to registered vendors. Our <b>Roster Fast-Track service ($749)</b> helps you complete registration correctly and quickly.`,

  faq_docs:
    `<b>Documents needed for UN tenders</b>\n\n` +
    `Most UN agencies require:\n` +
    `• UNGM registration\n` +
    `• Audited financial statements (last 2–3 years)\n` +
    `• Company registration certificate\n` +
    `• Tax compliance certificate\n` +
    `• Past performance references\n` +
    `• Technical capability documentation\n\n` +
    `Our readiness assessment identifies exactly which you're missing.`,

  faq_pricing:
    `<b>Pricing & plans</b>\n\n` +
    `• <b>Free assessment</b> — company analysis + tender matching\n` +
    `• <b>Grants + Tenders Matching</b> — weekly curated matches, subscription\n` +
    `• <b>Bid Analysis ($39)</b> — win probability, gap analysis, competitor intelligence\n` +
    `• <b>Roster Fast-Track ($749)</b> — UNGM registration support\n\n` +
    `<a href="https://www.tenderpath.me/#pricing">Full pricing →</a>`,

  faq_cancel:
    `<b>Cancelling your subscription</b>\n\n` +
    `Yes, anytime — no long-term commitment.\n\n` +
    `Cancel from your account settings. You keep access until the end of your billing period.\n\n` +
    `Still having trouble? Hit "Talk to Team" and we'll sort it immediately.`,

  faq_arabic:
    `<b>Arabic support</b>\n\n` +
    `Yes. Our weekly tender digest is delivered in English and Arabic, and our team includes Arabic-speaking procurement advisors.\n\n` +
    `We specifically cover opportunities for vendors in MENA and other Arabic-speaking regions.`,
};
