import {
  SQSClient,
  SendMessageCommand,
  SendMessageCommandInput,
  CreateQueueCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  SQSClientConfig
} from "@aws-sdk/client-sqs";
import { OrderData } from "../types";
import { config } from "../config";

export interface SQSOrderMessage {
  orderId: string;
  orderData: OrderData;
  timestamp: number;
  auctionStartPrice: string;
  auctionEndPrice: string;
  auctionDuration: number;
}

export class SQSService {
  private sqsClient: SQSClient;
  private queueUrl: string | null = null;
  private readonly queueName: string = "unite-defi-orders.fifo";
  
  constructor() {
    const sqsConfig: SQSClientConfig = {
      region: config.aws?.region || "us-east-1",
      credentials: config.aws?.credentials ? {
        accessKeyId: config.aws.credentials.accessKeyId,
        secretAccessKey: config.aws.credentials.secretAccessKey
      } : undefined
    };
    
    this.sqsClient = new SQSClient(sqsConfig);
    console.log("[SQS] Initialized SQS client for region:", sqsConfig.region);
  }
  
  async initialize(): Promise<void> {
    try {
      // Try to get existing queue URL
      const getQueueUrlCommand = new GetQueueUrlCommand({
        QueueName: this.queueName
      });
      
      try {
        const response = await this.sqsClient.send(getQueueUrlCommand);
        this.queueUrl = response.QueueUrl!;
        console.log("[SQS] Using existing queue:", this.queueUrl);
      } catch (error: any) {
        if (error.name === "QueueDoesNotExist") {
          // Create new FIFO queue
          console.log("[SQS] Queue does not exist, creating new FIFO queue...");
          await this.createQueue();
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error("[SQS] Failed to initialize SQS service:", error);
      throw error;
    }
  }
  
  private async createQueue(): Promise<void> {
    const createQueueCommand = new CreateQueueCommand({
      QueueName: this.queueName,
      Attributes: {
        // FIFO queue attributes
        FifoQueue: "true",
        ContentBasedDeduplication: "true",
        // Message retention period (7 days)
        MessageRetentionPeriod: "604800",
        // Visibility timeout (5 minutes to match order timeout)
        VisibilityTimeout: "300",
        // Long polling
        ReceiveMessageWaitTimeSeconds: "20"
      }
    });
    
    const response = await this.sqsClient.send(createQueueCommand);
    this.queueUrl = response.QueueUrl!;
    console.log("[SQS] Created new FIFO queue:", this.queueUrl);
  }
  
  async broadcastOrder(
    orderId: string,
    orderData: OrderData,
    auctionStartPrice: string,
    auctionEndPrice: string,
    auctionDuration: number
  ): Promise<void> {
    if (!this.queueUrl) {
      throw new Error("SQS queue not initialized");
    }
    
    const message: SQSOrderMessage = {
      orderId,
      orderData,
      timestamp: Date.now(),
      auctionStartPrice,
      auctionEndPrice,
      auctionDuration
    };
    
    const params: SendMessageCommandInput = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message),
      // FIFO specific attributes
      MessageGroupId: "orders", // All orders in same group for ordering
      MessageDeduplicationId: orderId // Use order ID for deduplication
    };
    
    try {
      const command = new SendMessageCommand(params);
      const response = await this.sqsClient.send(command);
      console.log(`[SQS] Broadcasted order ${orderId} to queue. MessageId: ${response.MessageId}`);
    } catch (error) {
      console.error(`[SQS] Failed to broadcast order ${orderId}:`, error);
      throw error;
    }
  }
  
  async getQueueUrl(): Promise<string> {
    if (!this.queueUrl) {
      await this.initialize();
    }
    return this.queueUrl!;
  }
}