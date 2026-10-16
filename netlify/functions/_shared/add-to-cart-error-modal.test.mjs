import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const storefrontSource = readFileSync('js/site.js', 'utf8');
const storefrontStyles = readFileSync('css/site.css', 'utf8');

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.isConnected = false;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  appendChild(child) {
    child.parentElement = this;
    child.setConnected(this.isConnected);
    this.children.push(child);
    return child;
  }

  setConnected(value) {
    this.isConnected = value;
    this.children.forEach((child) => child.setConnected(value));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    const listeners = [...(this.listeners.get(event.type) || [])];
    listeners.forEach(({ listener, once }) => {
      listener.call(this, event);
      if (once) {
        this.listeners.set(
          event.type,
          (this.listeners.get(event.type) || []).filter((entry) => entry.listener !== listener)
        );
      }
    });
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
    this.setConnected(false);
  }
}

function walk(element) {
  return [element, ...element.children.flatMap(walk)];
}

function createHarness(pathname = '/') {
  const document = {
    readyState: 'loading',
    activeElement: null,
    createElement(tagName) {
      return new FakeElement(tagName, document);
    },
    getElementById(id) {
      return walk(document.documentElement).find((element) => element.id === id) || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };

  document.documentElement = new FakeElement('html', document);
  document.documentElement.setConnected(true);
  document.body = new FakeElement('body', document);
  document.documentElement.appendChild(document.body);

  const trigger = new FakeElement('button', document);
  trigger.textContent = 'Agregar al carrito';
  document.body.appendChild(trigger);
  document.activeElement = trigger;

  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };

  let nextResponse = { ok: true, body: { ok: true, lease: null } };
  const window = {
    location: { pathname },
    addEventListener() {},
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
  };

  const context = vm.createContext({
    console,
    document,
    localStorage,
    window,
    fetch: async () => {
      if (nextResponse.throw) throw nextResponse.throw;
      return {
        ok: nextResponse.ok,
        json: async () => nextResponse.body,
      };
    },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    URL,
    Error,
  });

  vm.runInContext(storefrontSource, context, { filename: 'js/site.js' });

  return {
    context,
    document,
    localStorage,
    trigger,
    window,
    setResponse(response) {
      nextResponse = response;
    },
  };
}

function modalElements(document) {
  const backdrop = document.getElementById('add-to-cart-error-backdrop');
  assert.ok(backdrop, 'the blocking modal should be present');
  const elements = walk(backdrop);
  return {
    backdrop,
    dialog: elements.find((element) => element.getAttribute('role') === 'alertdialog'),
    title: elements.find((element) => element.id === 'add-to-cart-error-title'),
    body: elements.find((element) => element.id === 'add-to-cart-error-body'),
    buttons: elements.filter((element) => element.tagName === 'BUTTON'),
  };
}

async function rejectedAdd(error, pathname = '/') {
  const harness = createHarness(pathname);
  await harness.window.__staticCartReady;
  harness.setResponse({ ok: false, body: { error } });
  const originalPath = harness.window.location.pathname;
  const added = await harness.context.addStaticCartItem('item-1');
  assert.equal(added, false);
  assert.equal(harness.window.location.pathname, originalPath);
  const cart = JSON.parse(harness.localStorage.getItem('mudanza-demo-cart'));
  assert.deepEqual(cart.ids, []);
  return { ...harness, ...modalElements(harness.document) };
}

test('reservation conflict uses the exact owner-approved one-button modal', async () => {
  const result = await rejectedAdd(
    'Este artículo está temporalmente reservado por otro comprador.'
  );

  assert.equal(result.title.textContent, 'Este artículo ya está reservado');
  assert.equal(
    result.body.textContent,
    'Otra persona lo tiene reservado temporalmente en este momento.'
  );
  assert.equal(result.buttons.length, 1);
  assert.equal(result.buttons[0].textContent, 'Entendido');
  assert.equal(result.dialog.getAttribute('aria-modal'), 'true');
});

test('unavailable item uses a prominent acknowledgement-only modal', async () => {
  const result = await rejectedAdd('Este artículo ya no está disponible.');
  assert.equal(result.title.textContent, 'Este artículo ya no está disponible');
  assert.equal(result.buttons.length, 1);
  assert.equal(result.buttons[0].textContent, 'Entendido');
});

