# STOCKROOM

A mobile-first convenience-store inventory and barcode price lookup app built with plain HTML, CSS, and JavaScript.

## What it does

- Automatically scans product barcodes with the rear phone camera using a cross-browser barcode reader, with native `BarcodeDetector` fallback.
- Offers a hybrid visual-assist mode: capture the item, compare it with saved reference photos, and confirm the suggested product.
- Provides manual barcode entry as a reliable fallback.
- Shows retail price, listed/selling price, estimated margin, and current stock.
- Records recent scans.
- Supports quick one-unit sales and restocking.
- Shows low-stock and out-of-stock products.
- Lets you add products and export/import a JSON backup.
- Saves data locally in the browser with `localStorage`.

## Run it

Open `index.html` directly for desktop testing, or serve this folder locally:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

For camera scanning on a real phone, publish the folder over HTTPS (for example with GitHub Pages, Netlify, or Cloudflare Pages). Browsers normally block camera access on ordinary insecure network URLs. Tap **START CAMERA** once, hold a barcode in the frame, and the matching retail price, listed price, margin, and quantity will appear automatically.

## Hybrid visual workflow

Use **START CAMERA**, then **CAPTURE ITEM** when the item has no easy-to-find barcode. Visual matching works from reference photos saved with products. Add a clear, front-facing photo when creating a product. The app compares the live camera frame with those photos and displays the closest matches for confirmation.

Visual matching is an on-device assist, not a guaranteed identification system. Similar packaging, poor lighting, or a new package design can produce a wrong match, so always confirm the product before selling. **CHOOSE FROM CATALOG** is the no-barcode fallback when no reference photos are available.

## Try the sample catalog

The starter catalog includes sample products. The sample potato chips barcode is:

```text
000123456789
```

Because the data is local-only, each browser/device has its own catalog. Export a backup before moving to another device.

## Production considerations

This is a complete front-end prototype for a small store or portfolio project. A multi-device store deployment should add a backend database, user accounts, role permissions, barcode validation, audit history, and synchronized stock updates before being used for real transactions.
