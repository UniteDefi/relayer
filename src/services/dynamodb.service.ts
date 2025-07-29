import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  BatchWriteCommand
} from "@aws-sdk/lib-dynamodb";
import { OrderData, ResolverCommitment } from "../types";

interface TradeItem {
  tradeId: string;
  swapRequest: any;
  marketPrice: string;
  status: string;
  resolver?: string;
  createdAt: number;
  expiresAt: number;
  auctionStartPrice: string;
  auctionEndPrice: string;
  auctionDuration: number;
  committedPrice?: string;
  commitmentTime?: number;
  commitmentDeadline?: number;
  srcEscrowAddress?: string;
  dstEscrowAddress?: string;
  userFundsMoved?: boolean;
  userFundsMovedAt?: number;
  settlementTx?: any;
  secretRevealedAt?: number;
  secretRevealTxHash?: string;
  updatedAt: number;
  secret?: string;
  secretHash?: string;
  secretCreatedAt?: number;
  secretRevealedAt?: number;
}

interface ResolverCommitmentItem {
  commitment_id: string;
  tradeId: string;
  resolverAddress: string;
  acceptedPrice: string;
  timestamp: number;
  status: string;
  createdAt: number;
}

export class DynamoDBService {
  private client: DynamoDBClient;
  private docClient: DynamoDBDocumentClient;
  private tradesTableName: string = "Trades";
  private commitmentsTableName: string = "ResolverCommitments";
  
