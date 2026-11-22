# Google sign-in, saved data and analytics

## Firebase setup

1. Create or select a Firebase project and add a Web app. In **Authentication → Sign-in method**, enable **Google**. The app does not restrict sign-in by email domain; any Google account can register and sign in.
2. In **Authentication → Settings → Authorized domains**, add the exact frontend domains that serve the app, including the production Vercel domain (for example `ffcs-demo.vercel.app`) and any Vercel preview domain that you intend to use. Firebase's default localhost entry is useful for local development. Do not add the API domain unless it also serves the frontend.
3. Add the Web app's API key, auth domain, project ID and app ID to Vercel as `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_APP_ID`, then redeploy. These are Firebase web-app configuration values, not Admin credentials.
4. Set the same project ID in the API runtime as `FIREBASE_PROJECT_ID`. Create a Firebase service account with Firebase Authentication user-management access and store its JSON only as the backend secret `FIREBASE_SERVICE_ACCOUNT_JSON` (or use Application Default Credentials in a supported runtime). Never add this secret to Vercel, a `VITE_*` variable, source control, or a client bundle. The Render Blueprint declares both API variables as unsynchronized secrets so they must be supplied in the Render dashboard.
5. Set `CORS_ORIGINS` on the API to the exact comma-separated frontend origins. Use origins, not URL paths.

The frontend persists Firebase Auth locally in the browser and restores the Firebase session on reload. Every API request other than `GET /api/healthz` carries a Firebase ID token. The API checks its signature, expiry and revocation status, and requires Google as the sign-in provider. The UID used for data ownership is taken only from this verified token.

## User data ownership and deletion

Saved timetables, optimization history, preferences and derived stats are scoped to the verified Firebase UID. An account can list, read or delete only its own saved timetables. The browser's planner cache is also namespaced by UID. Previous unowned JSON-store records and the old unscoped browser key are preserved in place, but are not exposed to signed-in accounts; users can re-import their own data.

Use **Delete account** in the signed-in app to permanently delete the current Firebase user and that UID's saved timetables, optimization history, preferences and browser planner cache. The action requires a recent Google reauthentication. If the API reports a deletion failure, contact the operator; do not assume the account and data were both removed. The operation is not a recovery/restore mechanism.

## GA4 configuration and collection

Create a GA4 web data stream and set its `G-...` measurement ID as `VITE_GA_MEASUREMENT_ID` in the frontend build environment. Leave it unset to disable Analytics. Rebuild/redeploy after changing it.

The app emits page-view events for a fixed set of application route names and titles. It does not set a GA user ID or send email, name, Firebase UID, timetable contents, course codes, or query strings. Google Signals and ad-personalization signals are disabled. GA4 provides visitor, session and active-user reports from its standard web collection; reporting availability and definitions are controlled by Google Analytics. This is basic page-view measurement, not detailed feature or timetable behavior tracking.

GA4 uses browser-side analytics storage/cookies according to the configured Google Analytics property and applicable consent setup. Review your institution's privacy requirements and provide any required notice/consent before enabling the measurement ID. The app itself does not send account identifiers to GA4.

## Persistence limits

The current JSON persistence store assigns ownership safely for the deployed single-process API and uses atomic file replacement. A local JSON file is not a multi-instance database: concurrent API replicas can overwrite each other's updates, and ephemeral disk replacement can lose all stored records. Keep one API instance and attach durable storage if retaining saved timetables is required. Before enabling multiple instances, migrate the store to a transactional shared database with UID ownership and access controls. No database migration is included here.

Legacy unowned rows are deliberately not assigned to the first account or made globally visible. Back them up and use an explicit, verified ownership migration if they must be recovered.
