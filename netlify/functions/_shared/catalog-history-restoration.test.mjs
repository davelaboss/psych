import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const controller = await readFile(new URL('../../../js/volume2-storefront.js', import.meta.url), 'utf8');
const staticStorefront = await readFile(new URL('../../../js/site.js', import.meta.url), 'utf8');
const sourceStorefront = await readFile(new URL('../../../source/components/storefront.tsx', import.meta.url), 'utf8');
const sourceProductCard = await readFile(new URL('../../../source/components/product-card.tsx', import.meta.url), 'utf8');
const sourcePageScroll = await readFile(new URL('../../../source/components/history-scroll-restoration.tsx', import.meta.url), 'utf8');
const sourceProductPage = await readFile(new URL('../../../source/app/producto/[slug]/page.tsx', import.meta.url), 'utf8');
const sourceCartPage = await readFile(new URL('../../../source/app/carrito/page.tsx', import.meta.url), 'utf8');
const instrumentedController = controller.replace(
  /\}\)\(\);\s*$/,
  `globalThis.__catalogHistory = {
    CATALOG_HISTORY_KEY,
    PAGE_SCROLL_HISTORY_KEY,
    catalogSnapshotFromValues,
    pageScrollSnapshot,
    readCatalogHistoryState,
    readPageScrollHistoryState,
    replaceCatalogHistoryState,
    replacePageScrollHistoryState,
    restoreCatalogState,
    restoredRenderCount,
  };\n})();`,
);
const context = {
  console,
  document: { readyState: 'loading', addEventListener() {} },
  window: {},
};
runInNewContext(instrumentedController, context);
const historyHelpers = context.__catalogHistory;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshot(overrides = {}) {
  return historyHelpers.catalogSnapshotFromValues({
    search: 'mesa',
    category: 'Cocina',
    availability: 'DELAYED',
    condition: 'GOOD',
    maxPrice: '2000000',
    sort: 'price-desc',
    showSold: true,
    renderedCount: 350,
    scrollY: 18420,
    ...overrides,
  });
}

class MemoryHistory {
  constructor() {
    this.entries = [{ url: '/', state: null }];
    this.index = 0;
  }

  get state() {
    return this.entries[this.index].state;
  }

  replaceState(state, _title, url) {
    this.entries[this.index] = { state, url };
  }

  push(url, state = null) {
    this.entries.splice(this.index + 1);
    this.entries.push({ url, state });
    this.index += 1;
  }

  back() {
    this.index = Math.max(0, this.index - 1);
    return this.entries[this.index];
  }

  forward() {
    this.index = Math.min(this.entries.length - 1, this.index + 1);
    return this.entries[this.index];
  }
}

test('catalog snapshot contains every discovery control, render depth, and scroll position', () => {
  assert.deepEqual(plain(snapshot()), {
    version: 1,
    search: 'mesa',
    category: 'Cocina',
    availability: 'DELAYED',
    condition: 'GOOD',
    maxPrice: '2000000',
    sort: 'price-desc',
    showSold: true,
    renderedCount: 350,
    scrollY: 18420,
  });
});

test('restoration applies controls and render depth before scrolling, then resumes observation', () => {
  const calls = [];
  const saved = snapshot();
  historyHelpers.restoreCatalogState(saved, {
    restoreControls(value) {
      calls.push(['controls', value.search, value.category, value.availability]);
    },
    applyFilters(renderedCount) {
      calls.push(['filters-and-depth', renderedCount]);
    },
    restoreScroll(scrollY, onRestored) {
      calls.push(['scroll', scrollY]);
      onRestored();
    },
    resumeLoading() {
      calls.push(['observer']);
    },
  });

  assert.deepEqual(calls, [
    ['controls', 'mesa', 'Cocina', 'DELAYED'],
    ['filters-and-depth', 350],
    ['scroll', 18420],
    ['observer'],
  ]);
});

test('restored render depth is direct, bounded, and fresh visits still start at 48', () => {
  assert.equal(historyHelpers.restoredRenderCount(350, 500), 350);
  assert.equal(historyHelpers.restoredRenderCount(12, 500), 48);
  assert.equal(historyHelpers.restoredRenderCount(undefined, 500), 48);
  assert.equal(historyHelpers.restoredRenderCount(700, 500), 500);
});

