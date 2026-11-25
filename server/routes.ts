import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BACKUP_DIR,
  closeAndReopenDb,
  DB_PATH,
  getDb,
  withTransaction,
} from './db.ts';

const router = Router();

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getSettingValue(db: DatabaseSync, key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

function getAllSettings(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

function getDefaultLocationId(db: DatabaseSync): number {
  const loc = db.prepare('SELECT id FROM locations WHERE is_default = 1 ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
  if (loc) return loc.id;
  const anyLoc = db.prepare('SELECT id FROM locations ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined;
  if (!anyLoc) throw new HttpError(400, 'No inventory location configured');
  return anyLoc.id;
}

function nextInvoiceNumber(db: DatabaseSync, table: 'sales' | 'purchases', prefixKey: string, defaultPrefix: string): string {
  const prefix = getSettingValue(db, prefixKey, defaultPrefix);
  const year = new Date().getFullYear();
  const countRow = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
  let seq = countRow.c + 1;
  while (true) {
    const candidate = `${prefix}${year}-${String(seq).padStart(4, '0')}`;
    const exists = db.prepare(`SELECT 1 FROM ${table} WHERE invoice_no = ?`).get(candidate);
    if (!exists) return candidate;
    seq += 1;
  }
}

function addMonthsIso(fromIso: string, months: number): string {
  const d = new Date(fromIso);
  d.setMonth(d.getMonth() + (months || 0));
  return d.toISOString();
}

function adjustProductAndLocationStock(
  db: DatabaseSync,
  params: {
    productId: number;
    locationId: number;
    delta: number;
    userId: number | null;
    movementType: string;
    referenceType?: string;
    referenceId?: number | null;
    referenceNo?: string;
    notes?: string;
    createdAt?: string;
  }
) {
  const prod = db.prepare('SELECT id, name, quantity FROM products WHERE id = ?').get(params.productId) as
    | { id: number; name: string; quantity: number }
    | undefined;
  if (!prod) {
    throw new HttpError(404, `Product #${params.productId} not found`);
  }

  const allowNegative = getSettingValue(db, 'allow_negative_stock', 'false') === 'true';
  const prevQty = Number(prod.quantity);
  const newQty = prevQty + Number(params.delta);

  if (newQty < 0 && !allowNegative) {
    throw new HttpError(400, `Insufficient stock for "${prod.name}". Available: ${prevQty}, requested change: ${params.delta}`);
  }

  const locStock = db
    .prepare('SELECT quantity FROM product_location_stock WHERE product_id = ? AND location_id = ?')
    .get(params.productId, params.locationId) as { quantity: number } | undefined;
  const prevLocQty = locStock ? Number(locStock.quantity) : 0;
  const newLocQty = prevLocQty + Number(params.delta);

  if (newLocQty < 0 && !allowNegative) {
    throw new HttpError(
      400,
      `Insufficient stock for "${prod.name}" at selected location. Location qty: ${prevLocQty}, requested: ${params.delta}`
    );
  }

  const timestamp = params.createdAt || new Date().toISOString();

  db.prepare('UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?').run(newQty, timestamp, params.productId);
  db.prepare(`
    INSERT INTO product_location_stock (product_id, location_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(product_id, location_id) DO UPDATE SET quantity = excluded.quantity
  `).run(params.productId, params.locationId, newLocQty);

  db.prepare(`
    INSERT INTO stock_movements (
      product_id, location_id, user_id, previous_qty, change_qty, new_qty,
      movement_type, reference_type, reference_id, reference_no, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.productId,
    params.locationId,
    params.userId ?? 1,
    prevQty,
    params.delta,
    newQty,
    params.movementType,
    params.referenceType || '',
    params.referenceId ?? null,
    params.referenceNo || '',
    params.notes || '',
    timestamp
  );

  return { prevQty, newQty, newLocQty };
}

function handleError(res: any, err: unknown) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  const message = err instanceof Error ? err.message : 'Unexpected server error';
  if (message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: `Duplicate value conflict: ${message}` });
  }
  if (message.includes('FOREIGN KEY constraint failed')) {
    return res.status(409).json({ error: 'Cannot complete operation because related records exist.' });
  }
  console.error('[API Error]', err);
  return res.status(500).json({ error: message });
}

router.get('/health', (_req, res) => {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    res.json({ ok: true, dbPath: DB_PATH });
  } catch (err) {
    handleError(res, err);
  }
});

// Bootstrap reference tables
router.get('/bootstrap', (_req, res) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id, name, role, active, created_at FROM users ORDER BY id ASC').all();
    const settings = getAllSettings(db);
    const categories = db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
    const brands = db.prepare('SELECT * FROM brands ORDER BY name ASC').all();
    const locations = db.prepare('SELECT * FROM locations ORDER BY is_default DESC, name ASC').all();
    const customers = db.prepare('SELECT * FROM customers ORDER BY id ASC').all();
    const suppliers = db.prepare('SELECT * FROM suppliers ORDER BY id ASC').all();
    res.json({ users, settings, categories, brands, locations, customers, suppliers });
  } catch (err) {
    handleError(res, err);
  }
});

// Dashboard metrics & analytics
router.get('/dashboard', (_req, res) => {
  try {
    const db = getDb();

    const productSummary = db.prepare(`
      SELECT
        COUNT(*) as total_products,
        COALESCE(SUM(quantity), 0) as total_quantity,
        COALESCE(SUM(quantity * purchase_price), 0) as total_purchase_value,
        COALESCE(SUM(quantity * sale_price), 0) as total_sale_value,
        COALESCE(SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END), 0) as out_of_stock_count,
        COALESCE(SUM(CASE WHEN quantity > 0 AND quantity <= min_stock THEN 1 ELSE 0 END), 0) as low_stock_count
      FROM products
    `).get();

    const todaySales = db.prepare(`
      SELECT
        COALESCE(SUM(total), 0) as today_sales,
        COALESCE(SUM(discount), 0) as today_discounts,
        COUNT(*) as today_sale_count
      FROM sales
      WHERE status != 'cancelled' AND date(sale_date, 'localtime') = date('now', 'localtime')
    `).get() as { today_sales: number; today_discounts: number; today_sale_count: number };

    const todayGrossProfitRow = db.prepare(`
      SELECT
        COALESCE(SUM((si.unit_price - si.unit_cost) * (si.quantity - si.returned_qty)), 0) as gross_profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.status != 'cancelled' AND date(s.sale_date, 'localtime') = date('now', 'localtime')
    `).get() as { gross_profit: number };

    const todayPurchases = db.prepare(`
      SELECT COALESCE(SUM(total), 0) as today_purchases, COUNT(*) as today_purchase_count
      FROM purchases
      WHERE status != 'cancelled' AND date(purchase_date, 'localtime') = date('now', 'localtime')
    `).get();

    const todayExpenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as today_expenses
      FROM expenses
      WHERE date(expense_date, 'localtime') = date('now', 'localtime')
    `).get() as { today_expenses: number };

    const receivablesRow = db.prepare(`
      SELECT COALESCE(SUM(MAX(0, total - paid_amount)), 0) as total_receivables
      FROM sales
      WHERE status != 'cancelled'
    `).get() as { total_receivables: number };

    const payablesRow = db.prepare(`
      SELECT COALESCE(SUM(MAX(0, total - paid_amount)), 0) as total_payables
      FROM purchases
      WHERE status != 'cancelled'
    `).get() as { total_payables: number };

    const lowStockProducts = db.prepare(`
      SELECT p.*, b.name as brand_name, c.name as category_name
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.quantity <= p.min_stock
      ORDER BY p.quantity ASC, p.name ASC
      LIMIT 12
    `).all();

    const recentTransactions = db.prepare(`
      SELECT 'sale' as tx_type, s.id, s.invoice_no, s.sale_date as tx_date, s.total, s.paid_amount,
             s.payment_status, s.status, COALESCE(c.name, 'Walk-in Customer') as party_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      UNION ALL
      SELECT 'purchase' as tx_type, p.id, p.invoice_no, p.purchase_date as tx_date, p.total, p.paid_amount,
             p.payment_status, p.status, COALESCE(sup.name, 'Supplier') as party_name
      FROM purchases p
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      ORDER BY tx_date DESC
      LIMIT 10
    `).all();

    const topSelling = db.prepare(`
      SELECT p.id, p.name, p.sku, p.quantity as current_stock,
             SUM(si.quantity - si.returned_qty) as units_sold,
             SUM(si.total_price) as revenue,
             SUM((si.unit_price - si.unit_cost) * (si.quantity - si.returned_qty)) as profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      JOIN products p ON p.id = si.product_id
      WHERE s.status != 'cancelled'
      GROUP BY p.id
      HAVING units_sold > 0
      ORDER BY units_sold DESC, revenue DESC
      LIMIT 6
    `).all();

    // 7-day daily chart aligned to localtime
    const dailyChart: Array<{ date: string; label: string; sales: number; profit: number; purchases: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const modifier = i === 0 ? '0 days' : `-${i} days`;
      const dayMeta = db.prepare("SELECT date('now', 'localtime', ?) as d").get(modifier) as { d: string };
      const isoDate = dayMeta.d;
      const [y, m, dayNum] = isoDate.split('-').map(Number);
      const label = new Date(y, (m || 1) - 1, dayNum || 1).toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
      });

      const sRow = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total, COALESCE(SUM(discount), 0) as discount
        FROM sales WHERE status != 'cancelled' AND date(sale_date, 'localtime') = ?
      `).get(isoDate) as { total: number; discount: number };

      const pRow = db.prepare(`
        SELECT COALESCE(SUM((si.unit_price - si.unit_cost) * (si.quantity - si.returned_qty)), 0) as gross_profit
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.status != 'cancelled' AND date(s.sale_date, 'localtime') = ?
      `).get(isoDate) as { gross_profit: number };

      const purRow = db.prepare(`
        SELECT COALESCE(SUM(total), 0) as total
        FROM purchases WHERE status != 'cancelled' AND date(purchase_date, 'localtime') = ?
      `).get(isoDate) as { total: number };

      dailyChart.push({
        date: isoDate,
        label,
        sales: Number(sRow.total || 0),
        profit: Number(pRow.gross_profit || 0) - Number(sRow.discount || 0),
        purchases: Number(purRow.total || 0),
      });
    }

    const categoryValuation = db.prepare(`
      SELECT COALESCE(c.name, 'Uncategorized') as category,
             COUNT(p.id) as product_count,
             COALESCE(SUM(p.quantity), 0) as stock_qty,
             COALESCE(SUM(p.quantity * p.purchase_price), 0) as purchase_value,
             COALESCE(SUM(p.quantity * p.sale_price), 0) as sale_value
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      GROUP BY c.id
      ORDER BY sale_value DESC
    `).all();

    res.json({
      summary: {
        ...productSummary,
        ...todaySales,
        ...todayPurchases,
        today_expenses: Number(todayExpenses.today_expenses || 0),
        today_profit: Number(todayGrossProfitRow.gross_profit || 0) - Number(todaySales.today_discounts || 0),
        total_receivables: Number(receivablesRow.total_receivables || 0),
        total_payables: Number(payablesRow.total_payables || 0),
      },
      lowStockProducts,
      recentTransactions,
      topSelling,
      dailyChart,
      categoryValuation,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Exact QR / Barcode / SKU / Serial lookup
router.get('/lookup', (req, res) => {
  try {
    const db = getDb();
    const rawCode = String(req.query.code || '').trim();
    if (!rawCode) {
      return res.json({ matchType: 'none', code: rawCode, product: null, serialRecord: null });
    }

    // 1. Check serial_numbers (by serial_number or serial_qr)
    const serialRecord = db.prepare(`
      SELECT sn.*, p.name as product_name, p.sku, sup.name as supplier_name, c.name as customer_name
      FROM serial_numbers sn
      JOIN products p ON p.id = sn.product_id
      LEFT JOIN suppliers sup ON sup.id = sn.supplier_id
      LEFT JOIN customers c ON c.id = sn.customer_id
      WHERE LOWER(sn.serial_number) = LOWER(?) OR LOWER(sn.serial_qr) = LOWER(?)
      LIMIT 1
    `).get(rawCode, rawCode) as Record<string, any> | undefined;

    if (serialRecord) {
      const product = db.prepare(`
        SELECT p.*, b.name as brand_name, c.name as category_name
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
      `).get(serialRecord.product_id);
      return res.json({ matchType: 'serial', code: rawCode, product, serialRecord });
    }

    // 2. Check products (by qr_code, barcode, or sku)
    const product = db.prepare(`
      SELECT p.*, b.name as brand_name, c.name as category_name
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE LOWER(p.qr_code) = LOWER(?) OR LOWER(p.barcode) = LOWER(?) OR LOWER(p.sku) = LOWER(?)
      LIMIT 1
    `).get(rawCode, rawCode, rawCode);

    if (product) {
      return res.json({ matchType: 'product', code: rawCode, product, serialRecord: null });
    }

    return res.json({ matchType: 'none', code: rawCode, product: null, serialRecord: null });
  } catch (err) {
    handleError(res, err);
  }
});

// Products CRUD & Search
router.get('/products', (req, res) => {
  try {
    const db = getDb();
    const q = String(req.query.q || '').trim();
    const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
    const brandId = req.query.brandId ? Number(req.query.brandId) : null;
    const stockStatus = String(req.query.stockStatus || '');

    const conditions: string[] = [];
    const args: any[] = [];

    if (q) {
      const like = `%${q}%`;
      conditions.push(`(
        p.name LIKE ? OR p.model LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.qr_code LIKE ?
        OR b.name LIKE ? OR c.name LIKE ?
        OR EXISTS (SELECT 1 FROM serial_numbers sn WHERE sn.product_id = p.id AND sn.serial_number LIKE ?)
      )`);
      args.push(like, like, like, like, like, like, like, like);
    }
    if (categoryId) {
      conditions.push('p.category_id = ?');
      args.push(categoryId);
    }
    if (brandId) {
      conditions.push('p.brand_id = ?');
      args.push(brandId);
    }
    if (stockStatus === 'low') {
      conditions.push('p.quantity > 0 AND p.quantity <= p.min_stock');
    } else if (stockStatus === 'out') {
      conditions.push('p.quantity <= 0');
    } else if (stockStatus === 'in') {
      conditions.push('p.quantity > p.min_stock');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const products = db.prepare(`
      SELECT p.*, b.name as brand_name, c.name as category_name,
        (SELECT COUNT(*) FROM serial_numbers sn WHERE sn.product_id = p.id AND sn.status = 'available') as available_serials_count
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      ${whereClause}
      ORDER BY p.name ASC
    `).all(...args) as Array<Record<string, any>>;

    const locStocks = db.prepare(`
      SELECT pls.product_id, pls.location_id, pls.quantity, l.name as location_name, l.code as location_code
      FROM product_location_stock pls
      JOIN locations l ON l.id = pls.location_id
    `).all() as Array<{ product_id: number; location_id: number; quantity: number; location_name: string; location_code: string }>;

    const locMap = new Map<number, typeof locStocks>();
    for (const ls of locStocks) {
      if (!locMap.has(ls.product_id)) locMap.set(ls.product_id, []);
      locMap.get(ls.product_id)!.push(ls);
    }

    const enriched = products.map((p) => ({
      ...p,
      location_stocks: locMap.get(p.id) || [],
    }));

    res.json(enriched);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/products/:id', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const product = db.prepare(`
      SELECT p.*, b.name as brand_name, c.name as category_name
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `).get(id);
    if (!product) throw new HttpError(404, 'Product not found');

    const locationStocks = db.prepare(`
      SELECT pls.*, l.name as location_name, l.code as location_code
      FROM product_location_stock pls
      JOIN locations l ON l.id = pls.location_id
      WHERE pls.product_id = ?
    `).all(id);

    const availableSerials = db.prepare(`
      SELECT sn.*, l.name as location_name
      FROM serial_numbers sn
      LEFT JOIN locations l ON l.id = sn.location_id
      WHERE sn.product_id = ? AND sn.status = 'available'
      ORDER BY sn.id ASC
    `).all(id);

    const movements = db.prepare(`
      SELECT sm.*, l.name as location_name, u.name as user_name
      FROM stock_movements sm
      LEFT JOIN locations l ON l.id = sm.location_id
      LEFT JOIN users u ON u.id = sm.user_id
      WHERE sm.product_id = ?
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT 50
    `).all(id);

    res.json({ product, locationStocks, availableSerials, movements });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/products', (req, res) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const sku = String(body.sku || '').trim();
    if (!name || !sku) {
      throw new HttpError(400, 'Product name and SKU are required');
    }

    const result = withTransaction((db) => {
      const existingSku = db.prepare('SELECT id FROM products WHERE LOWER(sku) = LOWER(?)').get(sku);
      if (existingSku) throw new HttpError(409, `SKU "${sku}" already exists`);

      const barcode = body.barcode ? String(body.barcode).trim() : null;
      if (barcode) {
        const existingBc = db.prepare('SELECT id FROM products WHERE LOWER(barcode) = LOWER(?)').get(barcode);
        if (existingBc) throw new HttpError(409, `Barcode "${barcode}" is already assigned to another product`);
      }

      const qrCode = String(body.qr_code || `PRODQR:${sku}`).trim();
      const existingQr = db.prepare('SELECT id FROM products WHERE LOWER(qr_code) = LOWER(?)').get(qrCode);
      if (existingQr) throw new HttpError(409, `QR code "${qrCode}" is already in use`);

      const initialQty = Math.max(0, Math.floor(Number(body.quantity || 0)));
      const serialTracking = body.serial_tracking ? 1 : 0;
      const serialNumbers: string[] = Array.isArray(body.serial_numbers)
        ? body.serial_numbers.map((s: any) => String(s).trim()).filter(Boolean)
        : [];

      if (serialTracking && initialQty > 0 && serialNumbers.length !== initialQty) {
        throw new HttpError(
          400,
          `Serial tracking is enabled. Provide ${initialQty} unique serial number(s) for initial stock (received ${serialNumbers.length}).`
        );
      }

      const now = new Date().toISOString();
      const defaultLocId = Number(body.location_id || getDefaultLocationId(db));
      const purchasePrice = Number(body.purchase_price || 0);
      const salePrice = Number(body.sale_price || 0);
      const wholesalePrice = Number(body.wholesale_price || salePrice);
      const minStock = Math.max(0, Math.floor(Number(body.min_stock ?? 5)));
      const warrantyMonths = Math.max(0, Math.floor(Number(body.warranty_months ?? 12)));

      const info = db.prepare(`
        INSERT INTO products (
          name, brand_id, category_id, model, sku, barcode, qr_code,
          purchase_price, sale_price, wholesale_price, quantity, min_stock,
          serial_tracking, warranty_months, image_url, description, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        name,
        body.brand_id ? Number(body.brand_id) : null,
        body.category_id ? Number(body.category_id) : null,
        String(body.model || '').trim(),
        sku,
        barcode,
        qrCode,
        purchasePrice,
        salePrice,
        wholesalePrice,
        minStock,
        serialTracking,
        warrantyMonths,
        String(body.image_url || ''),
        String(body.description || ''),
        now,
        now
      );

      const productId = Number(info.lastInsertRowid);

      // Initialize zero stock rows for all locations
      const allLocs = db.prepare('SELECT id FROM locations').all() as Array<{ id: number }>;
      for (const l of allLocs) {
        db.prepare('INSERT OR IGNORE INTO product_location_stock (product_id, location_id, quantity) VALUES (?, ?, 0)').run(
          productId,
          l.id
        );
      }

      if (initialQty > 0) {
        adjustProductAndLocationStock(db, {
          productId,
          locationId: defaultLocId,
          delta: initialQty,
          userId: body.user_id ? Number(body.user_id) : 1,
          movementType: 'initial',
          referenceType: 'product',
          referenceId: productId,
          referenceNo: sku,
          notes: 'Initial stock on product creation',
          createdAt: now,
        });

        if (serialTracking && serialNumbers.length > 0) {
          const seen = new Set<string>();
          for (const sn of serialNumbers) {
            if (seen.has(sn.toLowerCase())) {
              throw new HttpError(409, `Duplicate serial number in batch: ${sn}`);
            }
            seen.add(sn.toLowerCase());
            const exists = db.prepare('SELECT id FROM serial_numbers WHERE LOWER(serial_number) = LOWER(?)').get(sn);
            if (exists) throw new HttpError(409, `Serial number "${sn}" already exists in database`);

            db.prepare(`
              INSERT INTO serial_numbers (
                serial_number, serial_qr, product_id, location_id, purchase_date, purchase_price,
                status, warranty_months, notes, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, 'available', ?, 'Initial product registration', ?, ?)
            `).run(sn, `SERQR:${productId}:${sn}`, productId, defaultLocId, now, purchasePrice, warrantyMonths, now, now);
          }
        }
      }

      return db.prepare(`
        SELECT p.*, b.name as brand_name, c.name as category_name
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
      `).get(productId);
    });

    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/products/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const sku = String(body.sku || '').trim();
    if (!name || !sku) throw new HttpError(400, 'Product name and SKU are required');

    const updated = withTransaction((db) => {
      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
      if (!existing) throw new HttpError(404, 'Product not found');

      const dupSku = db.prepare('SELECT id FROM products WHERE LOWER(sku) = LOWER(?) AND id != ?').get(sku, id);
      if (dupSku) throw new HttpError(409, `SKU "${sku}" is already used by another product`);

      const barcode = body.barcode ? String(body.barcode).trim() : null;
      if (barcode) {
        const dupBc = db.prepare('SELECT id FROM products WHERE LOWER(barcode) = LOWER(?) AND id != ?').get(barcode, id);
        if (dupBc) throw new HttpError(409, `Barcode "${barcode}" is already used by another product`);
      }

      const now = new Date().toISOString();
      db.prepare(`
        UPDATE products SET
          name = ?, brand_id = ?, category_id = ?, model = ?, sku = ?, barcode = ?,
          purchase_price = ?, sale_price = ?, wholesale_price = ?, min_stock = ?,
          serial_tracking = ?, warranty_months = ?, image_url = ?, description = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name,
        body.brand_id ? Number(body.brand_id) : null,
        body.category_id ? Number(body.category_id) : null,
        String(body.model || '').trim(),
        sku,
        barcode,
        Number(body.purchase_price || 0),
        Number(body.sale_price || 0),
        Number(body.wholesale_price || 0),
        Math.max(0, Math.floor(Number(body.min_stock ?? 5))),
        body.serial_tracking ? 1 : 0,
        Math.max(0, Math.floor(Number(body.warranty_months ?? 12))),
        String(body.image_url || ''),
        String(body.description || ''),
        now,
        id
      );

      return db.prepare(`
        SELECT p.*, b.name as brand_name, c.name as category_name
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
      `).get(id);
    });

    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/products/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const force = req.query.force === 'true';

    withTransaction((db) => {
      const prod = db.prepare('SELECT id, name, quantity FROM products WHERE id = ?').get(id) as
        | { id: number; name: string; quantity: number }
        | undefined;
      if (!prod) throw new HttpError(404, 'Product not found');

      const saleItemRefs = db.prepare('SELECT DISTINCT sale_id FROM sale_items WHERE product_id = ?').all(id) as Array<{ sale_id: number }>;
      const purchaseItemRefs = db.prepare('SELECT DISTINCT purchase_id FROM purchase_items WHERE product_id = ?').all(id) as Array<{ purchase_id: number }>;

      if (!force && (saleItemRefs.length > 0 || purchaseItemRefs.length > 0)) {
        throw new HttpError(
          409,
          `Product "${prod.name}" has linked sales (${saleItemRefs.length}) or purchases (${purchaseItemRefs.length}). Confirm force delete to remove it and its linked item lines.`
        );
      }

      // Remove child records referencing this product cleanly
      db.prepare('DELETE FROM serial_numbers WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM stock_movements WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM stock_transfers WHERE product_id = ?').run(id);

      if (saleItemRefs.length > 0) {
        db.prepare('DELETE FROM sale_items WHERE product_id = ?').run(id);
        for (const ref of saleItemRefs) {
          const rem = db.prepare('SELECT COALESCE(SUM(total_price), 0) as sub, COUNT(*) as cnt FROM sale_items WHERE sale_id = ?').get(
            ref.sale_id
          ) as { sub: number; cnt: number };
          if (rem.cnt === 0) {
            db.prepare("DELETE FROM payments WHERE invoice_type = 'sale' AND invoice_id = ?").run(ref.sale_id);
            db.prepare('DELETE FROM sales WHERE id = ?').run(ref.sale_id);
          } else {
            const sRow = db.prepare('SELECT discount, tax, paid_amount FROM sales WHERE id = ?').get(ref.sale_id) as {
              discount: number;
              tax: number;
              paid_amount: number;
            };
            const newTotal = Math.max(0, Number(rem.sub) - Number(sRow.discount || 0) + Number(sRow.tax || 0));
            const newPaid = Math.min(Number(sRow.paid_amount || 0), newTotal);
            const pStatus = newPaid >= newTotal ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
            db.prepare('UPDATE sales SET subtotal = ?, total = ?, paid_amount = ?, payment_status = ? WHERE id = ?').run(
              rem.sub,
              newTotal,
              newPaid,
              pStatus,
              ref.sale_id
            );
          }
        }
      }

      if (purchaseItemRefs.length > 0) {
        db.prepare('DELETE FROM purchase_items WHERE product_id = ?').run(id);
        for (const ref of purchaseItemRefs) {
          const rem = db.prepare('SELECT COALESCE(SUM(total_cost), 0) as sub, COUNT(*) as cnt FROM purchase_items WHERE purchase_id = ?').get(
            ref.purchase_id
          ) as { sub: number; cnt: number };
          if (rem.cnt === 0) {
            db.prepare("DELETE FROM payments WHERE invoice_type = 'purchase' AND invoice_id = ?").run(ref.purchase_id);
            db.prepare('DELETE FROM purchases WHERE id = ?').run(ref.purchase_id);
          } else {
            const pRow = db.prepare('SELECT discount, tax, paid_amount FROM purchases WHERE id = ?').get(ref.purchase_id) as {
              discount: number;
              tax: number;
              paid_amount: number;
            };
            const newTotal = Math.max(0, Number(rem.sub) - Number(pRow.discount || 0) + Number(pRow.tax || 0));
            const newPaid = Math.min(Number(pRow.paid_amount || 0), newTotal);
            const pStatus = newPaid >= newTotal ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';
            db.prepare('UPDATE purchases SET subtotal = ?, total = ?, paid_amount = ?, payment_status = ? WHERE id = ?').run(
              rem.sub,
              newTotal,
              newPaid,
              pStatus,
              ref.purchase_id
            );
          }
        }
      }

      db.prepare('DELETE FROM products WHERE id = ?').run(id);
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Categories, Brands, Locations
router.post('/categories', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Category name is required');
    const db = getDb();
    const info = db
      .prepare('INSERT INTO categories (name, description, created_at) VALUES (?, ?, ?)')
      .run(name, String(req.body?.description || ''), new Date().toISOString());
    res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/brands', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Brand name is required');
    const db = getDb();
    const info = db.prepare('INSERT INTO brands (name, created_at) VALUES (?, ?)').run(name, new Date().toISOString());
    res.status(201).json(db.prepare('SELECT * FROM brands WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/brands/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM brands WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/locations', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!name || !code) throw new HttpError(400, 'Location name and code are required');
    const created = withTransaction((db) => {
      const info = db
        .prepare('INSERT INTO locations (name, code, address, is_default, created_at) VALUES (?, ?, ?, 0, ?)')
        .run(name, code, String(req.body?.address || ''), new Date().toISOString());
      const locId = Number(info.lastInsertRowid);
      const products = db.prepare('SELECT id FROM products').all() as Array<{ id: number }>;
      for (const p of products) {
        db.prepare('INSERT OR IGNORE INTO product_location_stock (product_id, location_id, quantity) VALUES (?, ?, 0)').run(p.id, locId);
      }
      return db.prepare('SELECT * FROM locations WHERE id = ?').get(locId);
    });
    res.status(201).json(created);
  } catch (err) {
    handleError(res, err);
  }
});

// Unified Quick Stock Entry (QR / Barcode / Serial Number / Product Name)
router.post('/stock/quick-add', (req, res) => {
  try {
    const body = req.body || {};
    const productId = Number(body.product_id);
    const quantity = Math.floor(Number(body.quantity || 0));
    if (!productId || quantity <= 0) {
      throw new HttpError(400, 'Valid product and positive quantity are required');
    }

    const result = withTransaction((db) => {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Record<string, any> | undefined;
      if (!prod) throw new HttpError(404, 'Product not found');

      const locationId = Number(body.location_id || getDefaultLocationId(db));
      const userId = Number(body.user_id || 1);
      const supplierId = body.supplier_id ? Number(body.supplier_id) : null;
      const entryDate = body.date ? new Date(body.date).toISOString() : new Date().toISOString();
      const purchasePrice = body.purchase_price !== undefined ? Number(body.purchase_price) : Number(prod.purchase_price);
      const salePrice = body.sale_price !== undefined ? Number(body.sale_price) : Number(prod.sale_price);
      const notes = String(body.notes || '').trim();
      const method = String(body.entry_method || 'name_search');

      const serialNumbers: string[] = Array.isArray(body.serial_numbers)
        ? body.serial_numbers.map((s: any) => String(s).trim()).filter(Boolean)
        : [];

      if (prod.serial_tracking === 1) {
        if (serialNumbers.length !== quantity) {
          throw new HttpError(
            400,
            `"${prod.name}" requires serial tracking. Please enter exactly ${quantity} unique serial number(s) (received ${serialNumbers.length}).`
          );
        }
      }

      // Check serial uniqueness before mutating anything
      const seen = new Set<string>();
      for (const sn of serialNumbers) {
        if (seen.has(sn.toLowerCase())) {
          throw new HttpError(409, `Duplicate serial number in entry: "${sn}"`);
        }
        seen.add(sn.toLowerCase());
        const existingSn = db.prepare('SELECT id, serial_number FROM serial_numbers WHERE LOWER(serial_number) = LOWER(?)').get(sn);
        if (existingSn) {
          throw new HttpError(409, `Serial number "${sn}" already exists in the system. Duplicate serial numbers are not permitted.`);
        }
      }

      // Update product pricing if modified
      if (purchasePrice !== Number(prod.purchase_price) || salePrice !== Number(prod.sale_price)) {
        db.prepare('UPDATE products SET purchase_price = ?, sale_price = ?, updated_at = ? WHERE id = ?').run(
          purchasePrice,
          salePrice,
          entryDate,
          productId
        );
      }

      const movementNote = notes
        ? `${notes} (via ${method})`
        : `Quick stock entry via ${method}`;

      const stockUpdate = adjustProductAndLocationStock(db, {
        productId,
        locationId,
        delta: quantity,
        userId,
        movementType: 'manual_add',
        referenceType: 'quick_entry',
        referenceId: null,
        referenceNo: prod.sku,
        notes: movementNote,
        createdAt: entryDate,
      });

      const createdSerials: Array<Record<string, any>> = [];
      for (const sn of serialNumbers) {
        const serialQr = `SERQR:${productId}:${sn}`;
        const info = db.prepare(`
          INSERT INTO serial_numbers (
            serial_number, serial_qr, product_id, location_id, supplier_id,
            purchase_date, purchase_price, status, warranty_months, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?)
        `).run(
          sn,
          serialQr,
          productId,
          locationId,
          supplierId,
          entryDate,
          purchasePrice,
          prod.warranty_months || 12,
          movementNote,
          entryDate,
          entryDate
        );
        createdSerials.push(db.prepare('SELECT * FROM serial_numbers WHERE id = ?').get(info.lastInsertRowid) as Record<string, any>);
      }

      const updatedProduct = db.prepare(`
        SELECT p.*, b.name as brand_name, c.name as category_name
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
      `).get(productId);

      return {
        product: updatedProduct,
        previousQty: stockUpdate.prevQty,
        addedQty: quantity,
        newQty: stockUpdate.newQty,
        createdSerials,
      };
    });

    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Stock Adjustment / Damaged / Lost
router.post('/stock/adjust', (req, res) => {
  try {
    const body = req.body || {};
    const productId = Number(body.product_id);
    const movementType = String(body.movement_type || 'adjustment');
    const quantityChange = Math.floor(Number(body.quantity_change || 0));
    const notes = String(body.notes || '').trim();

    if (!productId || quantityChange === 0) {
      throw new HttpError(400, 'Product and non-zero quantity change are required');
    }
    if (!['adjustment', 'damaged', 'lost', 'manual_add'].includes(movementType)) {
      throw new HttpError(400, 'Invalid movement type');
    }

    const resData = withTransaction((db) => {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Record<string, any> | undefined;
      if (!prod) throw new HttpError(404, 'Product not found');

      const locationId = Number(body.location_id || getDefaultLocationId(db));
      const userId = Number(body.user_id || 1);
      const serialIds: number[] = Array.isArray(body.serial_ids) ? body.serial_ids.map(Number) : [];

      if ((movementType === 'damaged' || movementType === 'lost') && quantityChange > 0) {
        throw new HttpError(400, 'Damaged or lost stock must be a negative quantity change');
      }

      if (prod.serial_tracking === 1 && quantityChange < 0 && serialIds.length > 0) {
        if (serialIds.length !== Math.abs(quantityChange)) {
          throw new HttpError(400, 'Selected serial count must match adjustment quantity');
        }
        const targetStatus = movementType === 'damaged' ? 'damaged' : 'damaged';
        const now = new Date().toISOString();
        for (const sid of serialIds) {
          const sn = db.prepare('SELECT * FROM serial_numbers WHERE id = ? AND product_id = ?').get(sid, productId) as
            | Record<string, any>
            | undefined;
          if (!sn || sn.status !== 'available') {
            throw new HttpError(400, `Serial #${sid} is not available for adjustment`);
          }
          db.prepare('UPDATE serial_numbers SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
            targetStatus,
            notes || `Marked ${movementType}`,
            now,
            sid
          );
        }
      }

      return adjustProductAndLocationStock(db, {
        productId,
        locationId,
        delta: quantityChange,
        userId,
        movementType,
        referenceType: 'manual_adjustment',
        notes: notes || `Inventory ${movementType}`,
      });
    });

    res.json(resData);
  } catch (err) {
    handleError(res, err);
  }
});

