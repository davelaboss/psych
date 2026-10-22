import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [site, checkout, styles, endpoint] = await Promise.all([
  readFile(new URL('../../../js/site.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../js/checkout.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../css/site.css', import.meta.url), 'utf8'),
  readFile(new URL('../cart-reservation.mjs', import.meta.url), 'utf8'),
]);

test('active cart banner is limited to the four storefront route families and links to cart', () => {
  const routeGuard = site.match(/function storefrontSupportsCartBanner[\s\S]*?\n}/)?.[0] || '';
  assert.match(routeGuard, /path === '\/'/);
  assert.match(routeGuard, /path\.startsWith\('\/producto\/'\)/);
  assert.match(routeGuard, /path === '\/carrito'/);
  assert.match(routeGuard, /path === '\/checkout'/);
  assert.doesNotMatch(routeGuard, /admin/);
  assert.match(site, /id = 'cart-reservation-banner'/);
  assert.match(site, /Tus artículos están reservados/);
  assert.match(site, /href="\/carrito">Ir al carrito/);
});

test('banner and both page cards share one countdown and exact-deadline renderer', () => {
  assert.match(site, /function reservationCardHtml\(actionText\)/);
  assert.match(site, /data-reservation-remaining/);
  assert.match(site, /data-reservation-deadline/);
  assert.match(site, /reservationCardHtml\('Completá tu compra'\)/);
  assert.match(checkout, /reservationCardHtml\('Completá este paso'\)/);
  assert.match(site, /updateCartReservationDisplays\(cart\.expiresAt\)/);
  assert.match(site, /formatReservationDeadline\(expiresAt\)/);
  assert.doesNotMatch(site, /Reserva temporal ·/);
  assert.doesNotMatch(checkout, /Tu carrito queda reservado por/);
});