test('catalog to product or cart and Back restores the catalog entry snapshot', () => {
  for (const destination of ['/producto/item-350', '/carrito']) {
    const history = new MemoryHistory();
    const saved = snapshot();
    historyHelpers.replaceCatalogHistoryState(history, '/', saved);
    history.push(destination);

    const catalogEntry = history.back();
    assert.equal(catalogEntry.url, '/');
    assert.deepEqual(plain(historyHelpers.readCatalogHistoryState(catalogEntry.state)), plain(saved));
  }
});

test('product to cart Back order remains product, then the original catalog entry', () => {
  const history = new MemoryHistory();
  const saved = snapshot({ search: '', category: '', availability: 'ALL' });
  historyHelpers.replaceCatalogHistoryState(history, '/', saved);
  history.push('/producto/item-350', { route: 'product' });
  history.push('/carrito', { route: 'cart' });

  assert.deepEqual(history.back().state, { route: 'product' });
  assert.deepEqual(plain(historyHelpers.readCatalogHistoryState(history.back().state)), plain(saved));
});

test('Back, Forward, Back does not consume the history-entry catalog state', () => {
  const history = new MemoryHistory();
  const saved = snapshot();
  historyHelpers.replaceCatalogHistoryState(history, '/', saved);
  history.push('/producto/item-350');

  assert.deepEqual(plain(historyHelpers.readCatalogHistoryState(history.back().state)), plain(saved));
  assert.equal(history.forward().url, '/producto/item-350');
  assert.deepEqual(plain(historyHelpers.readCatalogHistoryState(history.back().state)), plain(saved));
});

test('a genuinely fresh homepage entry has no unrelated catalog state', () => {
  const history = new MemoryHistory();
  historyHelpers.replaceCatalogHistoryState(history, '/', snapshot());
  history.push('/producto/item-350');
  history.push('/');

  assert.equal(historyHelpers.readCatalogHistoryState(history.state), null);
});

test('product and cart scroll positions belong to their own history entries', () => {
  const history = new MemoryHistory();
  history.entries[0].url = '/producto/item-350';
  const productScroll = historyHelpers.pageScrollSnapshot('/producto/item-350', 1081);
  historyHelpers.replacePageScrollHistoryState(
    history,
    '/producto/item-350',
    productScroll,
  );
  history.push('/carrito');

  const productEntry = history.back();
  assert.deepEqual(
    plain(historyHelpers.readPageScrollHistoryState(productEntry.state, productEntry.url)),
    plain(productScroll),
  );

  history.forward();
  const cartScroll = historyHelpers.pageScrollSnapshot('/carrito', 640);
  historyHelpers.replacePageScrollHistoryState(history, '/carrito', cartScroll);
  history.push('/producto/item-351');
  const cartEntry = history.back();
  assert.deepEqual(
    plain(historyHelpers.readPageScrollHistoryState(cartEntry.state, cartEntry.url)),
    plain(cartScroll),
  );
});

test('cart boot initializes page history without entering catalog loading and restores after cart render', async () => {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const animationFrames = [];
  let catalogLoads = 0;
  let scrollY = 0;
  const historyState = {
    mudanzaPageScrollState: {
      version: 1,
      path: '/carrito',
      scrollY: 640,
    },
  };
  const browserHistory = {
    state: historyState,
    scrollRestoration: 'auto',
    replaceState(state) {
      this.state = state;
    },
  };
  const browserWindow = {
    history: browserHistory,
    innerHeight: 800,
    location: {
      href: 'https://example.test/carrito',
      pathname: '/carrito',
    },
    get scrollY() {
      return scrollY;
    },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    loadAuthoritativeCatalog() {
      catalogLoads += 1;
      return Promise.resolve({ products: [], deliveredProduct: null });
    },
    requestAnimationFrame(callback) {
      animationFrames.push(callback);
    },
    scrollTo({ top }) {
      scrollY = top;
    },
    setTimeout,
  };
  const bootContext = {
    clearTimeout,
    console,
    document: {
      documentElement: { scrollHeight: 2400 },
      readyState: 'loading',
      addEventListener(type, listener) {
        documentListeners.set(type, listener);
      },
    },
    setTimeout,
    window: browserWindow,
  };

  runInNewContext(controller, bootContext);
  await documentListeners.get('DOMContentLoaded')();

  assert.equal(browserHistory.scrollRestoration, 'manual');
  assert.ok(windowListeners.has('scroll'), 'cart boot installs page scroll tracking');
  assert.ok(windowListeners.has('pagehide'), 'cart boot installs pagehide persistence');
  assert.ok(windowListeners.has('storefront:cart-rendered'), 'cart boot waits for authoritative cart render');
  assert.equal(catalogLoads, 0, 'catalog controller must not load catalog on cart');
  assert.equal(animationFrames.length, 0, 'saved scroll waits for the cart render');

  windowListeners.get('storefront:cart-rendered')();
  assert.equal(animationFrames.length, 1);
  while (animationFrames.length) animationFrames.shift()();
  assert.equal(scrollY, 640);
});

