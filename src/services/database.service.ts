import { DynamoDBService } from "./dynamodb.service";
import { OrderData, ResolverCommitment } from "../types";


export class DatabaseService {
  private dynamodb: DynamoDBService;
  
  constructor() {
    console.log("[Database] Initializing DynamoDB-based database service");
    this.dynamodb = new DynamoDBService();
  }
  
  async initialize(): Promise<void> {
    await this.dynamodb.initialize();
  }
  
  // Order Management
  async saveOrder(order: OrderData): Promise<void> {
    await this.dynamodb.saveOrder(order);
  }
  
  async getOrder(orderId: string): Promise<OrderData | null> {
    return await this.dynamodb.getOrder(orderId);
  }
  
  async getAllActiveOrders(): Promise<OrderData[]> {
    return await this.dynamodb.getAllActiveOrders();
  }
  
  async getOrdersByStatus(status: string): Promise<OrderData[]> {
    return await this.dynamodb.getOrdersByStatus(status);
  }
  
  async getExpiredOrders(now: number): Promise<OrderData[]> {
    return await this.dynamodb.getExpiredOrders(now);
  }
  
  async getOrdersWithExpiredCommitments(now: number): Promise<OrderData[]> {
    return await this.dynamodb.getOrdersWithExpiredCommitments(now);
  }
  
  async getOrdersPendingSecretReveal(now: number): Promise<OrderData[]> {
    return await this.dynamodb.getOrdersPendingSecretReveal(now);
  }
  
  // Secret Management
  async saveSecret(orderId: string, secretHash: string, secret: string): Promise<void> {
    await this.dynamodb.saveSecret(orderId, secretHash, secret);
  }
  
  // SDK Order Data Management
  async saveSDKOrderData(orderId: string, orderData: any, extension: string): Promise<void> {
    // For now, we store this as part of the order data
    // In a production system, this might be stored separately
    const order = await this.getOrder(orderId);
    if (order) {
      order.sdkOrder = { orderData, extension, orderHash: orderId };
      await this.saveOrder(order);
    }
  }
  
  async getSecret(orderId: string): Promise<string | null> {
    return await this.dynamodb.getSecret(orderId);
  }
  
  async markSecretRevealed(orderId: string): Promise<void> {
    await this.dynamodb.markSecretRevealed(orderId);
  }
  
  async deleteSecret(orderId: string): Promise<void> {
    await this.dynamodb.deleteSecret(orderId);
  }
  
  // Resolver Commitment Management
  async saveResolverCommitment(commitment: ResolverCommitment): Promise<void> {
    await this.dynamodb.saveResolverCommitment(commitment);
  }
  
  async getResolverCommitments(orderId: string): Promise<ResolverCommitment[]> {
    return await this.dynamodb.getResolverCommitments(orderId);
  }
  
  async updateCommitmentStatus(orderId: string, resolverAddress: string, status: string): Promise<void> {
    await this.dynamodb.updateCommitmentStatus(orderId, resolverAddress, status);
  }
  
  // Order History
  async addOrderHistory(orderId: string, action: string, details?: string): Promise<void> {
    await this.dynamodb.addOrderHistory(orderId, action, details);
  }
  
  async getOrderHistory(orderId: string): Promise<any[]> {
    return await this.dynamodb.getOrderHistory(orderId);
  }
  
  // Analytics
  async getOrderStats(): Promise<any> {
    return await this.dynamodb.getOrderStats();
  }
  
  async getResolverStats(resolverAddress: string): Promise<any> {
    return await this.dynamodb.getResolverStats(resolverAddress);
  }
  
  // Cleanup
  async cleanupOldOrders(daysToKeep: number = 30): Promise<number> {
    return await this.dynamodb.cleanupOldOrders(daysToKeep);
  }
  
  
  // Graceful shutdown
  async close(): Promise<void> {
    await this.dynamodb.close();
  }
}