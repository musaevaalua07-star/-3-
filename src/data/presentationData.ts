export type CameraPresetId =
  | 'overview'
  | 'impactCloseup'
  | 'notchCloseup'
  | 'collapseCloseup'
  | 'underwaterBench'
  | 'crossSection'
  | 'aerial';

export interface ScientificBlock {
  heading: string;
  formula?: string;
  summary: string;
  keyProcess: string;
  metricsNote: string;
}

export interface CameraTrajectorySegment {
  name: string;
  motionType: string;
  startPos: [number, number, number];
  midPos: [number, number, number];
  endPos: [number, number, number];
  lookAtStart: [number, number, number];
  lookAtEnd: [number, number, number];
  purpose: string;
}

export interface PresentationStage {
  id: number;
  indexLabel: string;
  shortLabel: string;
  title: string;
  phaseNote: string;
  description: string;
  mechanismLabel: string;
  mechanismDetail: string;
  narrationText: string;
  scientificBlock: ScientificBlock;
  trajectory: CameraTrajectorySegment;
  targetProgress: number;
  recommendedWavePower: number;
  cameraPreset: CameraPresetId;
  durationSec: number;
}

export interface CameraPreset {
  id: CameraPresetId;
  label: string;
  shortDesc: string;
  position: [number, number, number];
  target: [number, number, number];
}

export interface CalloutDef {
  id: string;
  title: string;
  subtitle: string;
  minProgress: number;
  maxProgress: number;
  getAnchor: (progress: number) => [number, number, number];
}

export const CAMERA_PRESETS: Record<CameraPresetId, CameraPreset> = {
  overview: {
    id: 'overview',
    label: 'Жалпы шолу',
    shortDesc: 'Жағалау, маяк және кекурдың жалпы көрінісі',
    position: [16.8, 9.2, 16.2],
    target: [0.4, 2.2, -0.2],
  },
  impactCloseup: {
    id: 'impactCloseup',
    label: 'Соққы нүктесі',
    shortDesc: 'Толқынның жартас табанына соғылуы (жақыннан)',
    position: [8.6, 2.4, 7.6],
    target: [1.4, 1.15, 0.2],
  },
  notchCloseup: {
    id: 'notchCloseup',
    label: 'Ойық ішінен',
    shortDesc: 'Толқын соқпалы ойық пен қуыстың тереңдеуі',
    position: [5.4, 1.9, 8.8],
    target: [-0.2, 1.25, 0.8],
  },
  collapseCloseup: {
    id: 'collapseCloseup',
    label: 'Опырылу сәті',
    shortDesc: 'Асылмалы жартастың жарылып құлау ракурсы',
    position: [10.4, 5.4, 10.6],
    target: [0.6, 2.9, 0.2],
  },
  underwaterBench: {
    id: 'underwaterBench',
    label: 'Су асты бенч',
    shortDesc: 'Су астындағы тегістелген бенч пен шөгінділердің жиналуы',
    position: [9.8, 2.8, 16.4],
    target: [6.4, -0.9, 2.4],
  },
  crossSection: {
    id: 'crossSection',
    label: 'Гео-қима',
    shortDesc: 'Шөгінді қабаттар мен ойықтың көлденең профилі',
    position: [3.2, 3.9, 19.6],
    target: [3.4, 0.9, 0.0],
  },
  aerial: {
    id: 'aerial',
    label: 'Жоғарыдан',
    shortDesc: 'Жағалау сызығының шегінуі мен бенч аумағы',
    position: [12.5, 19.2, 10.2],
    target: [-0.4, 1.4, -0.5],
  },
};

