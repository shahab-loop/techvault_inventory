export interface User {
  id: number;
  name: string;
  role: 'Admin' | 'Manager' | 'Cashier';
  active: number;
  created_at: string;
}

export interface Category {
  id: number;
  name: string;
  description: string;
}

export interface Brand {
  id: number;
  name: string;
}

export interface Location {
  id: number;
  name: string;
  code: string;
  address: string;
  is_default: number;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  total_purchases?: number;
  total_paid?: number;
  outstanding_balance?: number;
  invoice_count?: number;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  total_purchases?: number;
  total_paid?: number;
  outstanding_balance?: number;
  invoice_count?: number;
}

export interface LocationStock {
  product_id: number;
  location_id: number;
  quantity: number;
  location_name: string;
  location_code: string;
}

export interface Product {
  id: number;
  name: string;
  brand_id: number | null;
  category_id: number | null;
  brand_name?: string;
  category_name?: string;
  model: string;
  sku: string;
  barcode: string | null;
  qr_code: string;
  purchase_price: number;
  sale_price: number;
  wholesale_price: number;
  quantity: number;
  min_stock: number;
  serial_tracking: number;
  warranty_months: number;
  image_url: string;
  description: string;
  available_serials_count?: number;
  location_stocks?: LocationStock[];
  created_at: string;
  updated_at: string;
}

export interface SerialRecord {
  id: number;
  serial_number: string;
  serial_qr: string;
  product_id: number;
  product_name?: string;
  product_model?: string;
  product_sku?: string;
  product_sale_price?: number;
  location_id: number | null;
  location_name?: string;
  purchase_id: number | null;
  purchase_invoice_no?: string;
  supplier_id: number | null;
  supplier_name?: string;
  purchase_date: string | null;
  purchase_price: number;
  sale_id: number | null;
  sale_invoice_no?: string;
  customer_id: number | null;
  customer_name?: string;
  sale_date: string | null;
  status: 'available' | 'sold' | 'returned' | 'under_warranty' | 'damaged';
  warranty_months: number;
  warranty_expiry: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: number;
  product_id: number;
  product_name?: string;
  product_sku?: string;
  product_model?: string;
  location_id: number | null;
  location_name?: string;
  user_id: number | null;
  user_name?: string;
  previous_qty: number;
  change_qty: number;
  new_qty: number;
  movement_type: string;
  reference_type: string;
  reference_id: number | null;
  reference_no: string;
  notes: string;
  created_at: string;
}

export interface SaleInvoice {
  id: number;
  invoice_no: string;
  customer_id: number | null;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  location_id: number | null;
  location_name?: string;
  user_id: number | null;
  user_name?: string;
  sale_date: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid_amount: number;
  payment_method: string;
  payment_status: 'paid' | 'partial' | 'unpaid';
  notes: string;
  status: 'completed' | 'returned' | 'cancelled';
}

export interface PurchaseInvoice {
  id: number;
  invoice_no: string;
  supplier_id: number | null;
  supplier_name?: string;
  supplier_phone?: string;
  location_id: number | null;
  location_name?: string;
  user_id: number | null;
  user_name?: string;
  purchase_date: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid_amount: number;
  payment_status: 'paid' | 'partial' | 'unpaid';
  notes: string;
  status: 'completed' | 'returned' | 'cancelled';
}

export interface BackupRecord {
  id: number;
  filename: string;
  file_path: string;
  size_bytes: number;
  backup_type: 'manual' | 'auto';
  created_at: string;
}

export interface AppSettings {
  shop_name: string;
  shop_address: string;
  shop_phone: string;
  shop_logo: string;
  currency: string;
  date_format: string;
  invoice_prefix: string;
  purchase_prefix: string;
  tax_rate: string;
  default_printer: 'A4' | '80mm' | '58mm';
  allow_negative_stock: string;
  low_stock_default: string;
  backup_location: string;
  auto_backup_interval: string;
  warranty_terms: string;
  invoice_terms: string;
  [key: string]: string;
}

export interface BootstrapData {
  users: User[];
  settings: AppSettings;
  categories: Category[];
  brands: Brand[];
  locations: Location[];
  customers: Customer[];
  suppliers: Supplier[];
}

export type AppView =
  | 'dashboard'
  | 'quick-stock'
  | 'pos'
  | 'products'
  | 'purchases'
  | 'serials'
  | 'history'
  | 'parties'
  | 'reports'
  | 'settings';
