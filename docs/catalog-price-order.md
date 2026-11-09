# Homepage ordering and Item 615 visibility — November 9, 2026

Production baseline: `71e6dab37e2de6c758ab6a4bb8a1895273c8bed8`, Netlify
deploy `6af22df1e1386011a71f8126`. Root `index.html` and
`js/volume2-storefront.js` are the published storefront. The historical React
source and compiled assets are not rebuilt for this scoped controller change.

## Findings and behavior

The authoritative endpoint already includes Item 615 as AVAILABLE, Vehículos,
quantity 1, USD 18000, INQUIRY, with no PYG asking price. Before this change,
the vehicle category displayed it correctly in a live browser. There was no
backend exclusion to repair. Every old sort except newest grouped USD after
all PYG listings, including descending price; the default used Item number.
With 48 initial cards, this buried the Tracker at the end of ordinary browsing.
Search and the vehicle filter reduced the set and exposed the existing record.

Descending effective price is now the default, and reset restores it. Price
sorting uses the fresh authoritative products, after Admin overrides, without
reading embedded historical prices. Search, categories, availability, maximum
price filtering, opt-in sold listings and append-only loading retain their rules.
Catalog Item-number order, newest and ascending prices remain explicit options.

History snapshots retain filters, loading depth and scroll. An old default
`catalog` snapshot migrates to descending price; an explicitly selected catalog
order now has `sortExplicit: true` and survives Back/Forward and refresh.
Existing saved ascending/newest/descending choices are retained. Old snapshots
cannot distinguish a previously selected catalog order from the old default;
both migrate unless the new explicit marker exists.

## Mixed currency policy: ordering only

`sortingPricePYG` uses the effective `askingPricePYG` for PYG (including
missing currency on legacy PYG records), and `askingPriceUSD * 6226.21` for USD.
The dated reference is Banco Central del Paraguay's November 9, 2026 daily
currency sheet: https://www.bcp.gov.py/webapps/web/cotizacion/monedas (USD row,
PYG 6,226.21 per USD, consulted November 9). This is a fixed, dated ordering
reference, not a live exchange quotation, offered conversion, payment rate or
new selling price. Future reference updates require an ordinary code release.
For ordering, Item 615 compares as 112,071,780 PYG, while its visible price and
approved transaction terms remain **US$18,000, direct WhatsApp inquiry**.

No amount is written back into products, inventory, Admin overrides or checkout.
Unknown, nonpositive and malformed prices, and unsupported currencies, sort
after known prices in either direction with Item-number ties. They are retained
in unfiltered browsing rather than silently removed or treated as free.
Maximum-price filters retain their existing PYG-only eligibility rules; the
conversion is used exclusively for ordering.

No backend, inventory, payment, reservation, marketing, publishing-lock or
vehicle-content changes are required. PR #72 files remain exactly as deployed.
