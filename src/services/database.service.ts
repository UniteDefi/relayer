import { Database } from "sqlite3";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { OrderData, ResolverCommitment } from "../types";

interface OrderRecord {
  order_id: string;
  swap_request: string;
  market_price: string;
  status: string;
  resolver_address?: string;
  created_at: number;
  expires_at: number;
  auction_start_price: string;
  auction_end_price: string;
  auction_duration: number;
  committed_price?: string;
  commitment_time?: number;
  commitment_deadline?: number;
  src_escrow_address?: string;
  dst_escrow_address?: string;
  user_funds_moved: number;
  user_funds_moved_at?: number;
  settlement_tx?: string;
  secret_revealed_at?: number;
  secret_reveal_tx_hash?: string;
  updated_at: number;
}

interface ResolverCommitmentRecord {
  id?: number;
  order_id: string;
  resolver_address: string;
  accepted_price: string;
  timestamp: number;
  status: string; // 'active', 'completed', 'failed'
  created_at: number;
}

interface SecretRecord {
  order_id: string;
  secret_hash: string;
  secret: string;
  created_at: number;
  revealed_at?: number;
}

export class DatabaseService {
  private db: Database;
  private dbPath: string;
  
  // Promisified database methods
  private run: (sql: string, params?: any[]) => Promise<void>;
  private get: (sql: string, params?: any[]) => Promise<any>;
  private all: (sql: string, params?: any[]) => Promise<any[]>;
  
  constructor(dbPath?: string) {
    // Use provided path or default to data directory
    this.dbPath = dbPath || path.join(process.cwd(), "data", "relayer.db");
    
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    console.log(`[Database] Initializing SQLite database at: ${this.dbPath}`);
    
    // Initialize database connection
    this.db = new Database(this.dbPath);
    
    // Promisify database methods
    this.run = promisify(this.db.run.bind(this.db));
    this.get = promisify(this.db.get.bind(this.db));
    this.all = promisify(this.db.all.bind(this.db));
  }
  
