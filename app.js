(() => {
  'use strict';

  const PRODUCTS_KEY = 'stockroom-products-v1';
  const SETTINGS_KEY = 'stockroom-settings-v1';
  const RECENT_KEY = 'stockroom-recent-v1';
  const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

  const sampleProducts = [
    { barcode: '000123456789', name: 'Potato Chips Original 60g', category: 'Snacks', retailPrice: 35, listedPrice: 45, stock: 18, reorderAt: 5 },
    { barcode: '000123456790', name: 'Cola Can 330ml', category: 'Drinks', retailPrice: 28, listedPrice: 38, stock: 24, reorderAt: 8 },
    { barcode: '000123456791', name: 'Purified Water 500ml', category: 'Drinks', retailPrice: 12, listedPrice: 18, stock: 31, reorderAt: 10 },
    { barcode: '000123456792', name: 'Chocolate Bar Classic 45g', category: 'Snacks', retailPrice: 42, listedPrice: 55, stock: 7, reorderAt: 8 },
    { barcode: '000123456793', name: 'Instant Noodles Chicken', category: 'Pantry', retailPrice: 16, listedPrice: 24, stock: 4, reorderAt: 6 },
    { barcode: '000123456794', name: 'White Bread Loaf', category: 'Bakery', retailPrice: 58, listedPrice: 72, stock: 0, reorderAt: 4 },
  ];

  const state = {
    products: load(PRODUCTS_KEY, sampleProducts),
    settings: load(SETTINGS_KEY, { storeName: 'Corner Store', lowStockThreshold: 5 }),
    recent: load(RECENT_KEY, []),
    selectedBarcode: null,
    resultMessage: '',
    resultMessageType: '',
    stream: null,
    detector: null,
    scanTimer: null,
    scanning: false,
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const cameraPreview = $('#cameraPreview');
  const cameraFrame = $('.camera-frame');
  const cameraPlaceholder = $('#cameraPlaceholder');
  const scannerState = $('#scannerState');
  const scannerNote = $('#scannerNote');
  const toast = $('#toast');
  const visualMatchButton = $('#visualMatch');
  const visualState = $('#visualState');
  const visualResult = $('#visualResult');

  function load(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch (error) {
      return fallback;
    }
  }

  function persist() {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(state.products));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    localStorage.setItem(RECENT_KEY, JSON.stringify(state.recent));
  }

  function money(value) { return currency.format(Number(value) || 0); }
  function normalizeBarcode(value) { return String(value || '').replace(/\s+/g, '').trim(); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function findProduct(barcode) { return state.products.find((product) => product.barcode === normalizeBarcode(barcode)); }
  function isLow(product) { return product.stock > 0 && product.stock <= Math.max(product.reorderAt, state.settings.lowStockThreshold); }
  function isOut(product) { return product.stock <= 0; }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.size) { resolve(''); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function imageSignature(source) {
    const canvas = document.createElement('canvas');
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const sourceWidth = source.videoWidth || source.naturalWidth || source.width;
    const sourceHeight = source.videoHeight || source.naturalHeight || source.height;
    const crop = Math.min(sourceWidth, sourceHeight);
    const offsetX = (sourceWidth - crop) / 2;
    const offsetY = (sourceHeight - crop) / 2;
    context.drawImage(source, offsetX, offsetY, crop, crop, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size).data;
    const histogram = new Array(64).fill(0);
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index] >> 6;
      const green = pixels[index + 1] >> 6;
      const blue = pixels[index + 2] >> 6;
      histogram[(red * 16) + (green * 4) + blue] += 1;
    }
    const total = size * size;
    return histogram.map((value) => value / total);
  }

  function signatureDistance(first, second) {
    return Math.sqrt(first.reduce((total, value, index) => total + ((value - second[index]) ** 2), 0) / first.length);
  }

  function setVisualState(label) {
    visualState.textContent = label;
  }

  function renderVisualCatalog(message = 'Choose the item you are holding. You can add a reference photo to make future visual matches faster.') {
    visualResult.hidden = false;
    visualResult.innerHTML = `<div class="visual-result-heading">CATALOG PICKER</div><p class="visual-empty">${escapeHtml(message)}</p>${state.products.map((product) => `<button class="visual-match" data-visual-barcode="${escapeHtml(product.barcode)}" type="button"><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || 'GENERAL')} · ${product.referencePhoto ? 'PHOTO READY' : 'NO REFERENCE PHOTO'}</small></span><span class="visual-confidence">${money(product.listedPrice)}</span></button>`).join('')}`;
  }

  function selectVisualProduct(barcode) {
    const product = findProduct(barcode);
    if (!product) return;
    switchView('scan');
    showProduct(product, false);
    setResultMessage('Visual match selected. Verify the item before selling.', 'warning');
    renderProduct();
    showToast(`${product.name} selected for confirmation.`);
  }

  async function runVisualMatch() {
    if (!state.stream || cameraPreview.readyState < 2) {
      setVisualState('START CAMERA');
      showToast('Start the camera before capturing an item.');
      return;
    }
    const referenceProducts = state.products.filter((product) => product.referencePhoto);
    if (!referenceProducts.length) {
      setVisualState('PICK ITEM');
      renderVisualCatalog('No reference photos are saved yet. Choose the item from your catalog, then add a clear reference photo when creating future products.');
      return;
    }
    setVisualState('MATCHING');
    try {
      const capturedSignature = imageSignature(cameraPreview);
      const matches = [];
      for (const product of referenceProducts) {
        const image = new Image();
        image.src = product.referencePhoto;
        await new Promise((resolve) => { image.onload = resolve; image.onerror = resolve; });
        if (image.naturalWidth) matches.push({ product, similarity: Math.max(0, Math.min(99, Math.round(100 - signatureDistance(capturedSignature, imageSignature(image)) * 100))) });
      }
      matches.sort((a, b) => b.similarity - a.similarity);
      if (!matches.length) throw new Error('No readable reference photos');
      visualResult.hidden = false;
      visualResult.innerHTML = `<div class="visual-result-heading">TOP VISUAL MATCHES — CONFIRM ITEM</div><p class="visual-empty">Similarity is an assist, not proof. Select the correct product before viewing its price.</p>${matches.slice(0, 3).map(({ product, similarity }) => `<button class="visual-match" data-visual-barcode="${escapeHtml(product.barcode)}" type="button"><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || 'GENERAL')} · ${similarity}% visual similarity</small></span><span class="visual-confidence">${similarity}%</span></button>`).join('')}`;
      setVisualState('CONFIRM');
    } catch (error) {
      setVisualState('TRY AGAIN');
      renderVisualCatalog('The visual match needs a clearer view. Try better lighting, center the item, or choose from the catalog.');
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function setResultMessage(message, type = '') {
    state.resultMessage = message;
    state.resultMessageType = type;
  }

  function showProduct(product, addToRecent = true) {
    if (!product) return;
    state.selectedBarcode = product.barcode;
    setResultMessage('');
    if (addToRecent) {
      state.recent = [{ barcode: product.barcode, name: product.name, listedPrice: product.listedPrice, at: Date.now() }, ...state.recent.filter((item) => item.barcode !== product.barcode)].slice(0, 8);
      persist();
    }
    renderProduct();
    renderRecent();
  }

  function lookupBarcode(value) {
    const barcode = normalizeBarcode(value);
    if (!barcode) {
      setResultMessage('Enter a barcode number first.', 'warning');
      renderProduct();
      return;
    }
    const product = findProduct(barcode);
    if (!product) {
      state.selectedBarcode = null;
      setResultMessage(`No product found for ${barcode}. Add it to your catalog below.`, 'warning');
      renderProduct();
      openAddProduct(barcode);
      showToast('Product not found — ready to add.');
      return;
    }
    showProduct(product);
    $('#barcodeInput').value = '';
  }

  function renderProduct() {
    const empty = $('#emptyResult');
    const content = $('#productResultContent');
    const product = state.selectedBarcode ? findProduct(state.selectedBarcode) : null;
    if (!product) {
      empty.hidden = false;
      content.hidden = true;
      $('#productResult').classList.add('is-empty');
      if (state.resultMessage) {
        empty.innerHTML = `<span class="result-icon">!</span><span>${escapeHtml(state.resultMessage)}</span>`;
      } else {
        empty.innerHTML = '<span class="result-icon">⌕</span><span>Scan or enter a barcode to begin.</span>';
      }
      return;
    }
    empty.hidden = true;
    content.hidden = false;
    $('#productResult').classList.remove('is-empty');
    $('#resultCategory').textContent = (product.category || 'GENERAL').toUpperCase();
    $('#resultName').textContent = product.name;
    $('#resultBarcode').textContent = product.barcode;
    $('#resultRetail').textContent = money(product.retailPrice);
    $('#resultListed').textContent = money(product.listedPrice);
    $('#resultMargin').textContent = money(product.listedPrice - product.retailPrice);
    $('#resultStock').textContent = String(product.stock);
    const badge = $('#resultStockBadge');
    badge.className = 'stock-badge';
    if (isOut(product)) { badge.textContent = 'OUT OF STOCK'; badge.classList.add('out'); }
    else if (isLow(product)) { badge.textContent = 'LOW STOCK'; badge.classList.add('low'); }
    else badge.textContent = 'IN STOCK';
    $('#sellOne').disabled = isOut(product);
    $('#sellOne').style.opacity = isOut(product) ? '.45' : '1';
    const message = $('#resultMessage');
    message.textContent = state.resultMessage;
    message.className = `result-message ${state.resultMessageType}`;
  }

  function renderRecent() {
    const list = $('#recentList');
    $('#scanCount').textContent = `${state.recent.length} scan${state.recent.length === 1 ? '' : 's'}`;
    if (!state.recent.length) {
      list.innerHTML = '<p class="muted-text">Your recent lookups will appear here.</p>';
      return;
    }
    list.innerHTML = state.recent.map((item) => `<button class="recent-item" data-recent-barcode="${escapeHtml(item.barcode)}" type="button"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.barcode)} · ${new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></span><span class="recent-price">${money(item.listedPrice)}</span></button>`).join('');
  }

  function renderStats() {
    $('#productCount').textContent = String(state.products.length);
    $('#unitCount').textContent = String(state.products.reduce((total, product) => total + Number(product.stock || 0), 0));
    $('#lowStockCount').textContent = String(state.products.filter((product) => isLow(product) || isOut(product)).length);
  }

  function renderInventory() {
    const query = $('#inventorySearch').value.toLowerCase().trim();
    const filter = $('#inventoryFilter').value;
    const products = state.products.filter((product) => {
      const matchesQuery = !query || [product.name, product.category, product.barcode].some((value) => String(value).toLowerCase().includes(query));
      const matchesFilter = filter === 'all' || (filter === 'low' && isLow(product)) || (filter === 'out' && isOut(product));
      return matchesQuery && matchesFilter;
    });
    const list = $('#inventoryList');
    if (!products.length) { list.innerHTML = '<p class="muted-text">No products match this filter.</p>'; return; }
    list.innerHTML = products.map((product) => `<article class="inventory-row ${isLow(product) || isOut(product) ? 'low' : ''}"><div class="inventory-product"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.category || 'GENERAL')} · ${escapeHtml(product.barcode)}</small></div><div class="inventory-value"><small>ON HAND</small><strong>${product.stock}</strong></div><div class="inventory-value"><small>RETAIL</small><strong>${money(product.retailPrice)}</strong></div><div class="inventory-value"><small>LISTED</small><strong>${money(product.listedPrice)}</strong></div><div class="inventory-value"><small>STATUS</small><strong>${isOut(product) ? 'OUT' : isLow(product) ? 'LOW' : 'OK'}</strong></div><div class="inventory-actions"><button class="small-button" data-stock-action="restock" data-barcode="${escapeHtml(product.barcode)}" type="button" aria-label="Restock ${escapeHtml(product.name)}">+</button><button class="small-button" data-stock-action="sell" data-barcode="${escapeHtml(product.barcode)}" type="button" aria-label="Sell one ${escapeHtml(product.name)}">−</button></div></article>`).join('');
  }

  function renderSettings() {
    $('#storeNameLabel').textContent = state.settings.storeName.toUpperCase();
    $('#storeNameInput').value = state.settings.storeName;
    $('#lowStockInput').value = state.settings.lowStockThreshold;
  }

  function renderAll() { renderProduct(); renderRecent(); renderStats(); renderInventory(); renderSettings(); }

  function changeStock(barcode, delta) {
    const product = findProduct(barcode);
    if (!product) return;
    if (delta < 0 && product.stock <= 0) { setResultMessage('No units left. Restock before selling.', 'warning'); showToast('Out of stock.'); renderProduct(); return; }
    product.stock = Math.max(0, product.stock + delta);
    state.selectedBarcode = product.barcode;
    setResultMessage(delta > 0 ? `Restocked one unit. ${product.stock} now on hand.` : `Sale recorded. ${product.stock} now on hand.`, 'success');
    persist();
    renderAll();
    showToast(delta > 0 ? `${product.name} restocked.` : `${product.name} sold.`);
  }

  function openAddProduct(barcode = '') {
    switchView('inventory');
    const card = $('#addProductCard');
    card.classList.add('is-visible');
    const barcodeField = $('#productForm').elements.barcode;
    barcodeField.value = barcode;
    document.getElementById('inventoryView').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => (barcode ? $('#productForm').elements.name : barcodeField).focus(), 300);
  }

  function switchView(view) {
    $$('.view').forEach((panel) => panel.classList.toggle('is-active', panel.dataset.viewPanel === view));
    $$('.nav-button').forEach((button) => button.classList.toggle('is-active', button.dataset.view === view));
    if (view === 'inventory') renderInventory();
    window.location.hash = view;
  }

  function setScannerStatus(label, note = '') { scannerState.textContent = label; if (note) scannerNote.textContent = note; }

  async function startScanner() {
    if (!navigator.mediaDevices?.getUserMedia) { setScannerStatus('UNAVAILABLE', 'This browser cannot access the camera. Use manual barcode entry or open the app in a secure mobile browser.'); showToast('Camera unavailable on this browser.'); return; }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      cameraPreview.srcObject = state.stream;
      await cameraPreview.play();
      cameraFrame.classList.add('is-live');
      $('#startScan').disabled = true;
      $('#stopScan').disabled = false;
      visualMatchButton.disabled = false;
      setVisualState('READY');
      if (!('BarcodeDetector' in window)) {
        setScannerStatus('CAMERA ON', 'Camera preview is active, but this browser has no native barcode detector. Enter the barcode manually below.');
        return;
      }
      let formats;
      try { formats = await BarcodeDetector.getSupportedFormats(); } catch (error) { formats = []; }
      state.detector = formats.length ? new BarcodeDetector({ formats }) : new BarcodeDetector();
      state.scanning = true;
      setScannerStatus('SCANNING', 'Hold the barcode inside the frame.');
      scanFrame();
    } catch (error) {
      setScannerStatus('CAMERA ERROR', 'Camera permission was denied or the camera is already in use. Manual lookup is still available.');
      showToast('Could not start the camera.');
    }
  }

  async function scanFrame() {
    if (!state.scanning || !state.detector) return;
    try {
      if (cameraPreview.readyState >= 2) {
        const codes = await state.detector.detect(cameraPreview);
        const found = codes.find((code) => code.rawValue);
        if (found) { lookupBarcode(found.rawValue); stopScanner(); return; }
      }
    } catch (error) { /* Keep scanning; the next frame may succeed. */ }
    state.scanTimer = setTimeout(scanFrame, 180);
  }

  function stopScanner() {
    state.scanning = false;
    clearTimeout(state.scanTimer);
    state.detector = null;
    if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
    cameraPreview.srcObject = null;
    cameraFrame.classList.remove('is-live');
    $('#startScan').disabled = false;
    $('#stopScan').disabled = true;
    visualMatchButton.disabled = true;
    setVisualState('READY');
    setScannerStatus('READY');
  }

  function exportBackup() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), products: state.products, settings: state.settings, recent: state.recent }, null, 2);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    link.download = `stockroom-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Backup exported.');
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.products)) throw new Error('Invalid backup');
      state.products = parsed.products;
      state.settings = parsed.settings || state.settings;
      state.recent = Array.isArray(parsed.recent) ? parsed.recent : [];
      persist(); renderAll(); showToast('Backup imported.');
    } catch (error) { showToast('That backup file is not valid.'); }
  }

  $('#lookupForm').addEventListener('submit', (event) => { event.preventDefault(); lookupBarcode($('#barcodeInput').value); });
  $('#startScan').addEventListener('click', startScanner);
  $('#stopScan').addEventListener('click', stopScanner);
  visualMatchButton.addEventListener('click', runVisualMatch);
  $('#visualCatalog').addEventListener('click', () => { setVisualState('PICK ITEM'); renderVisualCatalog(); });
  visualResult.addEventListener('click', (event) => { const button = event.target.closest('[data-visual-barcode]'); if (button) selectVisualProduct(button.dataset.visualBarcode); });
  $('#sellOne').addEventListener('click', () => changeStock(state.selectedBarcode, -1));
  $('#restockOne').addEventListener('click', () => changeStock(state.selectedBarcode, 1));
  $('#inventorySearch').addEventListener('input', renderInventory);
  $('#inventoryFilter').addEventListener('change', renderInventory);
  $('#focusAddProduct').addEventListener('click', () => openAddProduct());
  $('#closeAddProduct').addEventListener('click', () => $('#addProductCard').classList.remove('is-visible'));
  $$('.nav-button').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('#recentList').addEventListener('click', (event) => { const button = event.target.closest('[data-recent-barcode]'); if (button) { switchView('scan'); showProduct(findProduct(button.dataset.recentBarcode), false); } });
  $('#inventoryList').addEventListener('click', (event) => { const button = event.target.closest('[data-stock-action]'); if (button) changeStock(button.dataset.barcode, button.dataset.stockAction === 'restock' ? 1 : -1); });
  $('#productForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const barcode = normalizeBarcode(form.get('barcode'));
    if (findProduct(barcode)) { showToast('That barcode already exists.'); return; }
    const product = { barcode, name: String(form.get('name')).trim(), category: String(form.get('category') || 'General').trim(), retailPrice: Number(form.get('retailPrice')), listedPrice: Number(form.get('listedPrice')), stock: Number(form.get('stock')), reorderAt: Number(form.get('reorderAt')), referencePhoto: await fileToDataUrl(form.get('referencePhoto')) };
    if (!product.name || !barcode || !Number.isFinite(product.retailPrice) || !Number.isFinite(product.listedPrice)) { showToast('Complete the required product fields.'); return; }
    state.products.unshift(product); persist(); event.currentTarget.reset(); event.currentTarget.elements.reorderAt.value = 5; $('#addProductCard').classList.remove('is-visible'); renderAll(); showProduct(product); switchView('scan'); showToast('Product added to catalog.');
  });
  $('#settingsForm').addEventListener('submit', (event) => { event.preventDefault(); state.settings.storeName = $('#storeNameInput').value.trim() || 'Corner Store'; state.settings.lowStockThreshold = Math.max(0, Number($('#lowStockInput').value) || 0); persist(); renderAll(); showToast('Settings saved.'); });
  $('#exportData').addEventListener('click', exportBackup);
  $('#importData').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', (event) => { const [file] = event.target.files; if (file) importBackup(file); event.target.value = ''; });
  $('#resetData').addEventListener('click', () => { if (window.confirm('Restore the sample catalog? Your current local products will be replaced.')) { state.products = sampleProducts.map((product) => ({ ...product })); state.recent = []; persist(); renderAll(); showToast('Sample catalog restored.'); } });
  window.addEventListener('beforeunload', stopScanner);

  $('#todayLabel').textContent = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date()).toUpperCase();
  const initialView = ['scan', 'inventory', 'settings'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'scan';
  renderAll();
  switchView(initialView);
})();
