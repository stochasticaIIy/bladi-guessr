// All player-facing text lives here, in Moroccan Darija written in Arabic script.

const ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"] as const;

/** 1234 -> "١٢٣٤" (Darija is written with Arabic-Indic digits). */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)] as string);
}

/** 12450 -> "١٢٬٤٥٠" */
export function formatNumber(value: number): string {
  const rounded = Math.round(value);
  const digits = toArabicDigits(Math.abs(rounded));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, "٬");
  return rounded < 0 ? `-${grouped}` : grouped;
}

export function formatKm(km: number): string {
  if (km < 0.05) return "فنفس البلاصة";
  if (km < 1) return `أقل من ${toArabicDigits(1)} كم`;
  if (km < 10) return `${toArabicDigits(km.toFixed(1))} كم`;
  return `${formatNumber(km)} كم`;
}

export type Grade = { title: string; note: string };

/** Final grade, scaled to however many rounds were played. */
export function gradeFor(total: number, maxTotal: number): Grade {
  const share = maxTotal > 0 ? total / maxTotal : 0;
  if (share >= 0.92)
    return { title: "نتا خريطة المغرب بيديك", note: "تقريبا كل بلاصة عرفتيها. ماكاينش لي يغلبك!" };
  if (share >= 0.72)
    return { title: "ولد البلاد", note: "واعر بزاف! بلادك كتعرفها مزيان." };
  if (share >= 0.48)
    return { title: "ماشي خايب", note: "كتعرف البلاد، ولكن مازال عندك شي بلايص تسنى تدورها." };
  if (share >= 0.25)
    return { title: "خاصك تدور أكثر", note: "بداية مزيانة، ولكن المغرب كبير بزاف." };
  return { title: "تبدا من هنا", note: "مازال خاصك تسافر 😄 عاود جرب، غادي تحسن." };
}

export const copy = {
  appName: "بلادي گيسر",
  tagline: "شحال كتعرف بلادك؟",
  intro:
    "خمسة ديال الدورات. كل مرة تطيح فوسط شارع مغربي حقيقي: دور بالشاشة، مشي مع الأسهم، وقلب على العلامات. منين تعرف فين نتا، حط الدبوس فالخريطة.",
  start: "بدا اللعب",
  startHint: `خمسة ديال الدورات · ${toArabicDigits(5000)} نقطة فكل دورة`,
  round: "الدورة",
  of: "من",
  navHint: "دور بالشاشة · مشي مع الأسهم",
  viewerLoading: "كنحمّلو الشارع…",
  viewerError: "هاد الشارع ما بغاش يتحمل. بدلو ببلاصة أخرى.",
  imageryDown: "ما قدرناش نجيبو الصور دابا. تحقق من الاتصال وعاود جرب.",
  swap: "بدل هاد البلاصة",
  swapping: "كنبدلو…",
  noToken:
    "خاصنا توكن ديال Mapillary باش نحملو الصور. زيدو فـ NEXT_PUBLIC_MAPILLARY_TOKEN وعاود شعل السيرفر.",
  mapHint: "كليكي على الخريطة باش تحط الدبوس",
  mapHintSet: "كليكي باش تبدل البلاصة",
  confirm: "أكد التخمين",
  changing: "كنحسبو…",
  correctPlace: "البلاصة الصحيحة",
  distance: "المسافة",
  next: "الدورة اللي جاية",
  seeResult: "شوف النتيجة",
  finalScore: "النتيجة النهائية",
  outOf: "من",
  pointsSuffix: "نقطة",
  playAgain: "عاود لعب",
  rounds: "الدورات",
  imageCredit: "تصويرة",
  error: "وقع شي مشكل. عاود جرب.",
  retry: "عاود جرب",
  loading: "كنوجدو البلاد…",
  tilesFailed: "الخريطة ما بغاتش تتحمل، ولكن تقدر تحط الدبوس",
  leaderboard: "الترتيب العام",
  leaderboardLoading: "كنجيبو الترتيب…",
  leaderboardEmpty: "مازال ماكاينش شي واحد فالترتيب. كون نتا الأول!",
  leaderboardDown: "الترتيب ما بغاش يتحمل دابا. عاود جرب من بعد.",
  leaderboardPlayers: "لاعب",
  leaderboardYou: "نتا",
  leaderboardSlow: "شوية الصبر، عاود جرب من بعد شي ثواني.",
  nameLabel: "سميتك فالترتيب",
  namePlaceholder: "سميتك",
  submitScore: "دخل النتيجة للترتيب",
  submitting: "كنسجلو…",
  scoreSaved: "تسجلت! نتا رقم",
  modeLabel: "طريقة اللعب",
  modeStreet: "شوارع",
  modePhotos: "تصاور",
  modeStreetPlaces: "بلاصة",
  modePhotoPlaces: "تصويرة",
  modeStreetOffline: "خاصها توكن ديال Mapillary",
  photoIntro:
    "تصويرة حقيقية من المغرب: مدينة قديمة، غور، ساحل، سوق، ولا طريق فالجبل. قلب على العلامات، وحط الدبوس فين كتضن تصورات.",
  photoStartHint: `${toArabicDigits(5)} ديال الدورات · تصاور من كل المغرب`,
  photoHint: "هادي تصويرة من المغرب · حط الدبوس فين كتضن تصورات",
  photoLoading: "كنحمّلو التصويرة…",
  photoError: "هاد التصويرة ما بغاتش تتحمل. بدلو ببلاصة أخرى.",
  challengePhotos: "تحدي بالتصاور",
  challengeStreet: "تحدي بالشوارع",
  challengeBadge: "تحدي",
  challengeIntroTitle: "تحدي من صحابك",
  challengeIntro:
    "هادي نفس الدورات اللي لعب صاحبك: نفس الشوارع ونفس الترتيب. حط الدبوس وشوف واش كتجيب نتيجة أحسن منو.",
  challengeIntroPhotos:
    "هادي نفس الدورات اللي لعب صاحبك: نفس التصاور ونفس الترتيب. حط الدبوس وشوف واش كتجيب نتيجة أحسن منو.",
  challengeStart: "بدا التحدي",
  challengeStartHint: `${toArabicDigits(5)} ديال الدورات · نفس الدورات عند الجميع`,
  challengeBoard: "ترتيب التحدي",
  challengeEmpty: "مازال حتى واحد ما لعب هاد التحدي. كون نتا الأول!",
  challengeSummary:
    "هادي كانت دورات التحدي. صيفط الرابط لصحابك وشوف شكون كيجيب نتيجة أحسن.",
  challengeShare: "شارك الرابط مع صحابك",
  challengeShareText: "جرب هاد التحدي فالبلادي گيسر: نفس الدورات، شوف شكون كيعرف المغرب أكثر.",
  challengeCopied: "تنسخ الرابط! صيفطو دابا.",
  challengeShareFailed: "ما قدرناش ننسخو الرابط. هادا هو:",
  createChallenge: "دير تحدي مع صحابك",
  challengeInviteHint: "صيفط هاد الرابط لصحابك قبل ما تبدا، باش يلعبو نفس الدورات.",
} as const;
