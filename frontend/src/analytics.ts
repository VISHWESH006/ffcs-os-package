export type AnalyticsPage = 'login' | 'dashboard' | 'import' | 'courses' | 'builder' | 'saved';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
let initialized = false;

function initialize() {
  if (initialized || !measurementId || typeof window === 'undefined' || typeof document === 'undefined') return;
  initialized = true;
  window.dataLayer ??= [];
  window.gtag ??= (...args: unknown[]) => { window.dataLayer?.push(args); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  if (!document.querySelector(`script[data-ffcs-ga="${measurementId}"]`)) {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.ffcsGa = measurementId;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
  }
}

const PAGE_METADATA: Record<AnalyticsPage, { path: string; title: string }> = {
  login: { path: '/login', title: 'Sign in' },
  dashboard: { path: '/app/overview', title: 'Overview' },
  import: { path: '/app/import', title: 'Import data' },
  courses: { path: '/app/courses', title: 'Course workspace' },
  builder: { path: '/app/timetable-builder', title: 'Timetable builder' },
  saved: { path: '/app/my-timetables', title: 'My timetables' },
};

export function trackPageView(page: AnalyticsPage) {
  if (!measurementId) return;
  initialize();
  const pageInfo = PAGE_METADATA[page];
  window.gtag?.('event', 'page_view', {
    page_title: pageInfo.title,
    page_path: pageInfo.path,
    page_location: `${window.location.origin}${pageInfo.path}`,
  });
}