// Serial Number Management
router.get('/serials', (req, res) => {
  try {
    const db = getDb();
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all');
    const productId = req.query.productId ? Number(req.query.productId) : null;

    const conditions: string[] = [];
    const args: any[] = [];

    if (q) {
      const like = `%${q}%`;
      conditions.push(`(
        sn.serial_number LIKE ? OR sn.serial_qr LIKE ? OR p.name LIKE ? OR p.model LIKE ? OR p.sku LIKE ?
        OR COALESCE(s.invoice_no, '') LIKE ? OR COALESCE(c.name, '') LIKE ? OR COALESCE(sup.name, '') LIKE ?
      )`);
      args.push(like, like, like, like, like, like, like, like);
    }

    if (productId) {
      conditions.push('sn.product_id = ?');
      args.push(productId);
    }

    const nowIso = new Date().toISOString();
    if (status === 'available' || status === 'sold' || status === 'returned' || status === 'under_warranty' || status === 'damaged') {
      conditions.push('sn.status = ?');
      args.push(status);
    } else if (status === 'warranty_active') {
      conditions.push("(sn.status = 'sold' OR sn.status = 'under_warranty') AND sn.warranty_expiry IS NOT NULL AND sn.warranty_expiry >= ?");
      args.push(nowIso);
    } else if (status === 'warranty_expired') {
      conditions.push("sn.warranty_expiry IS NOT NULL AND sn.warranty_expiry < ?");
      args.push(nowIso);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT sn.*,
        p.name as product_name, p.model as product_model, p.sku as product_sku, p.sale_price as product_sale_price,
        sup.name as supplier_name,
        c.name as customer_name,
        s.invoice_no as sale_invoice_no,
        pur.invoice_no as purchase_invoice_no,
        l.name as location_name
      FROM serial_numbers sn
      JOIN products p ON p.id = sn.product_id
      LEFT JOIN suppliers sup ON sup.id = sn.supplier_id
      LEFT JOIN customers c ON c.id = sn.customer_id
      LEFT JOIN sales s ON s.id = sn.sale_id
      LEFT JOIN purchases pur ON pur.id = sn.purchase_id
      LEFT JOIN locations l ON l.id = sn.location_id
      ${whereClause}
      ORDER BY sn.updated_at DESC, sn.id DESC
      LIMIT 500
    `).all(...args);

    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/serials/:id/history', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const serial = db.prepare(`
      SELECT sn.*, p.name as product_name, p.model as product_model, p.sku as product_sku,
             sup.name as supplier_name, c.name as customer_name,
             s.invoice_no as sale_invoice_no, pur.invoice_no as purchase_invoice_no, l.name as location_name
      FROM serial_numbers sn
      JOIN products p ON p.id = sn.product_id
      LEFT JOIN suppliers sup ON sup.id = sn.supplier_id
      LEFT JOIN customers c ON c.id = sn.customer_id
      LEFT JOIN sales s ON s.id = sn.sale_id
      LEFT JOIN purchases pur ON pur.id = sn.purchase_id
      LEFT JOIN locations l ON l.id = sn.location_id
      WHERE sn.id = ?
    `).get(id) as Record<string, any> | undefined;

    if (!serial) throw new HttpError(404, 'Serial number record not found');

    const movements = db.prepare(`
      SELECT sm.*, u.name as user_name, l.name as location_name
      FROM stock_movements sm
      LEFT JOIN users u ON u.id = sm.user_id
      LEFT JOIN locations l ON l.id = sm.location_id
      WHERE sm.product_id = ? AND (sm.reference_id = ? OR sm.reference_id = ? OR sm.notes LIKE ?)
      ORDER BY sm.created_at DESC
      LIMIT 30
    `).all(serial.product_id, serial.sale_id ?? -1, serial.purchase_id ?? -1, `%${serial.serial_number}%`);

    res.json({ serial, movements });
  } catch (err) {
    handleError(res, err);
  }
});

router.patch('/serials/:id/status', (req, res) => {
  try {
    const id = Number(req.params.id);
    const newStatus = String(req.body?.status || '');
    const notes = String(req.body?.notes || '').trim();
    if (!['available', 'sold', 'returned', 'under_warranty', 'damaged'].includes(newStatus)) {
      throw new HttpError(400, 'Invalid serial status');
    }

    const updated = withTransaction((db) => {
      const existing = db.prepare('SELECT * FROM serial_numbers WHERE id = ?').get(id) as Record<string, any> | undefined;
      if (!existing) throw new HttpError(404, 'Serial not found');

      const now = new Date().toISOString();
      db.prepare('UPDATE serial_numbers SET status = ?, notes = ?, updated_at = ? WHERE id = ?').run(
        newStatus,
        notes || existing.notes,
        now,
        id
      );

      // Keep stock synced if transitioning between available <-> damaged/returned manually
      if (existing.status === 'available' && newStatus === 'damaged') {
        adjustProductAndLocationStock(db, {
          productId: existing.product_id,
          locationId: existing.location_id || getDefaultLocationId(db),
          delta: -1,
          userId: Number(req.body?.user_id || 1),
          movementType: 'damaged',
          referenceType: 'serial',
          referenceId: id,
          referenceNo: existing.serial_number,
          notes: notes || `Serial ${existing.serial_number} marked damaged`,
          createdAt: now,
        });
      } else if ((existing.status === 'damaged' || existing.status === 'returned') && newStatus === 'available') {
        adjustProductAndLocationStock(db, {
          productId: existing.product_id,
          locationId: existing.location_id || getDefaultLocationId(db),
          delta: 1,
          userId: Number(req.body?.user_id || 1),
          movementType: 'adjustment',
          referenceType: 'serial',
          referenceId: id,
          referenceNo: existing.serial_number,
          notes: notes || `Serial ${existing.serial_number} restored to available stock`,
          createdAt: now,
        });
      }

      return db.prepare('SELECT * FROM serial_numbers WHERE id = ?').get(id);
    });

    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// Sales & POS
router.get('/sales', (req, res) => {
  try {
    const db = getDb();
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE s.invoice_no LIKE ? OR COALESCE(c.name, \'\') LIKE ?' : '';
    const args = q ? [`%${q}%`, `%${q}%`] : [];
    const rows = db.prepare(`
      SELECT s.*, COALESCE(c.name, 'Walk-in Customer') as customer_name, c.phone as customer_phone,
             u.name as user_name, l.name as location_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN locations l ON l.id = s.location_id
      ${where}
      ORDER BY s.sale_date DESC, s.id DESC
      LIMIT 250
    `).all(...args);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/sales/:id', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const sale = db.prepare(`
      SELECT s.*, COALESCE(c.name, 'Walk-in Customer') as customer_name, c.phone as customer_phone,
             c.address as customer_address, u.name as user_name, l.name as location_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.id = ?
    `).get(id);
    if (!sale) throw new HttpError(404, 'Sale invoice not found');

    const items = db.prepare(`
      SELECT si.*, p.name as product_name, p.model as product_model, p.sku as product_sku,
             p.warranty_months, p.serial_tracking
      FROM sale_items si
      JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = ?
    `).all(id) as Array<Record<string, any>>;

    const serials = db.prepare(`
      SELECT id, sale_item_id, product_id, serial_number, serial_qr, warranty_expiry, status
      FROM serial_numbers
      WHERE sale_id = ?
    `).all(id) as Array<Record<string, any>>;

    const itemsWithSerials = items.map((it) => ({
      ...it,
      serials: serials.filter((sn) => sn.sale_item_id === it.id || (sn.sale_item_id == null && sn.product_id === it.product_id)),
    }));

    const payments = db.prepare(`
      SELECT * FROM payments WHERE invoice_type = 'sale' AND invoice_id = ? ORDER BY payment_date DESC
    `).all(id);

    res.json({ sale, items: itemsWithSerials, payments });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/sales', (req, res) => {
  try {
    const body = req.body || {};
    const items: Array<{
      product_id: number;
      quantity: number;
      unit_price: number;
      discount?: number;
      serial_ids?: number[];
    }> = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0) {
      throw new HttpError(400, 'At least one product item is required to create an invoice');
    }

    const created = withTransaction((db) => {
      const locationId = Number(body.location_id || getDefaultLocationId(db));
      const userId = Number(body.user_id || 1);
      const customerId = body.customer_id ? Number(body.customer_id) : 1;
      const saleDate = body.sale_date ? new Date(body.sale_date).toISOString() : new Date().toISOString();
      const invoiceNo = nextInvoiceNumber(db, 'sales', 'invoice_prefix', 'INV-');
      const invoiceDiscount = Math.max(0, Number(body.discount || 0));
      const taxRate = body.tax_rate !== undefined ? Number(body.tax_rate) : Number(getSettingValue(db, 'tax_rate', '0'));

      let subtotal = 0;
      const validatedItems: Array<{
        product: Record<string, any>;
        quantity: number;
        unitPrice: number;
        itemDiscount: number;
        totalPrice: number;
        serialIds: number[];
      }> = [];

      for (const item of items) {
        const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(item.product_id)) as
          | Record<string, any>
          | undefined;
        if (!prod) throw new HttpError(404, `Product #${item.product_id} not found`);

        const qty = Math.floor(Number(item.quantity || 0));
        if (qty <= 0) throw new HttpError(400, `Quantity for "${prod.name}" must be positive`);

        const unitPrice = Number(item.unit_price ?? prod.sale_price);
        const itemDiscount = Math.max(0, Number(item.discount || 0));
        const totalPrice = Math.max(0, unitPrice * qty - itemDiscount);
        const serialIds = Array.isArray(item.serial_ids) ? item.serial_ids.map(Number) : [];

        if (prod.serial_tracking === 1) {
          if (serialIds.length !== qty) {
            throw new HttpError(
              400,
              `"${prod.name}" requires serial selection. Select ${qty} available serial number(s).`
            );
          }
          const uniqueSet = new Set(serialIds);
          if (uniqueSet.size !== serialIds.length) {
            throw new HttpError(400, `Duplicate serial number selected for "${prod.name}"`);
          }
          for (const sid of serialIds) {
            const sn = db.prepare('SELECT * FROM serial_numbers WHERE id = ? AND product_id = ?').get(sid, prod.id) as
              | Record<string, any>
              | undefined;
            if (!sn) throw new HttpError(404, `Serial #${sid} does not belong to "${prod.name}"`);
            if (sn.status !== 'available') {
              throw new HttpError(
                409,
                `Serial "${sn.serial_number}" cannot be sold (current status: ${sn.status}).`
              );
            }
          }
        }

        subtotal += totalPrice;
        validatedItems.push({ product: prod, quantity: qty, unitPrice, itemDiscount, totalPrice, serialIds });
      }

      const taxable = Math.max(0, subtotal - invoiceDiscount);
      const tax = Number(((taxable * Math.max(0, taxRate)) / 100).toFixed(2));
      const total = Math.max(0, Number((taxable + tax).toFixed(2)));
      const paymentMethod = String(body.payment_method || 'cash');
      let paidAmount = body.paid_amount !== undefined ? Number(body.paid_amount) : total;
      if (paymentMethod === 'credit') paidAmount = Math.min(paidAmount, total);
      paidAmount = Math.max(0, Math.min(paidAmount, total));

      const paymentStatus = paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

      const saleInfo = db.prepare(`
        INSERT INTO sales (
          invoice_no, customer_id, location_id, user_id, sale_date,
          subtotal, discount, tax, total, paid_amount, payment_method, payment_status, notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
      `).run(
        invoiceNo,
        customerId,
        locationId,
        userId,
        saleDate,
        subtotal,
        invoiceDiscount,
        tax,
        total,
        paidAmount,
        paymentMethod,
        paymentStatus,
        String(body.notes || ''),
        saleDate
      );

      const saleId = Number(saleInfo.lastInsertRowid);

      for (const vi of validatedItems) {
        const siInfo = db.prepare(`
          INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, discount, total_price, returned_qty)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(saleId, vi.product.id, vi.quantity, vi.unitPrice, vi.product.purchase_price, vi.itemDiscount, vi.totalPrice);
        const saleItemId = Number(siInfo.lastInsertRowid);

        adjustProductAndLocationStock(db, {
          productId: vi.product.id,
          locationId,
          delta: -vi.quantity,
          userId,
          movementType: 'sale',
          referenceType: 'sale',
          referenceId: saleId,
          referenceNo: invoiceNo,
          notes: `Sold on invoice ${invoiceNo}`,
          createdAt: saleDate,
        });

        for (const sid of vi.serialIds) {
          const warrantyMonths = Number(vi.product.warranty_months || 12);
          const warrantyExpiry = warrantyMonths > 0 ? addMonthsIso(saleDate, warrantyMonths) : null;
          db.prepare(`
            UPDATE serial_numbers
            SET status = 'sold', sale_id = ?, sale_item_id = ?, customer_id = ?, sale_date = ?,
                warranty_months = ?, warranty_expiry = ?, updated_at = ?
            WHERE id = ?
          `).run(saleId, saleItemId, customerId, saleDate, warrantyMonths, warrantyExpiry, saleDate, sid);
        }
      }

      if (paidAmount > 0) {
        db.prepare(`
          INSERT INTO payments (
            party_type, party_id, invoice_type, invoice_id, invoice_no, amount,
            payment_method, payment_date, notes, user_id, created_at
          ) VALUES ('customer', ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(customerId, saleId, invoiceNo, paidAmount, paymentMethod, saleDate, `Payment on ${invoiceNo}`, userId, saleDate);
      }

      return { id: saleId, invoice_no: invoiceNo, total, paid_amount: paidAmount, payment_status: paymentStatus };
    });

    res.status(201).json(created);
  } catch (err) {
    handleError(res, err);
  }
});