test('the cart render owner signals history restoration for every terminal render state', () => {
  const completion = staticStorefront.match(/function completeCartRoute\(\)[\s\S]*?\n}/)?.[0] || '';
  const completionCalls = staticStorefront.match(/completeCartRoute\(\);/g) || [];

  assert.match(completion, /classList\.remove\('cart-route-pending'\)/);
  assert.match(completion, /dispatchEvent\(new CustomEvent\('storefront:cart-rendered'\)\)/);
  assert.equal(completionCalls.length, 3, 'error, empty, and populated cart renders all signal completion');
});

test('product-to-product Back keeps Product A scroll and rejects another path state', () => {
  const history = new MemoryHistory();
  history.entries[0].url = '/producto/item-350';
  const saved = historyHelpers.pageScrollSnapshot('/producto/item-350', 1081);
  historyHelpers.replacePageScrollHistoryState(history, '/producto/item-350', saved);
  history.push('/producto/item-351');

  const productA = history.back();
  assert.deepEqual(
    plain(historyHelpers.readPageScrollHistoryState(productA.state, productA.url)),
    plain(saved),
  );
  assert.equal(
    historyHelpers.readPageScrollHistoryState(productA.state, '/producto/item-999'),
    null,
  );
});

test('catalog state is saved continuously and legacy global scroll storage is absent', () => {
  assert.match(controller, /historyObject\.replaceState/);
  assert.match(controller, /window\.addEventListener\('scroll', scheduleScrollSave, \{ passive: true \}\)/);
  assert.match(controller, /window\.addEventListener\('pagehide', flushCatalogState\)/);
  assert.match(controller, /SCROLL_SAVE_DELAY_MS = 150/);
  assert.match(controller, /if \(state\.restoringCatalog\) return/);
  assert.match(controller, /path === '\/carrito' \|\| path\.startsWith\('\/producto\/'\)/);
  assert.match(controller, /window\.history\.scrollRestoration = isStorefrontFlow \? 'manual' : 'auto'/);
  assert.match(controller, /PAGE_SCROLL_HISTORY_KEY = 'mudanzaPageScrollState'/);
  assert.match(controller, /restorePageHistoryScroll\(savedPageScroll\)/);
  assert.match(controller, /window\.addEventListener\('pagehide', \(\) => flushPageScroll\(!state\.pageLinkNavigation\)\)/);
  assert.match(sourcePageScroll, /HISTORY_KEY = 'mudanzaPageScrollState'/);
  assert.match(sourcePageScroll, /document\.addEventListener\('click', captureLinkNavigation, true\)/);
  assert.match(sourcePageScroll, /window\.addEventListener\('pagehide', saveCurrent\)/);
  assert.match(sourceProductPage, /<HistoryScrollRestoration \/>/);
  assert.match(sourceCartPage, /<HistoryScrollRestoration \/>/);
  assert.match(staticStorefront, /window\.persistCatalogHistoryState\?\.\(\)/);
  assert.match(sourceStorefront, /window\.history\.replaceState/);
  assert.match(sourceProductCard, /persistCatalogHistoryState\?\.\(\)/);
  assert.doesNotMatch(`${controller}\n${staticStorefront}\n${sourceStorefront}\n${sourceProductCard}`, /mudanza-catalog-scroll|sessionStorage/);
  assert.doesNotMatch(controller, /history\.pushState|history\.back\(|location\.replace/);
});
