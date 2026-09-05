// i18n.mjs - UI chrome strings for the explainer page.
//
// Two separate things are language-controlled:
//   1. the CHROME (buttons, tabs, placeholders) - this file
//   2. the CONTENT Claude writes (prose, FAQ, review) - see references/authoring.md
// A locale with no entry here falls back to English chrome, while Claude still
// authors the content in the requested language.

export const DEFAULT_LANGUAGE = 'hinglish';

const en = {
  // chrome
  contents: 'Contents',
  comment: 'Comment',
  sendToClaude: 'Send to Claude',
  threads: 'Threads',
  codeDiff: 'Code diff',
  openDifit: 'Open difit',
  hintCommentMode: 'comment mode',
  hintThreads: 'threads',
  hintOpenDifit: 'open difit',

  // hero
  tldr: 'TL;DR',
  difitCardTitle: 'The code diff is open in difit',
  difitCardSub: 'Leave line-level comments there - Claude replies in the same thread.',

  // sections
  review: 'Review',
  reviewKicker: 'a senior engineer reads it',
  verdict: 'Verdict',
  suggestedFix: 'Suggested fix',
  faq: 'FAQ',
  faqKicker: 'questions & answers',
  faqSummary: 'The questions people actually ask - and the ones they should.',
  faqSearch: 'Search the FAQ...',
  expandAll: 'expand all',
  collapseAll: 'collapse all',
  glossary: 'Glossary',
  glossaryKicker: 'terms',

  // footer
  generated: 'Generated',
  footHint: 'Something wrong or unclear?',
  footCta: 'Draw a box and comment',
  footTail: '- Claude will answer in that thread.',

  // composer
  regionComment: 'Region comment',
  selectionComment: 'Selection comment',
  composerPlaceholder: "What's wrong or confusing here? Ask - Claude answers in this thread.",
  saveComment: 'Save comment',
  cancel: 'Cancel',
  close: 'Close',
  saveHint: 'save',
  commentOnSelection: 'Comment on selection',
  bboxHint: 'Drag a box on the page, then write your comment',
  toExit: 'to exit',

  // threads
  tabAll: 'All',
  tabPending: 'Pending',
  tabAnswered: 'Answered',
  tabDifit: 'difit',
  sendPending: 'Send pending',
  copyPrompt: 'Copy prompt',
  live: 'live',
  reconnecting: 'reconnecting...',
  replyAndSend: 'Reply & send',
  locate: 'Locate',
  del: 'Delete',
  followUpPlaceholder: 'Ask a follow-up...',
  you: 'You',
  claude: 'Claude',
  emptyTitle: 'No threads yet',
  emptyBody: 'Press C, drag a box over anything on the page, and ask your question.',
  difitEmptyTitle: 'No comments in difit',
  difitEmptyBody: 'Open difit, comment on any line - Claude replies in that same thread.',
  difitServerLive: 'server live',
  difitServerDown: 'server is down (restart it from the skill)',
  codeThread: 'code thread',
  codeThreads: 'code threads',
  stale: 'stale',
  staleTitle: 'The page changed after this comment',

  // send modal
  sentTitle: 'comments sent',
  promptTitle: 'Prompt for pending comments',
  listeningTitle: 'A Claude session is listening.',
  listeningBody:
    'The answer will show up in this panel shortly - nothing else to do. The prompt below is just a backup.',
  idleTitle: 'No Claude session is listening right now.',
  idleBody:
    'Copy the prompt below and paste it into your Claude Code session - your comments are already written into it.',
  promptLabel: 'Or copy this prompt and paste it into a Claude Code session',
  monitorArmed: 'Monitor armed',
  noWatcher: 'No watcher - paste it',
  copied: 'Copied',

  // toasts
  toastSavedDraft: 'Comment saved as draft - now press "Send to Claude"',
  toastSent: (n) => n + ' comment' + (n === 1 ? '' : 's') + ' sent to Claude',
  toastAnswered: 'Claude replied - check the threads',
  toastPageUpdated: 'Page updated - reloading',
  toastPageUpdatedDraft: 'Claude updated the page - your draft is safe.',
  toastReload: 'Reload',
  toastEmptyComment: 'The comment is empty',
  toastEmptyReply: 'The reply is empty',
  toastSentToClaude: 'Sent to Claude - the answer lands here',
  toastDeleted: 'Thread deleted',
  toastNoPending: 'No pending comments',
  toastCopyBlocked: 'Copy blocked - the text is selected, press Ctrl+C',
  toastClipboardBlocked: 'Clipboard blocked by the browser',
  toastSaveFailed: 'Save failed: ',
  toastSubmitFailed: 'Submit failed: ',

  // callouts
  calloutInfo: 'Note',
  calloutTip: 'Tip',
  calloutWarn: 'Careful',
  calloutDanger: 'Danger',
  calloutEdge: 'Edge case',
  calloutGotcha: 'Gotcha',
  calloutPerf: 'Performance',
  calloutSecurity: 'Security',

  // index
  hubTitle: 'Explain Hub',
  hubEmpty: 'No explainers yet. Ask Claude to run /explain <target>.',
  explainer: 'explainer',
  explainers: 'explainers',
  open: 'open',
  threadsLabel: 'threads',
};