  async initialize(): Promise<void> {
    console.log("[Database] Creating tables if not exist...");
    
    // Enable foreign keys
    await this.run("PRAGMA foreign_keys = ON");
    
    // Create orders table
    await this.run(`
      CREATE TABLE IF NOT EXISTS orders (
        order_id TEXT PRIMARY KEY,
        swap_request TEXT NOT NULL,
        market_price TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active', 'committed', 'settling', 'completed', 'failed', 'rescue_available')),
        resolver_address TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        auction_start_price TEXT NOT NULL,
        auction_end_price TEXT NOT NULL,
        auction_duration INTEGER NOT NULL,
        committed_price TEXT,
        commitment_time INTEGER,
        commitment_deadline INTEGER,
        src_escrow_address TEXT,
        dst_escrow_address TEXT,
        user_funds_moved INTEGER DEFAULT 0,
        user_funds_moved_at INTEGER,
        settlement_tx TEXT,
        secret_revealed_at INTEGER,
        secret_reveal_tx_hash TEXT,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // Create indexes for efficient queries
    await this.run(`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_orders_expires_at ON orders(expires_at)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_orders_resolver ON orders(resolver_address)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_orders_commitment_deadline ON orders(commitment_deadline)`);
    
    // Create resolver commitments table for audit trail
    await this.run(`
      CREATE TABLE IF NOT EXISTS resolver_commitments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        resolver_address TEXT NOT NULL,
        accepted_price TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(order_id)
      )
    `);
    
    await this.run(`CREATE INDEX IF NOT EXISTS idx_commitments_order_id ON resolver_commitments(order_id)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_commitments_resolver ON resolver_commitments(resolver_address)`);
    
    // Create secrets table (for secure storage)
    await this.run(`
      CREATE TABLE IF NOT EXISTS secrets (
        order_id TEXT PRIMARY KEY,
        secret_hash TEXT NOT NULL,
        secret TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        revealed_at INTEGER,
        FOREIGN KEY (order_id) REFERENCES orders(order_id)
      )
    `);
    
    // Create order history table for audit trail
    await this.run(`
      CREATE TABLE IF NOT EXISTS order_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(order_id)
      )
    `);
    
    await this.run(`CREATE INDEX IF NOT EXISTS idx_history_order_id ON order_history(order_id)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_history_timestamp ON order_history(timestamp)`);
    
    console.log("[Database] Tables created successfully");
  }
  
  // Order Management
  async saveOrder(order: OrderData): Promise<void> {
    const swapRequestJson = JSON.stringify(order.swapRequest);
    const settlementTxJson = order.settlementTx ? JSON.stringify(order.settlementTx) : null;
    const now = Date.now();
    
    await this.run(`
      INSERT OR REPLACE INTO orders (
        order_id, swap_request, market_price, status, resolver_address,
        created_at, expires_at, auction_start_price, auction_end_price, auction_duration,
        committed_price, commitment_time, commitment_deadline,
        src_escrow_address, dst_escrow_address,
        user_funds_moved, user_funds_moved_at, settlement_tx,
        secret_revealed_at, secret_reveal_tx_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      order.orderId,
      swapRequestJson,
      order.marketPrice,
      order.status,
      order.resolver || null,
      order.createdAt,
      order.expiresAt,
      order.auctionStartPrice,
      order.auctionEndPrice,
      order.auctionDuration,
      order.committedPrice || null,
      order.commitmentTime || null,
      order.commitmentDeadline || null,
      order.srcEscrowAddress || null,
      order.dstEscrowAddress || null,
      order.userFundsMoved ? 1 : 0,
      order.userFundsMovedAt || null,
      settlementTxJson,
      order.secretRevealedAt || null,
      order.secretRevealTxHash || null,
      now
    ]);
    
    // Log to history
    await this.addOrderHistory(order.orderId, `Order ${order.status}`, JSON.stringify({
      status: order.status,
      resolver: order.resolver,
      committedPrice: order.committedPrice
    }));
  }
  
  async getOrder(orderId: string): Promise<OrderData | null> {
    const record = await this.get("SELECT * FROM orders WHERE order_id = ?", [orderId]);
    
    if (!record) {
      return null;
    }
    
    return this.recordToOrderData(record);
  }
  
  async getAllActiveOrders(): Promise<OrderData[]> {
    const records = await this.all(
      "SELECT * FROM orders WHERE status IN ('active', 'rescue_available') ORDER BY created_at DESC"
    );
    
    return records.map(record => this.recordToOrderData(record));
  }
  
  async getOrdersByStatus(status: string): Promise<OrderData[]> {
    const records = await this.all(
      "SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC",
      [status]
    );
    
    return records.map(record => this.recordToOrderData(record));
  }
  
  async getExpiredOrders(now: number): Promise<OrderData[]> {
    const records = await this.all(
      "SELECT * FROM orders WHERE status = 'active' AND expires_at < ?",
      [now]
    );
    
    return records.map(record => this.recordToOrderData(record));
  }
  
  async getOrdersWithExpiredCommitments(now: number): Promise<OrderData[]> {
    const records = await this.all(
      "SELECT * FROM orders WHERE status = 'committed' AND commitment_deadline < ?",
      [now]
    );
    
    return records.map(record => this.recordToOrderData(record));
  }
  
  async getOrdersPendingSecretReveal(now: number): Promise<OrderData[]> {
    const records = await this.all(
      "SELECT * FROM orders WHERE status = 'settling' AND settlement_tx IS NOT NULL AND secret_revealed_at IS NULL AND user_funds_moved_at < ?",
      [now - 120000] // 2 minutes ago
    );
    
    return records.map(record => this.recordToOrderData(record));
  }
  
  // Secret Management
  async saveSecret(orderId: string, secretHash: string, secret: string): Promise<void> {
    await this.run(`
      INSERT INTO secrets (order_id, secret_hash, secret, created_at)
      VALUES (?, ?, ?, ?)
    `, [orderId, secretHash, secret, Date.now()]);
  }
  
  async getSecret(orderId: string): Promise<string | null> {
    const record = await this.get(
      "SELECT secret FROM secrets WHERE order_id = ?",
      [orderId]
    );
    
    return record?.secret || null;
  }
  
  async markSecretRevealed(orderId: string): Promise<void> {
    await this.run(
      "UPDATE secrets SET revealed_at = ? WHERE order_id = ?",
      [Date.now(), orderId]
    );
  }
  
  async deleteSecret(orderId: string): Promise<void> {
    await this.run("DELETE FROM secrets WHERE order_id = ?", [orderId]);
  }
  
  // Resolver Commitment Management
  async saveResolverCommitment(commitment: ResolverCommitment): Promise<void> {
    await this.run(`
      INSERT INTO resolver_commitments (
        order_id, resolver_address, accepted_price, timestamp, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      commitment.orderId,
      commitment.resolverAddress,
      commitment.acceptedPrice,
      commitment.timestamp,
      Date.now()
    ]);
  }
  
  async getResolverCommitments(orderId: string): Promise<ResolverCommitment[]> {
    const records = await this.all(
      "SELECT * FROM resolver_commitments WHERE order_id = ? ORDER BY timestamp DESC",
      [orderId]
    );
    
    return records.map(record => ({
      orderId: record.order_id,
      resolverAddress: record.resolver_address,
      acceptedPrice: record.accepted_price,
      timestamp: record.timestamp
    }));
  }
  
  async updateCommitmentStatus(orderId: string, resolverAddress: string, status: string): Promise<void> {
    await this.run(
      "UPDATE resolver_commitments SET status = ? WHERE order_id = ? AND resolver_address = ?",
      [status, orderId, resolverAddress]
    );
  }
  
  // Order History
  async addOrderHistory(orderId: string, action: string, details?: string): Promise<void> {
    await this.run(`
      INSERT INTO order_history (order_id, action, details, timestamp)
      VALUES (?, ?, ?, ?)
    `, [orderId, action, details || null, Date.now()]);
  }
  
  async getOrderHistory(orderId: string): Promise<any[]> {
    return await this.all(
      "SELECT * FROM order_history WHERE order_id = ? ORDER BY timestamp DESC",
      [orderId]
    );
  }
  
  // Analytics
  async getOrderStats(): Promise<any> {
    const stats = await this.get(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_orders,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_orders,
        COUNT(CASE WHEN status = 'rescue_available' THEN 1 END) as rescue_available_orders
      FROM orders
    `);
    
    return stats;
  }
  
  async getResolverStats(resolverAddress: string): Promise<any> {
    const stats = await this.get(`
      SELECT 
        COUNT(*) as total_commitments,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_trades,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_trades
      FROM resolver_commitments
      WHERE resolver_address = ?
    `, [resolverAddress]);
    
    return stats;
  }
  
  // Cleanup
  async cleanupOldOrders(daysToKeep: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    // Delete old completed/failed orders
    await this.run(
      "DELETE FROM orders WHERE status IN ('completed', 'failed') AND updated_at < ?",
      [cutoffTime]
    );
    
    const changes = this.db.changes;
    console.log(`[Database] Cleaned up ${changes} old orders`);
    return changes;
  }
  
  // Helper to convert database record to OrderData
  private recordToOrderData(record: OrderRecord): OrderData {
    return {
      orderId: record.order_id,
      swapRequest: JSON.parse(record.swap_request),
      marketPrice: record.market_price,
      status: record.status as any,
      resolver: record.resolver_address,
      createdAt: record.created_at,
      expiresAt: record.expires_at,
      auctionStartPrice: record.auction_start_price,
      auctionEndPrice: record.auction_end_price,
      auctionDuration: record.auction_duration,
      committedPrice: record.committed_price,
      commitmentTime: record.commitment_time,
      commitmentDeadline: record.commitment_deadline,
      srcEscrowAddress: record.src_escrow_address,
      dstEscrowAddress: record.dst_escrow_address,
      userFundsMoved: record.user_funds_moved === 1,
      userFundsMovedAt: record.user_funds_moved_at,
      settlementTx: record.settlement_tx ? JSON.parse(record.settlement_tx) : undefined,
      secretRevealedAt: record.secret_revealed_at,
      secretRevealTxHash: record.secret_reveal_tx_hash
    };
  }
  
  // Graceful shutdown
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          console.error("[Database] Error closing database:", err);
          reject(err);
        } else {
          console.log("[Database] Database connection closed");
          resolve();
        }
      });
    });
  }
}