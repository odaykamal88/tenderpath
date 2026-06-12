import type { BotButton } from "./types";

/**
 * Bot menus + canned copy, authored channel-agnostically. Buttons use abstract
 * `action` strings (not Telegram callback_data); each adapter renders them.
 * Text uses the lightweight HTML subset Telegram supports — the WhatsApp
 * adapter converts it. Keep to <b>, <i>, <code>, <a href>.
 */

export const MAIN_MENU: BotButton[][] = [
  [
    { label: "📋 My Assessment", action: "menu_assessment" },
    { label: "🔑 Login Issue", action: "menu_login" },
  ],
  [
    { label: "🎯 My Top Matches", action: "menu_matches" },
    { label: "💬 Talk to Team", action: "menu_escalate" },
  ],
  [
    { label: "❓ FAQ", action: "menu_faq" },
    { label: "📅 Book a 30-min Call", url: "https://calendly.com/oday-kamal-9ya/30min" },
  ],
];

export const LOGIN_MENU: BotButton[][] = [
  [
    { label: "I use Google", action: "login_google" },
    { label: "I use email / magic link", action: "login_magic" },
  ],
  [
    { label: "💬 Talk to Team", action: "menu_escalate" },
    { label: "← Back", action: "back_menu" },
  ],
];

export const FAQ_MENU: BotButton[][] = [
  [
    { label: "What is TenderPath?", action: "faq_what_is" },
    { label: "How does assessment work?", action: "faq_assessment" },
  ],
  [
    { label: "Agencies covered", action: "faq_agencies" },
    { label: "What is UNGM?", action: "faq_ungm" },
  ],
  [
    { label: "Documents needed", action: "faq_docs" },
    { label: "Pricing & plans", action: "faq_pricing" },
  ],
  [
    { label: "Cancel subscription", action: "faq_cancel" },
    { label: "Arabic support", action: "faq_arabic" },
  ],
  [
    { label: "💬 Talk to Team", action: "menu_escalate" },
    { label: "← Back", action: "back_menu" },
  ],
];

export const FAQ_BACK: BotButton[][] = [
  [
    { label: "← FAQ list", action: "menu_faq" },
    { label: "💬 Talk to Team", action: "menu_escalate" },
    { label: "⌂ Menu", action: "back_menu" },
  ],
];

export const ESCALATE_BACK: BotButton[][] = [
  [
    { label: "💬 Talk to Team", action: "menu_escalate" },
    { label: "⌂ Main menu", action: "back_menu" },
  ],
];

export const MENU_BACK: BotButton[][] = [[{ label: "⌂ Main menu", action: "back_menu" }]];

export const WELCOME =
  `Hey! I'm the TenderPath assistant.\n\n` +
  `I can pull up your assessment results, check your tender matches, or help with account stuff.\n\n` +
  `What's up?`;

export const FAQ_ANSWERS: Record<string, string> = {
  faq_what_is:
    `<b>What is TenderPath?</b>\n\n` +
    `TenderPath is a procurement intelligence platform that helps businesses find, assess, and win UN contracts and grants.\n\n` +
    `We crawl 30+ UN agency portals in real time, match opportunities to your company profile, and provide readiness analysis and proposal support.`,

  faq_assessment:
    `<b>How does the free assessment work?</b>\n\n` +
    `Enter your company name, email, and website (or a short description). Our AI:\n` +
    `• Crawls your website and extracts capabilities\n` +
    `• Matches you against active tenders from 30+ UN agencies\n` +
    `• Scores your readiness across 4 dimensions\n\n` +
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