// Edit sale invoice (reverses old stock/serials & applies updated items atomically)
router.put('/sales/:id', (req, res) => {
  try {
    const saleId = Number(req.params.id);
    const body = req.body || {};
    const items: Array<{ product_id: number; quantity: number; unit_price: number; discount?: number; serial_ids?: number[] }> =
      Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw new HttpError(400, 'Invoice must contain at least one item');

    const updated = withTransaction((db) => {
      const existingSale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Record<string, any> | undefined;
      if (!existingSale) throw new HttpError(404, 'Invoice not found');
      if (existingSale.status === 'cancelled') throw new HttpError(400, 'Cannot edit a voided invoice');

      const now = new Date().toISOString();
      const userId = Number(body.user_id || existingSale.user_id || 1);
      const locationId = Number(body.location_id || existingSale.location_id || getDefaultLocationId(db));
      const customerId = Number(body.customer_id || existingSale.customer_id || 1);

      // 1. Reverse prior sale_items stock and release prior serials
      const oldItems = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as Array<Record<string, any>>;
      for (const oi of oldItems) {
        const netSold = Number(oi.quantity) - Number(oi.returned_qty || 0);
        if (netSold > 0) {
          adjustProductAndLocationStock(db, {
            productId: oi.product_id,
            locationId: existingSale.location_id || locationId,
            delta: netSold,
            userId,
            movementType: 'adjustment',
            referenceType: 'sale_edit',
            referenceId: saleId,
            referenceNo: existingSale.invoice_no,
            notes: `Reversed item qty during edit of ${existingSale.invoice_no}`,
            createdAt: now,
          });
        }
      }
      db.prepare(`
        UPDATE serial_numbers
        SET status = 'available', sale_id = NULL, sale_item_id = NULL, customer_id = NULL, sale_date = NULL, warranty_expiry = NULL, updated_at = ?
        WHERE sale_id = ? AND status = 'sold'
      `).run(now, saleId);
      db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);

      // 2. Apply updated items
      const invoiceDiscount = Math.max(0, Number(body.discount ?? existingSale.discount ?? 0));
      const taxRate = body.tax_rate !== undefined ? Number(body.tax_rate) : 0;
      let subtotal = 0;

      for (const item of items) {
        const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(item.product_id)) as Record<string, any> | undefined;
        if (!prod) throw new HttpError(404, `Product #${item.product_id} not found`);
        const qty = Math.floor(Number(item.quantity || 0));
        if (qty <= 0) throw new HttpError(400, 'Item quantity must be positive');

        const unitPrice = Number(item.unit_price ?? prod.sale_price);
        const itemDiscount = Math.max(0, Number(item.discount || 0));
        const totalPrice = Math.max(0, unitPrice * qty - itemDiscount);
        const serialIds = Array.isArray(item.serial_ids) ? item.serial_ids.map(Number) : [];

        if (prod.serial_tracking === 1) {
          if (serialIds.length !== qty) {
            throw new HttpError(400, `"${prod.name}" requires ${qty} serial number(s)`);
          }
          for (const sid of serialIds) {
            const sn = db.prepare('SELECT * FROM serial_numbers WHERE id = ? AND product_id = ?').get(sid, prod.id) as
              | Record<string, any>
              | undefined;
            if (!sn || sn.status !== 'available') {
              throw new HttpError(409, `Serial #${sid} is not available`);
            }
          }
        }

        subtotal += totalPrice;
        const siInfo = db.prepare(`
          INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, discount, total_price, returned_qty)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(saleId, prod.id, qty, unitPrice, prod.purchase_price, itemDiscount, totalPrice);

        adjustProductAndLocationStock(db, {
          productId: prod.id,
          locationId,
          delta: -qty,
          userId,
          movementType: 'sale',
          referenceType: 'sale_edit',
          referenceId: saleId,
          referenceNo: existingSale.invoice_no,
          notes: `Updated invoice ${existingSale.invoice_no}`,
          createdAt: now,
        });

        for (const sid of serialIds) {
          const warrantyMonths = Number(prod.warranty_months || 12);
          const warrantyExpiry = warrantyMonths > 0 ? addMonthsIso(existingSale.sale_date, warrantyMonths) : null;
          db.prepare(`
            UPDATE serial_numbers
            SET status = 'sold', sale_id = ?, sale_item_id = ?, customer_id = ?, sale_date = ?,
                warranty_months = ?, warranty_expiry = ?, updated_at = ?
            WHERE id = ?
          `).run(saleId, Number(siInfo.lastInsertRowid), customerId, existingSale.sale_date, warrantyMonths, warrantyExpiry, now, sid);
        }
      }

      const taxable = Math.max(0, subtotal - invoiceDiscount);
      const tax = Number(((taxable * Math.max(0, taxRate)) / 100).toFixed(2));
      const total = Math.max(0, Number((taxable + tax).toFixed(2)));
      const paidAmount = Math.min(Number(body.paid_amount ?? existingSale.paid_amount ?? 0), total);
      const paymentStatus = paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

      db.prepare(`
        UPDATE sales
        SET customer_id = ?, subtotal = ?, discount = ?, tax = ?, total = ?, paid_amount = ?, payment_status = ?, notes = ?
        WHERE id = ?
      `).run(customerId, subtotal, invoiceDiscount, tax, total, paidAmount, paymentStatus, String(body.notes ?? existingSale.notes ?? ''), saleId);

      return db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId);
    });

    res.json(updated);
  } catch (err) {
    handleError(res, err);
  }
});

// Void/Cancel Sale without erasing financial history
router.post('/sales/:id/void', (req, res) => {
  try {
    const saleId = Number(req.params.id);
    const result = withTransaction((db) => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Record<string, any> | undefined;
      if (!sale) throw new HttpError(404, 'Invoice not found');
      if (sale.status === 'cancelled') throw new HttpError(400, 'Invoice is already voided');

      const now = new Date().toISOString();
      const locId = sale.location_id || getDefaultLocationId(db);
      const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as Array<Record<string, any>>;

      for (const it of items) {
        const netSold = Number(it.quantity) - Number(it.returned_qty || 0);
        if (netSold > 0) {
          adjustProductAndLocationStock(db, {
            productId: it.product_id,
            locationId: locId,
            delta: netSold,
            userId: sale.user_id || 1,
            movementType: 'customer_return',
            referenceType: 'sale_void',
            referenceId: saleId,
            referenceNo: sale.invoice_no,
            notes: `Invoice ${sale.invoice_no} voided (history retained)`,
            createdAt: now,
          });
        }
      }

      db.prepare(`
        UPDATE serial_numbers
        SET status = 'available', sale_id = NULL, sale_item_id = NULL, customer_id = NULL, sale_date = NULL, warranty_expiry = NULL,
            notes = 'Released from voided invoice', updated_at = ?
        WHERE sale_id = ?
      `).run(now, saleId);

      db.prepare("UPDATE sales SET status = 'cancelled', notes = COALESCE(notes, '') || ' [VOIDED]' WHERE id = ?").run(saleId);
      return { ok: true, status: 'cancelled' };
    });

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Permanently Delete Sale Invoice (restores sold stock & frees serials first if not already voided)
router.delete('/sales/:id', (req, res) => {
  try {
    const saleId = Number(req.params.id);
    const result = withTransaction((db) => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Record<string, any> | undefined;
      if (!sale) throw new HttpError(404, 'Invoice not found');

      const now = new Date().toISOString();
      const locId = sale.location_id || getDefaultLocationId(db);

      if (sale.status === 'completed') {
        const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(saleId) as Array<Record<string, any>>;
        for (const it of items) {
          const netSold = Number(it.quantity) - Number(it.returned_qty || 0);
          if (netSold > 0) {
            adjustProductAndLocationStock(db, {
              productId: it.product_id,
              locationId: locId,
              delta: netSold,
              userId: sale.user_id || 1,
              movementType: 'adjustment',
              referenceType: 'sale_delete',
              referenceId: saleId,
              referenceNo: sale.invoice_no,
              notes: `Stock restored on deletion of ${sale.invoice_no}`,
              createdAt: now,
            });
          }
        }
      }

      db.prepare(`
        UPDATE serial_numbers
        SET status = CASE WHEN status = 'sold' THEN 'available' ELSE status END,
            sale_id = NULL, sale_item_id = NULL, customer_id = NULL, sale_date = NULL, warranty_expiry = NULL,
            notes = CASE WHEN status = 'sold' THEN 'Released from deleted invoice' ELSE notes END,
            updated_at = ?
        WHERE sale_id = ?
      `).run(now, saleId);

      db.prepare("DELETE FROM payments WHERE invoice_type = 'sale' AND invoice_id = ?").run(saleId);
      db.prepare('DELETE FROM sale_items WHERE sale_id = ?').run(saleId);
      db.prepare('DELETE FROM sales WHERE id = ?').run(saleId);

      return { ok: true, deletedId: saleId };
    });

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Customer Return on Sale
router.post('/sales/:id/return', (req, res) => {
  try {
    const saleId = Number(req.params.id);
    const body = req.body || {};
    const returnItems: Array<{ sale_item_id: number; quantity: number; serial_ids?: number[]; restock_as_available?: boolean }> =
      Array.isArray(body.items) ? body.items : [];

    if (returnItems.length === 0) throw new HttpError(400, 'Select at least one item to return');

    const result = withTransaction((db) => {
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId) as Record<string, any> | undefined;
      if (!sale) throw new HttpError(404, 'Invoice not found');
      if (sale.status === 'cancelled') throw new HttpError(400, 'Cannot return items from a voided invoice');

      const now = new Date().toISOString();
      const locId = sale.location_id || getDefaultLocationId(db);
      const userId = Number(body.user_id || 1);

      for (const ri of returnItems) {
        const si = db.prepare('SELECT * FROM sale_items WHERE id = ? AND sale_id = ?').get(ri.sale_item_id, saleId) as
          | Record<string, any>
          | undefined;
        if (!si) throw new HttpError(404, 'Sale item not found');

        const remaining = Number(si.quantity) - Number(si.returned_qty || 0);
        const qty = Math.floor(Number(ri.quantity || 0));
        if (qty <= 0 || qty > remaining) {
          throw new HttpError(400, `Invalid return quantity (${qty}). Remaining returnable: ${remaining}`);
        }

        db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').run(qty, si.id);

        const serialIds = Array.isArray(ri.serial_ids) ? ri.serial_ids.map(Number) : [];
        const restockStatus = ri.restock_as_available === false ? 'returned' : 'available';

        if (serialIds.length > 0) {
          for (const sid of serialIds) {
            db.prepare('UPDATE serial_numbers SET status = ?, notes = ?, updated_at = ? WHERE id = ? AND sale_id = ?').run(
              restockStatus,
              `Returned from ${sale.invoice_no}`,
              now,
              sid,
              saleId
            );
          }
        }

        if (restockStatus === 'available') {
          adjustProductAndLocationStock(db, {
            productId: si.product_id,
            locationId: locId,
            delta: qty,
            userId,
            movementType: 'customer_return',
            referenceType: 'sale',
            referenceId: saleId,
            referenceNo: sale.invoice_no,
            notes: `Customer return on ${sale.invoice_no}`,
            createdAt: now,
          });
        }
      }

      const unreturned = db
        .prepare('SELECT COALESCE(SUM(quantity - returned_qty), 0) as rem FROM sale_items WHERE sale_id = ?')
        .get(saleId) as { rem: number };
      if (unreturned.rem === 0) {
        db.prepare("UPDATE sales SET status = 'returned' WHERE id = ?").run(saleId);
      }

      return { ok: true };
    });

    res.json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Purchases
router.get('/purchases', (req, res) => {
  try {
    const db = getDb();
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE p.invoice_no LIKE ? OR COALESCE(sup.name, \'\') LIKE ?' : '';
    const args = q ? [`%${q}%`, `%${q}%`] : [];
    const rows = db.prepare(`
      SELECT p.*, COALESCE(sup.name, 'Supplier') as supplier_name, sup.phone as supplier_phone,
             u.name as user_name, l.name as location_name
      FROM purchases p
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN locations l ON l.id = p.location_id
      ${where}
      ORDER BY p.purchase_date DESC, p.id DESC
      LIMIT 250
    `).all(...args);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/purchases/:id', (req, res) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    const purchase = db.prepare(`
      SELECT p.*, COALESCE(sup.name, 'Supplier') as supplier_name, sup.phone as supplier_phone,
             u.name as user_name, l.name as location_name
      FROM purchases p
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      LEFT JOIN users u ON u.id = p.user_id
      LEFT JOIN locations l ON l.id = p.location_id
      WHERE p.id = ?
    `).get(id);
    if (!purchase) throw new HttpError(404, 'Purchase invoice not found');

    const items = db.prepare(`
      SELECT pi.*, prod.name as product_name, prod.model as product_model, prod.sku as product_sku
      FROM purchase_items pi
      JOIN products prod ON prod.id = pi.product_id
      WHERE pi.purchase_id = ?
    `).all(id);

    const serials = db.prepare(`
      SELECT id, purchase_item_id, product_id, serial_number, serial_qr, status
      FROM serial_numbers
      WHERE purchase_id = ?
    `).all(id);

    res.json({ purchase, items, serials });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/purchases', (req, res) => {
  try {
    const body = req.body || {};
    const items: Array<{
      product_id: number;
      quantity: number;
      unit_cost: number;
      serial_numbers?: string[];
    }> = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0) throw new HttpError(400, 'At least one purchase item is required');

    const created = withTransaction((db) => {
      const supplierId = body.supplier_id ? Number(body.supplier_id) : null;
      if (!supplierId) throw new HttpError(400, 'Supplier is required');

      const locationId = Number(body.location_id || getDefaultLocationId(db));
      const userId = Number(body.user_id || 1);
      const purchaseDate = body.purchase_date ? new Date(body.purchase_date).toISOString() : new Date().toISOString();
      const invoiceNo = String(body.invoice_no || '').trim() || nextInvoiceNumber(db, 'purchases', 'purchase_prefix', 'PUR-');

      let subtotal = 0;
      const seenSerials = new Set<string>();
      const preparedItems: Array<{
        product: Record<string, any>;
        quantity: number;
        unitCost: number;
        totalCost: number;
        serialNumbers: string[];
      }> = [];

      for (const item of items) {
        const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(item.product_id)) as Record<string, any> | undefined;
        if (!prod) throw new HttpError(404, `Product #${item.product_id} not found`);

        const qty = Math.floor(Number(item.quantity || 0));
        if (qty <= 0) throw new HttpError(400, `Quantity for "${prod.name}" must be positive`);

        const unitCost = Math.max(0, Number(item.unit_cost ?? prod.purchase_price));
        const totalCost = unitCost * qty;
        const serialNumbers = Array.isArray(item.serial_numbers)
          ? item.serial_numbers.map((s) => String(s).trim()).filter(Boolean)
          : [];

        if (prod.serial_tracking === 1 && serialNumbers.length !== qty) {
          throw new HttpError(
            400,
            `"${prod.name}" has serial tracking enabled. Enter ${qty} unique serial number(s).`
          );
        }

        for (const sn of serialNumbers) {
          if (seenSerials.has(sn.toLowerCase())) {
            throw new HttpError(409, `Duplicate serial number in purchase: "${sn}"`);
          }
          seenSerials.add(sn.toLowerCase());
          const exists = db.prepare('SELECT 1 FROM serial_numbers WHERE LOWER(serial_number) = LOWER(?)').get(sn);
          if (exists) throw new HttpError(409, `Serial number "${sn}" already exists in database`);
        }

        subtotal += totalCost;
        preparedItems.push({ product: prod, quantity: qty, unitCost, totalCost, serialNumbers });
      }

      const discount = Math.max(0, Number(body.discount || 0));
      const tax = Math.max(0, Number(body.tax || 0));
      const total = Math.max(0, subtotal - discount + tax);
      const paidAmount = Math.max(0, Math.min(Number(body.paid_amount ?? total), total));
      const paymentStatus = paidAmount >= total ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid';

      const purInfo = db.prepare(`
        INSERT INTO purchases (
          invoice_no, supplier_id, location_id, user_id, purchase_date,
          subtotal, discount, tax, total, paid_amount, payment_status, notes, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
      `).run(
        invoiceNo,
        supplierId,
        locationId,
        userId,
        purchaseDate,
        subtotal,
        discount,
        tax,
        total,
        paidAmount,
        paymentStatus,
        String(body.notes || ''),
        purchaseDate
      );

      const purchaseId = Number(purInfo.lastInsertRowid);

      for (const pi of preparedItems) {
        const piInfo = db.prepare(`
          INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, total_cost, returned_qty)
          VALUES (?, ?, ?, ?, ?, 0)
        `).run(purchaseId, pi.product.id, pi.quantity, pi.unitCost, pi.totalCost);
        const purchaseItemId = Number(piInfo.lastInsertRowid);

        // Update latest purchase cost on product
        db.prepare('UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?').run(
          pi.unitCost,
          purchaseDate,
          pi.product.id
        );

        adjustProductAndLocationStock(db, {
          productId: pi.product.id,
          locationId,
          delta: pi.quantity,
          userId,
          movementType: 'purchase',
          referenceType: 'purchase',
          referenceId: purchaseId,
          referenceNo: invoiceNo,
          notes: `Purchased via ${invoiceNo}`,
          createdAt: purchaseDate,
        });

        for (const sn of pi.serialNumbers) {
          db.prepare(`
            INSERT INTO serial_numbers (
              serial_number, serial_qr, product_id, location_id, purchase_id, purchase_item_id,
              supplier_id, purchase_date, purchase_price, status, warranty_months, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, ?, ?)
          `).run(
            sn,
            `SERQR:${pi.product.id}:${sn}`,
            pi.product.id,
            locationId,
            purchaseId,
            purchaseItemId,
            supplierId,
            purchaseDate,
            pi.unitCost,
            pi.product.warranty_months || 12,
            `Purchased on ${invoiceNo}`,
            purchaseDate,
            purchaseDate
          );
        }
      }

      if (paidAmount > 0) {
        db.prepare(`
          INSERT INTO payments (
            party_type, party_id, invoice_type, invoice_id, invoice_no, amount,
            payment_method, payment_date, notes, user_id, created_at
          ) VALUES ('supplier', ?, 'purchase', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          supplierId,
          purchaseId,
          invoiceNo,
          paidAmount,
          String(body.payment_method || 'cash'),
          purchaseDate,
          `Supplier payment for ${invoiceNo}`,
          userId,
          purchaseDate
        );
      }

      return { id: purchaseId, invoice_no: invoiceNo, total, paid_amount: paidAmount, payment_status: paymentStatus };
    });

    res.status(201).json(created);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/purchases/:id/return', (req, res) => {
  try {
    const purchaseId = Number(req.params.id);
    const body = req.body || {};
    const items: Array<{ purchase_item_id: number; quantity: number }> = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) throw new HttpError(400, 'Select at least one item to return to supplier');

    withTransaction((db) => {
      const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(purchaseId) as Record<string, any> | undefined;
      if (!purchase) throw new HttpError(404, 'Purchase invoice not found');

      const now = new Date().toISOString();
      const locId = purchase.location_id || getDefaultLocationId(db);
      const userId = Number(body.user_id || 1);

      for (const ri of items) {
        const pi = db.prepare('SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?').get(ri.purchase_item_id, purchaseId) as
          | Record<string, any>
          | undefined;
        if (!pi) throw new HttpError(404, 'Purchase item not found');
        const rem = Number(pi.quantity) - Number(pi.returned_qty || 0);
        const qty = Math.floor(Number(ri.quantity || 0));
        if (qty <= 0 || qty > rem) {
          throw new HttpError(400, `Invalid supplier return qty (${qty}). Remaining: ${rem}`);
        }

        db.prepare('UPDATE purchase_items SET returned_qty = returned_qty + ? WHERE id = ?').run(qty, pi.id);

        // If serialized, mark available serials from this purchase as returned
        const availSerials = db
          .prepare("SELECT id FROM serial_numbers WHERE purchase_item_id = ? AND status = 'available' LIMIT ?")
          .all(pi.id, qty) as Array<{ id: number }>;
        for (const sn of availSerials) {
          db.prepare("UPDATE serial_numbers SET status = 'returned', notes = ?, updated_at = ? WHERE id = ?").run(
            `Returned to supplier on ${purchase.invoice_no}`,
            now,
            sn.id
          );
        }

        adjustProductAndLocationStock(db, {
          productId: pi.product_id,
          locationId: locId,
          delta: -qty,
          userId,
          movementType: 'supplier_return',
          referenceType: 'purchase',
          referenceId: purchaseId,
          referenceNo: purchase.invoice_no,
          notes: `Returned to supplier (${purchase.invoice_no})`,
          createdAt: now,
        });
      }

      const remAll = db
        .prepare('SELECT COALESCE(SUM(quantity - returned_qty), 0) as rem FROM purchase_items WHERE purchase_id = ?')
        .get(purchaseId) as { rem: number };
      if (remAll.rem === 0) {
        db.prepare("UPDATE purchases SET status = 'returned' WHERE id = ?").run(purchaseId);
      }
    });

    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Customers & Suppliers with live balance aggregation
router.get('/customers', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT c.*,
        COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.customer_id = c.id AND s.status != 'cancelled'), 0) as total_purchases,
        COALESCE((SELECT SUM(s.paid_amount) FROM sales s WHERE s.customer_id = c.id AND s.status != 'cancelled'), 0) as total_paid,
        COALESCE((SELECT SUM(s.total - s.paid_amount) FROM sales s WHERE s.customer_id = c.id AND s.status != 'cancelled'), 0) as outstanding_balance,
        COALESCE((SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status != 'cancelled'), 0) as invoice_count
      FROM customers c
      ORDER BY c.id ASC
    `).all();
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/customers', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Customer name is required');
    const db = getDb();
    const info = db
      .prepare('INSERT INTO customers (name, phone, email, address, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        name,
        String(req.body?.phone || ''),
        String(req.body?.email || ''),
        String(req.body?.address || ''),
        String(req.body?.notes || ''),
        new Date().toISOString()
      );
    res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/customers/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Customer name is required');
    const db = getDb();
    db.prepare('UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?').run(
      name,
      String(req.body?.phone || ''),
      String(req.body?.email || ''),
      String(req.body?.address || ''),
      String(req.body?.notes || ''),
      id
    );
    res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/suppliers', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT sup.*,
        COALESCE((SELECT SUM(p.total) FROM purchases p WHERE p.supplier_id = sup.id AND p.status != 'cancelled'), 0) as total_purchases,
        COALESCE((SELECT SUM(p.paid_amount) FROM purchases p WHERE p.supplier_id = sup.id AND p.status != 'cancelled'), 0) as total_paid,
        COALESCE((SELECT SUM(p.total - p.paid_amount) FROM purchases p WHERE p.supplier_id = sup.id AND p.status != 'cancelled'), 0) as outstanding_balance,
        COALESCE((SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = sup.id AND p.status != 'cancelled'), 0) as invoice_count
      FROM suppliers sup
      ORDER BY sup.id ASC
    `).all();
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/suppliers', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Supplier name is required');
    const db = getDb();
    const info = db
      .prepare('INSERT INTO suppliers (name, phone, email, address, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        name,
        String(req.body?.phone || ''),
        String(req.body?.email || ''),
        String(req.body?.address || ''),
        String(req.body?.notes || ''),
        new Date().toISOString()
      );
    res.status(201).json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/suppliers/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'Supplier name is required');
    const db = getDb();
    db.prepare('UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?').run(
      name,
      String(req.body?.phone || ''),
      String(req.body?.email || ''),
      String(req.body?.address || ''),
      String(req.body?.notes || ''),
      id
    );
    res.json(db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id));
  } catch (err) {
    handleError(res, err);
  }
});

// Payments
router.get('/payments', (req, res) => {
  try {
    const db = getDb();
    const partyType = req.query.partyType ? String(req.query.partyType) : '';
    const partyId = req.query.partyId ? Number(req.query.partyId) : null;
    const conds: string[] = [];
    const args: any[] = [];
    if (partyType) {
      conds.push('pay.party_type = ?');
      args.push(partyType);
    }
    if (partyId) {
      conds.push('pay.party_id = ?');
      args.push(partyId);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT pay.*,
        CASE WHEN pay.party_type = 'customer' THEN (SELECT name FROM customers WHERE id = pay.party_id)
             ELSE (SELECT name FROM suppliers WHERE id = pay.party_id) END as party_name,
        u.name as user_name
      FROM payments pay
      LEFT JOIN users u ON u.id = pay.user_id
      ${where}
      ORDER BY pay.payment_date DESC, pay.id DESC
      LIMIT 300
    `).all(...args);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/payments', (req, res) => {
  try {
    const body = req.body || {};
    const partyType = String(body.party_type || '');
    const partyId = Number(body.party_id);
    const amount = Number(body.amount || 0);
    if (!['customer', 'supplier'].includes(partyType) || !partyId || amount <= 0) {
      throw new HttpError(400, 'Valid party type, party ID, and positive payment amount are required');
    }

    const result = withTransaction((db) => {
      const now = new Date().toISOString();
      const paymentDate = body.payment_date ? new Date(body.payment_date).toISOString() : now;
      const userId = Number(body.user_id || 1);
      const method = String(body.payment_method || 'cash');
      const notes = String(body.notes || '');

      let remainingToApply = amount;
      let refInvoiceNo = String(body.invoice_no || '');
      let refInvoiceId = body.invoice_id ? Number(body.invoice_id) : null;

      if (partyType === 'customer') {
        const unpaidSales = refInvoiceId
          ? (db.prepare("SELECT * FROM sales WHERE id = ? AND customer_id = ? AND status != 'cancelled'").all(refInvoiceId, partyId) as Array<Record<string, any>>)
          : (db
              .prepare("SELECT * FROM sales WHERE customer_id = ? AND status != 'cancelled' AND paid_amount < total ORDER BY sale_date ASC")
              .all(partyId) as Array<Record<string, any>>);

        for (const s of unpaidSales) {
          if (remainingToApply <= 0) break;
          const due = Number(s.total) - Number(s.paid_amount);
          const applied = Math.min(due, remainingToApply);
          if (applied > 0) {
            const newPaid = Number(s.paid_amount) + applied;
            const newStatus = newPaid >= Number(s.total) ? 'paid' : 'partial';
            db.prepare('UPDATE sales SET paid_amount = ?, payment_status = ? WHERE id = ?').run(newPaid, newStatus, s.id);
            remainingToApply -= applied;
            if (!refInvoiceNo) refInvoiceNo = s.invoice_no;
          }
        }
      } else {
        const unpaidPurchases = refInvoiceId
          ? (db.prepare("SELECT * FROM purchases WHERE id = ? AND supplier_id = ? AND status != 'cancelled'").all(refInvoiceId, partyId) as Array<Record<string, any>>)
          : (db
              .prepare("SELECT * FROM purchases WHERE supplier_id = ? AND status != 'cancelled' AND paid_amount < total ORDER BY purchase_date ASC")
              .all(partyId) as Array<Record<string, any>>);

        for (const p of unpaidPurchases) {
          if (remainingToApply <= 0) break;
          const due = Number(p.total) - Number(p.paid_amount);
          const applied = Math.min(due, remainingToApply);
          if (applied > 0) {
            const newPaid = Number(p.paid_amount) + applied;
            const newStatus = newPaid >= Number(p.total) ? 'paid' : 'partial';
            db.prepare('UPDATE purchases SET paid_amount = ?, payment_status = ? WHERE id = ?').run(newPaid, newStatus, p.id);
            remainingToApply -= applied;
            if (!refInvoiceNo) refInvoiceNo = p.invoice_no;
          }
        }
      }

      const info = db.prepare(`
        INSERT INTO payments (
          party_type, party_id, invoice_type, invoice_id, invoice_no, amount,
          payment_method, payment_date, notes, user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        partyType,
        partyId,
        partyType === 'customer' ? 'sale' : 'purchase',
        refInvoiceId,
        refInvoiceNo,
        amount,
        method,
        paymentDate,
        notes,
        userId,
        now
      );

      return db.prepare('SELECT * FROM payments WHERE id = ?').get(info.lastInsertRowid);
    });

    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Expenses
router.get('/expenses', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT e.*, u.name as user_name
      FROM expenses e
      LEFT JOIN users u ON u.id = e.user_id
      ORDER BY e.expense_date DESC, e.id DESC
    `).all();
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/expenses', (req, res) => {
  try {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const category = String(body.category || 'General').trim();
    const amount = Number(body.amount || 0);
    if (!title || amount <= 0) throw new HttpError(400, 'Expense title and positive amount are required');

    const db = getDb();
    const now = new Date().toISOString();
    const info = db.prepare(`
      INSERT INTO expenses (category, title, amount, expense_date, payment_method, notes, user_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      category,
      title,
      amount,
      body.expense_date ? new Date(body.expense_date).toISOString() : now,
      String(body.payment_method || 'cash'),
      String(body.notes || ''),
      Number(body.user_id || 1),
      now
    );
    res.status(201).json(db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    handleError(res, err);
  }
});

router.delete('/expenses/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Inventory Movements History
router.get('/movements', (req, res) => {
  try {
    const db = getDb();
    const q = String(req.query.q || '').trim();
    const type = String(req.query.type || 'all');
    const productId = req.query.productId ? Number(req.query.productId) : null;

    const conds: string[] = [];
    const args: any[] = [];
    if (q) {
      const like = `%${q}%`;
      conds.push('(p.name LIKE ? OR p.sku LIKE ? OR sm.reference_no LIKE ? OR sm.notes LIKE ?)');
      args.push(like, like, like, like);
    }
    if (type !== 'all') {
      conds.push('sm.movement_type = ?');
      args.push(type);
    }
    if (productId) {
      conds.push('sm.product_id = ?');
      args.push(productId);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT sm.*, p.name as product_name, p.sku as product_sku, p.model as product_model,
             l.name as location_name, u.name as user_name
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      LEFT JOIN locations l ON l.id = sm.location_id
      LEFT JOIN users u ON u.id = sm.user_id
      ${where}
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT 400
    `).all(...args);
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

// Multi-location Stock Transfers
router.get('/transfers', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT st.*, p.name as product_name, p.sku as product_sku,
             fl.name as from_location_name, tl.name as to_location_name, u.name as user_name
      FROM stock_transfers st
      JOIN products p ON p.id = st.product_id
      JOIN locations fl ON fl.id = st.from_location_id
      JOIN locations tl ON tl.id = st.to_location_id
      LEFT JOIN users u ON u.id = st.user_id
      ORDER BY st.created_at DESC, st.id DESC
      LIMIT 150
    `).all();
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/transfers', (req, res) => {
  try {
    const body = req.body || {};
    const productId = Number(body.product_id);
    const fromLocId = Number(body.from_location_id);
    const toLocId = Number(body.to_location_id);
    const quantity = Math.floor(Number(body.quantity || 0));

    if (!productId || !fromLocId || !toLocId || fromLocId === toLocId || quantity <= 0) {
      throw new HttpError(400, 'Select product, two different locations, and a positive quantity');
    }

    const result = withTransaction((db) => {
      const prod = db.prepare('SELECT * FROM products WHERE id = ?').get(productId) as Record<string, any> | undefined;
      if (!prod) throw new HttpError(404, 'Product not found');

      const fromRow = db
        .prepare('SELECT quantity FROM product_location_stock WHERE product_id = ? AND location_id = ?')
        .get(productId, fromLocId) as { quantity: number } | undefined;
      const availAtSource = fromRow ? Number(fromRow.quantity) : 0;
      if (availAtSource < quantity) {
        throw new HttpError(400, `Insufficient stock at source location. Available: ${availAtSource}`);
      }

      const serialIds: number[] = Array.isArray(body.serial_ids) ? body.serial_ids.map(Number) : [];
      const movedSerialNumbers: string[] = [];
      const now = new Date().toISOString();

      if (prod.serial_tracking === 1) {
        if (serialIds.length !== quantity) {
          throw new HttpError(400, `Select ${quantity} available serial number(s) at source location for transfer`);
        }
        for (const sid of serialIds) {
          const sn = db
            .prepare("SELECT * FROM serial_numbers WHERE id = ? AND product_id = ? AND location_id = ? AND status = 'available'")
            .get(sid, productId, fromLocId) as Record<string, any> | undefined;
          if (!sn) throw new HttpError(400, `Serial #${sid} is not available at source location`);
          db.prepare('UPDATE serial_numbers SET location_id = ?, updated_at = ? WHERE id = ?').run(toLocId, now, sid);
          movedSerialNumbers.push(sn.serial_number);
        }
      }

      const countRow = db.prepare('SELECT COUNT(*) as c FROM stock_transfers').get() as { c: number };
      const transferNo = `TRF-${new Date().getFullYear()}-${String(countRow.c + 1).padStart(4, '0')}`;
      const userId = Number(body.user_id || 1);
      const notes = String(body.notes || '');

      const info = db.prepare(`
        INSERT INTO stock_transfers (
          transfer_no, product_id, from_location_id, to_location_id, quantity, serial_numbers_json, user_id, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(transferNo, productId, fromLocId, toLocId, quantity, JSON.stringify(movedSerialNumbers), userId, notes, now);

      // Update location stocks cleanly while keeping global product quantity unchanged
      db.prepare(`
        INSERT INTO product_location_stock (product_id, location_id, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT(product_id, location_id) DO UPDATE SET quantity = quantity - ?
      `).run(productId, fromLocId, availAtSource - quantity, quantity);

      db.prepare(`
        INSERT INTO product_location_stock (product_id, location_id, quantity)
        VALUES (?, ?, ?)
        ON CONFLICT(product_id, location_id) DO UPDATE SET quantity = quantity + ?
      `).run(productId, toLocId, quantity, quantity);

      db.prepare(`
        INSERT INTO stock_movements (
          product_id, location_id, user_id, previous_qty, change_qty, new_qty,
          movement_type, reference_type, reference_id, reference_no, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'transfer_out', 'transfer', ?, ?, ?, ?)
      `).run(productId, fromLocId, userId, prod.quantity, -quantity, prod.quantity, Number(info.lastInsertRowid), transferNo, `Transferred out to location #${toLocId}`, now);

      db.prepare(`
        INSERT INTO stock_movements (
          product_id, location_id, user_id, previous_qty, change_qty, new_qty,
          movement_type, reference_type, reference_id, reference_no, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'transfer_in', 'transfer', ?, ?, ?, ?)
      `).run(productId, toLocId, userId, prod.quantity, quantity, prod.quantity, Number(info.lastInsertRowid), transferNo, `Transferred in from location #${fromLocId}`, now);

      return db.prepare('SELECT * FROM stock_transfers WHERE id = ?').get(info.lastInsertRowid);
    });

    res.status(201).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

// Smart Forecasting & Reorder Suggestions
router.get('/analytics/forecasting', (_req, res) => {
  try {
    const db = getDb();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffIso = cutoff.toISOString();

    const products = db.prepare(`
      SELECT p.*, b.name as brand_name, c.name as category_name,
        COALESCE((
          SELECT SUM(si.quantity - si.returned_qty)
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id = p.id AND s.status != 'cancelled' AND s.sale_date >= ?
        ), 0) as units_sold_30d
      FROM products p
      LEFT JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.quantity ASC, units_sold_30d DESC
    `).all(cutoffIso) as Array<Record<string, any>>;

    const forecast = products.map((p) => {
      const avgDailySales = Number((p.units_sold_30d / 30).toFixed(2));
      const daysRemaining = avgDailySales > 0 ? Math.round(p.quantity / avgDailySales) : p.quantity > 0 ? 999 : 0;
      const targetStock30d = Math.max(p.min_stock * 2, Math.ceil(avgDailySales * 30));
      const suggestedReorder = Math.max(0, targetStock30d - p.quantity);
      let urgency: 'critical' | 'warning' | 'healthy' = 'healthy';
      if (p.quantity <= 0 || daysRemaining <= 7) urgency = 'critical';
      else if (p.quantity <= p.min_stock || daysRemaining <= 15) urgency = 'warning';

      return {
        ...p,
        avg_daily_sales: avgDailySales,
        days_remaining: daysRemaining,
        suggested_reorder: suggestedReorder,
        estimated_reorder_cost: suggestedReorder * Number(p.purchase_price),
        urgency,
      };
    });

    res.json(forecast);
  } catch (err) {
    handleError(res, err);
  }
});

// Comprehensive Reports & Analytics
router.get('/reports/summary', (req, res) => {
  try {
    const db = getDb();
    const startDate = String(req.query.startDate || '2000-01-01').slice(0, 10);
    const endDate = String(req.query.endDate || '2099-12-31').slice(0, 10);

    const salesRows = db.prepare(`
      SELECT s.*, COALESCE(c.name, 'Walk-in Customer') as customer_name
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.status != 'cancelled' AND substr(s.sale_date, 1, 10) BETWEEN ? AND ?
      ORDER BY s.sale_date DESC
    `).all(startDate, endDate) as Array<Record<string, any>>;

    const purchaseRows = db.prepare(`
      SELECT p.*, COALESCE(sup.name, 'Supplier') as supplier_name
      FROM purchases p
      LEFT JOIN suppliers sup ON sup.id = p.supplier_id
      WHERE p.status != 'cancelled' AND substr(p.purchase_date, 1, 10) BETWEEN ? AND ?
      ORDER BY p.purchase_date DESC
    `).all(startDate, endDate) as Array<Record<string, any>>;

    const expenseRows = db.prepare(`
      SELECT * FROM expenses
      WHERE substr(expense_date, 1, 10) BETWEEN ? AND ?
      ORDER BY expense_date DESC
    `).all(startDate, endDate) as Array<Record<string, any>>;

    const productProfit = db.prepare(`
      SELECT p.id, p.name, p.sku, p.quantity as stock_qty,
        COALESCE(SUM(si.quantity - si.returned_qty), 0) as units_sold,
        COALESCE(SUM(si.total_price), 0) as revenue,
        COALESCE(SUM(si.unit_cost * (si.quantity - si.returned_qty)), 0) as cogs,
        COALESCE(SUM((si.unit_price - si.unit_cost) * (si.quantity - si.returned_qty)), 0) as gross_profit
      FROM products p
      LEFT JOIN sale_items si ON si.product_id = p.id
      LEFT JOIN sales s ON s.id = si.sale_id AND s.status != 'cancelled' AND substr(s.sale_date, 1, 10) BETWEEN ? AND ?
      GROUP BY p.id
      HAVING units_sold > 0
      ORDER BY gross_profit DESC
    `).all(startDate, endDate) as Array<Record<string, any>>;

    const totalRevenue = salesRows.reduce((acc, s) => acc + Number(s.total), 0);
    const totalPurchases = purchaseRows.reduce((acc, p) => acc + Number(p.total), 0);
    const totalExpenses = expenseRows.reduce((acc, e) => acc + Number(e.amount), 0);
    const totalCogs = productProfit.reduce((acc, p) => acc + Number(p.cogs), 0);
    const totalDiscounts = salesRows.reduce((acc, s) => acc + Number(s.discount || 0), 0);
    const grossProfit = totalRevenue - totalCogs;
    const netProfit = grossProfit - totalExpenses;

    const stockValuation = db.prepare(`
      SELECT p.id, p.name, p.sku, p.model, c.name as category_name, b.name as brand_name,
             p.quantity, p.min_stock, p.purchase_price, p.sale_price,
             (p.quantity * p.purchase_price) as total_cost_value,
             (p.quantity * p.sale_price) as total_retail_value
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN brands b ON b.id = p.brand_id
      ORDER BY total_cost_value DESC
    `).all();

    const customerBalances = db.prepare(`
      SELECT c.id, c.name, c.phone,
        COALESCE(SUM(s.total), 0) as total_billed,
        COALESCE(SUM(s.paid_amount), 0) as total_paid,
        COALESCE(SUM(s.total - s.paid_amount), 0) as balance_due
      FROM customers c
      LEFT JOIN sales s ON s.customer_id = c.id AND s.status != 'cancelled'
      GROUP BY c.id
      HAVING total_billed > 0
      ORDER BY balance_due DESC
    `).all();

    const supplierBalances = db.prepare(`
      SELECT sup.id, sup.name, sup.phone,
        COALESCE(SUM(p.total), 0) as total_billed,
        COALESCE(SUM(p.paid_amount), 0) as total_paid,
        COALESCE(SUM(p.total - p.paid_amount), 0) as balance_due
      FROM suppliers sup
      LEFT JOIN purchases p ON p.supplier_id = sup.id AND p.status != 'cancelled'
      GROUP BY sup.id
      HAVING total_billed > 0
      ORDER BY balance_due DESC
    `).all();

    const paymentReport = db.prepare(`
      SELECT pay.*,
        CASE WHEN pay.party_type = 'customer' THEN (SELECT name FROM customers WHERE id = pay.party_id)
             ELSE (SELECT name FROM suppliers WHERE id = pay.party_id) END as party_name
      FROM payments pay
      WHERE substr(pay.payment_date, 1, 10) BETWEEN ? AND ?
      ORDER BY pay.payment_date DESC
    `).all(startDate, endDate);

    res.json({
      pnl: {
        totalRevenue,
        totalCogs,
        grossProfit,
        totalDiscounts,
        totalExpenses,
        netProfit,
        totalPurchases,
        salesCount: salesRows.length,
        purchasesCount: purchaseRows.length,
      },
      salesRows,
      purchaseRows,
      expenseRows,
      productProfit,
      stockValuation,
      customerBalances,
      supplierBalances,
      paymentReport,
    });
  } catch (err) {
    handleError(res, err);
  }
});

// Settings & Users
router.get('/settings', (_req, res) => {
  try {
    const db = getDb();
    res.json(getAllSettings(db));
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/settings', (req, res) => {
  try {
    const updates = req.body || {};
    withTransaction((db) => {
      const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      for (const [k, v] of Object.entries(updates)) {
        if (typeof k === 'string' && k.length <= 64) {
          stmt.run(k, String(v ?? ''));
        }
      }
    });
    res.json(getAllSettings(getDb()));
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/users', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || 'Cashier');
    if (!name || !['Admin', 'Manager', 'Cashier'].includes(role)) {
      throw new HttpError(400, 'Valid user name and role (Admin, Manager, Cashier) required');
    }
    const db = getDb();
    const info = db
      .prepare('INSERT INTO users (name, role, pin, active, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(name, role, String(req.body?.pin || ''), new Date().toISOString());
    res.status(201).json(db.prepare('SELECT id, name, role, active, created_at FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    handleError(res, err);
  }
});

router.put('/users/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, any> | undefined;
    if (!existing) throw new HttpError(404, 'User not found');

    const name = String(req.body?.name ?? existing.name).trim();
    const role = String(req.body?.role ?? existing.role);
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
    db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name, role, active, id);
    res.json(db.prepare('SELECT id, name, role, active, created_at FROM users WHERE id = ?').get(id));
  } catch (err) {
    handleError(res, err);
  }
});

// Backup & Restore
router.get('/backups', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM backups ORDER BY created_at DESC, id DESC').all();
    res.json(rows);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/backups', async (req, res) => {
  try {
    const backupType = req.body?.backup_type === 'auto' ? 'auto' : 'manual';
    const db = getDb();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `techvault-backup-${timestamp}.db`;
    const destPath = path.resolve(BACKUP_DIR, filename);

    if (!destPath.startsWith(BACKUP_DIR + path.sep)) {
      throw new HttpError(400, 'Invalid backup destination path');
    }

    // Flush WAL and write clean standalone SQLite snapshot using VACUUM INTO
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);

    const stats = fs.statSync(destPath);
    const info = db
      .prepare('INSERT INTO backups (filename, file_path, size_bytes, backup_type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(filename, destPath, stats.size, backupType, new Date().toISOString());

    res.status(201).json(db.prepare('SELECT * FROM backups WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/backups/:id/download', (req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(Number(req.params.id)) as
      | { filename: string; file_path: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Backup not found');

    const resolved = path.resolve(row.file_path);
    if (!resolved.startsWith(BACKUP_DIR + path.sep) || !fs.existsSync(resolved)) {
      throw new HttpError(404, 'Backup file missing from local disk');
    }
    res.download(resolved, row.filename);
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/backups/restore', (req, res) => {
  try {
    const backupId = Number(req.body?.backup_id);
    if (!backupId) throw new HttpError(400, 'Backup ID is required');

    const db = getDb();
    const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId) as
      | { filename: string; file_path: string }
      | undefined;
    if (!row) throw new HttpError(404, 'Backup record not found');

    const resolved = path.resolve(row.file_path);
    if (!resolved.startsWith(BACKUP_DIR + path.sep) || !fs.existsSync(resolved)) {
      throw new HttpError(404, 'Backup file does not exist on disk');
    }

    // Create a safety pre-restore snapshot first
    const safetyPath = path.resolve(BACKUP_DIR, `pre-restore-${Date.now()}.db`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec(`VACUUM INTO '${safetyPath.replace(/'/g, "''")}'`);

    try {
      db.close();
    } catch {
      // ignore
    }

    for (const ext of ['', '-wal', '-shm']) {
      if (ext && fs.existsSync(DB_PATH + ext)) {
        fs.unlinkSync(DB_PATH + ext);
      }
    }
    fs.copyFileSync(resolved, DB_PATH);
    closeAndReopenDb();

    res.json({ ok: true, restoredFrom: row.filename });
  } catch (err) {
    handleError(res, err);
  }
});

router.post('/backups/upload-restore', (req, res) => {
  try {
    const base64 = String(req.body?.file_base64 || '');
    if (!base64) throw new HttpError(400, 'Backup file data is required');

    const buffer = Buffer.from(base64, 'base64');
    const magic = buffer.subarray(0, 16).toString('utf8');
    if (magic !== 'SQLite format 3\0') {
      throw new HttpError(400, 'Invalid file: uploaded file is not a valid SQLite 3 database');
    }

    const tempPath = path.resolve(BACKUP_DIR, `uploaded-restore-${Date.now()}.db`);
    fs.writeFileSync(tempPath, buffer);

    // Quick integrity check on uploaded DB
    const checkDb = new DatabaseSync(tempPath);
    const checkRes = checkDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const hasProductsTable = checkDb
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='products'")
      .get();
    checkDb.close();

    if (checkRes.integrity_check !== 'ok' || !hasProductsTable) {
      fs.unlinkSync(tempPath);
      throw new HttpError(400, 'Uploaded SQLite file failed integrity or schema verification');
    }

    const db = getDb();
    const safetyPath = path.resolve(BACKUP_DIR, `pre-upload-restore-${Date.now()}.db`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.exec(`VACUUM INTO '${safetyPath.replace(/'/g, "''")}'`);
    try {
      db.close();
    } catch {
      // ignore
    }

    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(DB_PATH + ext)) fs.unlinkSync(DB_PATH + ext);
    }
    fs.copyFileSync(tempPath, DB_PATH);
    const reopened = closeAndReopenDb();

    const stats = fs.statSync(tempPath);
    reopened
      .prepare('INSERT INTO backups (filename, file_path, size_bytes, backup_type, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(path.basename(tempPath), tempPath, stats.size, 'manual', new Date().toISOString());

    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

router.get('/export/business-json', (_req, res) => {
  try {
    const db = getDb();
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: getAllSettings(db),
      categories: db.prepare('SELECT * FROM categories').all(),
      brands: db.prepare('SELECT * FROM brands').all(),
      locations: db.prepare('SELECT * FROM locations').all(),
      products: db.prepare('SELECT * FROM products').all(),
      serial_numbers: db.prepare('SELECT * FROM serial_numbers').all(),
      customers: db.prepare('SELECT * FROM customers').all(),
      suppliers: db.prepare('SELECT * FROM suppliers').all(),
      sales: db.prepare('SELECT * FROM sales').all(),
      sale_items: db.prepare('SELECT * FROM sale_items').all(),
      purchases: db.prepare('SELECT * FROM purchases').all(),
      purchase_items: db.prepare('SELECT * FROM purchase_items').all(),
      stock_movements: db.prepare('SELECT * FROM stock_movements').all(),
      payments: db.prepare('SELECT * FROM payments').all(),
      expenses: db.prepare('SELECT * FROM expenses').all(),
      stock_transfers: db.prepare('SELECT * FROM stock_transfers').all(),
    };
    res.setHeader('Content-Disposition', `attachment; filename="techvault-business-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(payload);
  } catch (err) {
    handleError(res, err);
  }
});

export default router;