const hinglish = {
  ...en,
  contents: 'Contents',
  difitCardTitle: 'Code diff difit mein khula hai',
  difitCardSub: 'Line-level comments wahin chhodo - Claude usi thread mein reply karega.',

  reviewKicker: 'seniormost dev ka review',
  faqKicker: 'sawaal-jawaab',
  faqSummary: 'Jo sawaal aam taur pe aate hain - aur jo aane chahiye.',
  faqSearch: 'FAQ mein dhoondo...',
  glossaryKicker: 'shabdkosh',

  footHint: 'Kuch galat lage ya samajh na aaye?',
  footCta: 'Box draw karke comment karo',
  footTail: '- Claude usi thread mein jawaab dega.',

  composerPlaceholder: 'Yahan kya galat / confusing hai? Poochho - Claude isi thread mein jawaab dega.',
  bboxHint: 'Page pe box drag karo, phir comment likho',
  toExit: 'to exit',
  followUpPlaceholder: 'Follow-up poochho...',

  emptyTitle: 'Abhi koi thread nahi',
  emptyBody: 'C dabao, page pe kahin bhi box drag karo, aur sawaal likho.',
  difitEmptyTitle: 'difit pe koi comment nahi',
  difitEmptyBody: 'difit kholo, kisi line pe comment chhodo - Claude wahin thread mein jawaab dega.',
  difitServerLive: 'server live',
  difitServerDown: 'server band hai (skill se restart karo)',
  staleTitle: 'Is comment ke baad page badla hai',

  sentTitle: 'comments bheje',
  promptTitle: 'Pending comments ka prompt',
  listeningTitle: 'Claude session sun raha hai.',
  listeningBody:
    'Jawaab thodi der mein isi panel mein aa jaayega - kuch karne ki zaroorat nahi. Neeche wala prompt sirf backup hai.',
  idleTitle: 'Abhi koi Claude session nahi sun raha.',
  idleBody:
    'Neeche wala prompt copy karke apne Claude Code session mein paste kar do - usmein tumhare comments already likhe hain.',
  promptLabel: 'Ya ye prompt copy karke Claude Code session mein paste kar do',
  noWatcher: 'No watcher - paste karo',

  toastSavedDraft: 'Comment draft mein save ho gaya - ab "Send to Claude" dabao',
  toastSent: (n) => n + ' comment Claude ko bhej diye',
  toastAnswered: 'Claude ne jawaab diya - threads dekho',
  toastPageUpdated: 'Page update ho gaya - reload kar raha hoon',
  toastPageUpdatedDraft: 'Claude ne page update kiya - tumhara draft bacha hua hai.',
  toastEmptyComment: 'Comment khaali hai',
  toastEmptyReply: 'Reply khaali hai',
  toastSentToClaude: 'Claude ko bhej diya - jawaab yahin aayega',
  toastDeleted: 'Thread delete ho gaya',
  toastNoPending: 'Koi pending comment nahi hai',
  toastCopyBlocked: 'Copy block hua - text select ho gaya hai, Ctrl+C dabao',
  toastClipboardBlocked: 'Clipboard browser ne block kiya',

  calloutWarn: 'Dhyaan do',
  calloutDanger: 'Khatra',
  calloutGotcha: 'Gotcha',

  hubEmpty: 'Abhi koi explainer nahi hai. Claude se /explain <target> chalwao.',
};