export const PRESENTATION_STAGES: PresentationStage[] = [
  {
    id: 0,
    indexLabel: '01',
    shortLabel: 'Бастапқы жаға',
    title: '01. Бастапқы тік жағалау',
    phaseNote: 'Тепе-теңдік кезеңі · Тік шөгінді жартас',
    description:
      'Абразия басталмас бұрын жағалау шөгінді тау жыныстарынан (құмтас, әктас және саз қабаттарынан) құралған тік беткей түрінде болады. Теңіз толқындары таяз суға жеткенде энергиясын жағалау табанына шоғырландырады.',
    mechanismLabel: 'Геологиялық құрылым',
    mechanismDetail: 'Қабатты шөгінді жыныстардың беріктік айырмашылығы',
    narrationText:
      'Бірінші кезең — бастапқы тік жағалау. Абразия процесі басталмас бұрын жағалау құмтас, әктас және жұмсақ саз қабаттарынан тұратын биік жартас түрінде қалыптасады. Теңіз толқындары таяз су аймағына жақындағанда барлық кинетикалық энергиясын дәл осы жағалау табанына бағыттайды.',
    scientificBlock: {
      heading: 'Энергияның жағалауға берілуі',
      formula: 'E = ⅛ · ρ · g · H²',
      summary:
        'Толқынның меншікті энергиясы оның биіктігінің квадратына (H²) тура пропорционал. Жұмсақ саз-мергель қабаты су деңгейінде орналасқандықтан ең осал аймақ саналады.',
      keyProcess: 'Толқын рефракциясы және мүйіске энергияның шоғырлануы',
      metricsNote: 'Жыныс беріктігі: 15–45 МПа · Орташа толқын: 1.2–1.8 м',
    },
    trajectory: {
      name: 'Траектория 01 — Жалпы панорамалық жақындау',
      motionType: 'Кең доға бойымен сырғу (Establishing Arc)',
      startPos: [20.5, 11.2, 18.0],
      midPos: [17.0, 9.0, 15.2],
      endPos: [13.5, 6.4, 12.6],
      lookAtStart: [0.8, 2.8, -0.8],
      lookAtEnd: [1.0, 2.0, 0.2],
      purpose: 'Жағалау профилін, маяк масштабын, шөгінді қабаттарды және жақындаған толқын шебін тұтас таныстыру.',
    },
    targetProgress: 0.05,
    recommendedWavePower: 0.85,
    cameraPreset: 'overview',
    durationSec: 6.5,
  },
  {
    id: 1,
    indexLabel: '02',
    shortLabel: 'Толқын соққысы',
    title: '02. Гидравликалық соққы және корразия',
    phaseNote: 'Белсенді шабуыл · Қысым 120–280 кПа',
    description:
      'Дауылды толқындар жартас табанына үлкен жылдамдықпен соғылып, жарықтардағы ауаны сығады (гидравликалық қысым). Толқын ілестірген малтатас пен ірі құм жартас бетін механикалық түрде қажайды (корразия).',
    mechanismLabel: 'Негізгі механизм',
    mechanismDetail: 'Гидравликалық соққы + абразиялық материалдың қажауы',
    narrationText:
      'Екінші кезең — гидравликалық соққы және корразия. Қуатты толқындар жартас етегіне жоғары қысыммен соғылып, тас жарықтарындағы ауаны лезде сығады. Сонымен бірге толқын ілестірген малтатас пен құм жартас бетін егеу сияқты үздіксіз қажай бастайды.',
    scientificBlock: {
      heading: 'Гидравликалық қысым және корразия',
      formula: 'P ≈ ρ · v² · k',
      summary:
        'Толқын соққысы кезінде микрожарықтардағы ауа лезде сығылып, толқын шегінгенде кенет кеңейеді — бұл тау жынысын ішінен ыдыратады. Судағы тастар егеу ретінде әсер етеді.',
      keyProcess: 'Гидравликалық импульс, кавитация және корразиялық қажау',
      metricsNote: 'Соққы қысымы: 140–290 кПа · Жылдамдық: 6–11 м/с',
    },
    trajectory: {
      name: 'Траектория 02 — Толқын соққысына төменнен шүйілу',
      motionType: 'Төменгі динамикалық сырғу (Low Surf Tracking)',
      startPos: [12.4, 4.2, 10.8],
      midPos: [9.0, 2.5, 8.2],
      endPos: [7.6, 2.1, 6.8],
      lookAtStart: [1.6, 1.4, 0.4],
      lookAtEnd: [1.3, 1.1, 0.1],
      purpose: 'Су деңгейіне түсіп, көбіктің шашырауын, толқын күш векторларын және тас сынықтарының қажауын жақыннан көрсету.',
    },
    targetProgress: 0.28,
    recommendedWavePower: 1.45,
    cameraPreset: 'impactCloseup',
    durationSec: 7.0,
  },
  {
    id: 2,
    indexLabel: '03',
    shortLabel: 'Соқпалы ойық',
    title: '03. Толқын соқпалы ойықтың қалыптасуы',
    phaseNote: 'Үңгілу кезеңі · Төменгі жұмсақ қабат',
    description:
      'Үздіксіз гидравликалық соққы мен корразия нәтижесінде су жиегінде терең толқын соқпалы ойық (абразиялық қуыс) ойылады. Жоғарғы қабат тірексіз қалып, ауырлық күшінен тік кернеу жарықтары ашылады.',
    mechanismLabel: 'Геоморфологиялық өзгеріс',
    mechanismDetail: 'Ойық тереңдеген сайын асылмалы ернеудегі иілу моменті артады',
    narrationText:
      'Үшінші кезең — толқын соқпалы ойықтың қалыптасуы. Үздіксіз соққы мен қажаудың әсерінен су деңгейіндегі жұмсақ қабат терең үңгіліп, абразиялық қуыс пайда болады. Нәтижесінде жоғарғы қалың жартас тірексіз қалып, оның бойында терең тік жарықтар ашылады.',
    scientificBlock: {
      heading: 'Абразиялық қуыс және тік жарықтар',
      formula: 'σ_max = (M · y) / I > σ_шек',
      summary:
        'Толқын соқпалы ойық 2.5–4.5 м тереңдікке жеткенде жоғарғы асылмалы қабат консоль сияқты жұмыс істейді. Созылу кернеуі (σ) тау жынысының беріктік шегінен асқанда тік жарықтар пайда болады.',
      keyProcess: 'Ойықтың үңгілуі және асылмалы блоктағы кернеу концентрациясы',
      metricsNote: 'Ойық тереңдігі: 3.8 м · Тік жарық ашылуы: критикалық',
    },
    trajectory: {
      name: 'Траектория 03 — Ойықтан көлденең геологиялық қимаға өту',
      motionType: 'Бүйірлік орбиталық ауысу (Notch-to-Profile Orbit)',
      startPos: [6.4, 2.0, 9.2],
      midPos: [4.2, 2.8, 13.8],
      endPos: [1.6, 4.2, 18.2],
      lookAtStart: [0.0, 1.2, 0.8],
      lookAtEnd: [0.2, 2.2, 0.0],
      purpose: 'Алдымен үңгілген қуыстың тереңдігін жақыннан ашып, содан соң шөгінді қабаттар мен жарықтарды көлденең қимада көрсету.',
    },
    targetProgress: 0.56,
    recommendedWavePower: 1.65,
    cameraPreset: 'notchCloseup',
    durationSec: 7.5,
  },
  {
    id: 3,
    indexLabel: '04',
    shortLabel: 'Опырылу сәті',
    title: '04. Жартастың опырылып құлауы',
    phaseNote: 'Критикалық шек · Гравитациялық опырылу',
    description:
      'Тірегінен айырылған асылмалы жартас блогы өз салмағымен жарық бойымен үзіліп, теңізге опырылып құлайды. Шаң мен су шашырандысы көтеріліп, құлаған тастар толқын астында қайта ұсақталады.',
    mechanismLabel: 'Экшн-құбылыс',
    mechanismDetail: 'Гравитациялық үзілу, құлау және қайталама ұсақталу',
    narrationText:
      'Төртінші кезең — жартастың опырылып құлауы. Тірегінен айырылған асылмалы массив өз ауырлық салмағын көтере алмай, жарық бойымен үзіліп теңізге құлайды. Суға түскен ірі тас кесектері толқын күшімен қайта ұсақталып, жаңа қажау материалына айналады.',
    scientificBlock: {
      heading: 'Гравитациялық опырылу және блоктың құлауы',
      formula: 'F_ауыр = m · g > F_үйк + F_байл',
      summary:
        'Асылмалы массивтің ауырлық күші жыныс қабаттарының ілінісу күшінен асқан сәтте жылдам опырылу жүреді. Құлаған кесектер уақытша тосқауыл жасайды, бірақ толқын оларды шайып әкетеді.',
      keyProcess: 'Күрт опырылу, соққы толқыны және сынықтардың шоғырлануы',
      metricsNote: 'Құлау үдеуі: 9.8 м/с² · Бөлінген масса: ~420 тонна',
    },
    trajectory: {
      name: 'Траектория 04 — Опырылу сәтінің драмалық экшн-ракурсы',
      motionType: 'Жоғарыдан төменге серпінді қадағалау (Dynamic Collapse Follow)',
      startPos: [10.8, 6.2, 11.4],
      midPos: [11.6, 4.6, 10.8],
      endPos: [13.2, 3.8, 12.2],
      lookAtStart: [0.4, 3.8, 0.2],
      lookAtEnd: [2.2, 1.4, 0.4],
      purpose: 'Жартастың жарылу сәтін жоғары бұрыштан ұстап, тастар құлаған кезде көзқарасты теңіз бетіне қарай ілестіре түсіру.',
    },
    targetProgress: 0.74,
    recommendedWavePower: 1.85,
    cameraPreset: 'collapseCloseup',
    durationSec: 7.5,
  },
  {
    id: 4,
    indexLabel: '05',
    shortLabel: 'Бенч және шегіну',
    title: '05. Абразиялық терраса және жағалаудың шегінуі',
    phaseNote: 'Жаңа бедер · Клиф + Бенч + Кекур',
    description:
      'Бірнеше опырылу циклынан кейін тік жартас (клиф) құрлыққа қарай шегінеді. Бұрынғы жартас орнында су астындағы тегіс абразиялық терраса (бенч) және берік жыныстан қалған оқшау жартас — кекур қалыптасады.',
    mechanismLabel: 'Қорытынды бедер',
    mechanismDetail: 'Клифтің шегінуі, бенчтің кеңеюі және энергияның бәсеңдеуі',
    narrationText:
      'Бесінші кезең — абразиялық терраса және жағалаудың шегінуі. Опырылу циклдары қайталанған сайын тік жартас, яғни клиф құрлыққа қарай шегінеді. Оның орнында суасты тегіс абразиялық бенч алаңы мен берік жыныстан қалған оқшау жартас — кекур қалыптасады.',
    scientificBlock: {
      heading: 'Абразиялық бенч және тепе-теңдік профилі',
      formula: 'R_шегіну ≈ 0.5–3.5 м/жыл',
      summary:
        'Абразиялық терраса (бенч) кеңейген сайын толқындар таяз түпке үйкеліп энергиясын жоғалтады. Нәтижесінде жағалау шегінуі баяулап, жаңа геоморфологиялық тепе-теңдік орнайды.',
      keyProcess: 'Жағалау шегінуі, бенчтің тегістелуі және кекур оқшаулануы',
      metricsNote: 'Шегіну қашықтығы: 4.2 м · Бенч ені: кеңейген аймақ',
    },
    trajectory: {
      name: 'Траектория 05 — Жағалау шегінуін ашатын әуе көтерілісі',
      motionType: 'Жоғарылай алыстау (Aerial Pullback Reveal)',
      startPos: [14.0, 6.8, 13.0],
      midPos: [13.5, 13.4, 11.8],
      endPos: [12.2, 19.0, 10.2],
      lookAtStart: [1.0, 1.8, -0.4],
      lookAtEnd: [-0.4, 1.4, -0.6],
      purpose: 'Төменнен жоғары көтеріліп, клифтің шегінген сызығын, суасты бенч платформасын және оқшау қалған кекурды тұтас көрсету.',
    },
    targetProgress: 0.96,
    recommendedWavePower: 1.15,
    cameraPreset: 'aerial',
    durationSec: 8.0,
  },
];

