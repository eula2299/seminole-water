# Public reach and testing savings

`GET /api/national/impact` returns independently nullable `analytics` and `savings` sections. Unavailable totals are hidden, never replaced with promotional estimates.

## GA4 configuration

Enable the Google Analytics Data API in the Google Cloud project, grant its service account Viewer access to the website's GA4 property, and configure the server's secret settings:

- `GA4_PROPERTY_ID`: numeric GA4 property ID, not the G- measurement ID.
- `GA4_SERVICE_ACCOUNT_JSON`: service account JSON credentials, stored only as a server secret. Application Default Credentials are also supported instead.

The server requests `screenPageViews` and `totalUsers` over the property's available lifetime through today, with no daily breakdown or summation of users. Totals refresh at most once per minute. The browser refreshes every minute. GA processing delays and reporting identity can affect totals; the displayed update date is the last successful query. No API credentials are sent to the browser. The existing measurement ID is G-XC8X65GPJJ.

## Savings

Successful address lookups calculate comparable prices on the server. A free test is compared with the lowest priced paid test; otherwise the lowest priced option is compared with the second option, including equal-price options. Unknown prices and free information-only services are not treated as free lab tests. For price ranges, the aggregate uses the conservative lower saving. One comparison, selected by the access plan, contributes per lookup to avoid adding overlapping tests or panels.

`water_savings_opportunities` in the existing `DATABASE_URL` database persists the amount in cents, test name, time and random request ID. Retry IDs are unique, so the same lookup receipt cannot be counted twice. It stores no address, coordinates, email or user identifier. Repeated new lookups can represent the same household: the public label explicitly says opportunities across lookups, not unique beneficiaries or purchases. The aggregate begins with this release; old client-submitted amounts are excluded. The legacy impact endpoint no longer accepts monetary contributions.

No paid provider service or additional hosting service is required by this change.
