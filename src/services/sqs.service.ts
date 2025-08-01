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
  srcTokenDecimals?: number;
  dstTokenDecimals?: number;
}

export interface SQSSecretMessage {
  orderId: string;
  secret: string;
  resolverAddress: string;
  srcEscrowAddress: string;
  dstEscrowAddress: string;
  srcChainId: number;
  dstChainId: number;
  srcAmount: string;
  dstAmount: string;
  timestamp: number;
  competitionDeadline: number; // 5 minutes from now
}

export class SQSService {
  private sqsClient: SQSClient;
  private queueUrl: string = "";
  private secretsQueueUrl: string = "";
  private readonly queueName: string = "UniteDefiIntentQueue";
  private readonly secretsQueueName: string = "SecretsQueue";

  constructor() {
    const sqsConfig: SQSClientConfig = {
      region: config.aws?.region || "us-east-1",
      credentials: config.aws?.credentials
        ? {
            accessKeyId: config.aws.credentials.accessKeyId,
            secretAccessKey: config.aws.credentials.secretAccessKey
          }
        : undefined
    };

    this.sqsClient = new SQSClient(sqsConfig);
    console.log("[SQS] Initialized SQS client for region:", sqsConfig.region);
  }

  async initialize(): Promise<void> {
    try {
      // Initialize both queues
      await Promise.all([
        this.initializeQueue(this.queueName, "queueUrl"),
        this.initializeQueue(this.secretsQueueName, "secretsQueueUrl")
      ]);
    } catch (error) {
      console.error("[SQS] Failed to initialize SQS service:", error);
      throw error;
    }
  }

  private async initializeQueue(queueName: string, urlProperty: "queueUrl" | "secretsQueueUrl"): Promise<void> {
    try {
      // Try to get existing queue URL
      const getQueueUrlCommand = new GetQueueUrlCommand({
        QueueName: queueName
      });

      try {
        const response = await this.sqsClient.send(getQueueUrlCommand);
        this[urlProperty] = response.QueueUrl!;
        console.log(`[SQS] Using existing queue ${queueName}:`, this[urlProperty]);
      } catch (error: any) {
        if (error.name === "QueueDoesNotExist") {
          // Create new queue
          console.log(`[SQS] Queue ${queueName} does not exist, creating new queue...`);
          await this.createQueue(queueName, urlProperty);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error(`[SQS] Failed to initialize queue ${queueName}:`, error);
      throw error;
    }
  }

  private async createQueue(queueName: string, urlProperty: "queueUrl" | "secretsQueueUrl"): Promise<void> {
    const createQueueCommand = new CreateQueueCommand({
      QueueName: queueName,
      Attributes: {
        // Message retention period (7 days)
        MessageRetentionPeriod: "604800",
        // Visibility timeout (5 minutes to match order timeout)
        VisibilityTimeout: "300",
        // Long polling
        ReceiveMessageWaitTimeSeconds: "20"
      }
    });

    const response = await this.sqsClient.send(createQueueCommand);
    this[urlProperty] = response.QueueUrl!;
    console.log(`[SQS] Created new queue ${queueName}:`, this[urlProperty]);
  }

  async broadcastOrder(
    orderId: string,
    orderData: OrderData,
    auctionStartPrice: string,
    auctionEndPrice: string,
    auctionDuration: number,
    srcTokenDecimals?: number,
    dstTokenDecimals?: number
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
      auctionDuration,
      srcTokenDecimals,
      dstTokenDecimals
    };

    const params: SendMessageCommandInput = {
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message)
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

  async broadcastSecret(secretMessage: SQSSecretMessage): Promise<void> {
    if (!this.secretsQueueUrl) {
      throw new Error("Secrets queue not initialized");
    }

    const params: SendMessageCommandInput = {
      QueueUrl: this.secretsQueueUrl,
      MessageBody: JSON.stringify(secretMessage)
    };

    try {
      const command = new SendMessageCommand(params);
      const response = await this.sqsClient.send(command);
      console.log(`[SQS] Broadcasted secret for order ${secretMessage.orderId} to SecretsQueue. MessageId: ${response.MessageId}`);
      console.log(`[SQS] Competition deadline: ${new Date(secretMessage.competitionDeadline).toISOString()}`);
    } catch (error) {
      console.error(`[SQS] Failed to broadcast secret for order ${secretMessage.orderId}:`, error);
      throw error;
    }
  }

  async getQueueUrl(): Promise<string> {
    if (!this.queueUrl) {
      await this.initialize();
    }
    return this.queueUrl!;
  }

  async getSecretsQueueUrl(): Promise<string> {
    if (!this.secretsQueueUrl) {
      await this.initialize();
    }
    return this.secretsQueueUrl!;
  }
}
