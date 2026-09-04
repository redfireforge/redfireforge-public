import { UpdateNotificationBanner } from './UpdateNotificationBanner';
import { AppCloudWaitlistBanner } from './AppCloudWaitlistBanner';

/** Top-of-app promo / update chrome. Extracted so App.tsx stays under the 750-line gate. */
export function AppShellBanners() {
  return (
    <>
      <UpdateNotificationBanner />
      <AppCloudWaitlistBanner />
    </>
  );
}