export const CALLOUT_DEFINITIONS: CalloutDef[] = [
  {
    id: 'cliff',
    title: 'Клиф (тік жартас)',
    subtitle: 'Абразия әсерінен тіктелген жағалау беткейі',
    minProgress: 0.0,
    maxProgress: 1.0,
    getAnchor: (p) => {
      const retreated = p > 0.64 ? (p - 0.64) / 0.36 : 0;
      const x = 1.6 - retreated * 3.8;
      return [x, 6.2, -1.6];
    },
  },
  {
    id: 'strata',
    title: 'Шөгінді қабаттар',
    subtitle: 'Құмтас, әктас және саз қатпарлары',
    minProgress: 0.0,
    maxProgress: 0.62,
    getAnchor: () => [-2.8, 3.6, 5.2],
  },
  {
    id: 'impact',
    title: 'Гидравликалық соққы',
    subtitle: 'Толқын қысымы мен малтатас қажауы',
    minProgress: 0.14,
    maxProgress: 0.66,
    getAnchor: (p) => [2.6 - Math.min(p, 0.58) * 2.2, 1.35, 1.2],
  },
  {
    id: 'notch',
    title: 'Толқын соқпалы ойық',
    subtitle: 'Су деңгейінде үңгілген абразиялық қуыс',
    minProgress: 0.34,
    maxProgress: 0.66,
    getAnchor: (p) => [1.3 - (p - 0.3) * 4.2, 1.1, 3.1],
  },
  {
    id: 'rockfall',
    title: 'Опырылған тау жынысы',
    subtitle: 'Тірексіз қалған жартас сынықтары',
    minProgress: 0.65,
    maxProgress: 0.9,
    getAnchor: () => [2.6, 1.4, 0.8],
  },
  {
    id: 'bench',
    title: 'Абразиялық терраса (бенч)',
    subtitle: 'Толқын тегістеп қырнаған суасты жартас алаңы',
    minProgress: 0.35,
    maxProgress: 1.0,
    getAnchor: (p) => [3.6 + p * 1.4, -0.15, 3.2],
  },
  {
    id: 'sedimentWedge',
    title: 'Шөгінділер жиналуы (аккумуляция)',
    subtitle: 'Құм мен малтатастан түзілген суасты терраса',
    minProgress: 0.25,
    maxProgress: 1.0,
    getAnchor: (p) => [12.2 + p * 1.8, -0.95 + p * 0.45, 4.8],
  },
  {
    id: 'sedimentFlow',
    title: 'Шөгінді тасымалы',
    subtitle: 'Кері ағыспен теңізге тасымалданған сынықтар',
    minProgress: 0.22,
    maxProgress: 0.92,
    getAnchor: () => [7.8, -0.25, 6.2],
  },
  {
    id: 'stack',
    title: 'Кекур (жеке жартас)',
    subtitle: 'Бұзылуға төзімді қалдық жартас бағанасы',
    minProgress: 0.0,
    maxProgress: 1.0,
    getAnchor: () => [9.6, 4.4, -4.6],
  },
];
