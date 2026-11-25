import { Redirect } from 'expo-router';

/**
 * Any unknown link (for example a bare "smarttouristmobileapp://" deep link with an odd path)
 * goes back to the start screen instead of showing expo-router's "Unmatched Route" page.
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
