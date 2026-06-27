# Spekto Scout — Mobile App

React Native / Expo app for Scouts. Same Supabase backend, same database, same `captures` storage bucket as the browser version.

## Setup

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** (free on App Store / Play Store) to test on your phone immediately — no developer account needed for testing.

## Screens

| Screen | Description |
|---|---|
| Login / Register | Supabase auth, same accounts as browser |
| Dashboard (Jobs tab) | Available jobs with radius filter, active jobs, completed jobs |
| Inspection Detail | Accept/decline, start recording, dispute response |
| Recording | Native camera, GPS tagging, uploads to same `captures` bucket |
| Earnings | Payout batch items + awaiting release jobs |
| Disputes | All disputes with filter tabs, SLA countdown |
| Settings | Profile, ID verification, right-to-work, Stripe Connect, notifications |

## Publishing to App Stores

When ready to publish:

1. **Apple App Store** — requires Apple Developer account ($99/year)
2. **Google Play Store** — requires Google Play Developer account ($25 one-time)

Build with EAS:
```bash
npm install -g eas-cli
eas login
eas build --platform ios    # produces .ipa
eas build --platform android # produces .aab
```

Then submit via App Store Connect (Apple) and Google Play Console.