  constructor() {
    console.log("[DynamoDB] Initializing DynamoDB client...");
    
    // Initialize DynamoDB client
    this.client = new DynamoDBClient({
      region: process.env.AWS_REGION || "us-east-1"
    });
    
    // Create document client with marshalling options
    this.docClient = DynamoDBDocumentClient.from(this.client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false
      }
    });
  }
  
  async initialize(): Promise<void> {
    console.log("[DynamoDB] Creating tables if not exist...");
    
    // Create Trades table
    await this.createTableIfNotExists(this.tradesTableName, {
      TableName: this.tradesTableName,
      KeySchema: [
        { AttributeName: "tradeId", KeyType: "HASH" }
      ],
      AttributeDefinitions: [
        { AttributeName: "tradeId", AttributeType: "S" },
        { AttributeName: "status", AttributeType: "S" },
        { AttributeName: "createdAt", AttributeType: "N" },
        { AttributeName: "expiresAt", AttributeType: "N" },
        { AttributeName: "commitmentDeadline", AttributeType: "N" },
        { AttributeName: "resolver", AttributeType: "S" }
      ],
      BillingMode: "PAY_PER_REQUEST",
      GlobalSecondaryIndexes: [
        {
          IndexName: "StatusCreatedAtIndex",
          KeySchema: [
            { AttributeName: "status", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "StatusExpiresAtIndex",
          KeySchema: [
            { AttributeName: "status", KeyType: "HASH" },
            { AttributeName: "expiresAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "StatusCommitmentDeadlineIndex",
          KeySchema: [
            { AttributeName: "status", KeyType: "HASH" },
            { AttributeName: "commitmentDeadline", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "ResolverIndex",
          KeySchema: [
            { AttributeName: "resolver", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    });
    
    // Create ResolverCommitments table
    await this.createTableIfNotExists(this.commitmentsTableName, {
      TableName: this.commitmentsTableName,
      KeySchema: [
        { AttributeName: "commitment_id", KeyType: "HASH" },
        { AttributeName: "tradeId", KeyType: "RANGE" }
      ],
      AttributeDefinitions: [
        { AttributeName: "commitment_id", AttributeType: "S" },
        { AttributeName: "tradeId", AttributeType: "S" },
        { AttributeName: "resolverAddress", AttributeType: "S" },
        { AttributeName: "timestamp", AttributeType: "N" }
      ],
      BillingMode: "PAY_PER_REQUEST",
      GlobalSecondaryIndexes: [
        {
          IndexName: "TradeIdIndex",
          KeySchema: [
            { AttributeName: "tradeId", KeyType: "HASH" },
            { AttributeName: "timestamp", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "ResolverAddressIndex",
          KeySchema: [
            { AttributeName: "resolverAddress", KeyType: "HASH" },
            { AttributeName: "timestamp", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    });
    
    console.log("[DynamoDB] Tables ready");
  }
  
  private async createTableIfNotExists(tableName: string, params: any): Promise<void> {
    try {
      // Check if table exists
      await this.client.send(new DescribeTableCommand({ TableName: tableName }));
      console.log(`[DynamoDB] Table ${tableName} already exists`);
    } catch (error: any) {
      if (error instanceof ResourceNotFoundException) {
        // Table doesn't exist, create it
        console.log(`[DynamoDB] Creating table ${tableName}...`);
        await this.client.send(new CreateTableCommand(params));
        
        // Wait for table to be active
        let tableActive = false;
        while (!tableActive) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const response = await this.client.send(new DescribeTableCommand({ TableName: tableName }));
          tableActive = response.Table?.TableStatus === "ACTIVE";
        }
        console.log(`[DynamoDB] Table ${tableName} created successfully`);
      } else {
        throw error;
      }
    }
  }
  
  // Order Management
  async saveOrder(order: OrderData): Promise<void> {
    const now = Date.now();
    
    const item: TradeItem = {
      tradeId: order.orderId,
      swapRequest: order.swapRequest,
      marketPrice: order.marketPrice,
      status: order.status,
      resolver: order.resolver,
      createdAt: order.createdAt,
      expiresAt: order.expiresAt,
      auctionStartPrice: order.auctionStartPrice,
      auctionEndPrice: order.auctionEndPrice,
      auctionDuration: order.auctionDuration,
      committedPrice: order.committedPrice,
      commitmentTime: order.commitmentTime,
      commitmentDeadline: order.commitmentDeadline,
      srcEscrowAddress: order.srcEscrowAddress,
      dstEscrowAddress: order.dstEscrowAddress,
      userFundsMoved: order.userFundsMoved,
      userFundsMovedAt: order.userFundsMovedAt,
      settlementTx: order.settlementTx,
      secretRevealedAt: order.secretRevealedAt,
      secretRevealTxHash: order.secretRevealTxHash,
      updatedAt: now
    };
    
    await this.docClient.send(new PutCommand({
      TableName: this.tradesTableName,
      Item: item
    }));
    
    console.log(`[DynamoDB] Order ${order.orderId} saved with status ${order.status}`);
  }
  
  async getOrder(orderId: string): Promise<OrderData | null> {
    const response = await this.docClient.send(new GetCommand({
      TableName: this.tradesTableName,
      Key: { tradeId: orderId }
    }));
    
    if (!response.Item) {
      return null;
    }
    
    return this.itemToOrderData(response.Item as TradeItem);
  }
  
  async getAllActiveOrders(): Promise<OrderData[]> {
    const activeOrders = await this.queryByStatus("active");
    const rescueOrders = await this.queryByStatus("rescue_available");
    
    return [...activeOrders, ...rescueOrders].sort((a, b) => b.createdAt - a.createdAt);
  }
  
  async getOrdersByStatus(status: string): Promise<OrderData[]> {
    return this.queryByStatus(status);
  }
  
  private async queryByStatus(status: string): Promise<OrderData[]> {
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.tradesTableName,
      IndexName: "StatusCreatedAtIndex",
      KeyConditionExpression: "#status = :status",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": status
      },
      ScanIndexForward: false // Sort by createdAt DESC
    }));
    
    return (response.Items || []).map(item => this.itemToOrderData(item as TradeItem));
  }
  
  async getExpiredOrders(now: number): Promise<OrderData[]> {
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.tradesTableName,
      IndexName: "StatusExpiresAtIndex",
      KeyConditionExpression: "#status = :status AND expiresAt < :now",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "active",
        ":now": now
      }
    }));
    
    return (response.Items || []).map(item => this.itemToOrderData(item as TradeItem));
  }
  
  async getOrdersWithExpiredCommitments(now: number): Promise<OrderData[]> {
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.tradesTableName,
      IndexName: "StatusCommitmentDeadlineIndex",
      KeyConditionExpression: "#status = :status AND commitmentDeadline < :now",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "committed",
        ":now": now
      }
    }));
    
    return (response.Items || []).map(item => this.itemToOrderData(item as TradeItem));
  }
  
  async getOrdersPendingSecretReveal(now: number): Promise<OrderData[]> {
    // Since we can't do complex filtering in DynamoDB query, we'll scan and filter
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.tradesTableName,
      IndexName: "StatusCreatedAtIndex",
      KeyConditionExpression: "#status = :status",
      ExpressionAttributeNames: {
        "#status": "status"
      },
      ExpressionAttributeValues: {
        ":status": "settling"
      }
    }));
    
    const orders = (response.Items || [])
      .map(item => this.itemToOrderData(item as TradeItem))
      .filter(order => 
        order.settlementTx && 
        !order.secretRevealedAt && 
        order.userFundsMovedAt && 
        order.userFundsMovedAt < now - 120000
      );
    
    return orders;
  }
  
  // Secret Management
  async saveSecret(orderId: string, secretHash: string, secret: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tradesTableName,
      Key: { tradeId: orderId },
      UpdateExpression: "SET #secret = :secret, secretHash = :secretHash, secretCreatedAt = :createdAt",
      ExpressionAttributeNames: {
        "#secret": "secret"
      },
      ExpressionAttributeValues: {
        ":secret": secret,
        ":secretHash": secretHash,
        ":createdAt": Date.now()
      }
    }));
  }
  
  async getSecret(orderId: string): Promise<string | null> {
    const response = await this.docClient.send(new GetCommand({
      TableName: this.tradesTableName,
      Key: { tradeId: orderId },
      ProjectionExpression: "#secret",
      ExpressionAttributeNames: {
        "#secret": "secret"
      }
    }));
    
    return response.Item?.secret || null;
  }
  
  async markSecretRevealed(orderId: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tradesTableName,
      Key: { tradeId: orderId },
      UpdateExpression: "SET secretRevealedAt = :revealedAt",
      ExpressionAttributeValues: {
        ":revealedAt": Date.now()
      }
    }));
  }
  
  async deleteSecret(orderId: string): Promise<void> {
    await this.docClient.send(new UpdateCommand({
      TableName: this.tradesTableName,
      Key: { tradeId: orderId },
      UpdateExpression: "REMOVE #secret, secretHash, secretCreatedAt",
      ExpressionAttributeNames: {
        "#secret": "secret"
      }
    }));
  }
  
  // Resolver Commitment Management
  async saveResolverCommitment(commitment: ResolverCommitment): Promise<void> {
    const commitmentId = `${commitment.orderId}-${commitment.resolverAddress}-${commitment.timestamp}`;
    
    const item: ResolverCommitmentItem = {
      commitment_id: commitmentId,
      tradeId: commitment.orderId,
      resolverAddress: commitment.resolverAddress,
      acceptedPrice: commitment.acceptedPrice,
      timestamp: commitment.timestamp,
      status: "active",
      createdAt: Date.now()
    };
    
    await this.docClient.send(new PutCommand({
      TableName: this.commitmentsTableName,
      Item: item
    }));
  }
  
  async getResolverCommitments(orderId: string): Promise<ResolverCommitment[]> {
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.commitmentsTableName,
      IndexName: "TradeIdIndex",
      KeyConditionExpression: "tradeId = :tradeId",
      ExpressionAttributeValues: {
        ":tradeId": orderId
      },
      ScanIndexForward: false // Sort by timestamp DESC
    }));
    
    return (response.Items || []).map(item => ({
      orderId: item.tradeId,
      resolverAddress: item.resolverAddress,
      acceptedPrice: item.acceptedPrice,
      timestamp: item.timestamp
    }));
  }
  
  async updateCommitmentStatus(orderId: string, resolverAddress: string, status: string): Promise<void> {
    // Query to find the commitment
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.commitmentsTableName,
      IndexName: "TradeIdIndex",
      KeyConditionExpression: "tradeId = :tradeId",
      ExpressionAttributeValues: {
        ":tradeId": orderId
      }
    }));
    
    // Update matching commitments
    const updatePromises = (response.Items || [])
      .filter(item => item.resolverAddress === resolverAddress)
      .map(item => 
        this.docClient.send(new UpdateCommand({
          TableName: this.commitmentsTableName,
          Key: {
            commitment_id: item.commitment_id,
            tradeId: item.tradeId
          },
          UpdateExpression: "SET #status = :status",
          ExpressionAttributeNames: {
            "#status": "status"
          },
          ExpressionAttributeValues: {
            ":status": status
          }
        }))
      );
    
    await Promise.all(updatePromises);
  }
  
  // Order History
  async addOrderHistory(orderId: string, action: string, details?: string): Promise<void> {
    // For simplicity, we'll store history as part of the order item
    // In a production system, you might want a separate history table
    console.log(`[DynamoDB] Order history: ${orderId} - ${action}`);
  }
  
  async getOrderHistory(orderId: string): Promise<any[]> {
    // Simplified - in production you'd have a separate history table
    return [];
  }
  
  // Analytics
  async getOrderStats(): Promise<any> {
    // Scan the table and calculate stats
    // In production, you might maintain counters or use DynamoDB Streams
    const response = await this.docClient.send(new ScanCommand({
      TableName: this.tradesTableName,
      ProjectionExpression: "#status",
      ExpressionAttributeNames: {
        "#status": "status"
      }
    }));
    
    const items = response.Items || [];
    const stats = {
      total_orders: items.length,
      active_orders: items.filter(item => item.status === "active").length,
      completed_orders: items.filter(item => item.status === "completed").length,
      failed_orders: items.filter(item => item.status === "failed").length,
      rescue_available_orders: items.filter(item => item.status === "rescue_available").length
    };
    
    return stats;
  }
  
  async getResolverStats(resolverAddress: string): Promise<any> {
    const response = await this.docClient.send(new QueryCommand({
      TableName: this.commitmentsTableName,
      IndexName: "ResolverAddressIndex",
      KeyConditionExpression: "resolverAddress = :resolver",
      ExpressionAttributeValues: {
        ":resolver": resolverAddress
      }
    }));
    
    const items = response.Items || [];
    const stats = {
      total_commitments: items.length,
      completed_trades: items.filter(item => item.status === "completed").length,
      failed_trades: items.filter(item => item.status === "failed").length
    };
    
    return stats;
  }
  
  // Cleanup
  async cleanupOldOrders(daysToKeep: number = 30): Promise<number> {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    
    // Query completed and failed orders
    const completedOrders = await this.queryByStatus("completed");
    const failedOrders = await this.queryByStatus("failed");
    
    const ordersToDelete = [...completedOrders, ...failedOrders]
      .filter(order => order.createdAt < cutoffTime);
    
    // Batch delete old orders
    if (ordersToDelete.length > 0) {
      const chunks = [];
      for (let i = 0; i < ordersToDelete.length; i += 25) {
        chunks.push(ordersToDelete.slice(i, i + 25));
      }
      
      for (const chunk of chunks) {
        await this.docClient.send(new BatchWriteCommand({
          RequestItems: {
            [this.tradesTableName]: chunk.map(order => ({
              DeleteRequest: {
                Key: { tradeId: order.orderId }
              }
            }))
          }
        }));
      }
    }
    
    console.log(`[DynamoDB] Cleaned up ${ordersToDelete.length} old orders`);
    return ordersToDelete.length;
  }
  
  // Helper to convert DynamoDB item to OrderData
  private itemToOrderData(item: TradeItem): OrderData {
    return {
      orderId: item.tradeId,
      swapRequest: item.swapRequest,
      marketPrice: item.marketPrice,
      status: item.status as any,
      resolver: item.resolver,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      auctionStartPrice: item.auctionStartPrice,
      auctionEndPrice: item.auctionEndPrice,
      auctionDuration: item.auctionDuration,
      committedPrice: item.committedPrice,
      commitmentTime: item.commitmentTime,
      commitmentDeadline: item.commitmentDeadline,
      srcEscrowAddress: item.srcEscrowAddress,
      dstEscrowAddress: item.dstEscrowAddress,
      userFundsMoved: item.userFundsMoved,
      userFundsMovedAt: item.userFundsMovedAt,
      settlementTx: item.settlementTx,
      secretRevealedAt: item.secretRevealedAt,
      secretRevealTxHash: item.secretRevealTxHash
    };
  }
  
  // Graceful shutdown
  async close(): Promise<void> {
    console.log("[DynamoDB] Client closed");
    // DynamoDB client doesn't need explicit closing
  }
}