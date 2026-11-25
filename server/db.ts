import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const DB_PATH = path.join(DATA_DIR, 'inventory.db');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH);
    dbInstance.exec('PRAGMA foreign_keys = ON;');
    dbInstance.exec('PRAGMA journal_mode = WAL;');
    dbInstance.exec('PRAGMA busy_timeout = 5000;');
    initializeSchema(dbInstance);
    seedInitialData(dbInstance);
  }
  return dbInstance;
}

export function closeAndReopenDb(): DatabaseSync {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors
    }
    dbInstance = null;
  }
  return getDb();
}

export function withTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw err;
  }
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('Admin', 'Manager', 'Cashier')),
      pin TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS brands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      address TEXT DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      model TEXT DEFAULT '',
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT UNIQUE,
      qr_code TEXT NOT NULL UNIQUE,
      purchase_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      wholesale_price REAL NOT NULL DEFAULT 0,
      quantity INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 5,
      serial_tracking INTEGER NOT NULL DEFAULT 0,
      warranty_months INTEGER NOT NULL DEFAULT 12,
      image_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_location_stock (
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, location_id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL UNIQUE,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      purchase_date TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL CHECK(payment_status IN ('paid', 'partial', 'unpaid')),
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'returned', 'cancelled')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      total_cost REAL NOT NULL,
      returned_qty INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL UNIQUE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sale_date TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      payment_status TEXT NOT NULL CHECK(payment_status IN ('paid', 'partial', 'unpaid')),
      notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'returned', 'cancelled')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL,
      returned_qty INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS serial_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number TEXT NOT NULL UNIQUE,
      serial_qr TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      purchase_item_id INTEGER REFERENCES purchase_items(id) ON DELETE SET NULL,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      purchase_date TEXT,
      purchase_price REAL NOT NULL DEFAULT 0,
      sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      sale_item_id INTEGER REFERENCES sale_items(id) ON DELETE SET NULL,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      sale_date TEXT,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'sold', 'returned', 'under_warranty', 'damaged')),
      warranty_months INTEGER NOT NULL DEFAULT 12,
      warranty_expiry TEXT,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      previous_qty INTEGER NOT NULL,
      change_qty INTEGER NOT NULL,
      new_qty INTEGER NOT NULL,
      movement_type TEXT NOT NULL CHECK(movement_type IN (
        'initial', 'purchase', 'manual_add', 'sale', 'customer_return',
        'supplier_return', 'adjustment', 'damaged', 'lost', 'transfer_in', 'transfer_out'
      )),
      reference_type TEXT DEFAULT '',
      reference_id INTEGER,
      reference_no TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_type TEXT NOT NULL CHECK(party_type IN ('customer', 'supplier')),
      party_id INTEGER NOT NULL,
      invoice_type TEXT CHECK(invoice_type IN ('sale', 'purchase')),
      invoice_id INTEGER,
      invoice_no TEXT DEFAULT '',
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      payment_date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      amount REAL NOT NULL,
      expense_date TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      notes TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_no TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      from_location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      to_location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      quantity INTEGER NOT NULL,
      serial_numbers_json TEXT DEFAULT '[]',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      backup_type TEXT NOT NULL DEFAULT 'manual' CHECK(backup_type IN ('manual', 'auto')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_qr ON products(qr_code);
    CREATE INDEX IF NOT EXISTS idx_serials_sn ON serial_numbers(serial_number);
    CREATE INDEX IF NOT EXISTS idx_serials_qr ON serial_numbers(serial_qr);
    CREATE INDEX IF NOT EXISTS idx_serials_prod_status ON serial_numbers(product_id, status);
    CREATE INDEX IF NOT EXISTS idx_movements_prod ON stock_movements(product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(sale_date);
    CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date);
  `);

  const hasMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 1').get();
  if (!hasMigration) {
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
  }
}

function daysAgoIso(daysAgo: number, hour = 14): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

function addMonthsIso(fromIso: string, months: number): string {
  const d = new Date(fromIso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

function seedInitialData(db: DatabaseSync): void {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount > 0) {
    return;
  }

  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    // Users
    const insertUser = db.prepare('INSERT INTO users (name, role, pin, active, created_at) VALUES (?, ?, ?, 1, ?)');
    insertUser.run('Tariq Mahmood', 'Admin', '1234', now);
    insertUser.run('Bilal Ahmed', 'Manager', '2222', now);
    insertUser.run('Sana Khan', 'Cashier', '0000', now);

    // Settings
    const defaultSettings: Record<string, string> = {
      shop_name: 'TechVault Hardware & Systems',
      shop_address: 'Shop 14, Ground Floor, Hall Road Computer Plaza, Lahore',
      shop_phone: '+92 300 8421905',
      shop_logo: '',
      currency: 'PKR',
      date_format: 'YYYY-MM-DD',
      invoice_prefix: 'INV-',
      purchase_prefix: 'PUR-',
      tax_rate: '0',
      default_printer: '80mm',
      allow_negative_stock: 'false',
      low_stock_default: '5',
      backup_location: './data/backups',
      auto_backup_interval: 'daily',
      warranty_terms: 'Manufacturer warranty covers hardware defects only. Burnt, physically damaged, or tampered seals void warranty.',
      invoice_terms: 'Goods once sold will not be returned without original packaging and valid serial number match on invoice.',
    };
    const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaultSettings)) {
      insertSetting.run(k, v);
    }

    // Categories
    const categories = [
      ['Storage (SSD/HDD)', 'Solid state drives, NVMe modules, and mechanical hard disks'],
      ['Processors (CPU)', 'Desktop and workstation processors'],
      ['Memory (RAM)', 'DDR4 and DDR5 desktop/laptop memory kits'],
      ['Motherboards', 'ATX, mATX, and ITX motherboards'],
      ['Graphics Cards (GPU)', 'Dedicated gaming and workstation GPUs'],
      ['Power Supplies (PSU)', '80+ Bronze/Gold modular power supplies'],
      ['Peripherals', 'Mice, keyboards, coolers, and accessories'],
    ];
    const insertCategory = db.prepare('INSERT INTO categories (name, description, created_at) VALUES (?, ?, ?)');
    for (const [name, desc] of categories) {
      insertCategory.run(name, desc, now);
    }

    // Brands
    const brands = ['Samsung', 'Intel', 'AMD', 'Corsair', 'ASUS', 'MSI', 'Kingston', 'Western Digital', 'Logitech', 'Thermalright'];
    const insertBrand = db.prepare('INSERT INTO brands (name, created_at) VALUES (?, ?)');
    for (const b of brands) {
      insertBrand.run(b, now);
    }

    // Locations
    const insertLocation = db.prepare('INSERT INTO locations (name, code, address, is_default, created_at) VALUES (?, ?, ?, ?, ?)');
    insertLocation.run('Main Counter & Storefront', 'LOC-MAIN', 'Hall Road Shop 14 - Front Display', 1, now);
    insertLocation.run('Backroom Vault', 'LOC-VAULT', 'Upper Mezzanine Secure Storage', 0, now);
    insertLocation.run('Service & RMA Bench', 'LOC-RMA', 'Technician Diagnostics Desk', 0, now);

    // Suppliers
    const insertSupplier = db.prepare('INSERT INTO suppliers (name, phone, email, address, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insertSupplier.run('MegaTech Distributors', '+92 321 4450912', 'orders@megatechdist.pk', 'Hafeez Center, Gulberg III, Lahore', 'Official Samsung & Corsair distributor', now);
    insertSupplier.run('Silicon Valley Imports (KHI)', '+92 333 2109844', 'sales@svimports.pk', 'Techno City Mall, I.I. Chundrigar Rd, Karachi', 'CPU, Motherboard & GPU wholesale importer', now);
    insertSupplier.run('Global Hardware Wholesale', '+92 301 9912300', 'dispatch@globalhw.pk', 'Blue Area Plaza, Islamabad', 'Peripherals & storage distributor', now);

    // Customers
    const insertCustomer = db.prepare('INSERT INTO customers (name, phone, email, address, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insertCustomer.run('Walk-in Customer', '', '', '', 'Default retail counter customer', now);
    insertCustomer.run('Apex Gaming Arena', '+92 302 5511099', 'procurement@apexarena.pk', 'Model Town Link Road, Lahore', '20-PC esports lounge client', now);
    insertCustomer.run('Usman Creative Studio', '+92 345 8812231', 'usman@creativestudio.pk', 'DHA Phase 5, Lahore', 'Workstation builds & editing rigs', now);
    insertCustomer.run('Zainab Tech Solutions', '+92 312 6677881', 'accounts@zainabtech.pk', 'Johar Town, Lahore', 'Corporate IT vendor', now);

    // Products (IDs 1..10)
    const productsData = [
      {
        name: 'Samsung 980 PRO 1TB NVMe M.2 SSD',
        brandId: 1, categoryId: 1, model: 'MZ-V8P1T0BW', sku: 'SSD-SAM-980P-1TB',
        barcode: '8806090567891', qr: 'PRODQR:SSD-SAM-980P-1TB',
        purchase: 24500, sale: 28900, wholesale: 27200, qty: 5, minStock: 5,
        serialTracking: 1, warranty: 36,
        img: '/src/assets/images/product_nvme_ssd_1795590053462.jpg',
        desc: 'PCIe 4.0 NVMe M.2 internal SSD, up to 7,000 MB/s sequential read.'
      },
      {
        name: 'Intel Core i9-14900K Desktop Processor',
        brandId: 2, categoryId: 2, model: 'BX8071514900K', sku: 'CPU-INT-14900K',
        barcode: '5032037278942', qr: 'PRODQR:CPU-INT-14900K',
        purchase: 158000, sale: 174500, wholesale: 168000, qty: 4, minStock: 3,
        serialTracking: 1, warranty: 36,
        img: '/src/assets/images/product_desktop_cpu_1795590053934.jpg',
        desc: '24-Core (8P+16E) LGA1700 unlocked desktop processor up to 6.0 GHz.'
      },
      {
        name: 'Corsair Dominator Platinum RGB 32GB (2x16GB) DDR5',
        brandId: 4, categoryId: 3, model: 'CMT32GX5M2B6000C36', sku: 'RAM-COR-DOM32-D5',
        barcode: '840006651234', qr: 'PRODQR:RAM-COR-DOM32-D5',
        purchase: 38000, sale: 44500, wholesale: 42000, qty: 6, minStock: 4,
        serialTracking: 1, warranty: 60,
        img: '/src/assets/images/product_ddr5_ram_1795590052561.jpg',
        desc: 'DDR5-6000MHz CL36 dual-channel memory kit with DHX cooling.'
      },
      {
        name: 'ASUS ROG Strix Z790-E Gaming WiFi II Motherboard',
        brandId: 5, categoryId: 4, model: 'ROG-STRIX-Z790-E-II', sku: 'MB-ASU-Z790E',
        barcode: '4711387312988', qr: 'PRODQR:MB-ASU-Z790E',
        purchase: 118000, sale: 132000, wholesale: 127000, qty: 2, minStock: 3,
        serialTracking: 1, warranty: 36,
        img: '/src/assets/images/product_motherboard_1795590054007.jpg',
        desc: 'LGA1700 ATX gaming motherboard with PCIe 5.0, WiFi 7, and 5x M.2 slots.'
      },
      {
        name: 'AMD Ryzen 7 7800X3D Processor',
        brandId: 3, categoryId: 2, model: '100-100000910WOF', sku: 'CPU-AMD-7800X3D',
        barcode: '730143314930', qr: 'PRODQR:CPU-AMD-7800X3D',
        purchase: 108000, sale: 121000, wholesale: 116500, qty: 3, minStock: 4,
        serialTracking: 1, warranty: 36,
        img: '',
        desc: '8-Core, 16-Thread AM5 processor with 96MB 3D V-Cache.'
      },
      {
        name: 'MSI GeForce RTX 4070 SUPER 12G Ventus 3X OC',
        brandId: 6, categoryId: 5, model: 'RTX4070S-V3X-12G', sku: 'GPU-MSI-4070S',
        barcode: '4711377154901', qr: 'PRODQR:GPU-MSI-4070S',
        purchase: 189000, sale: 208000, wholesale: 201000, qty: 2, minStock: 3,
        serialTracking: 1, warranty: 24,
        img: '',
        desc: '12GB GDDR6X triple-fan NVIDIA Ada Lovelace graphics card.'
      },
      {
        name: 'Kingston Fury Beast 16GB DDR4-3200 Desktop RAM',
        brandId: 7, categoryId: 3, model: 'KF432C16BB1/16', sku: 'RAM-KIN-16G-D4',
        barcode: '740617319873', qr: 'PRODQR:RAM-KIN-16G-D4',
        purchase: 9200, sale: 11500, wholesale: 10600, qty: 14, minStock: 6,
        serialTracking: 1, warranty: 60,
        img: '',
        desc: 'Single 16GB DDR4-3200 CL16 low-profile heatspreader module.'
      },
      {
        name: 'WD Black 2TB 7200RPM Performance Desktop HDD',
        brandId: 8, categoryId: 1, model: 'WD2003FZEX', sku: 'HDD-WD-BLK-2TB',
        barcode: '718037806143', qr: 'PRODQR:HDD-WD-BLK-2TB',
        purchase: 17500, sale: 21000, wholesale: 19800, qty: 0, minStock: 4,
        serialTracking: 1, warranty: 24,
        img: '',
        desc: '3.5-inch SATA 6Gb/s 7200 RPM 64MB cache internal hard drive.'
      },
      {
        name: 'Corsair RM850e 850W 80+ Gold Fully Modular PSU',
        brandId: 4, categoryId: 6, model: 'CP-9020263-EU', sku: 'PSU-COR-RM850E',
        barcode: '840006661998', qr: 'PRODQR:PSU-COR-RM850E',
        purchase: 31000, sale: 36500, wholesale: 34500, qty: 7, minStock: 3,
        serialTracking: 1, warranty: 84,
        img: '',
        desc: 'ATX 3.0 & PCIe 5.0 compliant low-noise modular power supply.'
      },
      {
        name: 'Logitech G Pro X Superlight Wireless Mouse',
        brandId: 9, categoryId: 7, model: '910-005878', sku: 'PER-LOG-GPXSL',
        barcode: '097855159878', qr: 'PRODQR:PER-LOG-GPXSL',
        purchase: 26500, sale: 32000, wholesale: 29800, qty: 9, minStock: 4,
        serialTracking: 0, warranty: 12,
        img: '',
        desc: 'Ultra-lightweight 63g HERO 25K wireless esports mouse.'
      }
    ];

    const insertProduct = db.prepare(`
      INSERT INTO products (
        name, brand_id, category_id, model, sku, barcode, qr_code,
        purchase_price, sale_price, wholesale_price, quantity, min_stock,
        serial_tracking, warranty_months, image_url, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLocStock = db.prepare('INSERT INTO product_location_stock (product_id, location_id, quantity) VALUES (?, ?, ?)');
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        product_id, location_id, user_id, previous_qty, change_qty, new_qty,
        movement_type, reference_type, reference_id, reference_no, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSerial = db.prepare(`
      INSERT INTO serial_numbers (
        serial_number, serial_qr, product_id, location_id, purchase_id, supplier_id,
        purchase_date, purchase_price, status, warranty_months, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const seedPurchaseDate = daysAgoIso(12, 11);
    const insertPurchase = db.prepare(`
      INSERT INTO purchases (
        invoice_no, supplier_id, location_id, user_id, purchase_date,
        subtotal, discount, tax, total, paid_amount, payment_status, notes, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 'completed', ?)
    `);
    insertPurchase.run('PUR-2026-0001', 1, 1, 1, seedPurchaseDate, 1480000, 1480000, 1480000, 'paid', 'Initial flagship hardware stock batch', seedPurchaseDate);
    insertPurchase.run('PUR-2026-0002', 2, 1, 1, daysAgoIso(5, 16), 750000, 750000, 500000, 'partial', 'GPU and Motherboard restock batch', daysAgoIso(5, 16));

    const insertPurchaseItem = db.prepare(`
      INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, total_cost, returned_qty)
      VALUES (?, ?, ?, ?, ?, 0)
    `);

    productsData.forEach((p, idx) => {
      const productId = idx + 1;
      insertProduct.run(
        p.name, p.brandId, p.categoryId, p.model, p.sku, p.barcode, p.qr,
        p.purchase, p.sale, p.wholesale, p.qty, p.minStock,
        p.serialTracking, p.warranty, p.img, p.desc, seedPurchaseDate, now
      );

      // Put all in Main Counter except a split for Kingston RAM & Corsair PSU
      if (productId === 7) {
        insertLocStock.run(productId, 1, 10);
        insertLocStock.run(productId, 2, 4);
        insertLocStock.run(productId, 3, 0);
      } else if (productId === 9) {
        insertLocStock.run(productId, 1, 5);
        insertLocStock.run(productId, 2, 2);
        insertLocStock.run(productId, 3, 0);
      } else {
        insertLocStock.run(productId, 1, p.qty);
        insertLocStock.run(productId, 2, 0);
        insertLocStock.run(productId, 3, 0);
      }

      if (p.qty > 0) {
        insertMovement.run(
          productId, 1, 1, 0, p.qty, p.qty,
          'initial', 'purchase', 1, 'PUR-2026-0001', 'Opening inventory stock', seedPurchaseDate
        );
        insertPurchaseItem.run(1, productId, p.qty, p.purchase, p.qty * p.purchase);
      }

      if (p.serialTracking === 1 && p.qty > 0) {
        const prefix = p.sku.split('-').slice(0, 2).join('');
        for (let i = 1; i <= p.qty; i++) {
          const sn = `${prefix}-26-${String(productId).padStart(2, '0')}${String(i).padStart(4, '0')}`;
          const locId = (productId === 7 && i > 10) || (productId === 9 && i > 5) ? 2 : 1;
          insertSerial.run(
            sn,
            `SERQR:${productId}:${sn}`,
            productId,
            locId,
            1,
            productId % 2 === 0 ? 2 : 1,
            seedPurchaseDate,
            p.purchase,
            'available',
            p.warranty,
            'Verified sealed unit',
            seedPurchaseDate,
            seedPurchaseDate
          );
        }
      }
    });

    // Seed 3 completed sales (including 1 today) so Dashboard, Profit, Forecasting, Serial History work immediately
    const insertSale = db.prepare(`
      INSERT INTO sales (
        invoice_no, customer_id, location_id, user_id, sale_date,
        subtotal, discount, tax, total, paid_amount, payment_method, payment_status, notes, status, created_at
      ) VALUES (?, ?, 1, 1, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'completed', ?)
    `);
    const insertSaleItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, unit_cost, discount, total_price, returned_qty)
      VALUES (?, ?, ?, ?, ?, 0, ?, 0)
    `);
    const insertPayment = db.prepare(`
      INSERT INTO payments (
        party_type, party_id, invoice_type, invoice_id, invoice_no, amount,
        payment_method, payment_date, notes, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const sale1Date = daysAgoIso(3, 15);
    insertSale.run('INV-2026-0001', 2, sale1Date, 203400, 0, 203400, 203400, 'bank', 'paid', 'Workstation upgrade order', sale1Date);
    insertSaleItem.run(1, 1, 1, 28900, 24500, 28900);
    insertSaleItem.run(1, 2, 1, 174500, 158000, 174500);
    insertPayment.run('customer', 2, 'sale', 1, 'INV-2026-0001', 203400, 'bank', sale1Date, 'Bank transfer settled', sale1Date);

    // Sold serials for sale 1
    db.prepare(`
      INSERT INTO serial_numbers (
        serial_number, serial_qr, product_id, location_id, purchase_id, supplier_id,
        purchase_date, purchase_price, sale_id, sale_item_id, customer_id, sale_date,
        status, warranty_months, warranty_expiry, notes, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 1, 1, ?, ?, 1, 1, 2, ?, 'sold', 36, ?, 'Sold on INV-2026-0001', ?, ?)
    `).run('SSDSAM-26-010099', 'SERQR:1:SSDSAM-26-010099', 1, seedPurchaseDate, 24500, sale1Date, addMonthsIso(sale1Date, 36), seedPurchaseDate, sale1Date);

    db.prepare(`
      INSERT INTO serial_numbers (
        serial_number, serial_qr, product_id, location_id, purchase_id, supplier_id,
        purchase_date, purchase_price, sale_id, sale_item_id, customer_id, sale_date,
        status, warranty_months, warranty_expiry, notes, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 1, 2, ?, ?, 1, 2, 2, ?, 'sold', 36, ?, 'Sold on INV-2026-0001', ?, ?)
    `).run('CPUINT-26-020099', 'SERQR:2:CPUINT-26-020099', 2, seedPurchaseDate, 158000, sale1Date, addMonthsIso(sale1Date, 36), seedPurchaseDate, sale1Date);

    const sale2Date = daysAgoIso(1, 17);
    insertSale.run('INV-2026-0002', 3, sale2Date, 208000, 3000, 205000, 150000, 'cash', 'partial', 'Partial credit invoice for studio build', sale2Date);
    insertSaleItem.run(2, 6, 1, 208000, 189000, 208000);
    insertPayment.run('customer', 3, 'sale', 2, 'INV-2026-0002', 150000, 'cash', sale2Date, 'Advance cash payment', sale2Date);
    db.prepare(`
      INSERT INTO serial_numbers (
        serial_number, serial_qr, product_id, location_id, purchase_id, supplier_id,
        purchase_date, purchase_price, sale_id, sale_item_id, customer_id, sale_date,
        status, warranty_months, warranty_expiry, notes, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 2, 2, ?, ?, 2, 3, 3, ?, 'sold', 24, ?, 'Sold on INV-2026-0002', ?, ?)
    `).run('GPUMSI-26-060099', 'SERQR:6:GPUMSI-26-060099', 6, daysAgoIso(5, 16), 189000, sale2Date, addMonthsIso(sale2Date, 24), daysAgoIso(5, 16), sale2Date);

    const sale3Date = daysAgoIso(0, 11);
    insertSale.run('INV-2026-0003', 1, sale3Date, 76500, 0, 76500, 76500, 'cash', 'paid', 'Counter retail sale', sale3Date);
    insertSaleItem.run(3, 3, 1, 44500, 38000, 44500);
    insertSaleItem.run(3, 10, 1, 32000, 26500, 32000);
    insertPayment.run('customer', 1, 'sale', 3, 'INV-2026-0003', 76500, 'cash', sale3Date, 'Cash counter settlement', sale3Date);
    db.prepare(`
      INSERT INTO serial_numbers (
        serial_number, serial_qr, product_id, location_id, purchase_id, supplier_id,
        purchase_date, purchase_price, sale_id, sale_item_id, customer_id, sale_date,
        status, warranty_months, warranty_expiry, notes, created_at, updated_at
      ) VALUES (?, ?, ?, 1, 1, 1, ?, ?, 3, 4, 1, ?, 'sold', 60, ?, 'Sold on INV-2026-0003', ?, ?)
    `).run('RAMCOR-26-030099', 'SERQR:3:RAMCOR-26-030099', 3, seedPurchaseDate, 38000, sale3Date, addMonthsIso(sale3Date, 60), seedPurchaseDate, sale3Date);

    // Supplier payment for PUR-2026-0001 and partial for PUR-2026-0002
    insertPayment.run('supplier', 1, 'purchase', 1, 'PUR-2026-0001', 1480000, 'bank', seedPurchaseDate, 'Settled distributor invoice', seedPurchaseDate);
    insertPayment.run('supplier', 2, 'purchase', 2, 'PUR-2026-0002', 500000, 'bank', daysAgoIso(5, 16), 'Partial payment on GPU shipment', daysAgoIso(5, 16));

    // Seed 2 shop expenses
    const insertExpense = db.prepare('INSERT INTO expenses (category, title, amount, expense_date, payment_method, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
    insertExpense.run('Utilities', 'Shop Electricity & Backup UPS', 18500, daysAgoIso(2, 10), 'cash', 'Monthly plaza meter bill', daysAgoIso(2, 10));
    insertExpense.run('Logistics', 'Courier & Hardware Packaging', 3400, daysAgoIso(0, 10), 'cash', 'Thermal labels & bubble wrap', daysAgoIso(0, 10));

    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}