test('expired cart session uses a prominent acknowledgement-only modal', async () => {
  const result = await rejectedAdd(
    'La sesión del carrito venció. Actualizá la página e intentá nuevamente.'
  );
  assert.equal(result.title.textContent, 'La sesión del carrito venció');
  assert.equal(result.buttons.length, 1);
  assert.equal(result.buttons[0].textContent, 'Entendido');
});

test('generic server and network failures use a clear acknowledgement-only modal', async () => {
  const server = await rejectedAdd('Database request failed');
  assert.equal(server.title.textContent, 'No pudimos agregar el artículo');
  assert.equal(server.buttons.length, 1);

  const networkHarness = createHarness('/');
  await networkHarness.window.__staticCartReady;
  networkHarness.setResponse({ throw: new Error('Failed to fetch') });
  assert.equal(await networkHarness.context.addStaticCartItem('item-1'), false);
  const network = modalElements(networkHarness.document);
  assert.equal(network.title.textContent, 'No pudimos agregar el artículo');
  assert.equal(network.buttons.length, 1);
});

test('successful Add to Cart keeps normal behavior and does not open a failure modal', async () => {
  const harness = createHarness('/');
  await harness.window.__staticCartReady;
  harness.setResponse({
    ok: true,
    body: {
      ok: true,
      lease: {
        createdAt: 1,
        expiresAt: Date.now() + 35 * 60 * 1000,
        extensionUsed: false,
        items: { 'item-1': 1 },
      },
    },
  });

  assert.equal(await harness.context.addStaticCartItem('item-1'), true);
  assert.equal(harness.document.getElementById('add-to-cart-error-backdrop'), null);
  const cart = JSON.parse(harness.localStorage.getItem('mudanza-demo-cart'));
  assert.deepEqual(cart.ids, ['item-1']);
});

test('homepage and product detail Add to Cart share the same blocking failure path', async () => {
  const homepage = await rejectedAdd('Este artículo ya no está disponible.', '/');
  const detail = await rejectedAdd(
    'Este artículo está temporalmente reservado por otro comprador.',
    '/producto/mesa'
  );

  assert.ok(homepage.backdrop);
  assert.ok(detail.backdrop);
  assert.match(
    storefrontSource,
    /function setupCatalogCartButtons\([\s\S]*?addStaticCartItem\(/
  );
  assert.match(
    storefrontSource,
    /function setupProductCartButton\([\s\S]*?addStaticCartItem\(/
  );
});

test('modal remains until Entendido, traps Tab, and returns focus without navigation', async () => {
  const result = await rejectedAdd(
    'Este artículo está temporalmente reservado por otro comprador.',
    '/producto/mesa'
  );
  const acknowledge = result.buttons[0];

  assert.equal(result.document.activeElement, acknowledge);
  result.document.activeElement = result.trigger;
  let prevented = false;
  result.backdrop.dispatchEvent({
    type: 'keydown',
    key: 'Tab',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(result.document.activeElement, acknowledge);
  assert.ok(result.document.getElementById('add-to-cart-error-backdrop'));

  acknowledge.dispatchEvent({ type: 'click' });
  assert.equal(result.document.getElementById('add-to-cart-error-backdrop'), null);
  assert.equal(result.document.activeElement, result.trigger);
  assert.equal(result.window.location.pathname, '/producto/mesa');
});

test('modal styling is prominent at desktop and small mobile viewports', () => {
  assert.match(
    storefrontStyles,
    /\.add-to-cart-error-backdrop\{[^}]*z-index:12000;[^}]*position:fixed|\.add-to-cart-error-backdrop\{[^}]*position:fixed;[^}]*z-index:12000/
  );
  assert.match(storefrontStyles, /\.add-to-cart-error-dialog\{[^}]*width:min\(100%,520px\)/);
  assert.match(storefrontStyles, /\.add-to-cart-error-dialog button\{[^}]*min-height:54px/);
  assert.match(storefrontStyles, /@media \(max-width:520px\)\{\.add-to-cart-error-backdrop/);
});

test('cart reservation semantics remain an atomic server claim outside the modal code', () => {
  assert.match(
    storefrontSource,
    /postCartReservation\('claim',[\s\S]*?if \(!result\.ok\) throw new Error/m
  );
  assert.match(storefrontSource, /setStaticCartFromLease\(result\.lease\);[\s\S]*?return true;/m);
});