test('later server leases and quantity responses replace the shared client deadline without client-derived extension', () => {
  const setter = site.slice(
    site.indexOf('function setStaticCartFromLease'),
    site.indexOf('async function syncStaticCartFromServer')
  );
  assert.match(setter, /expiresAt: lease\.expiresAt/);
  assert.match(setter, /startCartReservationCountdown\(lease\.expiresAt\)/);
  assert.doesNotMatch(setter, /Date\.now\(\).*expiresAt|expiresAt.*Date\.now\(\)/);
  const quantity = site.slice(
    site.indexOf('async function setStaticCartQuantity'),
    site.indexOf('function getCartQuantity')
  );
  assert.match(quantity, /postCartReservation\('quantity'/);
  assert.match(quantity, /setStaticCartFromLease\(result\.lease\)/);
});

test('all customer extension controls and copy are gone and the old public action is rejected', () => {
  const customerSource = `${site}\n${checkout}`;
  for (const text of [
    '¿Necesitás más tiempo?',
    'Necesito más tiempo',
    '+20 min',
    'Reserva extendida',
    'extend-checkout-reservation',
    'extend-cart-reservation',
    "postCartReservation('extend'",
  ]) assert.equal(customerSource.includes(text), false, `unexpected extension UI: ${text}`);
  assert.match(endpoint, /if \(action === 'extend'\)[\s\S]*?no admite extensiones/);
});

test('checkout removes premature order-hold copy and duplicate policy while retaining required acknowledgment', () => {
  const checkoutForm = checkout.match(/<form[\s\S]*?<\/form>/)?.[0] || '';
  assert.doesNotMatch(checkout, /Tu pedido quedará reservado por 2 horas/);
  assert.doesNotMatch(checkoutForm, /<section class="final-sale-policy"/);
  assert.match(checkoutForm, /name="finalSaleAcknowledged"[\s\S]*?required/);
  assert.match(checkoutForm, /no se realizan entregas/i);
  assert.match(checkoutForm, /Me corresponde retirar la compra en el domicilio del vendedor/i);
  assert.match(checkoutForm, /Nombre y apellido[\s\S]*?final-sale-acknowledgment[\s\S]*?WhatsApp[\s\S]*?Correo electrónico[\s\S]*?Crear pedido y ver datos/);
});

test('checkout order transition clears the cart and therefore its persistent reservation UI', () => {
  const success = checkout.match(/const saved = \{[\s\S]*?window\.location\.assign/ )?.[0] || '';
  assert.match(success, /localStorage\.removeItem\(\s*CHECKOUT_CART_KEY/);
  assert.match(success, /updateStaticCartCount/);
  assert.match(site, /if \(!cart\?\.expiresAt \|\| !cart\?\.ids\?\.length\) clearCartReservationUi\(\)/);
});

test('CART card styles outrank checkout injected rules without redesigning the ORDER card', () => {
  const cartCard = site.match(/function reservationCardHtml\(actionText\)[\s\S]*?\n}/)?.[0] || '';
  const orderCard = checkout.match(/<section class="reservation-deadline-card" role="status">[\s\S]*?RESERVA DEL PEDIDO[\s\S]*?<\/section>/)?.[0] || '';
  const injectedStrongRule = checkout.match(/\.reservation-deadline-card > strong \{[\s\S]*?\}/)?.[0] || '';

  assert.match(cartCard, /class="reservation-deadline-card" data-reservation-card/);
  assert.match(styles, /\.reservation-deadline-card\[data-reservation-card\]\{[^}]*border:3px solid[^}]*background:#fff7d7/);
  assert.match(styles, /\.reservation-deadline-card\[data-reservation-card\]>strong\{font-size:clamp\(30px,4vw,43px\)!important/);
  assert.match(styles, /@media\(max-width:620px\)[\s\S]*?\.reservation-deadline-card\[data-reservation-card\]>strong\{font-size:31px!important\}/);
  assert.match(injectedStrongRule, /font-size: 1\.3rem/);
  assert.ok(
    '.reservation-deadline-card[data-reservation-card]>strong'.split(/(?=[.\[])/).length >
      '.reservation-deadline-card>strong'.split(/(?=[.\[])/).length,
    'the CART countdown selector must be more specific than the later checkout rule'
  );
  assert.match(orderCard, /class="reservation-deadline-card" role="status"/);
  assert.doesNotMatch(orderCard, /data-reservation-card/);
  assert.doesNotMatch(styles, /(?:^|})\.reservation-deadline-card\{/);
});

test('continuously ticking CART countdown is semantic but not a live region', () => {
  const cartCard = site.match(/function reservationCardHtml\(actionText\)[\s\S]*?\n}/)?.[0] || '';
  const updater = site.match(/function updateCartReservationDisplays\(expiresAt\)[\s\S]*?\n}/)?.[0] || '';

  assert.match(cartCard, /<section[^>]*aria-label="Reserva del carrito"/);
  assert.doesNotMatch(cartCard, /role="status"|aria-live=/);
  assert.match(updater, /node\.textContent = remainingText/);
  assert.match(updater, /node\.textContent = deadlineText/);
});

test('reservation hierarchy is prominent, accessible, and mobile-safe around 390px', () => {
  assert.match(styles, /\.cart-reservation-banner\{[^}]*background:#f6c84c[^}]*border-bottom:3px solid/);
  assert.match(styles, /\.reservation-deadline-card\[data-reservation-card\]\{[^}]*border:3px solid[^}]*background:#fff7d7/);
  assert.match(styles, /\.reservation-modal-backdrop\{[^}]*position:fixed[^}]*z-index:12500/);
  assert.match(styles, /@media\(max-width:620px\)[\s\S]*?\.cart-reservation-banner>div\{grid-template-columns:1fr auto/);
  assert.match(styles, /\.cart-reservation-banner>div\{width:min\(1180px,100%\)/);
  assert.match(site, /role', 'dialog'/);
  assert.match(site, /aria-modal', 'true'/);
});

test('warning and expiration dialogs persist one-time event keys per exact deadline', () => {
  assert.match(site, /CART_WARNING_DEADLINES_KEY/);
  assert.match(site, /rememberOneTimeEvent\(CART_WARNING_DEADLINES_KEY, key\)/);
  assert.match(site, /rememberOneTimeEvent\(CART_EXPIRATION_EVENTS_KEY, key\)/);
  assert.match(site, /remaining <= 15 \* 60 \* 1000/);
  assert.match(site, /title: 'Tu reserva vence pronto'/);
  assert.match(site, /title: 'Tu reserva venció'/);
});