const hindi = {
  ...en,
  contents: 'विषय-सूची',
  comment: 'टिप्पणी',
  sendToClaude: 'Claude को भेजें',
  threads: 'थ्रेड',
  codeDiff: 'कोड डिफ़',
  openDifit: 'difit खोलें',
  hintCommentMode: 'टिप्पणी मोड',
  hintThreads: 'थ्रेड',
  hintOpenDifit: 'difit खोलें',

  difitCardTitle: 'कोड डिफ़ difit में खुला है',
  difitCardSub: 'लाइन-स्तर की टिप्पणियाँ वहीं छोड़ें - Claude उसी थ्रेड में जवाब देगा।',

  review: 'समीक्षा',
  reviewKicker: 'सबसे वरिष्ठ डेवलपर की समीक्षा',
  verdict: 'निष्कर्ष',
  suggestedFix: 'सुझाया गया सुधार',
  faqKicker: 'प्रश्न-उत्तर',
  faqSummary: 'जो सवाल आम तौर पर आते हैं - और जो आने चाहिए।',
  faqSearch: 'FAQ में खोजें...',
  expandAll: 'सब खोलें',
  collapseAll: 'सब बंद करें',
  glossary: 'शब्दकोश',
  glossaryKicker: 'शब्दावली',

  generated: 'बनाया गया',
  footHint: 'कुछ गलत लगे या समझ न आए?',
  footCta: 'बॉक्स खींचकर टिप्पणी करें',
  footTail: '- Claude उसी थ्रेड में जवाब देगा।',

  regionComment: 'क्षेत्र टिप्पणी',
  selectionComment: 'चयन टिप्पणी',
  composerPlaceholder: 'यहाँ क्या गलत या उलझाने वाला है? पूछिए - Claude इसी थ्रेड में जवाब देगा।',
  saveComment: 'टिप्पणी सहेजें',
  cancel: 'रद्द करें',
  close: 'बंद करें',
  saveHint: 'सहेजें',
  commentOnSelection: 'चयन पर टिप्पणी करें',
  bboxHint: 'पेज पर बॉक्स खींचें, फिर टिप्पणी लिखें',
  toExit: 'बाहर निकलने के लिए',

  tabAll: 'सभी',
  tabPending: 'लंबित',
  tabAnswered: 'उत्तरित',
  sendPending: 'लंबित भेजें',
  copyPrompt: 'प्रॉम्प्ट कॉपी करें',
  live: 'लाइव',
  reconnecting: 'फिर से जुड़ रहे हैं...',
  replyAndSend: 'जवाब भेजें',
  locate: 'ढूँढें',
  del: 'हटाएँ',
  followUpPlaceholder: 'आगे कुछ पूछें...',
  you: 'आप',
  emptyTitle: 'अभी कोई थ्रेड नहीं',
  emptyBody: 'C दबाएँ, पेज पर कहीं भी बॉक्स खींचें, और अपना सवाल लिखें।',
  difitEmptyTitle: 'difit पर कोई टिप्पणी नहीं',
  difitEmptyBody: 'difit खोलें, किसी लाइन पर टिप्पणी करें - Claude वहीं जवाब देगा।',
  difitServerLive: 'सर्वर चालू',
  difitServerDown: 'सर्वर बंद है (skill से दोबारा चालू करें)',
  codeThread: 'कोड थ्रेड',
  codeThreads: 'कोड थ्रेड',
  stale: 'पुराना',
  staleTitle: 'इस टिप्पणी के बाद पेज बदला है',

  sentTitle: 'टिप्पणियाँ भेजी गईं',
  promptTitle: 'लंबित टिप्पणियों का प्रॉम्प्ट',
  listeningTitle: 'एक Claude सेशन सुन रहा है।',
  listeningBody: 'जवाब थोड़ी देर में इसी पैनल में आ जाएगा। नीचे वाला प्रॉम्प्ट सिर्फ़ बैकअप है।',
  idleTitle: 'अभी कोई Claude सेशन नहीं सुन रहा।',
  idleBody: 'नीचे वाला प्रॉम्प्ट कॉपी करके अपने Claude Code सेशन में पेस्ट करें - उसमें आपकी टिप्पणियाँ पहले से लिखी हैं।',
  promptLabel: 'या यह प्रॉम्प्ट कॉपी करके Claude Code सेशन में पेस्ट करें',
  noWatcher: 'कोई सुन नहीं रहा - पेस्ट करें',
  copied: 'कॉपी हो गया',

  toastSavedDraft: 'टिप्पणी ड्राफ़्ट में सहेजी गई - अब "Claude को भेजें" दबाएँ',
  toastSent: (n) => n + ' टिप्पणियाँ Claude को भेजी गईं',
  toastAnswered: 'Claude ने जवाब दिया - थ्रेड देखें',
  toastPageUpdated: 'पेज अपडेट हो गया - रीलोड कर रहे हैं',
  toastPageUpdatedDraft: 'Claude ने पेज अपडेट किया - आपका ड्राफ़्ट सुरक्षित है।',
  toastReload: 'रीलोड',
  toastEmptyComment: 'टिप्पणी खाली है',
  toastEmptyReply: 'जवाब खाली है',
  toastSentToClaude: 'Claude को भेज दिया - जवाब यहीं आएगा',
  toastDeleted: 'थ्रेड हटा दिया गया',
  toastNoPending: 'कोई लंबित टिप्पणी नहीं',
  toastCopyBlocked: 'कॉपी ब्लॉक हुआ - टेक्स्ट चुन लिया गया है, Ctrl+C दबाएँ',
  toastClipboardBlocked: 'ब्राउज़र ने क्लिपबोर्ड ब्लॉक किया',
  toastSaveFailed: 'सहेजना विफल: ',
  toastSubmitFailed: 'भेजना विफल: ',

  calloutInfo: 'ध्यान दें',
  calloutTip: 'सुझाव',
  calloutWarn: 'सावधान',
  calloutDanger: 'खतरा',
  calloutEdge: 'किनारे का मामला',
  calloutGotcha: 'फँसाने वाली बात',
  calloutPerf: 'प्रदर्शन',
  calloutSecurity: 'सुरक्षा',

  hubEmpty: 'अभी कोई explainer नहीं है। Claude से /explain <target> चलवाएँ।',
  explainer: 'explainer',
  explainers: 'explainers',
  open: 'खुले',
  threadsLabel: 'थ्रेड',
};

const LOCALES = { hinglish, english: en, en, hindi, hi: hindi };

/** Chrome strings for a language, falling back to English for unknown ones. */
export function strings(language) {
  const key = String(language || DEFAULT_LANGUAGE).toLowerCase().trim();
  return LOCALES[key] || en;
}

/** Only these have translated chrome; any other value still steers the prose. */
export function hasChrome(language) {
  return Object.prototype.hasOwnProperty.call(LOCALES, String(language || '').toLowerCase().trim());
}

export const SUPPORTED_CHROME = ['hinglish', 'english', 'hindi'];

/** The subset the browser needs; functions are resolved server-side. */
export function clientStrings(language) {
  const s = strings(language);
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') out[k] = v;
  }
  // toastSent takes a count, so ship a template the client fills in.
  out.toastSentTemplate = String(s.toastSent(0)).replace(/^0\s*/, '{n} ');
  return out;
}
